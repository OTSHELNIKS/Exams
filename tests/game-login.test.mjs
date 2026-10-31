// NAME MLBB — вход через игру: edge-функция `game-login` + клиентский модуль.
// Тест грузит РЕАЛЬНЫЙ исходник функции (Deno + fetch замоканы) и проверяет
// оба канала: код на внутриигровую почту MLBB и код в Telegram. Код живёт
// 5 минут, одноразовый, привязан к Game ID; сессия выдаётся одноразовой
// ссылкой, а не паролем.
// Run: node tests/game-login.test.mjs   (zero dependencies)
import assert from 'node:assert/strict'
import { copyFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const SRC = join(here, '../supabase/functions/game-login/index.ts')
const TMP = '/tmp/name-game-login-under-test.mjs'

// ---------- мок окружения ----------
const state = {
  profiles: [], links: [], codes: [], tg: [], deleted: [], admins: {},
  linkOk: true,
  // Игровой шлюз: что вернёт /send-vc и /login (код из письма в игре).
  gameApi: { up: true, sendOk: true, acceptCode: '4821', zone: '6634' },
  gameCalls: [],
  profilePatches: [],
  statsCalls: [],
  statsUp: true,
  // Приватная таблица игровых JWT + сессии NAME (кого пускает Supabase).
  tokens: [],
  sessions: { 'USER-JWT': 'u1' },
  gameTokenExpired: false,
}

function J(status, json) {
  return { ok: status >= 200 && status < 300, status, json: async () => json }
}

globalThis.Deno = {
  env: {
    get: (k) => ({
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'SRKEY',
      TELEGRAM_BOT_TOKEN: 'TESTTOKEN',
    }[k] || ''),
  },
  serve: (h) => { globalThis.__gameHandler = h },
}

// Мини-PostgREST: понимает ровно те фильтры, которые использует функция.
function rest(table, url, init) {
  const method = (init && init.method) || 'GET'
  const params = new URL(url).searchParams
  const eq = (row, key) => {
    const raw = params.get(key)
    if (!raw) return true
    if (!raw.startsWith('eq.')) return true
    return String(row[key]) === raw.slice(3)
  }
  if (table === 'player_profiles' && method === 'GET') {
    return J(200, state.profiles.filter((r) => eq(r, 'game_id') && eq(r, 'game_server')))
  }
  if (table === 'player_profiles' && method === 'PATCH') {
    const patch = JSON.parse(init.body)
    state.profilePatches.push({ params: Object.fromEntries(params), patch })
    state.profiles.filter((r) => eq(r, 'user_id')).forEach((r) => Object.assign(r, patch))
    return J(204, null)
  }
  if (table === 'game_tokens' && method === 'GET') {
    return J(200, state.tokens.filter((r) => eq(r, 'user_id')))
  }
  if (table === 'game_tokens' && method === 'POST') {
    const row = JSON.parse(init.body)
    state.tokens = state.tokens.filter((r) => r.user_id !== row.user_id)
    state.tokens.push(row)
    return J(201, null)
  }
  if (table === 'game_tokens' && method === 'DELETE') {
    state.tokens = state.tokens.filter((r) => !eq(r, 'user_id'))
    return J(204, null)
  }
  if (table === 'telegram_links' && method === 'GET') {
    return J(200, state.links.filter((r) => eq(r, 'user_id')))
  }
  if (table === 'game_login_codes' && method === 'GET') {
    return J(200, state.codes.filter((r) => eq(r, 'code') && eq(r, 'user_id')))
  }
  if (table === 'game_login_codes' && method === 'POST') {
    const row = JSON.parse(init.body)
    state.codes.push({ ...row, created_at: new Date().toISOString() })
    return J(201, null)
  }
  if (table === 'game_login_codes' && method === 'PATCH') {
    const patch = JSON.parse(init.body)
    state.codes.filter((r) => eq(r, 'user_id')).forEach((r) => Object.assign(r, patch))
    return J(204, null)
  }
  if (table === 'game_login_codes' && method === 'DELETE') {
    const before = state.codes.length
    state.codes = state.codes.filter((r) => !(eq(r, 'code') || eq(r, 'user_id')))
    state.deleted.push(before - state.codes.length)
    return J(204, null)
  }
  return J(404, { error: 'unexpected ' + table + ' ' + method })
}

globalThis.fetch = async (input, init) => {
  const url = String(input)
  if (url.startsWith('https://api.telegram.org/')) {
    const body = JSON.parse(init.body)
    state.tg.push(body)
    return state.linkOk ? J(200, { ok: true, result: {} }) : J(400, { ok: false })
  }
  if (url.includes('/rest/v1/')) {
    const table = url.split('/rest/v1/')[1].split('?')[0]
    return rest(table, url, init || {})
  }
  // Игровой шлюз: отправка письма с кодом и проверка кода из письма.
  // Статистика игры: доступна только с игровым JWT (после проверки кода).
  if (url.includes('/user/stats') || url.includes('/user/matches')) {
    state.statsCalls.push(url)
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || ''
    if (!/^Bearer GJWT/.test(auth)) return J(401, { code: 401, message: 'unauthorized' })
    if (state.gameTokenExpired) return J(401, { code: 401, message: 'token expired' })
    if (url.includes('/user/stats')) {
      return state.statsUp ? J(200, { code: 0, data: { wc: 188, tc: 308, as: 762.35 } }) : J(502, {})
    }
    return state.statsUp
      ? J(200, { code: 0, data: { result: [
        { k: 10, d: 2, a: 8 }, { k: 4, d: 4, a: 12 }, { k: 6, d: 0, a: 6 },
      ] } })
      : J(502, {})
  }
  if (url.includes('/user/auth/send-vc') || url.includes('/user/auth/login')) {
    state.gameCalls.push({ url, body: JSON.parse(init.body) })
    if (!state.gameApi.up) return J(502, { message: 'bad gateway' })
    if (url.includes('/send-vc')) {
      return state.gameApi.sendOk ? J(200, { code: 0, data: '', msg: 'ok' }) : J(200, { code: 1999, msg: 'role not found' })
    }
    const body = JSON.parse(init.body)
    const good = String(body.vc) === state.gameApi.acceptCode
    return good
      ? J(200, { code: 0, msg: 'ok', data: {
        roleid: Number(body.role_id), zoneid: Number(state.gameApi.zone),
        jwt: 'GJWT-' + body.role_id, token: 'GJWT-' + body.role_id,
      } })
      : J(200, { code: 1001, msg: 'invalid verification code' })
  }
  if (url.includes('/auth/v1/user')) {
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    const id = state.sessions[token]
    return id ? J(200, { id, aud: 'authenticated' }) : J(401, { msg: 'invalid jwt' })
  }
  if (url.includes('/auth/v1/admin/users/')) {
    const id = url.split('/auth/v1/admin/users/')[1]
    const user = state.admins[id]
    return user ? J(200, user) : J(404, { error: 'not found' })
  }
  if (url.includes('/auth/v1/admin/generate_link')) {
    const body = JSON.parse(init.body)
    return J(200, { properties: { hashed_token: 'HASH-' + body.email } })
  }
  return J(404, { error: 'unexpected url ' + url })
}

copyFileSync(SRC, TMP)
await import(TMP + '?t=' + Date.now())
const handler = globalThis.__gameHandler
assert.ok(handler, 'game-login did not call Deno.serve')

let passed = 0
let failed = 0
async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log('PASS ' + name)
  } catch (error) {
    failed += 1
    console.log('FAIL ' + name + ' — ' + error.message)
  }
}

const BASE = 'https://test.supabase.co/functions/v1/game-login'
function post(action, body) {
  return handler(new Request(`${BASE}?action=${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}
function postAs(action, body, token) {
  return handler(new Request(`${BASE}?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body || {}),
  }))
}
const reset = () => {
  state.profiles = [{ user_id: 'u1', game_id: '1340937090', game_server: '6634', nick: 'Stranger_zxc', updated_at: '2026-10-31' }]
  state.links = [{ user_id: 'u1', tg_chat_id: '6553836608' }]
  state.codes = []
  state.tg = []
  state.deleted = []
  state.linkOk = true
  state.gameApi = { up: true, sendOk: true, acceptCode: '4821', zone: '6634' }
  state.gameCalls = []
  state.profilePatches = []
  state.statsCalls = []
  state.statsUp = true
  state.tokens = []
  state.sessions = { 'USER-JWT': 'u1' }
  state.gameTokenExpired = false
  state.admins = { u1: { id: 'u1', email: 'player@example.test' } }
}

// ---------- health ----------
await test('T-GL-01 health отдаёт build функции', async () => {
  const res = await handler(new Request(BASE + '?health=1'))
  const data = await res.json()
  assert.equal(res.status, 200)
  assert.equal(data.ok, true)
  assert.equal(data.build, 'game-login-v7')
})

// ---------- шаг 1: код ----------
await test('T-GL-02 код уходит в Telegram, привязанный к профилю', async () => {
  reset()
  const res = await post('code', { gameId: '1340937090', gameServer: '6634', channel: 'telegram' })
  const data = await res.json()
  assert.equal(res.status, 200, JSON.stringify(data))
  assert.equal(data.ok, true)
  assert.equal(data.ttl, 300)
  assert.equal(data.nick, 'Stranger_zxc')
  assert.equal(data.channel, 'telegram')
  assert.equal(state.tg.length, 1, 'одно сообщение боту')
  assert.equal(state.tg[0].chat_id, '6553836608')
  const sent = state.tg[0].text
  assert.match(sent, /\b\d{6}\b/, 'в сообщении шестизначный код')
  assert.match(sent, /1340937090/)
  const code = state.codes[0]
  assert.match(code.code, /^\d{6}$/)
  assert.equal(code.user_id, 'u1')
  assert.ok(new Date(code.expires_at) - Date.now() > 4 * 60 * 1000, 'живёт 5 минут')
})

await test('T-GL-03 неверный Game ID — bad_game_id, телеграм не трогаем', async () => {
  reset()
  const res = await post('code', { gameId: '12', gameServer: '6634' })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).error, 'bad_game_id')
  assert.equal(state.tg.length, 0)
})

await test('T-GL-04 нет профиля с таким Game ID — profile_not_found', async () => {
  reset()
  const res = await post('code', { gameId: '999999999', gameServer: '6634' })
  assert.equal(res.status, 404)
  assert.equal((await res.json()).error, 'profile_not_found')
})

await test('T-GL-05 профиль без Telegram — telegram_not_linked (никакой фиктивной привязки)', async () => {
  reset()
  state.links = []
  const res = await post('code', { gameId: '1340937090', channel: 'telegram' })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, 'telegram_not_linked')
  assert.equal(state.tg.length, 0)
  assert.equal(state.codes.length, 0)
})

await test('T-GL-06 кулдаун 30 секунд — too_often', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634', channel: 'telegram' })
  const res = await post('code', { gameId: '1340937090', gameServer: '6634', channel: 'telegram' })
  assert.equal(res.status, 429)
  assert.equal((await res.json()).error, 'too_often')
  assert.equal(state.tg.length, 1)
})

await test('T-GL-07 новый запрос стирает старый код (одноразовость по пользователю)', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634', channel: 'telegram' })
  state.codes[0].created_at = new Date(Date.now() - 60 * 1000).toISOString()
  await post('code', { gameId: '1340937090', gameServer: '6634', channel: 'telegram' })
  assert.equal(state.codes.length, 1, 'в базе остался только свежий код')
})

await test('T-GL-08 Telegram не принял сообщение — telegram_failed, код не оставляем', async () => {
  reset()
  state.linkOk = false
  const res = await post('code', { gameId: '1340937090', gameServer: '6634', channel: 'telegram' })
  assert.equal(res.status, 502)
  assert.equal((await res.json()).error, 'telegram_failed')
})

// ---------- шаг 2: сессия ----------
await test('T-GL-09 верный код даёт одноразовую ссылку и удаляется', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634', channel: 'telegram' })
  const code = state.codes[0].code
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code, channel: 'telegram' })
  const data = await res.json()
  assert.equal(res.status, 200, JSON.stringify(data))
  assert.equal(data.ok, true)
  assert.equal(data.tokenHash, 'HASH-player@example.test')
  assert.equal(state.codes.length, 0, 'код одноразовый')
  assert.doesNotMatch(JSON.stringify(data), /password|service_role|SRKEY/i)
})

await test('T-GL-10 повтор кода не проходит', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634', channel: 'telegram' })
  const code = state.codes[0].code
  await post('session', { gameId: '1340937090', gameServer: '6634', code, channel: 'telegram' })
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code, channel: 'telegram' })
  assert.equal(res.status, 401)
  assert.equal((await res.json()).error, 'bad_code')
})

await test('T-GL-11 чужой Game ID не принимает код', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634', channel: 'telegram' })
  const code = state.codes[0].code
  const res = await post('session', { gameId: '999999999', code, channel: 'telegram' })
  assert.equal(res.status, 401)
  assert.equal((await res.json()).error, 'bad_code')
})

await test('T-GL-12 истёкший код — code_expired и запись удаляется', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634', channel: 'telegram' })
  state.codes[0].expires_at = new Date(Date.now() - 1000).toISOString()
  const code = state.codes[0].code
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code, channel: 'telegram' })
  assert.equal(res.status, 401)
  assert.equal((await res.json()).error, 'code_expired')
  assert.equal(state.codes.length, 0)
})

await test('T-GL-13 короткий код — bad_request', async () => {
  reset()
  const res = await post('session', { gameId: '1340937090', code: '123' })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).error, 'bad_request')
})

await test('T-GL-14 у пользователя нет почты — no_email', async () => {
  reset()
  state.admins = { u1: { id: 'u1', email: '' } }
  await post('code', { gameId: '1340937090', gameServer: '6634', channel: 'telegram' })
  const code = state.codes[0].code
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code, channel: 'telegram' })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, 'no_email')
})

await test('T-GL-15 лишний сервер не мешает входу, но чужой сервер отклоняется', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634', channel: 'telegram' })
  const code = state.codes[0].code
  const wrong = await post('session', { gameId: '1340937090', gameServer: '1111', code, channel: 'telegram' })
  assert.equal(wrong.status, 401, 'другой сервер — отказ')
  const ok = await post('session', { gameId: '1340937090', code, channel: 'telegram' })
  assert.equal(ok.status, 200, 'сервер можно не указывать')
})

await test('T-GL-16 GET без health и неизвестное действие — 404', async () => {
  const a = await handler(new Request(BASE))
  assert.equal(a.status, 404)
  const b = await post('nope', {})
  assert.equal(b.status, 404)
})

await test('T-GL-17 OPTIONS отвечает CORS для мобильного клиента', async () => {
  const res = await handler(new Request(BASE, { method: 'OPTIONS' }))
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*')
})

// ---------- исходники: контракт с клиентом и безопасность ----------
await test('T-GL-18 таблица кодов закрыта от anon/authenticated', () => {
  const sql = read('supabase/migrations/20261031120000_game_login.sql')
  assert.match(sql, /create table if not exists public\.game_login_codes/i)
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /revoke all on public\.game_login_codes from anon, authenticated/i)
})

await test('T-GL-19 клиент просит код и обменивает его на сессию через verifyOtp', () => {
  const src = read('app/src/game-login.js')
  assert.match(src, /functions\/v1\/\$\{FUNCTION\}\?action=\$\{action\}/)
  assert.match(src, /post\('code'/)
  assert.match(src, /post\('session'/)
  assert.match(src, /verifyOtp\(\{ type: 'magiclink', token_hash: data\.tokenHash \}\)/)
  assert.doesNotMatch(src, /password/i)
})

await test('T-GL-20 ошибки переведены на человеческий язык', async () => {
  const mod = await import('../app/src/game-login.js').catch(() => null)
  const src = read('app/src/game-login.js')
  for (const key of ['bad_game_id', 'profile_not_found', 'telegram_not_linked', 'too_often', 'bad_code', 'code_expired', 'no_email']) {
    assert.match(src, new RegExp(`case '${key}'`), 'нет текста для ' + key)
  }
  if (mod) {
    assert.match(mod.describeGameLoginError(new Error('telegram_not_linked')), /Telegram/)
    assert.match(mod.describeGameLoginError(new Error('code_expired')), /5 минут/)
  }
})

await test('T-GL-21 плитка MLBB на входе активна и открывает модалку', () => {
  const src = read('app/src/screens.jsx')
  assert.match(src, /onClick=\{openGameLogin\}/, 'плитка не подключена к openGameLogin')
  assert.doesNotMatch(src, /method method--soon[^>]*MLBB/, 'MLBB всё ещё «скоро»')
  assert.match(src, /вход через игру/i)
  assert.match(src, /requestGameCode/)
  assert.match(src, /signInWithGameCode/)
})


// ---------- внутриигровая почта (основной канал) ----------
await test('T-GL-22 без канала код уходит в игру, а не в Telegram', async () => {
  reset()
  const res = await post('code', { gameId: '1340937090', gameServer: '6634' })
  const data = await res.json()
  assert.equal(res.status, 200, JSON.stringify(data))
  assert.equal(data.channel, 'ingame', 'по умолчанию — почта в игре')
  assert.equal(state.gameCalls.length, 1, 'один запрос к игровому шлюзу')
  assert.match(state.gameCalls[0].url, /\/user\/auth\/send-vc$/)
  assert.deepEqual(state.gameCalls[0].body, { role_id: 1340937090, zone_id: 6634 })
  assert.equal(state.codes[0].channel, 'ingame')
  assert.equal(state.codes[0].attempts, 0)
  assert.equal(state.tg.filter((m) => /\b\d{6}\b/.test(m.text)).length, 0, 'кода в Telegram нет')
})

await test('T-GL-23 письмо уходит только для профиля, который есть в NAME', async () => {
  reset()
  const res = await post('code', { gameId: '999999999', gameServer: '6634' })
  assert.equal(res.status, 404)
  assert.equal((await res.json()).error, 'profile_not_found')
  assert.equal(state.gameCalls.length, 0, 'на чужой Game ID письма не шлём')
})

await test('T-GL-24 предупреждение в Telegram, если бот привязан (но кода там нет)', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  assert.equal(state.tg.length, 1)
  assert.match(state.tg[0].text, /вход через игру/i)
  assert.doesNotMatch(state.tg[0].text, /\b\d{6}\b/, 'код в Telegram не попадает')
})

await test('T-GL-25 код из письма в игре даёт сессию', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code: '4821' })
  const data = await res.json()
  assert.equal(res.status, 200, JSON.stringify(data))
  assert.equal(data.ok, true)
  assert.equal(data.tokenHash, 'HASH-player@example.test')
  const verify = state.gameCalls[state.gameCalls.length - 1]
  assert.match(verify.url, /\/user\/auth\/login$/)
  assert.deepEqual(verify.body, { role_id: 1340937090, zone_id: 6634, vc: '4821' })
  assert.equal(state.codes.length, 0, 'попытка одноразовая')
})

await test('T-GL-26 JWT игры наружу не отдаётся', async () => {
  reset()
  state.gameApi = { ...state.gameApi }
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code: '4821' })
  const text = JSON.stringify(await res.json())
  assert.doesNotMatch(text, /jwt|"token"|roleid/i, 'в ответе нет данных игры: ' + text)
})

await test('T-GL-27 неверный код из письма — bad_code со счётчиком попыток', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code: '000000' })
  const data = await res.json()
  assert.equal(res.status, 401)
  assert.equal(data.error, 'bad_code')
  assert.equal(data.attemptsLeft, 4)
  assert.equal(state.codes[0].attempts, 1, 'попытка записана: ' + JSON.stringify(state.codes[0]))
})

await test('T-GL-28 после 5 неверных попыток код сгорает', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  let last = null
  for (let i = 0; i < 5; i += 1) {
    last = await post('session', { gameId: '1340937090', gameServer: '6634', code: '000000' })
  }
  assert.equal((await last.json()).error, 'bad_code')
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code: '4821' })
  assert.equal(res.status, 429, 'верный код больше не принимается')
  assert.equal((await res.json()).error, 'too_many_attempts')
  assert.equal(state.codes.length, 0)
})

await test('T-GL-29 шлюз недоступен — честный ingame_unavailable, попытка не создаётся', async () => {
  reset()
  state.gameApi.up = false
  const res = await post('code', { gameId: '1340937090', gameServer: '6634' })
  assert.equal(res.status, 503)
  assert.equal((await res.json()).error, 'ingame_unavailable')
  assert.equal(state.codes.length, 0)
  assert.equal(state.tg.length, 0, 'и запасной канал сам не включаем')
})

await test('T-GL-30 игра не нашла такой аккаунт — ingame_failed', async () => {
  reset()
  state.gameApi.sendOk = false
  const res = await post('code', { gameId: '1340937090', gameServer: '6634' })
  assert.equal(res.status, 502)
  assert.equal((await res.json()).error, 'ingame_failed')
})

await test('T-GL-31 канал в запросе и в подтверждении должны совпадать', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })  // попытка в игре
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code: '123456', channel: 'telegram' })
  assert.equal(res.status, 401, 'нельзя подтвердить телеграм-кодом попытку из игры')
  assert.equal((await res.json()).error, 'bad_code')
})

await test('T-GL-32 на шаге проверки профиль не раскрывается', async () => {
  reset()
  const res = await post('session', { gameId: '999999999', code: '4821' })
  assert.equal(res.status, 401)
  assert.equal((await res.json()).error, 'bad_code', 'не отвечаем profile_not_found')
})

await test('T-GL-33 миграция каналов применяется без потери старых кодов', () => {
  const sql = read('supabase/migrations/20261031180000_game_login_ingame.sql')
  assert.match(sql, /add column if not exists channel/i)
  assert.match(sql, /default 'telegram'/i, 'старые записи считаются телеграм-кодом')
  assert.match(sql, /add column if not exists attempts/i)
  assert.match(sql, /default 0/i)
})

await test('T-GL-34 кнопка «Открыть игру» уводит в MLBB или в магазин', async () => {
  const mod = await import('../app/src/game-link.js')
  const android = mod.gameLinks('android')
  assert.match(android.direct, /^intent:\/\//)
  assert.match(android.direct, /package=com\.mobile\.legends/)
  assert.match(android.store, /play\.google\.com.*com\.mobile\.legends/)
  assert.match(mod.gameLinks('ios').direct, /^mlbb:\/\//)
  assert.match(mod.gameLinks('ios').store, /apps\.apple\.com/)
  assert.equal(mod.gameLinks('desktop').direct, '', 'на компьютере игру не запускаем')
  assert.match(mod.gameHelpText('desktop'), /телефона/)
})

await test('T-GL-35 openGame: приложение не открылось — уводим в магазин', async () => {
  const mod = await import('../app/src/game-link.js')
  const visited = []
  const res = await mod.openGame({
    platform: 'android',
    navigate: (url) => visited.push(url),
    sleep: async () => {},
    isHidden: () => false,
    waitMs: 0,
  })
  assert.equal(res.opened, false)
  assert.equal(res.via, 'store')
  assert.equal(visited.length, 2, 'сначала intent, потом магазин')
  assert.match(visited[1], /play\.google\.com/)
})

await test('T-GL-36 openGame: игра открылась — в магазин не уводим', async () => {
  const mod = await import('../app/src/game-link.js')
  const visited = []
  const res = await mod.openGame({
    platform: 'ios',
    navigate: (url) => visited.push(url),
    sleep: async () => {},
    isHidden: () => true,
    waitMs: 0,
  })
  assert.equal(res.opened, true)
  assert.equal(res.via, 'mlbb://')
  assert.equal(visited.length, 1)
})

await test('T-GL-37 модалка: каналы, кнопка игры и подсказка про Почту', () => {
  const src = read('app/src/screens.jsx')
  assert.match(src, /gameChannel/, 'нет состояния канала')
  assert.match(src, /Письмо в игре/)
  assert.match(src, /Telegram-бот/)
  assert.match(src, /Открыть игру/, 'нет кнопки открытия игры')
  assert.match(src, /внутриигровую почту/)
  assert.match(src, /launchGame/)
  assert.match(src, /switchGameChannel/)
  // Канал, который реально уходит на сервер: при привязке — всегда ingame.
  assert.match(src, /channel: onlyIngame \? 'ingame'|const channel = onlyIngame \? 'ingame' : gameChannel/)
})

await test('T-GL-38 тексты каналов без пароля Moonton', () => {
  const modal = read('app/src/screens.jsx')
  const client = read('app/src/game-login.js')
  for (const src of [modal, client]) {
    assert.doesNotMatch(src, /введ(и|ите) (свой )?пароль/i, 'не просим пароль от аккаунта')
  }
  assert.match(client, /На внутриигровую почту/)
  assert.match(client, /ingame_unavailable/)
  assert.match(client, /too_many_attempts/)
})


// ---------- подтверждение владения (статус «привязан») ----------
await test('T-GL-39 код из игры ставит отметку подтверждения', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code: '4821' })
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.equal(data.verified, true)
  const mark = state.profilePatches.find((p) => p.patch.game_verified_at)
  assert.ok(mark, 'нет отметки game_verified_at')
  assert.equal(mark.patch.game_verified_id, '1340937090', 'отметка привязана к Game ID')
  assert.equal(mark.params.user_id, 'eq.u1')
  assert.ok(Date.now() - new Date(mark.patch.game_verified_at).getTime() < 60000)
})

await test('T-GL-40 код в Telegram не даёт статус «подтверждён»', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634', channel: 'telegram' })
  const code = state.codes[0].code
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code, channel: 'telegram' })
  const data = await res.json()
  assert.equal(data.ok, true, 'вход через бота работает')
  assert.equal(data.verified, false)
  assert.equal(state.profilePatches.length, 0, 'бот не подтверждает владение аккаунтом')
})

await test('T-GL-41 неверный код не ставит отметку', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  await post('session', { gameId: '1340937090', gameServer: '6634', code: '000000' })
  assert.equal(state.profilePatches.length, 0)
})

await test('T-GL-42 миграция: отметку нельзя поставить из браузера', () => {
  const sql = read('supabase/migrations/20261031190000_game_verified.sql')
  assert.match(sql, /add column if not exists game_verified_at/i)
  assert.match(sql, /add column if not exists game_verified_id/i)
  assert.match(sql, /create trigger protect_game_verification/i)
  assert.match(sql, /auth\.role\(\) in \('anon', 'authenticated'\)/i)
})

await test('T-GL-43 клиент запоминает, что владение подтверждено', () => {
  const src = read('app/src/game-login.js')
  assert.match(src, /verified/, 'клиент не смотрит на флаг verified')
})

await test('T-GL-44 в привязке из профиля только код из игры', () => {
  const src = read('app/src/screens.jsx')
  assert.match(src, /onlyIngame/, 'нет режима «только код из игры»')
  const profile = src.slice(src.indexOf('export function ProfileScreen'), src.indexOf('/* =============================================================== DRAFT'))
  assert.match(profile, /onlyIngame/, 'профиль не включает режим «только из игры»')
})


// ---------- длина кода: в игре 4 цифры ----------
await test('T-GL-45 четырёхзначный код из письма принимается', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code: '4821' })
  const data = await res.json()
  assert.equal(res.status, 200, JSON.stringify(data))
  assert.equal(data.ok, true)
  assert.equal(data.verified, true)
  const verify = state.gameCalls[state.gameCalls.length - 1]
  assert.equal(verify.body.vc, '4821', 'в шлюз уходит код как есть')
})

await test('T-GL-46 код из 3 цифр — bad_request, лишние символы отбрасываются', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const short = await post('session', { gameId: '1340937090', gameServer: '6634', code: '482' })
  assert.equal(short.status, 400)
  assert.equal((await short.json()).error, 'bad_request')
  assert.equal(state.codes[0].attempts, 0, 'мусорный ввод не тратит попытку')
  // Нецифры вырезаются: «4-8 2 1» всё равно идут как 4-значный код.
  const messy = await post('session', { gameId: '1340937090', gameServer: '6634', code: '4-8 2 1' })
  assert.equal(messy.status, 200, JSON.stringify(await messy.json()))
  assert.equal(state.gameCalls[state.gameCalls.length - 1].body.vc, '4821')
})

await test('T-GL-47 интерфейс ждёт 4 цифры, а не 6', () => {
  const src = read('app/src/screens.jsx')
  assert.match(src, /Код из письма — 4 цифры/)
  assert.match(src, /gameCode\.length < 4/, 'кнопка «Войти» не разблокируется на 4 цифрах')
  assert.doesNotMatch(src, /gameCode\.length !== 6/, 'старое требование ровно 6 цифр')
  assert.match(src, /В письме 4 цифры/)
})


// ---------- КДА и винрейт после подтверждения ----------
await test('T-GL-48 после кода из игры сохраняются винрейт и КДА', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code: '4821' })
  assert.equal(res.status, 200, JSON.stringify(await res.json().catch(() => ({}))))
  const mark = state.profilePatches.find((p) => p.patch.game_verified_at)
  assert.ok(mark, 'нет отметки подтверждения')
  // 188 побед из 308 матчей → 61%
  assert.equal(mark.patch.game_winrate, 61)
  assert.equal(mark.patch.game_matches, 308)
  // (10+4+6 убийств + 8+12+6 помощи) / 6 смертей = 46/6 ≈ 7.67
  assert.equal(mark.patch.game_kda, 7.67)
  assert.ok(mark.patch.game_stats_at, 'нет времени обновления статистики')
})

await test('T-GL-49 статистика запрашивается только с игровым JWT', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  await post('session', { gameId: '1340937090', gameServer: '6634', code: '4821' })
  assert.ok(state.statsCalls.length >= 1, 'не запрашивали статистику')
  assert.match(state.statsCalls[0], /\/user\/stats$/)
})

await test('T-GL-50 игра не отдала статистику — вход всё равно работает', async () => {
  reset()
  state.statsUp = false
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code: '4821' })
  const data = await res.json()
  assert.equal(data.ok, true, 'вход не должен ломаться из-за статистики')
  const mark = state.profilePatches.find((p) => p.patch.game_verified_at)
  assert.ok(mark, 'отметка подтверждения всё равно ставится')
  assert.equal(mark.patch.game_winrate, undefined, 'выдуманных цифр не пишем')
})

await test('T-GL-51 вход через Telegram не тянет статистику', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634', channel: 'telegram' })
  const code = state.codes[0].code
  await post('session', { gameId: '1340937090', gameServer: '6634', code, channel: 'telegram' })
  assert.equal(state.statsCalls.length, 0)
  assert.equal(state.profilePatches.length, 0)
})

await test('T-GL-55 игровой JWT сохраняется на сервере после подтверждения', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  await post('session', { gameId: '1340937090', gameServer: '6634', code: '4821' })
  assert.equal(state.tokens.length, 1, 'игровой токен не сохранён')
  assert.equal(state.tokens[0].jwt, 'GJWT-1340937090')
})

await test('T-GL-56 цифры обновляются по сессии, без кода', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  await post('session', { gameId: '1340937090', gameServer: '6634', code: '4821' })
  state.profilePatches = []
  state.statsCalls = []
  const res = await postAs('refresh', {}, 'USER-JWT')
  const data = await res.json()
  assert.equal(res.status, 200, JSON.stringify(data))
  assert.equal(data.ok, true)
  assert.equal(data.winrate, 61, 'винрейт не пересчитан')
  assert.ok(state.statsCalls.length >= 1, 'статистику не запрашивали')
  const patch = state.profilePatches.find((p) => p.patch.game_winrate)
  assert.ok(patch, 'цифры не записаны в профиль')
  assert.equal(patch.patch.game_kda, 7.67)
})

await test('T-GL-57 обновление без сессии не пускает', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  await post('session', { gameId: '1340937090', gameServer: '6634', code: '4821' })
  const res = await postAs('refresh', {}, 'BAD-TOKEN')
  assert.equal(res.status, 401)
  assert.equal(state.statsCalls.length >= 1, true)
})

await test('T-GL-58 истёкший игровой токен стирается, просим код один раз', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  await post('session', { gameId: '1340937090', gameServer: '6634', code: '4821' })
  state.gameTokenExpired = true
  const res = await postAs('refresh', {}, 'USER-JWT')
  const data = await res.json()
  assert.equal(data.ok, false)
  assert.equal(data.error, 'no_token')
  assert.equal(state.tokens.length, 0, 'мёртвый токен остался в базе')
})

await test('T-GL-53 обновление цифр не выдаёт новую сессию', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const res = await post('stats', { gameId: '1340937090', gameServer: '6634', code: '4821' })
  const data = await res.json()
  assert.equal(res.status, 200, JSON.stringify(data))
  assert.equal(data.ok, true)
  assert.equal(data.stats, true, 'статистика не записалась')
  assert.equal(data.tokenHash, undefined, 'обновление цифр не должно выдавать сессию')
  const mark = state.profilePatches.find((p) => p.patch.game_winrate)
  assert.ok(mark, 'винрейт не сохранён')
  assert.equal(mark.patch.game_kda, 7.67)
})

await test('T-GL-54 обновление цифр без верного кода ничего не пишет', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const res = await post('stats', { gameId: '1340937090', gameServer: '6634', code: '0000' })
  assert.equal(res.status, 401)
  assert.equal(state.statsCalls.length, 0, 'статистику запрашивали без доказанного кода')
})

await test('T-GL-52 миграция статистики и публичной вьюхи', () => {
  const sql = read('supabase/migrations/20261031200000_game_stats.sql')
  for (const col of ['game_kda', 'game_winrate', 'game_matches', 'game_stats_at']) {
    assert.match(sql, new RegExp(`add column if not exists ${col}`, 'i'), 'нет ' + col)
  }
  assert.match(sql, /create or replace view public\.player_profiles_public/i)
  assert.match(sql, /p\.game_winrate/)
  assert.match(sql, /game_verified\) AS|AS game_verified/i)
})

console.log(`\n${passed}/${passed + failed} game-login tests passed`)
if (failed) process.exit(1)
