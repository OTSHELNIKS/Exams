// Mount App itself: saved look, confirmed changes, navigation and realtime.
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url)), app = join(here, '../app'), nm = join(app, 'node_modules')
const { JSDOM } = await import(join(nm, 'jsdom/lib/api.js'))
const esbuild = (await import(join(nm, 'esbuild/lib/main.js'))).default
const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', { url: 'https://otshelniks.github.io/Exams/', pretendToBeVisual: true })
const style = dom.window.document.createElement('style'); style.textContent = readFileSync(join(app, 'src/styles.css'), 'utf8'); dom.window.document.head.appendChild(style)
globalThis.window = dom.window; globalThis.document = dom.window.document
globalThis.localStorage = dom.window.localStorage; globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event; globalThis.MouseEvent = dom.window.MouseEvent
globalThis.IS_REACT_ACT_ENVIRONMENT = false
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
const bundle = join(app, '.cosmetics-sync-under-test.mjs')
await esbuild.build({
  entryPoints: [join(app, 'src/App.jsx')], bundle: true, format: 'esm', outfile: bundle, jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'lucide-react'],
  define: { 'import.meta.env': '{}' }, logLevel: 'silent',
  plugins: [{ name: 'supabase-stub', setup(build) {
    build.onResolve({ filter: /supabase\.js$/ }, args => args.path.endsWith('supabase.js') ? { path: join(here, 'fixtures/app-cosmetics-stub.mjs') } : undefined)
  } }],
})
const React = (await import(join(nm, 'react/index.js'))).default
const { createRoot } = await import(join(nm, 'react-dom/client.js'))
const { default: App } = await import(bundle)
// Fixture is bundled, so expose controls through globals shared with the bundle.
const state = globalThis.__stubState
state.loadout = { user_id: 'u1', frame_id: 'frame-gold', banner_id: 'banner-none', banner_url: '', plate_id: 'plate-none', title_id: 'title-none', color_id: 'color-default' }
state.entitlements = ['frame-crown', 'plate-gold', 'banner-photo']
state.leaderboardRows = [{ user_id: 'u1', nick: 'QA', pts: 2000, position: 1, title: 'ТОП-1', avatar_url: '' }]
state.appLoadDelay = 0; state.appReadError = false; state.loadLatency = 0; state.equipLatency = 0; state.calls = []
const root = createRoot(document.getElementById('root'))
root.render(React.createElement(App))
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(fn, text, timeout = 3000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (fn()) return; await sleep(20) }
  throw new Error(text)
}
const click = el => { assert.ok(el, 'кнопка не найдена'); el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) }
const nav = label => [...document.querySelectorAll('.bottom-nav button')].find(b => b.textContent.trim() === label)
const card = label => [...document.querySelectorAll('.cosmetic-card')].find(el => el.querySelector('strong')?.textContent === label)
const chip = label => [...document.querySelectorAll('.cosmetics__tabs button')].find(el => el.textContent.trim() === label)
let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); passed++; console.log('PASS', name) } catch(e) { failed++; console.log('FAIL', name, '—', e.message) } }

await test('T-SYNC-01 сохранённое оформление читается и видно на главной', async () => {
  await until(() => document.querySelector('.profile-card .pframe--legend'), 'сохранённая рамка не загружена')
})
await test('T-SYNC-02 подтверждённый выбор виден сразу в профиле и на главной при медленном чтении', async () => {
  click(nav('Профиль'))
  await until(() => [...document.querySelectorAll('button')].some(b => /Оформление профиля/.test(b.textContent)), 'нет перехода к оформлению')
  click([...document.querySelectorAll('button')].find(b => /Оформление профиля/.test(b.textContent)))
  await until(() => card('Без рамки'), 'каталог не открылся')
  state.appLoadDelay = 700; state.appReadError = true
  click(card('Без рамки'))
  await until(() => state.loadout.frame_id === 'frame-none', 'сервер не сохранил выбор')
  await until(() => document.querySelector('.toast')?.textContent === 'Готово', 'подтверждение не пришло')
  click(nav('Профиль'))
  await until(() => document.querySelector('.profile-card'), 'нет профиля')
  assert.equal(document.querySelector('.profile-card .pframe'), null, 'в профиле осталась старая рамка')
  click(nav('Главная'))
  await until(() => document.querySelector('.profile-card'), 'нет главной')
  assert.equal(document.querySelector('.profile-card .pframe'), null, 'на главной осталась старая рамка')
  await sleep(850)
  assert.equal(document.querySelector('.profile-card .pframe'), null, 'поздний запрос вернул старую рамку')
  state.appLoadDelay = 0; state.appReadError = false
})
await test('T-SYNC-03 отказ сервера не меняет общий вид', async () => {
  click(nav('Профиль'))
  await until(() => [...document.querySelectorAll('button')].some(b => /Оформление профиля/.test(b.textContent)), 'профиль не открылся')
  click([...document.querySelectorAll('button')].find(b => /Оформление профиля/.test(b.textContent)))
  await until(() => card('MLBB 1-11'), 'нет каталога')
  await until(() => card('MLBB 1-11').textContent.includes('Открыто'), 'права не загрузились')
  state.failNext = 'locked'
  click(card('MLBB 1-11'))
  await until(() => document.querySelector('.lobby__error'), 'нет ошибки')
  click(nav('Профиль'))
  await until(() => document.querySelector('.profile-card'), 'нет профиля')
  assert.equal(document.querySelector('.profile-card .pframe'), null, 'отказанный выбор попал в профиль')
})
await test('T-SYNC-04 коллекционная рамка сохраняется и видна в рейтинге', async () => {
  click([...document.querySelectorAll('button')].find(b => /Оформление профиля/.test(b.textContent)))
  await until(() => card('MLBB 1-11')?.textContent.includes('Открыто'), 'права не загрузились')
  click(card('MLBB 1-11'))
  await until(() => state.loadout.frame_id === 'frame-crown', 'рамка не сохранена')
  await until(() => document.querySelector('.toast')?.textContent === 'Готово', 'нет подтверждения')
  click(nav('Профиль'))
  await until(() => document.querySelector('.profile-card .pframe--crown'), 'профиль не обновился')
  click(nav('Рейтинг'))
  await until(() => document.querySelector('.rank-row .pframe--crown'), 'рейтинг не обновился')
})

await test('T-SYNC-05 баннер, плашка, титул и цвет видны в профиле, рейтинге и карточке', async () => {
  click(nav('Профиль'))
  await until(() => [...document.querySelectorAll('button')].some(b => /Оформление профиля/.test(b.textContent)), 'нет профиля')
  click([...document.querySelectorAll('button')].find(b => /Оформление профиля/.test(b.textContent)))
  await until(() => chip('Шапка профиля'), 'нет вкладок')
  click(chip('Шапка профиля')); await until(() => card('Закат'), 'нет шапки')
  click(card('Закат')); await until(() => state.loadout.banner_id === 'banner-ember', 'шапка не сохранена')
  await until(() => !card('Закат').disabled, 'шапка не подтверждена')
  click(chip('Рамка имени')); await until(() => card('Золото')?.textContent.includes('Открыто'), 'нет права на плашку')
  click(card('Золото')); await until(() => state.loadout.plate_id === 'plate-gold', 'плашка не сохранена')
  await until(() => !card('Золото').disabled, 'плашка не подтверждена')
  click(chip('Титул')); await until(() => card('Ветеран'), 'нет титула')
  click(card('Ветеран')); await until(() => state.loadout.title_id === 'title-veteran', 'титул не сохранён')
  await until(() => !card('Ветеран').disabled, 'титул не подтверждён')
  click(chip('Цвет ника')); await until(() => card('Фирменный'), 'нет цвета')
  click(card('Фирменный')); await until(() => state.loadout.color_id === 'color-orange', 'цвет не сохранён')
  await until(() => !card('Фирменный').disabled, 'цвет не подтверждён')
  click(nav('Главная')); await until(() => document.querySelector('.profile-card .pbanner-ember'), 'главная: шапка')
  assert.ok(document.querySelector('.profile-card .pframe--crown'))
  assert.ok(document.querySelector('.profile-card .nick--plate.plate-gold'))
  assert.match(document.querySelector('.profile-card').textContent, /ВЕТЕРАН/)
  assert.equal(document.querySelector('.profile-card .nick').style.getPropertyValue('--nick-color'), '#ff6a1b')
  click(nav('Рейтинг')); await until(() => document.querySelector('.rank-row .nick--plate.plate-gold'), 'рейтинг: плашка')
  assert.ok(document.querySelector('.rank-row .pframe--crown'))
  assert.match(document.querySelector('.rank-row').textContent, /ВЕТЕРАН/)
  state.publicProfile = { user_id: 'u1', nick: 'QA', roles: [], regions: [], heroes: [], socials: [], pts: 2000 }
  click(document.querySelector('.rank-row'))
  await until(() => document.querySelector('.modal--player .pbanner-ember'), 'публичная карточка: шапка')
  assert.ok(document.querySelector('.modal--player .pframe--crown'))
  assert.ok(document.querySelector('.modal--player .nick--plate.plate-gold'))
  assert.match(document.querySelector('.modal--player').textContent, /ВЕТЕРАН/)
})
await test('T-SYNC-06 открытая карточка, рейтинг и свой профиль обновляются при изменении на другом устройстве', async () => {
  state.appLoadDelay = 500
  state.loadout.frame_id = 'frame-gold'
  globalThis.__emitCosmetic('u1')
  await sleep(40)
  state.appLoadDelay = 0
  state.loadout.frame_id = 'frame-emerald'
  globalThis.__emitCosmetic('u1')
  await until(() => document.querySelector('.rank-row .pframe--mythic'), 'рейтинг не обновился')
  await until(() => document.querySelector('.modal--player .pframe--mythic'), 'карточка не обновилась')
  await sleep(650)
  assert.ok(document.querySelector('.rank-row .pframe--mythic'), 'поздний ответ откатил рейтинг')
  assert.ok(document.querySelector('.modal--player .pframe--mythic'), 'поздний ответ откатил карточку')
  click([...document.querySelectorAll('.modal--player button')].find(b => b.textContent.trim() === 'Закрыть'))
  click(nav('Профиль'))
  await until(() => document.querySelector('.profile-card .pframe--mythic'), 'свой профиль не обновился')
})
await test('T-SYNC-07 своя картинка шапки сразу появляется и при удалении исчезает', async () => {
  await until(() => [...document.querySelectorAll('button')].some(b => /Оформление профиля/.test(b.textContent)), 'нет профиля')
  click([...document.querySelectorAll('button')].find(b => /Оформление профиля/.test(b.textContent)))
  await until(() => chip('Шапка профиля'), 'нет вкладок')
  click(chip('Шапка профиля')); await until(() => card('Своя картинка')?.textContent.includes('Открыто'), 'нет права на картинку')
  click(card('Своя картинка'))
  const input = document.querySelector('input[aria-label="Файл шапки профиля"]')
  const file = new dom.window.File(['fake'], 'banner.jpg', { type: 'image/jpeg' })
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  await until(() => state.loadout.banner_id === 'banner-photo', 'баннер не сохранён')
  await until(() => document.querySelector('.cosmetics__preview .pbanner img'), 'баннер не показан')
  click(nav('Профиль')); await until(() => document.querySelector('.profile-card .pbanner img'), 'баннер не появился в профиле')
  click(nav('Главная')); await until(() => document.querySelector('.profile-card .pbanner img'), 'баннер не появился на главной')
  click(nav('Профиль')); await until(() => [...document.querySelectorAll('button')].some(b => /Оформление профиля/.test(b.textContent)), 'нет профиля')
  click([...document.querySelectorAll('button')].find(b => /Оформление профиля/.test(b.textContent)))
  await until(() => chip('Шапка профиля'), 'нет вкладок'); click(chip('Шапка профиля'))
  await until(() => [...document.querySelectorAll('button')].some(b => /Убрать свою шапку/.test(b.textContent)), 'нет кнопки удаления')
  click([...document.querySelectorAll('button')].find(b => /Убрать свою шапку/.test(b.textContent)))
  await until(() => state.loadout.banner_url === '', 'баннер не удалён')
  click(nav('Профиль')); await until(() => document.querySelector('.profile-card'), 'нет профиля')
  assert.equal(document.querySelector('.profile-card .pbanner img'), null, 'удалённая картинка осталась')
})

await test('T-SYNC-08 повторное подключение перечитывает актуальный выбор', async () => {
  state.loadout.frame_id = 'frame-crown'
  globalThis.__cosmeticReconnect()
  await until(() => document.querySelector('.profile-card .pframe--crown'), 'повторное подключение не обновило профиль')
})
await test('T-SYNC-09 старый ответ не попадает в следующую сессию', async () => {
  state.appLoadDelay = 500
  state.loadout.frame_id = 'frame-gold'
  globalThis.__emitCosmetic('u1')
  await sleep(30)
  state.appLoadDelay = 0
  state.loadout.frame_id = 'frame-none'
  globalThis.__changeUser('u2')
  await until(() => document.querySelector('.profile-card') && !document.querySelector('.profile-card .pframe'), 'профиль другого пользователя не загрузился')
  await sleep(650)
  assert.equal(document.querySelector('.profile-card .pframe'), null, 'поздний ответ попал в другую сессию')
})

root.unmount()
await test('T-SYNC-10 подписки закрываются при выходе из приложения', async () => {
  assert.equal(globalThis.__cosmeticChannelCount(), 0)
})
rmSync(bundle, { force: true })
console.log(`\ncosmetics-sync: ${passed}/${passed + failed}`)
if (failed) process.exit(1)
