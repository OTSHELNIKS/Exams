// NAME MLBB — вход через игру: edge-функция `game-login` + клиентский модуль.
// Тест грузит РЕАЛЬНЫЙ исходник функции (Deno + fetch замоканы) и проверяет
// контракт: код уходит только привязанному Telegram, живёт 5 минут, одноразовый
// и привязан к Game ID; сессия выдаётся одноразовой ссылкой, а не паролем.
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
const state = { profiles: [], links: [], codes: [], tg: [], deleted: [], admins: {}, linkOk: true }

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
const reset = () => {
  state.profiles = [{ user_id: 'u1', game_id: '1340937090', game_server: '6634', nick: 'Stranger_zxc', updated_at: '2026-10-31' }]
  state.links = [{ user_id: 'u1', tg_chat_id: '6553836608' }]
  state.codes = []
  state.tg = []
  state.deleted = []
  state.linkOk = true
  state.admins = { u1: { id: 'u1', email: 'player@example.test' } }
}

// ---------- health ----------
await test('T-GL-01 health отдаёт build функции', async () => {
  const res = await handler(new Request(BASE + '?health=1'))
  const data = await res.json()
  assert.equal(res.status, 200)
  assert.equal(data.ok, true)
  assert.equal(data.build, 'game-login-v1')
})

// ---------- шаг 1: код ----------
await test('T-GL-02 код уходит в Telegram, привязанный к профилю', async () => {
  reset()
  const res = await post('code', { gameId: '1340937090', gameServer: '6634' })
  const data = await res.json()
  assert.equal(res.status, 200, JSON.stringify(data))
  assert.equal(data.ok, true)
  assert.equal(data.ttl, 300)
  assert.equal(data.nick, 'Stranger_zxc')
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
  const res = await post('code', { gameId: '1340937090' })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, 'telegram_not_linked')
  assert.equal(state.tg.length, 0)
  assert.equal(state.codes.length, 0)
})

await test('T-GL-06 кулдаун 30 секунд — too_often', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const res = await post('code', { gameId: '1340937090', gameServer: '6634' })
  assert.equal(res.status, 429)
  assert.equal((await res.json()).error, 'too_often')
  assert.equal(state.tg.length, 1)
})

await test('T-GL-07 новый запрос стирает старый код (одноразовость по пользователю)', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  state.codes[0].created_at = new Date(Date.now() - 60 * 1000).toISOString()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  assert.equal(state.codes.length, 1, 'в базе остался только свежий код')
})

await test('T-GL-08 Telegram не принял сообщение — telegram_failed, код не оставляем', async () => {
  reset()
  state.linkOk = false
  const res = await post('code', { gameId: '1340937090', gameServer: '6634' })
  assert.equal(res.status, 502)
  assert.equal((await res.json()).error, 'telegram_failed')
})

// ---------- шаг 2: сессия ----------
await test('T-GL-09 верный код даёт одноразовую ссылку и удаляется', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const code = state.codes[0].code
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code })
  const data = await res.json()
  assert.equal(res.status, 200, JSON.stringify(data))
  assert.equal(data.ok, true)
  assert.equal(data.tokenHash, 'HASH-player@example.test')
  assert.equal(state.codes.length, 0, 'код одноразовый')
  assert.doesNotMatch(JSON.stringify(data), /password|service_role|SRKEY/i)
})

await test('T-GL-10 повтор кода не проходит', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const code = state.codes[0].code
  await post('session', { gameId: '1340937090', gameServer: '6634', code })
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code })
  assert.equal(res.status, 401)
  assert.equal((await res.json()).error, 'bad_code')
})

await test('T-GL-11 чужой Game ID не принимает код', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const code = state.codes[0].code
  const res = await post('session', { gameId: '999999999', code })
  assert.equal(res.status, 401)
  assert.equal((await res.json()).error, 'bad_code')
})

await test('T-GL-12 истёкший код — code_expired и запись удаляется', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  state.codes[0].expires_at = new Date(Date.now() - 1000).toISOString()
  const code = state.codes[0].code
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code })
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
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const code = state.codes[0].code
  const res = await post('session', { gameId: '1340937090', gameServer: '6634', code })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, 'no_email')
})

await test('T-GL-15 лишний сервер не мешает входу, но чужой сервер отклоняется', async () => {
  reset()
  await post('code', { gameId: '1340937090', gameServer: '6634' })
  const code = state.codes[0].code
  const wrong = await post('session', { gameId: '1340937090', gameServer: '1111', code })
  assert.equal(wrong.status, 401, 'другой сервер — отказ')
  const ok = await post('session', { gameId: '1340937090', code })
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
  assert.match(src, /functionsUrl\('game-login'\)\}?\?action=\$\{action\}/)
  assert.match(src, /ACTION_URL\('code'\)/)
  assert.match(src, /ACTION_URL\('session'\)/)
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

console.log(`\n${passed}/${passed + failed} game-login tests passed`)
if (failed) process.exit(1)
