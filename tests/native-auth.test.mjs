// NAME MLBB — мобильное приложение (Capacitor): вход и «Открыть игру».
//
// Что проверяем:
//   1. разбор deep link com.namemlbb.app://auth — и ?code=, и #error=;
//   2. правильный redirectTo: приложение → deep link, браузер → адрес сайта;
//   3. startOAuth в приложении не редиректит WebView, а отдаёт ссылку
//      системному браузеру (иначе Google блокирует вход из WebView);
//   4. схема из кода совпадает с AndroidManifest, Info.plist и capacitor.config;
//   5. «Открыть игру» в приложении идёт через AppLauncher, а без игры — в магазин.
//
// Run: node tests/native-auth.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const { NATIVE_REDIRECT, parseNativeAuthUrl, completeNativeAuth, authRedirectTo, startOAuth } =
  await import('../app/src/native-auth.js')
const { openGame } = await import('../app/src/game-link.js')

// Тесты складываем в очередь и запускаем по одному в конце: часть из них
// асинхронная, а top-level await на каждый вызов сделал бы порядок вывода
// непредсказуемым.
let passed = 0
let failed = 0
const queue = []
function test(name, fn) {
  queue.push({ name, fn })
}

function withNative(value, fn) {
  const previous = globalThis.Capacitor
  globalThis.Capacitor = value ? { isNativePlatform: () => true } : { isNativePlatform: () => false }
  try {
    return fn()
  } finally {
    if (previous === undefined) delete globalThis.Capacitor
    else globalThis.Capacitor = previous
  }
}

// ---------------------------------------------------------------- deep link

test('T-NAT-01 адрес возврата — com.namemlbb.app://auth', () => {
  assert.equal(NATIVE_REDIRECT, 'com.namemlbb.app://auth')
})

test('T-NAT-02 PKCE-код из query разбирается', () => {
  const parsed = parseNativeAuthUrl('com.namemlbb.app://auth?code=abc-123')
  assert.equal(parsed.code, 'abc-123')
  assert.equal(parsed.error, '')
})

test('T-NAT-03 ошибка провайдера из query читается по-человечески', () => {
  const parsed = parseNativeAuthUrl('com.namemlbb.app://auth?error=access_denied&error_description=User+denied')
  assert.equal(parsed.error, 'access_denied')
  assert.equal(parsed.description, 'User denied')
})

test('T-NAT-04 ошибка из hash тоже ловится', () => {
  const parsed = parseNativeAuthUrl('com.namemlbb.app://auth#error=server_error&error_code=unexpected_failure')
  assert.equal(parsed.error, 'server_error')
})

test('T-NAT-05 мусор вместо адреса не роняет приложение', () => {
  for (const bad of ['', null, undefined, 'не ссылка']) {
    const parsed = parseNativeAuthUrl(bad)
    assert.deepEqual(parsed, { code: '', error: '', description: '' })
  }
})

test('T-NAT-06 без кода возврат не считается успешным', async () => {
  const result = await completeNativeAuth('com.namemlbb.app://auth', { auth: {} })
  assert.equal(result.ok, false)
  assert.match(result.error, /код/i)
})

test('T-NAT-07 код меняется на сессию через exchangeCodeForSession', async () => {
  let used = ''
  const supabase = { auth: { exchangeCodeForSession: async (code) => { used = code; return { error: null } } } }
  const result = await completeNativeAuth('com.namemlbb.app://auth?code=xyz', supabase)
  assert.equal(result.ok, true)
  assert.equal(used, 'xyz')
})

test('T-NAT-08 ошибка обмена показывается игроку', async () => {
  const supabase = { auth: { exchangeCodeForSession: async () => ({ error: { message: 'invalid grant' } }) } }
  const result = await completeNativeAuth('com.namemlbb.app://auth?code=xyz', supabase)
  assert.equal(result.ok, false)
  assert.equal(result.error, 'invalid grant')
})

// ------------------------------------------------------------------ redirect

test('T-NAT-09 в приложении redirectTo — deep link', () => {
  withNative(true, () => {
    globalThis.window = { location: { protocol: 'capacitor:', origin: 'capacitor://localhost', pathname: '/', search: '', hash: '' } }
    assert.equal(authRedirectTo(), NATIVE_REDIRECT)
    delete globalThis.window
  })
})

test('T-NAT-10 в браузере redirectTo остаётся адресом сайта', () => {
  withNative(false, () => {
    globalThis.window = { location: { protocol: 'https:', origin: 'https://otshelniks.github.io', pathname: '/Exams/', search: '', hash: '' } }
    assert.equal(authRedirectTo(), 'https://otshelniks.github.io/Exams/')
    delete globalThis.window
  })
})

test('T-NAT-11 в приложении OAuth не редиректит WebView, а уходит в браузер', async () => {
  await withNative(true, async () => {
    globalThis.window = { location: { protocol: 'capacitor:', origin: 'capacitor://localhost', pathname: '/', search: '', hash: '' } }
    let options = null
    const opened = []
    const supabase = {
      auth: {
        signInWithOAuth: async (args) => {
          options = args.options
          return { data: { provider: args.provider, url: 'https://accounts.google.com/o/oauth2/auth?x=1' }, error: null }
        },
      },
    }
    const result = await startOAuth(supabase, { provider: 'google', open: async (url) => { opened.push(url) } })
    assert.equal(result.redirected, true)
    assert.equal(options.skipBrowserRedirect, true)
    assert.equal(options.redirectTo, NATIVE_REDIRECT)
    assert.deepEqual(opened, ['https://accounts.google.com/o/oauth2/auth?x=1'])
    delete globalThis.window
  })
})

test('T-NAT-12 в браузере OAuth идёт обычным редиректом', async () => {
  await withNative(false, async () => {
    globalThis.window = { location: { protocol: 'https:', origin: 'https://otshelniks.github.io', pathname: '/Exams/', search: '', hash: '' } }
    let options = null
    const supabase = {
      auth: {
        signInWithOAuth: async (args) => { options = args.options; return { data: { provider: args.provider, url: 'https://accounts.google.com/o/oauth2/auth' }, error: null } },
      },
    }
    const result = await startOAuth(supabase, { provider: 'google', open: async () => { throw new Error('в браузере открывать нечего') } })
    assert.equal(result.redirected, true)
    assert.equal(options.skipBrowserRedirect, undefined)
    assert.equal(options.redirectTo, 'https://otshelniks.github.io/Exams/')
    delete globalThis.window
  })
})

test('T-NAT-13 привязка Google использует linkIdentity, а не новый вход', async () => {
  await withNative(false, async () => {
    globalThis.window = { location: { protocol: 'https:', origin: 'https://otshelniks.github.io', pathname: '/Exams/' } }
    let used = ''
    const supabase = {
      auth: {
        linkIdentity: async () => { used = 'linkIdentity'; return { data: { url: 'https://accounts.google.com/o/oauth2/auth' }, error: null } },
        signInWithOAuth: async () => { used = 'signInWithOAuth'; return { data: {}, error: null } },
      },
    }
    await startOAuth(supabase, { provider: 'google', link: true })
    assert.equal(used, 'linkIdentity')
    delete globalThis.window
  })
})

test('T-NAT-14 ошибка Supabase пробрасывается наверх', async () => {
  await withNative(false, async () => {
    globalThis.window = { location: { protocol: 'https:', origin: 'https://x.dev', pathname: '/' } }
    const supabase = { auth: { signInWithOAuth: async () => ({ data: {}, error: { message: 'provider is not enabled' } }) } }
    await assert.rejects(() => startOAuth(supabase, { provider: 'google' }), /provider is not enabled/)
    delete globalThis.window
  })
})

// ------------------------------------------------------------- нативные файлы

test('T-NAT-15 Android ловит возврат по схеме com.namemlbb.app', () => {
  const manifest = read('app/android/app/src/main/AndroidManifest.xml')
  assert.match(manifest, /android\.intent\.action\.VIEW/)
  assert.match(manifest, /android:scheme="com\.namemlbb\.app"/)
  assert.match(manifest, /android:host="auth"/)
})

test('T-NAT-16 iOS ловит возврат по CFBundleURLSchemes', () => {
  const plist = read('app/ios/App/App/Info.plist')
  assert.match(plist, /CFBundleURLSchemes/)
  assert.match(plist, /<string>com\.namemlbb\.app<\/string>/)
})

test('T-NAT-17 appId в capacitor.config совпадает со схемой возврата', () => {
  const config = read('app/capacitor.config.ts')
  assert.match(config, /appId:\s*'com\.namemlbb\.app'/)
  assert.match(config, /webDir:\s*'dist'/)
})

test('T-NAT-18 сборка приложения использует относительные пути к ассетам', () => {
  const vite = read('app/vite.config.js')
  assert.match(vite, /VITE_NATIVE/)
  assert.match(vite, /'\.\/'/)
})

test('T-NAT-19 в приложении есть разрешение открывать MLBB', () => {
  const manifest = read('app/android/app/src/main/AndroidManifest.xml')
  assert.match(manifest, /com\.mobile\.legends/)
  const plist = read('app/ios/App/App/Info.plist')
  assert.match(plist, /LSApplicationQueriesSchemes/)
  assert.match(plist, /<string>mlbb<\/string>/)
})

test('T-NAT-20 «Открыть игру» в приложении идёт через AppLauncher', async () => {
  const launches = []
  const result = await openGame({
    platform: 'android',
    launcher: async (url) => { launches.push(url) },
    navigate: async (url) => { launches.push('browser:' + url) },
    sleep: async () => {},
    waitMs: 0,
  })
  assert.equal(result.opened, true)
  assert.equal(result.via, 'launcher')
  assert.deepEqual(launches, ['mlbb://'])
})

test('T-NAT-21 если игры нет — уводим в Play Store', async () => {
  const visited = []
  const result = await openGame({
    platform: 'android',
    launcher: async () => { throw new Error('game_not_installed') },
    navigate: async (url) => { visited.push(url) },
    sleep: async () => {},
    waitMs: 0,
  })
  assert.equal(result.opened, false)
  assert.equal(result.via, 'store')
  assert.equal(visited.length, 1)
  assert.match(visited[0], /play\.google\.com/)
})

test('T-NAT-22 в браузере «Открыть игру» работает по-старому', async () => {
  const visited = []
  const result = await openGame({
    platform: 'android',
    navigate: async (url) => { visited.push(url) },
    sleep: async () => {},
    // Игра открылась — вкладка браузера ушла в фон.
    isHidden: () => true,
    waitMs: 0,
  })
  assert.equal(result.opened, true)
  assert.equal(visited[0].startsWith('intent://'), true)
})

for (const { name, fn } of queue) {
  try {
    await fn()
    passed += 1
    console.log('PASS ' + name)
  } catch (error) {
    failed += 1
    console.log('FAIL ' + name + ' — ' + error.message)
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
