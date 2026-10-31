// NAME MLBB — привязка TikTok через Login Kit (OAuth 2.0, обмен кода на сервере).
//
// Почему нужен сервер: TikTok отдаёт токен только вместе с client_secret, а
// секрет нельзя держать в браузере. Функция меняет код на токен, забирает ник
// и аватар, токены НЕ сохраняет и наружу не отдаёт.
//
//   POST /?action=exchange { code, redirectUri } -> { openId, handle, name, avatar }
//   GET  /?health=1                              -> { ok, build, configured }
//
// Секреты проекта: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET.

const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const USER_URL = 'https://open.tiktokapis.com/v2/user/info/'
const BUILD = 'tiktok-auth-v1'

const CLIENT_KEY = (Deno.env.get('TIKTOK_CLIENT_KEY') || '').trim()
const CLIENT_SECRET = (Deno.env.get('TIKTOK_CLIENT_SECRET') || '').trim()

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS),
  })
}

async function readJson(req) { try { return await req.json() } catch (e) { return {} } }

// Код из TikTok приходит в query и может быть URL-кодирован дважды.
function cleanCode(value) {
  let code = String(value || '').trim()
  if (/%[0-9a-f]{2}/i.test(code)) { try { code = decodeURIComponent(code) } catch (e) { /* оставляем как есть */ } }
  return code
}

async function exchange(code, redirectUri) {
  const body = new URLSearchParams({
    client_key: CLIENT_KEY,
    client_secret: CLIENT_SECRET,
    code: code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: body.toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    const reason = data.error_description || data.error || ('HTTP ' + res.status)
    console.error('tiktok token failed', String(reason).slice(0, 200))
    return { error: String(reason) }
  }
  return {
    accessToken: data.access_token,
    openId: String(data.open_id || ''),
  }
}

// Ник и аватар. Ошибку не считаем фатальной: open_id уже подтверждён TikTok.
async function profile(accessToken, openId) {
  try {
    const url = USER_URL + '?fields=' + encodeURIComponent('open_id,display_name,avatar_url')
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } })
    const data = await res.json().catch(() => ({}))
    const user = (data && data.data && data.data.user) || {}
    const handle = String(user.display_name || '').trim()
    return { handle: handle, name: handle, avatar: String(user.avatar_url || '') }
  } catch (e) {
    console.error('tiktok profile threw', String(e))
    return { handle: '', name: '', avatar: '' }
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method === 'GET' && url.searchParams.get('health') !== null) {
    return json({ ok: true, build: BUILD, configured: Boolean(CLIENT_KEY && CLIENT_SECRET) })
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'not_found' }, 404)

  const action = url.searchParams.get('action')
  if (action !== 'exchange') return json({ ok: false, error: 'not_found' }, 404)

  if (!CLIENT_KEY || !CLIENT_SECRET) {
    return json({ ok: false, error: 'not_configured' }, 503)
  }

  try {
    const body = await readJson(req)
    const code = cleanCode(body.code)
    const redirectUri = String(body.redirectUri || '').trim()
    if (!code) return json({ ok: false, error: 'bad_request' }, 400)
    if (!redirectUri) return json({ ok: false, error: 'bad_redirect' }, 400)

    const tokens = await exchange(code, redirectUri)
    if (tokens.error) {
      const raw = tokens.error.toLowerCase()
      const known = raw.includes('redirect') ? 'redirect_mismatch'
        : raw.includes('expired') || raw.includes('invalid code') ? 'code_expired'
        : 'token_failed'
      return json({ ok: false, error: known, detail: tokens.error.slice(0, 160) }, 400)
    }

    const info = await profile(tokens.accessToken, tokens.openId)
    // Токены живут только внутри запроса: клиенту нужен ник, а не доступ к аккаунту.
    return json({
      ok: true,
      openId: tokens.openId,
      handle: info.handle,
      name: info.name,
      avatar: info.avatar,
    })
  } catch (e) {
    console.error('tiktok-auth failed', String(e))
    return json({ ok: false, error: 'internal' }, 500)
  }
})
