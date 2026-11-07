// Проверяет экран лобби реальными событиями в jsdom без подключений к базе.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '../app')
const nm = join(app, 'node_modules')
const { JSDOM } = await import(join(nm, 'jsdom/lib/api.js'))
const esbuild = (await import(join(nm, 'esbuild/lib/main.js'))).default
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://example.test/', pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.localStorage = dom.window.localStorage
globalThis.IS_REACT_ACT_ENVIRONMENT = false

const bundle = join(app, '.lobby-ui-under-test.mjs')
await esbuild.build({
  entryPoints: [join(app, 'src/screens.jsx')], bundle: true, format: 'esm', outfile: bundle,
  jsx: 'automatic', external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'lucide-react'],
  plugins: [{ name: 'stub-supabase', setup(build) {
    build.onResolve({ filter: /supabase\.js$/ }, (args) => args.importer.endsWith('screens.jsx') ? { path: join(here, 'fixtures/lobby-supabase-stub.mjs') } : undefined)
  } }], define: { 'import.meta.env': '{}' }, logLevel: 'silent',
})
const React = (await import(join(nm, 'react/index.js'))).default
const { createRoot } = await import(join(nm, 'react-dom/client.js'))
const { LobbyScreen } = await import(bundle)
const state = globalThis.__lobbyTestState
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
const supabase = {
  channel() { return { on() { return this }, subscribe() { return this } } },
  removeChannel() {},
}
const input = (label) => document.querySelector(`[aria-label="${label}"]`)
const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(label))
function type(el, value) {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
}
function visibleAgain() { document.dispatchEvent(new dom.window.Event('visibilitychange')) }
let root
async function mount() {
  if (root) root.unmount()
  Object.assign(state, {
    lobby: { id: 'l1', code: '123456', region: 'ru', host_id: 'u1', room_id: '123456', room_password: '', status: 'open' },
    members: [{ user_id: 'u1', nick: 'Хост', is_host: true, checked_in: false }],
    nextLoad: null, nextSave: null, failLeave: false,
  })
  root = createRoot(document.getElementById('root'))
  root.render(React.createElement(LobbyScreen, { supabase, userId: 'u1', lobbyCode: '123456', onBack() {}, onLobbyChange() {} }))
  for (let i = 0; i < 20 && !input('Room ID'); i += 1) await settle()
  assert.ok(input('Room ID'), 'лобби открылось')
}
after(() => { root?.unmount(); rmSync(bundle, { force: true }); dom.window.close() })

test('фоновое обновление видит новых игроков, но не стирает ввод хоста', async () => {
  await mount()
  type(input('Room ID'), '987654')
  type(input('Пароль комнаты'), 'mypassword')
  state.members.push({ user_id: 'u2', nick: 'Второй', is_host: false, checked_in: false })
  visibleAgain(); await settle()
  assert.equal(input('Room ID').value, '987654')
  assert.equal(input('Пароль комнаты').value, 'mypassword')
  assert.match(document.body.textContent, /Второй/)
  assert.match(document.body.textContent, /2\/10/)
})

test('после выхода медленный ответ не возвращает закрытое лобби', async () => {
  await mount()
  let resolve
  state.nextLoad = new Promise((r) => { resolve = r })
  visibleAgain(); await settle()
  button('Закрыть').click(); await settle()
  assert.ok(input('Код приглашения'))
  resolve(); await settle()
  assert.ok(input('Код приглашения'))
  assert.equal(input('Room ID'), null)
})

test('если сервер отказал в выходе, лобби остаётся на экране', async () => {
  await mount()
  state.failLeave = true
  button('Закрыть').click(); await settle()
  assert.ok(input('Room ID'))
  assert.match(document.querySelector('[role="alert"]').textContent, /Сервер не ответил/)
})

test('закрытие лобби хостом становится видно при следующем обновлении', async () => {
  await mount()
  state.lobby.status = 'closed'
  visibleAgain(); await settle()
  assert.ok(input('Код приглашения'))
  assert.match(document.querySelector('[role="alert"]').textContent, /Хост закрыл лобби/)
})

test('ввод во время сохранения не теряется при ответе сервера', async () => {
  await mount()
  type(input('Room ID'), '111111')
  let resolve
  state.nextSave = new Promise((r) => { resolve = r })
  button('Показать составу').click(); await settle()
  type(input('Room ID'), '222222')
  resolve(); await settle()
  assert.equal(state.lobby.room_id, '111111')
  assert.equal(input('Room ID').value, '222222')
})
