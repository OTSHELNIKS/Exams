// NAME MLBB — вход через саму игру (Mobile Legends: Bang Bang).
// Edge function `game-login`. Dependency-free: plain fetch + PostgREST.
//
// Игрок не вводит почту и пароль: он указывает свой Game ID и сервер, получает
// шестизначный код в Telegram от бота @name_mlbb_bot и вводит его на сайте.
//
//   POST /?action=code     { gameId, gameServer }        -> код уходит в Telegram
//   POST /?action=session  { gameId, gameServer, code }  -> { tokenHash }
//
// Клиент меняет tokenHash на сессию через supabase.auth.verifyOtp({ type:
// 'magiclink', token_hash }), то есть пароль не нужен вообще.
//
// Безопасность:
//   - код живёт 5 минут, одноразовый, на игрока не больше одного активного;
//   - не чаще одного запроса кода в 30 секунд на профиль (защита от спама);
//   - код привязан к Game ID: чужой код не подойдёт к другому аккаунту;
//   - в ответах нет ни почты, ни id пользователя — только причина отказа;
//   - таблица game_login_codes закрыта для anon/authenticated (RLS + revoke),
//     работает только service role этой функции.
//
// Секреты функции: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN
// (последние два Supabase подставляет сам для этого проекта).

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '')
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''
const BUILD = 'game-login-v1'
const CODE_TTL_MS = 5 * 60 * 1000
const COOLDOWN_MS = 30 * 1000

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

function svcHeaders(extra) {
  return Object.assign(
    { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
    extra || {},
  )
}

async function dbSelect(table, params) {
  try {
    const q = new URLSearchParams(params || {}).toString()
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + (q ? '?' + q : ''), { headers: svcHeaders() })
    if (!r.ok) { console.error('db select failed', table, r.status); return [] }
    const j = await r.json().catch(() => [])
    return Array.isArray(j) ? j : []
  } catch (e) {
    console.error('db select threw', table, String(e))
    return []
  }
}

async function dbInsert(table, row) {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: svcHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify(row),
    })
    if (!r.ok) { console.error('db insert failed', table, r.status); return false }
    return true
  } catch (e) {
    console.error('db insert threw', table, String(e))
    return false
  }
}

async function dbDelete(table, params) {
  try {
    const q = new URLSearchParams(params || {}).toString()
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + (q ? '?' + q : ''), {
      method: 'DELETE', headers: svcHeaders(),
    })
    if (!r.ok) console.error('db delete failed', table, r.status)
    return r.ok
  } catch (e) {
    console.error('db delete threw', table, String(e))
    return false
  }
}

async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN) { console.error('no bot token'); return false }
  try {
    const r = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.ok === false) console.error('telegram send failed', JSON.stringify(j).slice(0, 300))
    return !!(j && j.ok)
  } catch (e) {
    console.error('telegram send threw', String(e))
    return false
  }
}

function digits(value, max) {
  return String(value === undefined || value === null ? '' : value).replace(/[^0-9]/g, '').slice(0, max)
}

async function readJson(req) {
  try { return await req.json() } catch (e) { return {} }
}

async function findProfile(gameId, gameServer) {
  const filters = { game_id: 'eq.' + gameId, select: 'user_id,game_id,game_server,nick', order: 'updated_at.desc' }
  if (gameServer) filters.game_server = 'eq.' + gameServer
  const rows = await dbSelect('player_profiles', filters)
  return rows[0] || null
}

// Шаг 1: находим профиль по Game ID, шлём код в привязанный Telegram.
async function handleCode(req) {
  const body = await readJson(req)
  const gameId = digits(body.gameId, 12)
  const gameServer = digits(body.gameServer, 6)
  if (!/^[0-9]{6,12}$/.test(gameId)) return json({ ok: false, error: 'bad_game_id' }, 400)

  const profile = await findProfile(gameId, gameServer)
  if (!profile) return json({ ok: false, error: 'profile_not_found' }, 404)

  const links = await dbSelect('telegram_links', { user_id: 'eq.' + profile.user_id, select: 'tg_chat_id' })
  if (!links[0]) return json({ ok: false, error: 'telegram_not_linked' }, 409)

  const recent = await dbSelect('game_login_codes', {
    user_id: 'eq.' + profile.user_id, select: 'created_at', order: 'created_at.desc', limit: '1',
  })
  if (recent[0] && Date.now() - new Date(recent[0].created_at).getTime() < COOLDOWN_MS) {
    return json({ ok: false, error: 'too_often' }, 429)
  }

  await dbDelete('game_login_codes', { user_id: 'eq.' + profile.user_id })
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const saved = await dbInsert('game_login_codes', {
    code: code,
    user_id: profile.user_id,
    game_id: gameId,
    game_server: gameServer || profile.game_server || '',
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (!saved) return json({ ok: false, error: 'internal' }, 500)

  const sent = await sendTelegram(links[0].tg_chat_id,
    '🔐 <b>Код входа на NAME</b>\n\n<code>' + code + '</code>\n\n' +
    'Введи его на сайте в течение 5 минут: Game ID <code>' + gameId + '</code>' +
    (gameServer ? ' · сервер <code>' + gameServer + '</code>' : '') + '.\n\n' +
    'Если это был не ты — просто проигнорируй сообщение.')
  if (!sent) return json({ ok: false, error: 'telegram_failed' }, 502)

  return json({ ok: true, ttl: Math.round(CODE_TTL_MS / 1000), nick: profile.nick || null })
}

// Одноразовая ссылка Supabase -> token_hash, который клиент меняет на сессию.
async function magicLinkToken(userId) {
  try {
    const userRes = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + encodeURIComponent(userId), { headers: svcHeaders() })
    if (!userRes.ok) { console.error('admin user failed', userRes.status); return null }
    const user = await userRes.json().catch(() => null)
    const email = user && user.email
    if (!email) return null
    const linkRes = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
      method: 'POST',
      headers: svcHeaders(),
      body: JSON.stringify({ type: 'magiclink', email: email }),
    })
    const link = await linkRes.json().catch(() => null)
    if (!linkRes.ok || !link) { console.error('generate link failed', linkRes.status); return null }
    const props = link.properties || link
    return props.hashed_token || link.hashed_token || null
  } catch (e) {
    console.error('magicLinkToken threw', String(e))
    return null
  }
}

// Шаг 2: проверяем код и отдаём token_hash.
async function handleSession(req) {
  const body = await readJson(req)
  const gameId = digits(body.gameId, 12)
  const gameServer = digits(body.gameServer, 6)
  const code = digits(body.code, 6)
  if (!/^[0-9]{6,12}$/.test(gameId) || !/^[0-9]{6}$/.test(code)) {
    return json({ ok: false, error: 'bad_request' }, 400)
  }

  const rows = await dbSelect('game_login_codes', { code: 'eq.' + code, select: '*' })
  const row = rows[0]
  if (!row) return json({ ok: false, error: 'bad_code' }, 401)
  if (String(row.game_id) !== gameId) return json({ ok: false, error: 'bad_code' }, 401)
  if (row.game_server && gameServer && String(row.game_server) !== gameServer) {
    return json({ ok: false, error: 'bad_code' }, 401)
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await dbDelete('game_login_codes', { code: 'eq.' + code })
    return json({ ok: false, error: 'code_expired' }, 401)
  }

  // Код одноразовый: гасим до обмена, чтобы повтор не сработал.
  await dbDelete('game_login_codes', { code: 'eq.' + code })
  const tokenHash = await magicLinkToken(row.user_id)
  if (!tokenHash) return json({ ok: false, error: 'no_email' }, 409)
  return json({ ok: true, tokenHash: tokenHash })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method === 'GET' && url.searchParams.get('health') !== null) {
    return json({ ok: true, build: BUILD, time: new Date().toISOString() })
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'not_found' }, 404)
  const action = url.searchParams.get('action')
  try {
    if (action === 'code') return await handleCode(req)
    if (action === 'session') return await handleSession(req)
  } catch (e) {
    console.error('game-login failed', String(e))
    return json({ ok: false, error: 'internal' }, 500)
  }
  return json({ ok: false, error: 'not_found' }, 404)
})
