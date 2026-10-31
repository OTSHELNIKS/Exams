// NAME MLBB — вход через саму игру (Mobile Legends: Bang Bang).
// Edge function `game-login`. Dependency-free: plain fetch + PostgREST.
//
// Игрок не вводит почту и пароль: он указывает Game ID и сервер и подтверждает
// владение аккаунтом одним из двух способов:
//
//   channel=ingame   (основной) — код приходит НА ВНУТРИИГРОВУЮ ПОЧТУ MLBB:
//                    игрок открывает игру, читает письмо и вводит код на сайте;
//   channel=telegram (запасной) — код приходит в привязанный Telegram-бот.
//
//   POST /?action=code     { gameId, gameServer, channel } -> код отправлен
//   POST /?action=session  { gameId, gameServer, code, channel } -> { tokenHash }
//   POST /?action=stats    { gameId, gameServer, code } -> обновление КДА/винрейта
//
// Клиент меняет tokenHash на сессию через supabase.auth.verifyOtp({ type:
// 'magiclink', token_hash }), то есть пароль не нужен вообще.
//
// Безопасность:
//   - код живёт 5 минут, одноразовый, на игрока не больше одной попытки;
//   - не чаще одного запроса кода в 30 секунд на профиль (защита от спама);
//   - 5 неверных вводов — попытка сгорает, нужен новый код;
//   - код привязан к Game ID и серверу: чужой код не подойдёт к другому аккаунту;
//   - в ответах нет ни почты, ни id пользователя — только причина отказа;
//   - код запрашивается только для профиля, который уже есть в NAME: на чужой
//     Game ID письмо в игру не отправить (иначе мы были бы бесплатным спамером);
//   - статус «аккаунт подтверждён» ставится ТОЛЬКО после кода из игры
//     (player_profiles.game_verified_at / game_verified_id), заполненный в
//     анкете Game ID сам по себе ничего не подтверждает;
//   - таблица game_login_codes закрыта для anon/authenticated (RLS + revoke).
//
// Внутриигровую почту нельзя отправить напрямую: у Moonton нет публичного API.
// Используется игровой шлюз, который отправляет официальное письмо с кодом на
// аккаунт MLBB (тот же механизм, что и на официальной странице обмена кодов).
// Секрета он не требует; если шлюз недоступен, клиент предлагает Telegram.
//
// Секреты функции: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN.

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '')
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''
const BUILD = 'game-login-v6'
const CODE_TTL_MS = 5 * 60 * 1000
const COOLDOWN_MS = 30 * 1000
const MAX_ATTEMPTS = 5
// Зеркала игрового шлюза: если основное недоступно, пробуем второе.
const GAME_API_BASES = [
  'https://arena.rone.dev/api',
  'https://arena.fastapicloud.dev/api',
]

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
  } catch (e) { console.error('db select threw', table, String(e)); return [] }
}

async function dbInsert(table, row) {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
      method: 'POST', headers: svcHeaders({ Prefer: 'return=minimal' }), body: JSON.stringify(row),
    })
    if (!r.ok) { console.error('db insert failed', table, r.status); return false }
    return true
  } catch (e) { console.error('db insert threw', table, String(e)); return false }
}

async function dbPatch(table, params, patch) {
  try {
    const q = new URLSearchParams(params || {}).toString()
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + (q ? '?' + q : ''), {
      method: 'PATCH', headers: svcHeaders({ Prefer: 'return=minimal' }), body: JSON.stringify(patch),
    })
    if (!r.ok) { console.error('db patch failed', table, r.status); return false }
    return true
  } catch (e) { console.error('db patch threw', table, String(e)); return false }
}

async function dbDelete(table, params) {
  try {
    const q = new URLSearchParams(params || {}).toString()
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + (q ? '?' + q : ''), { method: 'DELETE', headers: svcHeaders() })
    if (!r.ok) console.error('db delete failed', table, r.status)
    return r.ok
  } catch (e) { console.error('db delete threw', table, String(e)); return false }
}

async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN) { console.error('no bot token'); return false }
  try {
    const r = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.ok === false) console.error('telegram send failed', JSON.stringify(j).slice(0, 300))
    return !!(j && j.ok)
  } catch (e) { console.error('telegram send threw', String(e)); return false }
}

function digits(value, max) {
  return String(value === undefined || value === null ? '' : value).replace(/[^0-9]/g, '').slice(0, max)
}

async function readJson(req) { try { return await req.json() } catch (e) { return {} } }

// ---------------------------------------------------------------- игровой шлюз

async function gameApi(path, body) {
  for (const base of GAME_API_BASES) {
    try {
      const r = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json().catch(() => null)
      if (r.ok && data && typeof data.code === 'number') return data
      console.error('game api bad response', base, r.status)
    } catch (e) {
      console.error('game api threw', base, String(e))
    }
  }
  return null
}

// Просим игру отправить письмо с кодом на аккаунт игрока.
async function sendInGameCode(gameId, gameServer) {
  const data = await gameApi('/user/auth/send-vc', {
    role_id: Number(gameId),
    zone_id: Number(gameServer || 0),
  })
  if (!data) return { error: 'ingame_unavailable' }
  if (data.code !== 0) {
    console.error('send-vc refused', String(data.msg || '').slice(0, 120))
    return { error: 'ingame_failed' }
  }
  return { ok: true }
}

// Проверяем код из внутриигровой почты. Шлюз возвращает сам аккаунт — сверяем
// role_id и zone_id с тем, что ввёл игрок: код от другого аккаунта не подойдёт.
async function verifyInGameCode(gameId, gameServer, code) {
  const data = await gameApi('/user/auth/login', {
    role_id: Number(gameId),
    zone_id: Number(gameServer || 0),
    vc: String(code),
  })
  if (!data) return { error: 'ingame_unavailable' }
  if (data.code !== 0 || !data.data) return { error: 'bad_code' }
  const roleId = String(data.data.roleid || gameId)
  const zoneId = String(data.data.zoneid || gameServer || '')
  if (roleId !== gameId) return { error: 'bad_code' }
  if (gameServer && zoneId && zoneId !== gameServer) return { error: 'bad_code' }
  // JWT игры остаётся на сервере: он нужен, чтобы забрать КДА и винрейт.
  // Клиенту он не отдаётся никогда.
  return { ok: true, jwt: String(data.data.jwt || data.data.token || '') }
}

// ------------------------------------------------------------- статистика
// Общие цифры игрока: винрейт из /user/stats (wc/tc), КДА — по последним
// матчам ((убийства + помощь) / смерти). Работает только с игровым JWT,
// то есть только сразу после подтверждения кодом из внутриигровой почты.
function statsFromGame(stats, matches) {
  const patch = {}
  if (stats) {
    const wc = Number(stats.wc)
    const tc = Number(stats.tc)
    if (Number.isFinite(wc) && Number.isFinite(tc) && tc > 0) {
      patch.game_winrate = Math.round((wc / tc) * 100)
      patch.game_matches = tc
    }
  }
  if (Array.isArray(matches) && matches.length) {
    let kills = 0, deaths = 0, assists = 0
    for (const m of matches) {
      kills += Number(m && m.k) || 0
      deaths += Number(m && m.d) || 0
      assists += Number(m && m.a) || 0
    }
    const kda = deaths > 0 ? (kills + assists) / deaths : kills + assists
    patch.game_kda = Math.round(kda * 100) / 100
    if (patch.game_matches === undefined) patch.game_matches = matches.length
  }
  return Object.keys(patch).length ? patch : null
}

// Ответы шлюза бывают разной вложенности: `data.wc`, `data.stats.wc`, иногда
// массив прямо в `data`. Достаём и то, и другое, чтобы не терять цифры.
function pickStats(j) {
  const d = j && j.data
  if (!d) return null
  if (d.stats && typeof d.stats === 'object') return d.stats
  if (typeof d === 'object' && !Array.isArray(d)) return d
  return null
}

function pickMatches(j) {
  const d = j && j.data
  if (!d) return null
  if (Array.isArray(d)) return d
  if (Array.isArray(d.result)) return d.result
  if (d.data && Array.isArray(d.data.result)) return d.data.result
  if (d.matches && Array.isArray(d.matches)) return d.matches
  return null
}

async function gameGet(base, path, jwt) {
  const headers = { Authorization: 'Bearer ' + jwt, Accept: 'application/json' }
  const r = await fetch(base + path, { headers })
  const j = await r.json().catch(() => null)
  if (!r.ok || !j || j.code !== 0) {
    console.error('game get failed', base + path, r.status, String((j && j.msg) || '').slice(0, 120))
    return null
  }
  return j
}

async function fetchGameStats(jwt) {
  if (!jwt) { console.error('no game jwt — статистика не запрашивается'); return null }
  for (const base of GAME_API_BASES) {
    let stats = null
    let matches = null
    try {
      const j = await gameGet(base, '/user/stats', jwt)
      stats = pickStats(j)
      if (stats) console.error('stats ok', base, JSON.stringify(stats).slice(0, 200))
    } catch (e) { console.error('stats threw', base, String(e)) }
    try {
      const j = await gameGet(base, '/user/matches?limit=20', jwt)
      matches = pickMatches(j)
      if (matches) console.error('matches ok', base, matches.length)
    } catch (e) { console.error('matches threw', base, String(e)) }
    if (stats || matches) return { stats, matches }
  }
  return null
}

// ------------------------------------------------------------------- профиль

async function findProfile(gameId, gameServer) {
  const filters = { game_id: 'eq.' + gameId, select: 'user_id,game_id,game_server,nick', order: 'updated_at.desc' }
  if (gameServer) filters.game_server = 'eq.' + gameServer
  const rows = await dbSelect('player_profiles', filters)
  return rows[0] || null
}

async function telegramChatOf(userId) {
  const links = await dbSelect('telegram_links', { user_id: 'eq.' + userId, select: 'tg_chat_id' })
  return links[0] ? links[0].tg_chat_id : null
}

// Одна активная попытка на игрока: старые стираем, чтобы не копились коды.
async function startAttempt(profile, gameId, gameServer, channel) {
  await dbDelete('game_login_codes', { user_id: 'eq.' + profile.user_id })
  return dbInsert('game_login_codes', {
    code: (channel === 'ingame' ? 'ig-' : '') + crypto.randomUUID(),
    user_id: profile.user_id,
    game_id: gameId,
    game_server: gameServer || profile.game_server || '',
    channel,
    attempts: 0,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
}

async function latestAttempt(userId) {
  const rows = await dbSelect('game_login_codes', {
    user_id: 'eq.' + userId, select: '*', order: 'created_at.desc', limit: '1',
  })
  return rows[0] || null
}

async function cooldownLeft(userId) {
  const row = await latestAttempt(userId)
  if (!row) return 0
  const since = Date.now() - new Date(row.created_at).getTime()
  return since < COOLDOWN_MS ? COOLDOWN_MS - since : 0
}

// --------------------------------------------------------------------- шаги

async function handleCode(req) {
  const body = await readJson(req)
  const gameId = digits(body.gameId, 12)
  const gameServer = digits(body.gameServer, 6)
  const channel = body.channel === 'telegram' ? 'telegram' : 'ingame'
  if (!/^[0-9]{6,12}$/.test(gameId)) return json({ ok: false, error: 'bad_game_id' }, 400)

  const profile = await findProfile(gameId, gameServer)
  if (!profile) return json({ ok: false, error: 'profile_not_found' }, 404)

  if (await cooldownLeft(profile.user_id) > 0) return json({ ok: false, error: 'too_often' }, 429)

  const chatId = await telegramChatOf(profile.user_id)

  if (channel === 'telegram') {
    if (!chatId) return json({ ok: false, error: 'telegram_not_linked' }, 409)
    await dbDelete('game_login_codes', { user_id: 'eq.' + profile.user_id })
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const saved = await dbInsert('game_login_codes', {
      code, user_id: profile.user_id, game_id: gameId,
      game_server: gameServer || profile.game_server || '',
      channel: 'telegram', attempts: 0,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    })
    if (!saved) return json({ ok: false, error: 'internal' }, 500)
    const sent = await sendTelegram(chatId,
      '🔐 <b>Код входа на NAME</b>\n\n<code>' + code + '</code>\n\n' +
      'Введи его на сайте в течение 5 минут: Game ID <code>' + gameId + '</code>' +
      (gameServer ? ' · сервер <code>' + gameServer + '</code>' : '') + '.\n\n' +
      'Если это был не ты — просто проигнорируй сообщение.')
    if (!sent) return json({ ok: false, error: 'telegram_failed' }, 502)
    return json({ ok: true, channel: 'telegram', ttl: Math.round(CODE_TTL_MS / 1000), nick: profile.nick || null })
  }

  // Основной путь: письмо с кодом внутри игры.
  const sent = await sendInGameCode(gameId, gameServer || profile.game_server || '')
  if (sent.error) return json({ ok: false, error: sent.error }, sent.error === 'ingame_unavailable' ? 503 : 502)

  const saved = await startAttempt(profile, gameId, gameServer, 'ingame')
  if (!saved) return json({ ok: false, error: 'internal' }, 500)

  // Предупреждение в Telegram, если он привязан: вход просили именно сейчас.
  if (chatId) {
    await sendTelegram(chatId,
      '🎮 <b>Запрошен вход через игру</b>\n\nGame ID <code>' + gameId + '</code>' +
      (gameServer ? ' · сервер <code>' + gameServer + '</code>' : '') +
      '\nКод отправлен на внутриигровую почту MLBB. Если это не ты — смени пароль и напиши в поддержку.')
  }

  return json({ ok: true, channel: 'ingame', ttl: Math.round(CODE_TTL_MS / 1000), nick: profile.nick || null })
}

async function magicLinkToken(userId) {
  try {
    const userRes = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + encodeURIComponent(userId), { headers: svcHeaders() })
    if (!userRes.ok) { console.error('admin user failed', userRes.status); return null }
    const user = await userRes.json().catch(() => null)
    const email = user && user.email
    if (!email) return null
    const linkRes = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
      method: 'POST', headers: svcHeaders(), body: JSON.stringify({ type: 'magiclink', email: email }),
    })
    const link = await linkRes.json().catch(() => null)
    if (!linkRes.ok || !link) { console.error('generate link failed', linkRes.status); return null }
    const props = link.properties || link
    return props.hashed_token || link.hashed_token || null
  } catch (e) { console.error('magicLinkToken threw', String(e)); return null }
}

// Проверка кода и запись статистики. Используется и входом (session), и
// отдельным обновлением цифр (stats) для уже подтверждённых профилей.
async function applyCode(profile, gameId, gameServer, code, channel) {
  const attempt = await latestAttempt(profile.user_id)
  if (!attempt || attempt.channel !== channel) return { error: 'bad_code', status: 401 }
  if (new Date(attempt.expires_at).getTime() < Date.now()) {
    await dbDelete('game_login_codes', { user_id: 'eq.' + profile.user_id })
    return { error: 'code_expired', status: 401 }
  }
  if (String(attempt.game_id) !== gameId) return { error: 'bad_code', status: 401 }
  if (gameServer && attempt.game_server && String(attempt.game_server) !== gameServer) {
    return { error: 'bad_code', status: 401 }
  }
  if ((attempt.attempts || 0) >= MAX_ATTEMPTS) {
    await dbDelete('game_login_codes', { user_id: 'eq.' + profile.user_id })
    return { error: 'too_many_attempts', status: 429 }
  }

  let valid = false
  let gameJwt = ''
  if (channel === 'telegram') {
    valid = String(attempt.code) === String(code) && attempt.game_id === gameId
  } else {
    const check = await verifyInGameCode(gameId, gameServer || attempt.game_server || '', code)
    if (check.error === 'ingame_unavailable') return { error: 'ingame_unavailable', status: 503 }
    valid = !check.error
    gameJwt = check.jwt || ''
  }

  if (!valid) {
    const used = (attempt.attempts || 0) + 1
    await dbPatch('game_login_codes', { user_id: 'eq.' + profile.user_id }, { attempts: used })
    return { error: 'bad_code', status: 401, attemptsLeft: Math.max(0, MAX_ATTEMPTS - used) }
  }

  await dbDelete('game_login_codes', { user_id: 'eq.' + profile.user_id })
  return { ok: true, jwt: gameJwt }
}

// Пишем отметку «подтверждён» и цифры игры одним PATCH.
async function saveGameData(profile, gameId, jwt) {
  const patch = {
    game_verified_at: new Date().toISOString(),
    game_verified_id: gameId,
  }
  const fetched = await fetchGameStats(jwt)
  const stats = fetched ? statsFromGame(fetched.stats, fetched.matches) : null
  if (stats) Object.assign(patch, stats, { game_stats_at: new Date().toISOString() })
  const marked = await dbPatch('player_profiles', { user_id: 'eq.' + profile.user_id }, patch)
  if (!marked) console.error('game data mark failed', profile.user_id)
  return Boolean(stats)
}

async function handleSession(req) {
  const body = await readJson(req)
  const gameId = digits(body.gameId, 12)
  const gameServer = digits(body.gameServer, 6)
  const code = digits(body.code, 6)
  const channel = body.channel === 'telegram' ? 'telegram' : 'ingame'
  // В письме на внутриигровую почту MLBB приходит 4-значный код, в Telegram —
  // 6-значный. Принимаем 4–6 цифр, точную длину проверяет сам шлюз/бот.
  if (!/^[0-9]{6,12}$/.test(gameId) || !/^[0-9]{4,6}$/.test(code)) {
    return json({ ok: false, error: 'bad_request' }, 400)
  }

  // Не раскрываем, существует ли профиль: на этапе проверки любой промах —
  // это просто неверный код.
  const profile = await findProfile(gameId, gameServer)
  if (!profile) return json({ ok: false, error: 'bad_code' }, 401)

  const checked = await applyCode(profile, gameId, gameServer, code, channel)
  if (!checked.ok) {
    return json({ ok: false, error: checked.error, attemptsLeft: checked.attemptsLeft }, checked.status)
  }

  // Владение аккаунтом доказано кодом из игры — только теперь ставим отметку
  // «подтверждён». Код в Telegram доказывает лишь доступ к боту, поэтому
  // статус не меняет.
  let stats = false
  if (channel === 'ingame') stats = await saveGameData(profile, gameId, checked.jwt)

  const tokenHash = await magicLinkToken(profile.user_id)
  if (!tokenHash) return json({ ok: false, error: 'no_email' }, 409)
  return json({ ok: true, tokenHash: tokenHash, verified: channel === 'ingame', stats })
}

// Обновление КДА и винрейта для уже подтверждённого профиля: тот же код из
// внутриигровой почты, но новая сессия не создаётся — только цифры.
async function handleStats(req) {
  const body = await readJson(req)
  const gameId = digits(body.gameId, 12)
  const gameServer = digits(body.gameServer, 6)
  const code = digits(body.code, 6)
  if (!/^[0-9]{6,12}$/.test(gameId) || !/^[0-9]{4,6}$/.test(code)) {
    return json({ ok: false, error: 'bad_request' }, 400)
  }
  const profile = await findProfile(gameId, gameServer)
  if (!profile) return json({ ok: false, error: 'bad_code' }, 401)

  const checked = await applyCode(profile, gameId, gameServer, code, 'ingame')
  if (!checked.ok) {
    return json({ ok: false, error: checked.error, attemptsLeft: checked.attemptsLeft }, checked.status)
  }
  const stats = await saveGameData(profile, gameId, checked.jwt)
  return json({ ok: true, stats })
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
    if (action === 'stats') return await handleStats(req)
  } catch (e) {
    console.error('game-login failed', String(e))
    return json({ ok: false, error: 'internal' }, 500)
  }
  return json({ ok: false, error: 'not_found' }, 404)
})
