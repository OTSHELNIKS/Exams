// NAME MLBB — выбор оформления должен сразу менять превью.
//
// Баг, который поймал этот тест: «нажимаю рамку — не переключается, нажимаю
// другую — не переключается вообще». Причина была в состоянии экрана: «что
// надето» хранилось в формате строки из базы, а после первого выбора туда
// писались ключи вида frame/banner. Следующий рендер читал frame_id, не
// находил и откатывался к базовой рамке.
//
// Поэтому здесь не grep, а настоящие клики в jsdom: монтируем AppearanceScreen
// и смотрим, что превью и отметка «надето» меняются с первого раза, что
// переключение туда-обратно работает, что отказ сервера откатывает выбор и что
// медленный ответ загрузки не сбрасывает только что сделанный выбор.
//
// Run: node tests/appearance-pick.test.mjs   (нужны app/node_modules)
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const app = join(root, 'app')
const nm = join(app, 'node_modules')

let passed = 0
let failed = 0
const queue = []
function test(name, fn) { queue.push({ name, fn }) }

const need = ['react', 'react-dom', 'jsdom', 'esbuild']
const missing = need.filter((pkg) => !existsSync(join(nm, pkg)))
if (missing.length) {
  console.log('SKIP appearance-pick: нет app/node_modules (' + missing.join(', ') + ')')
  process.exit(0)
}

const { JSDOM } = await import(join(nm, 'jsdom/lib/api.js'))
const esbuild = (await import(join(nm, 'esbuild/lib/main.js'))).default

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
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
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.localStorage = dom.window.localStorage
globalThis.IS_REACT_ACT_ENVIRONMENT = false

// Экрану нужен сервер: подменяем модуль supabase.js стабом (см. fixtures).
const bundle = join(app, '.appearance-under-test.mjs')
await esbuild.build({
  entryPoints: [join(app, 'src/screens.jsx')],
  bundle: true,
  format: 'esm',
  outfile: bundle,
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'lucide-react'],
  plugins: [{
    name: 'stub-supabase',
    setup(build) {
      build.onResolve({ filter: /supabase\.js$/ }, (args) => (
        args.importer.endsWith('screens.jsx') ? { path: join(here, 'fixtures/supabase-stub.mjs') } : undefined
      ))
    },
  }],
  define: { 'import.meta.env': '{}' },
  logLevel: 'silent',
})

const React = (await import(join(nm, 'react/index.js'))).default
const { createRoot } = await import(join(nm, 'react-dom/client.js'))
const S = await import(bundle)
const stub = globalThis.__stubState
const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))
console.error = () => {}

// Игрок с прогрессом: почти всё бесплатное открыто.
const PLAYER = { verified: true, matches: 600, wins: 300, mmr: 2000, entitlements: [] }

let reactRoot = null
let host = null
async function mount({ latency = 0, equipLatency = 0, failNext = null, entitlements = [] } = {}) {
  if (reactRoot) { reactRoot.unmount(); host.remove() }
  Object.assign(stub, {
    loadout: { user_id: 'u1', frame_id: 'frame-default', banner_id: 'banner-none', title_id: 'title-none', color_id: 'color-default' },
    entitlements,
    calls: [],
    failNext,
    loadLatency: latency,
    equipLatency,
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  // Загрузки шапок между тестами не должны протекать.
  if (globalThis.__stubUploads) globalThis.__stubUploads.length = 0
  reactRoot = createRoot(host)
  reactRoot.render(React.createElement(S.AppearanceScreen, {
    supabase: {}, userId: 'u1', playerState: PLAYER, profile: { nick: 'QA' },
    onEquip: () => {}, onBack: () => {},
  }))
  await settle(latency + 60)
}

const cards = () => Array.from(document.querySelectorAll('.cosmetic-card'))
const titleOf = (card) => card.querySelector('strong')?.textContent || ''
const clickChip = async (label) => {
  const chip = Array.from(document.querySelectorAll('.cosmetics__tabs button'))
    .find((b) => (b.textContent || '').trim() === label)
  assert.ok(chip, `нет вкладки «${label}»`)
  chip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await settle()
}
const clickCard = async (label, wait = 120) => {
  const card = cards().find((c) => titleOf(c) === label)
  assert.ok(card, `нет карточки «${label}»`)
  card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await settle(wait)
}
const previewPalette = () => {
  const frame = document.querySelector('.cosmetics__preview .pframe')
  if (!frame) return null
  const m = frame.getAttribute('class').match(/pframe--([a-z]+)/)
  return m ? m[1] : null
}
const previewBanner = () => document.querySelector('.cosmetics__preview .pbanner')?.getAttribute('class') || null
const equippedTitles = () => cards().filter((c) => c.className.includes('is-equipped')).map(titleOf)
const errorText = () => document.querySelector('.lobby__error')?.textContent || ''

await mount()

test('T-PICK-00 экран открывается на базовой рамке', () => {
  assert.equal(previewPalette(), 'steel')
  assert.deepEqual(equippedTitles(), ['Классика'])
})

test('T-PICK-01 рамка переключается с первого клика', async () => {
  await clickCard('Лавр')
  assert.equal(previewPalette(), 'gold', 'превью не сменилось на золото')
  assert.deepEqual(equippedTitles(), ['Лавр'], 'отметка «надето» осталась на старой рамке')
  assert.deepEqual(stub.calls, ['frame-gold'], 'сервер не получил выбор')
})

test('T-PICK-02 вторая рамка тоже переключается (нет «залипания»)', async () => {
  await clickCard('Пламя')
  assert.equal(previewPalette(), 'emerald')
  assert.deepEqual(equippedTitles(), ['Пламя'])
  await clickCard('Рога')
  assert.equal(previewPalette(), 'ruby')
  assert.deepEqual(equippedTitles(), ['Рога'])
  assert.deepEqual(stub.calls, ['frame-gold', 'frame-emerald', 'frame-ruby'])
})

test('T-PICK-03 возврат на базовую рамку тоже работает', async () => {
  await clickCard('Классика')
  assert.equal(previewPalette(), 'steel')
  assert.deepEqual(equippedTitles(), ['Классика'])
})

test('T-PICK-04 шапка профиля переключается тем же путём', async () => {
  const before = stub.calls.length
  await clickChip('Шапка профиля')
  assert.match(previewBanner(), /pbanner-none/, 'на старте должна быть базовая шапка')
  await clickCard('Закат')
  assert.match(previewBanner(), /pbanner-ember/, 'шапка не переключилась')
  await clickCard('Легенда')
  assert.match(previewBanner(), /pbanner-legend/, 'вторая шапка не переключилась')
  assert.deepEqual(stub.calls.slice(before), ['banner-ember', 'banner-legend'])
})

test('T-PICK-05 закрытый предмет не отправляется на сервер', async () => {
  const before = stub.calls.length
  await clickChip('Рамка')
  // «Алмаз» — коллекционная рамка: без права она не открыта.
  await clickCard('Кристалл')
  assert.equal(stub.calls.length, before, 'закрытый предмет всё-таки ушёл на сервер')
  assert.match(errorText(), /коллекционное/i)
  assert.equal(previewPalette(), 'steel')
})

test('T-PICK-06 отказ сервера откатывает выбор и говорит об ошибке', async () => {
  await mount({ failNext: 'locked' })
  await clickCard('Лавр')
  assert.equal(previewPalette(), 'steel', 'после отказа сервера превью осталось золотым')
  assert.deepEqual(equippedTitles(), ['Классика'])
  assert.match(errorText(), /не подтвердил условие/i)
})

test('T-PICK-07 медленная загрузка не сбрасывает только что сделанный выбор', async () => {
  // Сервер отвечает на загрузку через 300 мс, а игрок успевает кликнуть раньше.
  await mount({ latency: 300, equipLatency: 10 })
  const card = cards().find((c) => titleOf(c) === 'Пламя')
  assert.ok(card)
  card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await settle(20)
  assert.equal(previewPalette(), 'emerald', 'выбор не применился сразу')
  // Ждём, пока придёт «старый» ответ загрузки, — он не должен откатить выбор.
  await settle(400)
  assert.equal(previewPalette(), 'emerald', 'поздний ответ сервера сбросил выбор')
})

test('T-PICK-08 выбор запомнен в базе тем же предметом', async () => {
  assert.equal(stub.loadout.frame_id, 'frame-emerald')
})

// -------------------------------------------- своя шапка: картинка и анимация

const uploads = globalThis.__stubUploads

// Файл в jsdom: настоящее поле файла только для чтения, поэтому подменяем
// свойство у input и отправляем change — так React получает файл, как в браузере.
async function pickFile(file) {
  const input = document.querySelector('.cosmetics__code input[type="file"]')
  assert.ok(input, 'нет поля выбора файла')
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  await settle(150)
}

const makeFile = (name, type, bytes = 1024) => new dom.window.File([new Uint8Array(bytes)], name, { type })

test('T-PICK-09 без права «Своя картинка» только объясняет, файл не грузится', async () => {
  await mount()
  await clickChip('Шапка профиля')
  await clickCard('Своя картинка')
  assert.match(errorText(), /покупа|платн|код активации/i)
  assert.equal(uploads.length, 0, 'файл ушёл на сервер без права')
})

test('T-PICK-10 с правом: выбираем JPG — шапка появляется сразу', async () => {
  await mount({ entitlements: ['banner-photo', 'banner-motion'] })
  await clickChip('Шапка профиля')
  await clickCard('Своя картинка')
  await pickFile(makeFile('banner.jpg', 'image/jpeg'))
  assert.equal(uploads.length, 1, 'файл не загрузился')
  assert.equal(uploads[0].type, 'image/jpeg')
  const img = document.querySelector('.cosmetics__preview .pbanner img')
  assert.ok(img, 'в превью нет картинки шапки')
  assert.match(img.getAttribute('src'), /storage\/v1\/object\/public\/banners\/u1\//)
  assert.deepEqual(stub.calls, ['banner-photo'])
})

test('T-PICK-11 GIF для «Анимации» принимается, JPG — нет', async () => {
  await mount({ entitlements: ['banner-photo', 'banner-motion'] })
  await clickChip('Шапка профиля')
  // Сначала пытаемся анимацию обычной картинкой — сервер откажет по формату.
  await clickCard('Анимация')
  await pickFile(makeFile('still.jpg', 'image/jpeg'))
  assert.match(errorText(), /gif|webp/i)
  // Потом настоящий GIF — принимается.
  await clickCard('Анимация')
  await pickFile(makeFile('loop.gif', 'image/gif'))
  const img = document.querySelector('.cosmetics__preview .pbanner img')
  assert.ok(img, 'анимация не попала в превью')
  assert.match(img.getAttribute('src'), /\.gif$/)
})

test('T-PICK-12 файл больше 4 МБ и чужой формат не загружаются', async () => {
  await mount({ entitlements: ['banner-photo'] })
  await clickChip('Шапка профиля')
  await clickCard('Своя картинка')
  await pickFile(makeFile('huge.jpg', 'image/jpeg', 5 * 1024 * 1024))
  assert.match(errorText(), /4 МБ/)
  assert.equal(uploads.length, 0, 'слишком большой файл всё-таки загрузился')
  await pickFile(makeFile('video.mp4', 'video/mp4'))
  assert.match(errorText(), /JPG|PNG|WebP|GIF/i)
  assert.equal(uploads.length, 0)
})

test('T-PICK-13 свою шапку можно убрать и вернуться к градиенту', async () => {
  await mount({ entitlements: ['banner-photo'] })
  await clickChip('Шапка профиля')
  await clickCard('Своя картинка')
  await pickFile(makeFile('banner.png', 'image/png'))
  assert.ok(document.querySelector('.cosmetics__preview .pbanner img'))
  const remove = Array.from(document.querySelectorAll('.cosmetics__uploads button'))
    .find((b) => /Убрать свою шапку/.test(b.textContent || ''))
  assert.ok(remove, 'нет кнопки «Убрать свою шапку»')
  remove.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await settle(120)
  assert.equal(document.querySelector('.cosmetics__preview .pbanner img'), null, 'картинка осталась')
})

rmSync(bundle, { force: true })

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

console.log(`\nappearance-pick: ${passed}/${passed + failed}`)
process.exitCode = failed ? 1 : 0
