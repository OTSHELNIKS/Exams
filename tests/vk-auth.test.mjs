// NAME MLBB — привязка VK через VK ID (OAuth 2.1 + PKCE).
// Тест держит контракт с VK: адрес authorize, обязательные параметры PKCE,
// обмен кода на токен с device_id, разбор ника и понятные ошибки.
// Сеть подменена — реальных запросов нет.
// Run: node tests/vk-auth.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// В node нет window/crypto.subtle в нужном виде — подставляем минимальный шим.
globalThis.window = { location: { origin: 'https://otshelniks.github.io', pathname: '/Exams/', assign() {} } }
globalThis.sessionStorage = {
  store: new Map(),
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null },
  setItem(k, v) { this.store.set(k, String(v)) },
  removeItem(k) { this.store.delete(k) },
}
// В Node 22 globalThis.crypto уже есть (WebCrypto) — используем его как есть.
const vk = await import('../app/src/vk-auth.js')

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log('PASS ' + name)
  } catch (error) {
    failed += 1
    console.log('FAIL ' + name + ' — ' + error.message)
  }
}

test('T-VK-01 ссылка авторизации содержит всё, что требует VK', () => {
  const url = new URL(vk.buildVkAuthUrl({ clientId: '7915193', redirect: 'https://otshelniks.github.io/Exams/', state: 's'.repeat(32), challenge: 'chal' }))
  assert.equal(url.origin + url.pathname, 'https://id.vk.ru/authorize')
  const p = url.searchParams
  assert.equal(p.get('response_type'), 'code')
  assert.equal(p.get('client_id'), '7915193')
  assert.equal(p.get('redirect_uri'), 'https://otshelniks.github.io/Exams/')
  assert.equal(p.get('code_challenge_method'), 'S256')
  assert.equal(p.get('code_challenge'), 'chal')
  assert.ok((p.get('state') || '').length >= 32, 'state короче 32 символов')
})

test('T-VK-02 PKCE: challenge — base64url от sha256', async () => {
  const challenge = await vk.codeChallenge('abc')
  assert.equal(challenge, 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0')
  assert.ok(!/[+/=]/.test(challenge), 'challenge должен быть base64url')
})

test('T-VK-03 возврат с VK разбирается, обычный адрес — нет', () => {
  const parsed = vk.parseVkReturn('https://otshelniks.github.io/Exams/?code=abc&device_id=1111&state=xyz')
  assert.deepEqual(parsed, { code: 'abc', deviceId: '1111', state: 'xyz' })
  assert.equal(vk.parseVkReturn('https://otshelniks.github.io/Exams/'), null)
  assert.equal(vk.parseVkReturn('https://otshelniks.github.io/Exams/?code=abc'), null)
})

test('T-VK-04 обмен кода на токен идёт на /oauth2/auth с device_id', async () => {
  let seen = null
  const fetchImpl = async (url, init) => {
    seen = { url, body: new URLSearchParams(init.body) }
    return { ok: true, status: 200, json: async () => ({ access_token: 'tok', user_id: 42 }) }
  }
  const result = await vk.exchangeVkCode({
    code: 'c0de', deviceId: '777', state: 'st', verifier: 'ver',
    clientId: '7915193', redirect: 'https://otshelniks.github.io/Exams/', fetchImpl,
  })
  assert.equal(result.accessToken, 'tok')
  assert.equal(result.userId, '42')
  assert.equal(seen.url, 'https://id.vk.ru/oauth2/auth')
  assert.equal(seen.body.get('grant_type'), 'authorization_code')
  assert.equal(seen.body.get('device_id'), '777')
  assert.equal(seen.body.get('code_verifier'), 'ver')
  assert.equal(seen.body.get('redirect_uri'), 'https://otshelniks.github.io/Exams/')
})

test('T-VK-05 ошибка VK превращается в исключение с причиной', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_request', error_description: 'device_id is invalid' }) })
  await assert.rejects(
    () => vk.exchangeVkCode({ code: 'c', deviceId: 'd', state: 's', verifier: 'v', clientId: '1', redirect: 'r', fetchImpl }),
    /device_id is invalid/,
  )
})

test('T-VK-06 ник берётся из users.get, при сбое остаётся id', async () => {
  const ok = await vk.fetchVkProfile({
    accessToken: 'tok', userId: '42',
    fetchImpl: async () => ({ json: async () => ({ response: [{ screen_name: 'durov', first_name: 'Павел', last_name: 'Дуров' }] }) }),
  })
  assert.deepEqual(ok, { handle: '@durov', name: 'Павел Дуров' })
  const broken = await vk.fetchVkProfile({ accessToken: 'tok', userId: '42', fetchImpl: async () => ({ json: async () => ({ error: {} }) }) })
  assert.equal(broken.handle, 'id42')
})

test('T-VK-07 полный цикл: state сверяется, ник возвращается', async () => {
  const verifier = 'v'.repeat(50)
  sessionStorage.setItem('name-mlbb:vk-verifier', verifier)
  sessionStorage.setItem('name-mlbb:vk-state', 'STATE123')
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push(url)
    if (url.includes('/oauth2/auth')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok', user_id: 7 }) }
    return { json: async () => ({ response: [{ screen_name: 'durov' }] }) }
  }
  const result = await vk.completeVkAuth('https://otshelniks.github.io/Exams/?code=Q&device_id=9&state=STATE123', { fetchImpl })
  assert.equal(result.handle, '@durov')
  assert.equal(result.userId, '7')
  assert.equal(calls.length, 2)
  assert.equal(sessionStorage.getItem('name-mlbb:vk-verifier'), null, 'verifier должен удаляться')

  sessionStorage.setItem('name-mlbb:vk-verifier', verifier)
  sessionStorage.setItem('name-mlbb:vk-state', 'GOOD')
  await assert.rejects(
    () => vk.completeVkAuth('https://otshelniks.github.io/Exams/?code=Q&device_id=9&state=EVIL', { fetchImpl }),
    /VK_STATE_MISMATCH/,
  )
})

test('T-VK-08 приложение VK ID подключено, ошибки объясняются по-русски', () => {
  assert.equal(vk.VK_CLIENT_ID, '54867424')
  assert.equal(vk.vkConfigured, true)
  const msg = vk.describeVkError(new Error('VK_ID_NOT_CONFIGURED'))
  assert.match(msg, /dev\.vk\.com/)
  assert.match(vk.describeVkError(new Error('VK_STATE_LOST')), /ещё раз/i)
  assert.match(vk.describeVkError(new Error('VK_TOKEN: invalid_client')), /Разрешить|redirect|VK не выдал/i)
})

test('T-VK-09 App связывает VK с профилем и чистит адрес', () => {
  const app = read('app/src/App.jsx')
  assert.ok(app.includes('parseVkReturn(window.location.href)'), 'нет разбора возврата VK')
  assert.ok(app.includes("url.searchParams.delete('code')") || app.includes("['code', 'device_id', 'state']"), 'код остаётся в адресе')
  assert.ok(app.includes('formatSocial(\'vk\', linked.handle)'), 'VK не попадает в соцсети профиля')
  assert.ok(app.includes('upsert(profileToRow(nextProfile'), 'привязка VK не сохраняется в базу')
})

console.log(`\nvk-auth: ${passed}/${passed + failed}`)
if (failed) process.exit(1)
