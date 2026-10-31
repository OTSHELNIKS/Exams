// NAME MLBB — привязка TikTok (Login Kit, OAuth 2.0).
// Тест держит контракт с TikTok и требования безопасности:
//   • ссылка авторизации содержит client_key, scope, redirect_uri и state;
//   • код меняется на ник ТОЛЬКО на сервере — client_secret не уходит в браузер;
//   • сервер не возвращает токены и не сохраняет их;
//   • ошибки показываются человеческим языком, привязка пишется в базу.
// Run: node tests/tiktok-auth.test.mjs   (zero dependencies, сеть подменена)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const fn = read('supabase/functions/tiktok-auth/index.ts')
const app = read('app/src/App.jsx')
const screens = read('app/src/screens.jsx')
const data = read('app/src/data.js')
const supa = read('app/src/supabase.js')

// Клиент читает client key через window — подставляем до импорта модуля.
globalThis.window = {
  location: { origin: 'https://otshelniks.github.io', pathname: '/Exams/', href: '', assign() {} },
  __NAME_TIKTOK_CLIENT_KEY__: 'test-client-key',
}
globalThis.sessionStorage = {
  store: new Map(),
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null },
  setItem(k, v) { this.store.set(k, String(v)) },
  removeItem(k) { this.store.delete(k) },
}

const tiktok = await import('../app/src/tiktok-auth.js')

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

const REDIRECT = 'https://otshelniks.github.io/Exams/'

// ---------- шаг 1: уходим на TikTok ----------
await test('T-TT-01 ссылка авторизации содержит всё, что требует TikTok', () => {
  const url = new URL(tiktok.buildTikTokAuthUrl({ clientKey: 'ck123', redirect: REDIRECT, state: 'st' }))
  assert.equal(url.origin + url.pathname, 'https://www.tiktok.com/v2/auth/authorize/')
  assert.equal(url.searchParams.get('client_key'), 'ck123')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('scope'), 'user.info.basic')
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT)
  assert.equal(url.searchParams.get('state'), 'st')
})

await test('T-TT-02 client key берётся из window/env и не пустой', () => {
  assert.equal(tiktok.TIKTOK_CLIENT_KEY, 'test-client-key')
  assert.equal(tiktok.tiktokConfigured, true)
})

await test('T-TT-02b client key приложения зашит по умолчанию и собирается в бандл', () => {
  // Публичный идентификатор: без него плитка TikTok не показывается вовсе.
  assert.match(tiktok.DEFAULT_TIKTOK_CLIENT_KEY, /^[a-z0-9]{16,}$/, 'ключ по умолчанию пустой или битый')
  const workflow = read('.github/workflows/pages.yml')
  assert.ok(workflow.includes(tiktok.DEFAULT_TIKTOK_CLIENT_KEY), 'сборка на Pages не получает client key')
  assert.ok(workflow.includes('VITE_TIKTOK_CLIENT_KEY'), 'в workflow нет переменной сборки')
  // Секрет в репозиторий и в сборку попадать не должен.
  assert.ok(!/^\s*TIKTOK_CLIENT_SECRET\s*:/m.test(workflow), 'секрет попал в переменные сборки')
  assert.ok(!/client_secret\s*[:=]\s*['"]/.test(read('app/src/tiktok-auth.js')), 'секрет попал во фронтенд')
})

await test('T-TT-03 старт привязки сохраняет state для проверки на возврате', async () => {
  const url = await tiktok.startTikTokAuth({ clientKey: 'ck123', redirect: REDIRECT })
  const state = new URL(url).searchParams.get('state')
  assert.ok(state && state.length >= 20, 'state слишком короткий')
  assert.equal(sessionStorage.getItem('name-mlbb:tiktok-state'), state)
})

await test('T-TT-04 без client key привязка честно не запускается', async () => {
  await assert.rejects(() => tiktok.startTikTokAuth({ clientKey: '' }), /TIKTOK_NOT_CONFIGURED/)
})

// ---------- шаг 2: разбор возврата ----------
await test('T-TT-05 код и state читаются из адреса', () => {
  const parsed = tiktok.parseTikTokReturn('https://x.test/Exams/?code=abc&state=st&scopes=user.info.basic')
  assert.deepEqual(parsed, { code: 'abc', state: 'st', error: '' })
})

await test('T-TT-06 отказ пользователя распознаётся отдельно', () => {
  const parsed = tiktok.parseTikTokReturn('https://x.test/Exams/?error=access_denied&error_description=User+denied')
  assert.equal(parsed.error, 'access_denied')
})

await test('T-TT-07 обычная страница не считается возвратом', () => {
  assert.equal(tiktok.parseTikTokReturn('https://x.test/Exams/'), null)
  assert.equal(tiktok.parseTikTokReturn(''), null)
})

// ---------- шаг 3: обмен на сервере ----------
await test('T-TT-08 клиент отправляет на сервер только код и адрес возврата', async () => {
  let seen = null
  const fetchImpl = async (url, init) => {
    seen = { url: String(url), body: JSON.parse(init.body) }
    return { ok: true, json: async () => ({ ok: true, openId: 'open-1', handle: 'name.mlbb', name: 'NAME', avatar: 'https://cdn/a.jpg' }) }
  }
  const res = await tiktok.exchangeTikTokCode({ code: 'abc', redirect: REDIRECT, fetchImpl })
  assert.match(seen.url, /functions\/v1\/tiktok-auth\?action=exchange$/)
  assert.deepEqual(seen.body, { code: 'abc', redirectUri: REDIRECT })
  assert.ok(!JSON.stringify(seen).includes('secret'), 'секрет ушёл из браузера')
  assert.equal(res.handle, 'name.mlbb')
})

await test('T-TT-09 отказ сервера превращается в понятный код ошибки', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ ok: false, error: 'redirect_mismatch' }) })
  await assert.rejects(() => tiktok.exchangeTikTokCode({ code: 'abc', fetchImpl }), /TIKTOK_REDIRECT_MISMATCH/)
})

await test('T-TT-10 полный цикл: state совпал — ник получен', async () => {
  const url = await tiktok.startTikTokAuth({ clientKey: 'ck123', redirect: REDIRECT })
  const state = new URL(url).searchParams.get('state')
  const fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, openId: 'open-1', handle: 'name.mlbb' }) })
  const linked = await tiktok.completeTikTokAuth(`${REDIRECT}?code=abc&state=${state}`, { fetchImpl })
  assert.equal(linked.handle, 'name.mlbb')
  assert.equal(linked.openId, 'open-1')
})

await test('T-TT-11 чужой state не принимается', async () => {
  await tiktok.startTikTokAuth({ clientKey: 'ck123', redirect: REDIRECT })
  const fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, handle: 'x' }) })
  await assert.rejects(
    () => tiktok.completeTikTokAuth(`${REDIRECT}?code=abc&state=not-the-same`, { fetchImpl }),
    /TIKTOK_STATE_MISMATCH/,
  )
})

await test('T-TT-12 без сохранённого state привязка не проходит', async () => {
  sessionStorage.store.clear()
  const fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, handle: 'x' }) })
  await assert.rejects(() => tiktok.completeTikTokAuth(`${REDIRECT}?code=abc&state=s`, { fetchImpl }), /TIKTOK_STATE_LOST/)
})

await test('T-TT-13 отказ TikTok не превращается в ошибку сети', async () => {
  const fetchImpl = async () => { throw new Error('не должно вызываться') }
  await assert.rejects(() => tiktok.completeTikTokAuth(`${REDIRECT}?error=access_denied`, { fetchImpl }), /TIKTOK_DENIED/)
})

// ---------- серверная часть ----------
await test('T-TT-14 сервер меняет код на токен по правилам TikTok', () => {
  assert.match(fn, /https:\/\/open\.tiktokapis\.com\/v2\/oauth\/token\//)
  assert.match(fn, /'Content-Type': 'application\/x-www-form-urlencoded'/)
  for (const param of ['client_key', 'client_secret', 'grant_type', 'redirect_uri']) {
    assert.ok(fn.includes(param), 'нет параметра ' + param)
  }
  assert.match(fn, /grant_type: 'authorization_code'/)
})

await test('T-TT-15 секрет живёт только в переменных окружения', () => {
  assert.match(fn, /Deno\.env\.get\('TIKTOK_CLIENT_SECRET'\)/)
  assert.ok(!/client_secret\s*[:=]\s*['"][^'"]{6,}/.test(fn), 'секрет захардкожен в функции')
  assert.ok(!app.includes('client_secret'), 'секрет упоминается во фронтенде')
  assert.ok(!screens.includes('client_secret'), 'секрет упоминается в экранах')
})

await test('T-TT-16 токены не возвращаются клиенту', () => {
  const tail = fn.slice(fn.indexOf('return json({\n      ok: true'))
  assert.ok(!tail.includes('access_token') && !tail.includes('refresh_token'), 'токены уходят в браузер')
  assert.ok(/const info = await profile\(tokens\.accessToken/.test(fn), 'нет запроса профиля')
  assert.match(fn, /fields=.*open_id,display_name,avatar_url|open_id,display_name,avatar_url/)
})

await test('T-TT-17 ошибки TikTok переводятся в коды для клиента', () => {
  for (const code of ['redirect_mismatch', 'code_expired', 'token_failed']) {
    assert.ok(fn.includes(code), 'нет обработки ' + code)
  }
  assert.match(fn, /'not_found'/)
  assert.match(fn, /'not_configured'/)
})

await test('T-TT-18 health показывает, настроено ли приложение', () => {
  assert.match(fn, /url\.searchParams\.get\('health'\)/)
  assert.match(fn, /configured: Boolean\(CLIENT_KEY && CLIENT_SECRET\)/)
  assert.match(fn, /BUILD = 'tiktok-auth-v1'/)
})

// ---------- интеграция в приложении ----------
await test('T-TT-19 возврат с TikTok обрабатывается один раз и чистит адрес', () => {
  assert.ok(app.includes('parseTikTokReturn(window.location.href)'), 'нет разбора возврата')
  assert.ok(app.includes('tiktokHandled'), 'возврат может обработаться дважды')
  assert.ok(/\['code', 'state', 'scopes', 'error', 'error_description'\]/.test(app), 'параметры не вычищаются из адреса')
  assert.ok(app.includes('history.replaceState'), 'адрес не чистится')
})

await test('T-TT-20 привязка сохраняется в базу сразу', () => {
  const block = app.slice(app.indexOf('completeTikTokAuth'), app.indexOf('// Кнопка «Войти через VK»'))
  assert.ok(block.includes('upsert(profileToRow(next, gameId, gameServer, session.user.id)'), 'TikTok не сохраняется в player_profiles')
  assert.ok(block.includes("formatSocial('tiktok', linked.handle)"), 'ник не пишется в socials')
  assert.ok(block.includes('setSocialNotice'), 'результат не показывается игроку')
})

await test('T-TT-21 кнопка привязки в профиле', () => {
  assert.ok(screens.includes('onLinkTikTok'), 'соцсети не получают обработчик TikTok')
  assert.ok(screens.includes('Войти через TikTok'), 'нет кнопки входа через TikTok')
  assert.ok(screens.includes("provider === 'tiktok'"), 'нет шага TikTok в окне привязки')
  assert.ok(screens.includes("tiktok: 'tiktok'"), 'нет иконки TikTok в выборе')
})

await test('T-TT-22 неготовое приложение не показывается игроку', () => {
  assert.ok(screens.includes('tiktokConfigured'), 'плитка TikTok не зависит от настройки приложения')
  assert.ok(/pickable = SOCIAL_ACTIVE\.filter\(\(p\) => p\.id !== 'tiktok' \|\| tiktokConfigured\)/.test(screens),
    'TikTok показывается без client key')
})

await test('T-TT-23 TikTok — привязка, а не вход по почте', () => {
  assert.ok(data.includes("{ id: 'tiktok', label: 'TikTok'"), 'провайдер не добавлен')
  assert.ok(supa.includes("['telegram', 'vk', 'google', 'tiktok']"), 'TikTok не сохраняется в базу')
  assert.ok(supa.includes('.slice(0, 4)'), 'список соцсетей обрезается до трёх')
})

await test('T-TT-24 ошибки объясняются по-русски', () => {
  const cases = ['TIKTOK_NOT_CONFIGURED', 'TIKTOK_STATE_LOST', 'TIKTOK_DENIED', 'TIKTOK_REDIRECT_MISMATCH', 'TIKTOK_CODE_EXPIRED', 'TIKTOK_TOKEN_FAILED']
  for (const key of cases) {
    assert.ok(tiktok.describeTikTokError(new Error(key)).length > 20, 'нет текста для ' + key)
  }
  assert.match(tiktok.describeTikTokError(new Error('TIKTOK_REDIRECT_MISMATCH')), /адрес возврата/)
  assert.match(tiktok.describeTikTokError(new Error('TIKTOK_DENIED')), /не разрешил/)
})

console.log(`\ntiktok: ${passed}/${passed + failed}`)
if (failed) process.exit(1)
