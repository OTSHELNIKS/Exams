// NAME MLBB — экран входа: способ «через игру» действительно виден и работает.
//
// Это не grep по исходникам, а настоящий рендер в jsdom: собираем screens.jsx
// через esbuild (он уже есть в зависимостях vite), монтируем AuthScreen, ищем
// кнопку «Войти через игровой аккаунт MLBB», нажимаем её и проверяем, что
// открылось окно с выбором канала и кнопкой «Открыть игру».
//
// Такой тест ловит ровно ту ошибку, из-за которой способ входа «пропадает»:
// кнопка отрисована, но выключена/не подключена к обработчику.
//
// Run: node tests/auth-ui.test.mjs   (нужны app/node_modules: react, react-dom, jsdom, esbuild)
import assert from 'node:assert/strict'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const app = join(repoRoot, 'app')
const nm = join(app, 'node_modules')

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

const need = ['react', 'react-dom', 'jsdom', 'esbuild']
const missing = need.filter((pkg) => !existsSync(join(nm, pkg)))
if (missing.length) {
  console.log('SKIP auth-ui: нет app/node_modules (' + missing.join(', ') + ') — выполни npm install в app')
  process.exit(0)
}

// ---------- окружение браузера ----------
const { JSDOM } = await import(join(nm, 'jsdom/lib/api.js'))
const esbuild = (await import(join(nm, 'esbuild/lib/main.js'))).default || await import(join(nm, 'esbuild/lib/main.js'))

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://otshelniks.github.io/Exams/',
  pretendToBeVisual: true,
})
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event
globalThis.IS_REACT_ACT_ENVIRONMENT = false  // обычный рендер, без act-обёртки

// ---------- сборка экрана ----------
// Бандл кладём внутрь app/, иначе node не найдёт react рядом с ним.
const bundle = join(app, '.auth-ui-under-test.mjs')
await esbuild.build({
  entryPoints: [join(app, 'src/screens.jsx')],
  bundle: true,
  format: 'esm',
  outfile: bundle,
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'lucide-react'],
  define: { 'import.meta.env': '{}' },
  logLevel: 'silent',
})

const React = (await import(join(nm, 'react/index.js'))).default
const { createRoot } = await import(join(nm, 'react-dom/client.js'))
const screens = await import(bundle)

let root
function mount() {
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root'))
  React.startTransition(() => {})
  root.render(React.createElement(screens.AuthScreen, {
    gameId: '', setGameId: () => {}, gameServer: '', setGameServer: () => {},
    callbackError: '', onLogin: () => {}, onPreview: () => {}, supabase: null,
    session: null, onSignOut: () => {}, authReady: true,
  }))
}
// Ждём, пока React применит обновление (без act() из react — он есть не всегда).
const settle = () => new Promise((resolve) => setTimeout(resolve, 60))
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
const buttons = () => Array.from(document.querySelectorAll('button'))
const byText = (re) => buttons().find((b) => re.test(b.textContent || ''))

mount()
await settle()

await test('T-AU-01 способ «через игру» виден на экране входа', () => {
  const html = document.body.innerHTML
  assert.match(html, /Войти через игровой аккаунт MLBB/, 'плитки MLBB нет в разметке')
  assert.match(html, /Войти через игру — код в MLBB/, 'нет крупной кнопки входа через игру')
  assert.match(html, /СПОСОБЫ РЕГИСТРАЦИИ/)
})

await test('T-AU-02 плитка MLBB активна (не disabled, не «скоро»)', () => {
  const tile = buttons().find((b) => b.getAttribute('aria-label') === 'Войти через игровой аккаунт MLBB')
  assert.ok(tile, 'плитка не найдена среди кнопок')
  assert.equal(tile.disabled, false, 'плитка выключена')
  assert.doesNotMatch(tile.className, /method--soon/, 'плитка помечена как «скоро»')
  assert.match(tile.textContent, /MLBB/)
})

await test('T-AU-03 нажатие на плитку открывает окно входа через игру', async () => {
  const tile = buttons().find((b) => b.getAttribute('aria-label') === 'Войти через игровой аккаунт MLBB')
  click(tile)
  await settle()
  const html = document.body.innerHTML
  assert.match(html, /Вход через игру/, 'окно не открылось')
  assert.match(html, /Укажи Game ID и сервер/, 'нет шага ввода Game ID')
  assert.match(html, /Письмо в игре/, 'нет выбора канала «письмо в игре»')
  assert.match(html, /Telegram-бот/, 'нет запасного канала Telegram')
  assert.match(html, /Открыть игру и посмотреть ID/, 'нет кнопки открытия игры')
})

await test('T-AU-04 крупная кнопка тоже открывает окно', async () => {
  // Закрываем окно и жмём основную кнопку под полями Game ID.
  const close = document.querySelector('.modal__close, [aria-label="Закрыть"]')
  if (close) { click(close); await settle() }
  const primary = byText(/Войти через игру — код в MLBB/)
  assert.ok(primary, 'кнопки нет')
  assert.equal(primary.disabled, false, 'кнопка выключена')
  click(primary)
  await settle()
  assert.match(document.body.innerHTML, /Вход через игру/, 'окно не открылось')
})

await test('T-AU-05 иконки способов входа — настоящие логотипы, а не буквы', () => {
  const marks = Array.from(document.querySelectorAll('.brand'))
  assert.ok(marks.length >= 3, 'иконок нет')
  const svgs = marks.filter((m) => m.querySelector('svg'))
  assert.ok(svgs.length >= 3, 'логотипы не отрисованы как SVG')
  for (const mark of marks) {
    const text = (mark.textContent || '').trim()
    assert.ok(!/^(G|f|VK)$/.test(text), 'осталась буква-заглушка: ' + text)
  }
  const google = document.querySelector('.brand.google')
  assert.ok(google && google.querySelectorAll('svg path').length === 4, 'у Google не 4 фирменных цвета')
  const tg = document.querySelector('.brand.telegram')
  assert.match(tg.getAttribute('style') || '', /background/, 'у Telegram нет своей подложки')
})

rmSync(bundle, { force: true })
console.log(`\n${passed}/${passed + failed} auth-ui tests passed`)
if (failed) process.exit(1)
