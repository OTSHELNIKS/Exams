// One-time Telegram bot authorization for already linked NAME accounts.
// Deployment requires JWT verification disabled for this function; its actions
// are protected by unguessable split secrets, short TTL and atomic server RPCs.
// Test on staging, including link security and rate limiting, before production.
const BASE = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '')
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
// Enable only after proving that ALL traffic passes through the trusted proxy,
// which must strip caller-supplied CF-Connecting-IP. No X-Forwarded-For fallback.
const TRUST_PROXY = Deno.env.get('TELEGRAM_AUTH_TRUST_PROXY') === 'cloudflare'
const IP_KEY = Deno.env.get('TELEGRAM_AUTH_IP_HMAC_KEY') || ''
const MAX_BODY = 4096
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }) }
function headers() { return { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' } }
async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, '0')).join('')
}
// Normalise equivalent addresses, grouping IPv6 clients by /64 so a single
// delegated prefix cannot cheaply rotate through the per-address allowance.
function clientAddress(raw) {
  if (typeof raw !== 'string' || raw.length > 45 || raw !== raw.trim()) return null
  if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(raw)) {
    const nums = raw.split('.').map(Number)
    return nums.every((n) => n <= 255) ? 'v4:' + nums.join('.') : null
  }
  if (!raw.includes(':') || !/^[0-9a-fA-F:.]+$/.test(raw)) return null
  try {
    const hostname = new URL('http://[' + raw + ']/').hostname
    const address = hostname.slice(1, -1), parts = address.split('::')
    if (parts.length > 2) return null
    const left = parts[0] ? parts[0].split(':') : [], right = parts.length === 2 && parts[1] ? parts[1].split(':') : []
    const zeros = 8 - left.length - right.length
    if ((parts.length === 1 && zeros !== 0) || (parts.length === 2 && zeros < 1)) return null
    const groups = [...left, ...Array(zeros).fill('0'), ...right].map((v) => parseInt(v, 16))
    if (groups.length !== 8 || groups.some((v) => !Number.isInteger(v) || v < 0 || v > 65535)) return null
    if (groups.slice(0, 5).every((v) => v === 0) && groups[5] === 65535) {
      return 'v4:' + [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.')
    }
    return 'v6:' + groups.slice(0, 4).map((v) => v.toString(16)).join(':') + '/64'
  } catch { return null }
}
async function hmacAddress(address) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(IP_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(address))
  return Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, '0')).join('')
}
async function readBody(req) {
  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > MAX_BODY) throw new Error('body_too_large')
  if (!req.body) throw new Error('bad_request')
  const reader = req.body.getReader(), chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY) { await reader.cancel().catch(() => {}); throw new Error('body_too_large') }
    chunks.push(value)
  }
  const buffer = new Uint8Array(total); let offset = 0
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
  try { const value = JSON.parse(new TextDecoder().decode(buffer)); return value && typeof value === 'object' && !Array.isArray(value) ? value : null } catch { return null }
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function rpc(name, args) {
  const result = await fetch(BASE + '/rest/v1/rpc/' + name, { method: 'POST', headers: headers(), body: JSON.stringify(args) })
  if (!result.ok) throw new Error('database unavailable')
  const data = await result.json()
  if (!data || typeof data !== 'object') throw new Error('database response')
  return data
}
async function magicLinkToken(id) {
  const r = await fetch(BASE + '/auth/v1/admin/users/' + encodeURIComponent(id), { headers: headers() })
  if (!r.ok) return null
  const user = await r.json()
  if (!user?.email) return null
  const link = await fetch(BASE + '/auth/v1/admin/generate_link', { method: 'POST', headers: headers(), body: JSON.stringify({ type: 'magiclink', email: user.email }) })
  if (!link.ok) return null
  const data = await link.json()
  return data?.properties?.hashed_token || data?.hashed_token || null
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST' || !BASE || !SERVICE || !TRUST_PROXY || IP_KEY.length < 32) return json({ error: 'unavailable' }, 503)
  const action = new URL(req.url).searchParams.get('action')
  if (action !== 'begin' && action !== 'complete') return json({ error: 'not_found' }, 404)
  // Never fall back to caller-controlled headers. If the trusted identity or
  // the shared limiter is unavailable, do not create or consume any token.
  const address = clientAddress(req.headers.get('cf-connecting-ip'))
  if (!address) return json({ error: 'unavailable' }, 503)
  try {
    const budget = await rpc('claim_telegram_auth_rate_limit', { p_identity_hash: await hmacAddress(address), p_action: action })
    if (budget.ok === false) return json({ error: 'too_many_requests' }, 429)
    if (budget.ok !== true) return json({ error: 'unavailable' }, 503)
    const body = await readBody(req)
    if (!body) return json({ error: 'bad_request' }, 400)
    if (action === 'begin') {
      if (!/^[0-9a-f]{64}$/.test(body.verifierHash || '')) return json({ error: 'bad_request' }, 400)
      const botToken = randomToken(), id = crypto.randomUUID()
      const result = await rpc('begin_telegram_token_auth', { p_id: id, p_bot_hash: await sha256(botToken), p_verifier_hash: body.verifierHash })
      if (!result.ok) return json({ error: result.error || 'internal' }, result.error === 'busy' ? 429 : 500)
      return json({ id, botToken, expiresIn: 300 })
    }
    if (action === 'complete') {
      if (!/^[0-9a-f-]{36}$/.test(body.id || '') || !/^[A-Za-z0-9_-]{43}$/.test(body.verifier || '')) return json({ error: 'bad_request' }, 400)
      const result = await rpc('consume_telegram_token_auth', { p_id: body.id, p_verifier_hash: await sha256(body.verifier) })
      if (result.status === 'pending') return json({ status: 'pending' })
      if (!result.ok || !result.user_id) return json({ error: 'expired' }, 401)
      const tokenHash = await magicLinkToken(result.user_id)
      if (!tokenHash) return json({ error: 'unavailable' }, 503)
      return json({ tokenHash })
    }
    return json({ error: 'not_found' }, 404)
  } catch (error) {
    if (error?.message === 'body_too_large') return json({ error: 'body_too_large' }, 413)
    if (error?.message === 'bad_request') return json({ error: 'bad_request' }, 400)
    return json({ error: 'unavailable' }, 503)
  }
})
