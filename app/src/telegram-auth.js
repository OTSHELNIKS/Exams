// Токен бота и секрет браузера независимы; ни один сам по себе не даёт вход.
const KEY = 'name:telegram-auth:v1'
const TIMEOUT_MS = 12000
function baseUrl() {
  const fromWindow = typeof window !== 'undefined' ? window.__NAME_SUPABASE_URL__ : ''
  return String(fromWindow || import.meta.env?.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
}
function randomVerifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function digest(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(hash), (x) => x.toString(16).padStart(2, '0')).join('')
}
async function post(action, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const result = await fetch(`${baseUrl()}/functions/v1/telegram-auth?action=${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
    })
    const data = await result.json().catch(() => ({}))
    if (!result.ok) throw new Error(data.error || 'unavailable')
    return data
  } finally { clearTimeout(timer) }
}
export function loadTelegramAuth() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    if (value && value.expiresAt > Date.now() && /^[A-Za-z0-9_-]{43}$/.test(value.verifier) && /^[A-Za-z0-9_-]{43}$/.test(value.botToken) && /^[0-9a-f-]{36}$/.test(value.id)) return value
    sessionStorage.removeItem(KEY)
  } catch { /* sessionStorage может быть недоступен */ }
  return null
}
export function clearTelegramAuth() { try { sessionStorage.removeItem(KEY) } catch { /* noop */ } }
export function saveTelegramAuth(pending) { try { sessionStorage.setItem(KEY, JSON.stringify(pending)) } catch { /* работает до закрытия вкладки */ } }
export async function beginTelegramAuth() {
  const verifier = randomVerifier()
  const data = await post('begin', { verifierHash: await digest(verifier) })
  if (!/^[A-Za-z0-9_-]{43}$/.test(data.botToken || '') || !/^[0-9a-f-]{36}$/.test(data.id || '') || !Number.isFinite(data.expiresIn)) throw new Error('unavailable')
  return { id: data.id, botToken: data.botToken, verifier, expiresAt: Date.now() + Math.min(data.expiresIn, 300) * 1000 }
}
export async function completeTelegramAuth(pending, client, isCurrent = () => true) {
  if (!pending || pending.expiresAt <= Date.now()) throw new Error('expired')
  const data = await post('complete', { id: pending.id, verifier: pending.verifier })
  if (!isCurrent()) return { cancelled: true }
  if (data.status === 'pending') return { pending: true }
  if (!data.tokenHash || !client) throw new Error('unavailable')
  const { error } = await client.auth.verifyOtp({ type: 'magiclink', token_hash: data.tokenHash })
  if (error) throw new Error('unavailable')
  return { ok: true }
}
