// NAME MLBB — приложение должно открываться.
//
// Самый дорогой баг — белый экран: сборка зелёная, деплой зелёный, а на
// телефоне пусто. Поэтому здесь мы не грепаем код, а реально монтируем
// App.jsx в jsdom и смотрим, что он отрисовался без исключений.
//
// Тест ловит:
//   • обращение к переменной до её объявления (TDZ) — типичный «белый экран»;
//   • падение при первом рендере главного экрана;
//   • отсутствие корневого содержимого после монтирования.
//
// Run: node tests/app-boot.test.mjs   (нужны app/node_modules: react, react-dom, jsdom, esbuild)
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const app = join(repoRoot, 'app')
const nm = join(app, 'node_modules')

let passed = 0
let failed = 0
const queue = []
function test(name, fn) { queue.push({ name, fn }) }

const need = ['react', 'react-dom', 'jsdom', 'esbuild']
const missing = need.filter((pkg) => !existsSync(join(nm, pkg)))
if (missing.length) {
  console.log('SKIP app-boot: нет app/node_modules (' + missing.join(', ') + ') — выполни npm install в app')
  process.exit(0)
}

const { JSDOM } = await import(join(nm, 'jsdom/lib/api.js'))
const esbuild = (await import(join(nm, 'esbuild/lib/main.js'))).default

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'https://otshelniks.github.io/Exams/',
  pretendToBeVisual: true,
})
const styleEl = dom.window.document.createElement('style')
styleEl.textContent = readFileSync(join(app, 'src/styles.css'), 'utf8')
dom.window.document.head.appendChild(styleEl)

globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event
globalThis.localStorage = dom.window.localStorage
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.IS_REACT_ACT_ENVIRONMENT = false

// Ошибки, которые React «проглатывает» в консоль, тоже считаем падением:
// на телефоне это ровно тот же белый экран.
const crashLog = []
const origError = console.error
console.error = (...args) => { crashLog.push(args.map(String).join(' ')); origError(...args) }

const bundle = join(app, '.app-boot-under-test.mjs')
await esbuild.build({
  entryPoints: [join(app, 'src/App.jsx')],
  bundle: true,
  format: 'esm',
  outfile: bundle,
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'lucide-react'],
  define: {
    'import.meta.env': JSON.stringify({ MODE: 'production', PROD: true, DEV: false, BASE_URL: '/Exams/' }),
  },
  logLevel: 'silent',
})

const React = (await import(join(nm, 'react/index.js'))).default
const { createRoot } = await import(join(nm, 'react-dom/client.js'))
const mod = await import(bundle)
const App = mod.default
const settle = () => new Promise((resolve) => setTimeout(resolve, 120))

// React выбрасывает ошибку рендера асинхронно (через reportError), поэтому
// ловим её и на уровне процесса, иначе тест просто упадёт стектрейсом.
const mountErrors = []
const onUncaught = (error) => { mountErrors.push(error) }
process.on('uncaughtException', onUncaught)

let mountError = null
let root = null
try {
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root'))
  root.render(React.createElement(App))
  await settle()
} catch (error) {
  mountError = error
}

test('T-BOOT-01 App.jsx отдаёт компонент', () => {
  assert.equal(typeof App, 'function', 'default export из App.jsx — не компонент')
})

test('T-BOOT-02 приложение монтируется без исключения', () => {
  assert.equal(mountError, null, `падение при монтировании: ${mountError && mountError.message}`)
  assert.equal(mountErrors.length, 0, `необработанная ошибка рендера: ${mountErrors[0] && mountErrors[0].message}`)
})

test('T-BOOT-03 React не сообщает об ошибке рендера', () => {
  const crash = crashLog.find((line) => /is not defined|before initialization|Cannot read|Minified React error|The above error occurred/i.test(line))
  assert.equal(crash, undefined, `ошибка рендера: ${crash}`)
})

test('T-BOOT-04 на экране есть содержимое, а не пустой контейнер', () => {
  const html = document.body.innerHTML
  assert.ok(html.length > 500, 'разметка почти пустая — вероятно белый экран')
  assert.match(html, /class="[^"]*(app|screen|landing)/, 'нет ни одного экрана приложения')
})

test('T-BOOT-05 главный экран показывает бренд и навигацию', () => {
  const html = document.body.innerHTML
  assert.match(html, /NAME/, 'нет названия платформы')
  const buttons = Array.from(document.querySelectorAll('button'))
  assert.ok(buttons.length >= 3, `кнопок слишком мало: ${buttons.length}`)
})

test('T-BOOT-07 каждый экран монтируется отдельно (дыры вроде TDZ видны сразу)', async () => {
  const screensBundle = join(app, '.app-boot-screens.mjs')
  await esbuild.build({
    entryPoints: [join(app, 'src/screens.jsx')],
    bundle: true,
    format: 'esm',
    outfile: screensBundle,
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'lucide-react'],
    define: { 'import.meta.env': '{}' },
    logLevel: 'silent',
  })
  const S = await import(screensBundle)
  const base = {
    supabase: null, userId: 'u1', onBack() {}, onReady() {}, onLeaderboard() {},
    onProfile() {}, onLobby() {}, onEquip() {}, onTransferCaptain: async () => {},
  }
  const profile = { nick: 'QA', level: 3, roles: [], socials: [], screenshots: [], elo: 1016, matchesPlayed: 12, wins: 7 }
  const teams = {
    teamA: [{ user_id: 'u1', nick: 'A1', isCaptain: true, checked_in: true }, { user_id: 'u2', nick: 'A2' }],
    teamB: [{ user_id: 'u3', nick: 'B1', isCaptain: true }, { user_id: 'u4', nick: 'B2' }],
    lobbyCode: '123456',
  }
  const look = { framePalette: 'gold', frameArt: 3, bannerCss: 'pbanner-ember', titleText: 'ВЕТЕРАН', colorValue: '#ffc83d' }
  const cases = [
    ['HomeScreen', { profile, actions: { goLeaderboard() {}, goDraft() {} }, look }],
    ['ProfileScreen', { profile, actions: {}, look }],
    ['DraftScreen', {}],
    ['MatchScreen', { teams }],
    ['LeaderboardScreen', {}],
    ['AppearanceScreen', { playerState: { verified: false, matches: 12, wins: 7, mmr: 1016, entitlements: [] }, profile }],
  ]
  for (const [name, props] of cases) {
    assert.equal(typeof S[name], 'function', `экран ${name} не экспортируется`)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const before = mountErrors.length
    const r = createRoot(host)
    r.render(React.createElement(S[name], { ...base, ...props }))
    await new Promise((resolve) => setTimeout(resolve, 90))
    r.unmount()
    host.remove()
    assert.equal(mountErrors.length, before, `${name}: ${mountErrors[before] && mountErrors[before].message}`)
  }
  rmSync(screensBundle, { force: true })
})

test('T-BOOT-08 все девять рамок рисуются и не ломают разметку', async () => {
  const framesBundle = join(app, '.app-boot-frames.mjs')
  await esbuild.build({
    entryPoints: [join(app, 'src/frames.jsx')],
    bundle: true,
    format: 'esm',
    outfile: framesBundle,
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    define: { 'import.meta.env': '{}' },
    logLevel: 'silent',
  })
  const { ProfileFrame, FRAME_PALETTES, FRAME_MOTIFS } = await import(framesBundle)
  const palettes = Object.keys(FRAME_PALETTES)
  assert.equal(palettes.length, 9)
  assert.equal(FRAME_MOTIFS.length, 9, 'мотивы рамок должны быть разными')
  assert.equal(new Set(FRAME_MOTIFS).size, 9)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const r = createRoot(host)
  r.render(React.createElement('div', null, palettes.map((palette, i) => React.createElement(ProfileFrame, { key: palette, palette, art: FRAME_MOTIFS[i] }))))
  await new Promise((resolve) => setTimeout(resolve, 90))
  assert.equal(host.querySelectorAll('svg.pframe').length, 9, 'часть рамок не отрисовалась')
  // Каждая рамка — своя форма: класс мотива в svg разный.
  const motifs = Array.from(host.querySelectorAll('svg.pframe')).map((svg) => (svg.getAttribute('class').match(/pframe--([a-z]+)/g) || []).join(','))
  assert.equal(new Set(motifs).size, 9, 'две рамки нарисованы одинаково')
  // Градиенты у каждой рамки свои, иначе цвета «перетекают» между аватарами.
  const ids = Array.from(host.querySelectorAll('linearGradient')).map((n) => n.id)
  assert.equal(new Set(ids).size, ids.length, 'дубли id в SVG-градиентах')
  r.unmount()
  host.remove()
  rmSync(framesBundle, { force: true })
})

test('T-BOOT-06 ни один модуль приложения не падает при импорте', async () => {
  for (const file of ['cosmetics.js', 'rating.js', 'frames.jsx', 'screens.jsx', 'ui.jsx', 'data.js']) {
    const out = join(app, `.app-boot-${file.replace(/\W/g, '_')}.mjs`)
    await esbuild.build({
      entryPoints: [join(app, 'src', file)],
      bundle: true,
      format: 'esm',
      outfile: out,
      jsx: 'automatic',
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'lucide-react'],
      define: { 'import.meta.env': '{}' },
      logLevel: 'silent',
    })
    await import(out)
    rmSync(out, { force: true })
  }
})

rmSync(bundle, { force: true })
console.error = origError
process.off('uncaughtException', onUncaught)

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

console.log(`\napp-boot: ${passed}/${passed + failed}`)
process.exitCode = failed ? 1 : 0
