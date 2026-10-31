// NAME MLBB — экран входа и профиль: способ «через игру» виден и работает.
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
import { existsSync, readFileSync, rmSync } from 'node:fs'
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

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'https://otshelniks.github.io/Exams/',
  pretendToBeVisual: true,
})
// Настоящие стили: без них нельзя проверить каскад (например, что поля Game ID
// внутри окна идут в одну колонку). jsdom считает CSS, хоть и без раскладки.
const styleEl = dom.window.document.createElement('style')
styleEl.textContent = readFileSync(join(app, 'src/styles.css'), 'utf8')
dom.window.document.head.appendChild(styleEl)
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


// ---------- профиль: игровой аккаунт под «СОЦСЕТЯМИ» ----------
function mountProfile({ gameId = '1340937090', gameServer = '6634', gameVerified = false } = {}) {
  document.body.innerHTML = '<div id="root"></div>'
  const rootEl = createRoot(document.getElementById('root'))
  rootEl.render(React.createElement(screens.ProfileScreen, {
    profile: { nick: 'Stranger_zxc', heroes: [], socials: [], screenshots: [], pts: 120 },
    actions: { addSocial: async () => ({ ok: true }), removeSocial: async () => true, addSlot: () => {} },
    gameId, gameServer, gameVerified, onGameVerified: () => {},
    googleAccount: '', telegramLink: undefined,
    onLinkGoogle: () => {}, onUnlinkTelegram: () => {}, onStartTelegram: () => {},
    onRefreshTelegram: () => {}, onLinkVk: () => {}, onLinkTikTok: () => {},
    socialNotice: '', onSocialNoticeShown: () => {}, onBack: () => {}, onEdit: () => {},
    supabase: null, userId: 'u1',
  }))
  return rootEl
}

mountProfile()
await settle()

await test('T-AU-06 в профиле есть карточка игрового аккаунта под «СОЦСЕТЯМИ»', () => {
  const card = document.querySelector('.game-account')
  assert.ok(card, 'нет карточки игрового аккаунта')
  assert.match(card.textContent, /ИГРОВОЙ АККАУНТ/)
  assert.match(card.textContent, /Mobile Legends/)
  assert.match(card.textContent, /1340937090/, 'нет Game ID в карточке')
  // Заполненный Game ID сам по себе НЕ даёт статус «привязан».
  assert.match(card.textContent, /не подтверждён/)
  assert.doesNotMatch(card.textContent, /подтверждён кодом/i, 'статус врёт без кода из игры')
  // Карточка стоит сразу после блока «СОЦСЕТИ», а не внутри него.
  const social = document.querySelector('.social-block')
  assert.ok(social, 'нет блока соцсетей')
  assert.ok(social.nextElementSibling === card, 'карточка должна идти сразу под «СОЦСЕТЯМИ»')
})

await test('T-AU-07 кнопка в карточке открывает подтверждение кодом', async () => {
  const btn = Array.from(document.querySelectorAll('.game-account__btn'))
    .find((b) => /Подтвердить кодом из игры/.test(b.textContent))
  assert.ok(btn, 'нет кнопки подтверждения')
  click(btn)
  await settle()
  const html = document.body.innerHTML
  assert.match(html, /Вход через игру/, 'окно подтверждения не открылось')
  assert.match(html, /внутриигровую почту/, 'нет текста про почту в игре')
  assert.match(html, /Открыть игру и посмотреть ID/)
  // Привязка идёт только кодом из игры: выбора канала и Telegram тут быть не должно.
  assert.doesNotMatch(html, /Telegram-бот/, 'в привязке не должно быть Telegram-канала')
  assert.doesNotMatch(html, /Прислать код в Telegram/)
  assert.doesNotMatch(html, /Нет доступа к игре/)
})

await test('T-AU-10 подтверждённый аккаунт помечается как «подтверждён»', async () => {
  mountProfile({ gameVerified: true })
  await settle()
  const card = document.querySelector('.game-account')
  assert.match(card.textContent, /подтверждён/)
  assert.match(card.textContent, /подтверждён кодом из внутриигровой почты/i)
  assert.ok(card.className.includes('is-verified'), 'нет класса подтверждённой карточки')
  assert.ok(card.querySelector('.game-account__badge.is-on'), 'нет золотого бейджа')
})

await test('T-AU-11 в карточке логотип игры, а не джойстик', () => {
  const card = document.querySelector('.game-account')
  const mark = card.querySelector('.brand.mlbb img')
  assert.ok(mark, 'нет картинки логотипа MLBB')
  assert.match(mark.getAttribute('src'), /mlbb-logo\.png$/)
  assert.equal(card.querySelector('.brand.mlbb svg'), null, 'остался джойстик')
})

await test('T-AU-08 без Game ID карточка предлагает привязать аккаунт', async () => {
  mountProfile({ gameId: '', gameServer: '' })
  await settle()
  const card = document.querySelector('.game-account')
  assert.match(card.textContent, /не привязан/)
  const btn = Array.from(document.querySelectorAll('.game-account__btn'))
    .find((b) => /Привязать игровой аккаунт/.test(b.textContent))
  assert.ok(btn, 'нет кнопки привязки')
})

await test('T-AU-09 в окне подтверждения поля Game ID в одну колонку (не вылезают за карточку)', async () => {
  mountProfile()
  await settle()
  const btn = Array.from(document.querySelectorAll('.game-account__btn'))
    .find((b) => /Подтвердить кодом из игры/.test(b.textContent))
  click(btn)
  await settle()
  const card = document.querySelector('.modal__card')
  assert.ok(card, 'окно не открылось')
  const fields = card.querySelector('.id-fields')
  assert.ok(fields, 'нет полей Game ID')
  const style = dom.window.getComputedStyle(fields)
  assert.equal(style.gridTemplateColumns, '1fr', 'поля всё ещё в две колонки — вылезут на узком экране')
  // Внутри окна не должно быть горизонтальной прокрутки.
  assert.equal(dom.window.getComputedStyle(card).overflowX, 'hidden')
  // И на самой сетке, и на полях разрешено сжиматься — иначе цифры давят ширину.
  const wrap = fields.querySelector('.input-wrap')
  assert.equal(dom.window.getComputedStyle(wrap).minWidth, '0px')
})

rmSync(bundle, { force: true })
console.log(`\n${passed}/${passed + failed} auth-ui tests passed`)
if (failed) process.exit(1)
