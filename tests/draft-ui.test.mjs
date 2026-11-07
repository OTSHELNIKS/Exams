// Искусственные данные, сеть и настоящая БД не используются.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'
const here = dirname(fileURLToPath(import.meta.url)), app = join(here, '../app'), nm = join(app, 'node_modules')
const { JSDOM } = await import(join(nm, 'jsdom/lib/api.js'))
const esbuild = (await import(join(nm, 'esbuild/lib/main.js'))).default
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/', pretendToBeVisual: true })
globalThis.window = dom.window; globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Node = dom.window.Node
globalThis.IS_REACT_ACT_ENVIRONMENT = false
const bundle = join(app, '.draft-ui-under-test.mjs')
await esbuild.build({ entryPoints: [join(app, 'src/server-draft.jsx')], bundle: true, format: 'esm', outfile: bundle, jsx: 'automatic', external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'lucide-react'], define: { 'import.meta.env': '{}' }, logLevel: 'silent' })
const React = (await import(join(nm, 'react/index.js'))).default
const { createRoot } = await import(join(nm, 'react-dom/client.js'))
const { ServerDraftScreen } = await import(bundle)
const settle = () => new Promise((r) => setTimeout(r, 35))
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text))
const member = (id, nick, isCaptain = false) => ({ user_id: id, nick, pts: 1000, roles: [], isCaptain })
let current, startError, calls, root
const client = {
  from() { return { select() { return this }, eq() { return this }, async maybeSingle() { return { data: { id: 'l1', host_id: 'a', status: 'open' } } } } },
  async rpc(name, args) { calls.push({ name, args }); if (name === 'start_lobby_draft' && startError) return { data: { error: startError } }; return { data: current } },
}
async function mount(userId) {
  root?.unmount(); calls = []; startError = null
  root = createRoot(document.getElementById('root'))
  root.render(React.createElement(ServerDraftScreen, { supabase: client, userId, lobbyCode: '123456', onBack() {}, onReady() {} }))
  await settle()
}
function refresh() { document.dispatchEvent(new dom.window.Event('visibilitychange')) }
after(() => { root?.unmount(); rmSync(bundle, { force: true }); dom.window.close() })
const active = () => ({ status: 'active', lobby_id: 'l1', captain_a: 'a', captain_b: 'b', turn: 'a', deadline: new Date(Date.now()+30000).toISOString(), server_time: new Date().toISOString(), team_a: [member('a', 'Хост', true)], team_b: [member('b', 'Капитан B', true)], pool: [member('c', 'Игрок C')] })

test('только хост видит запуск и ошибку о десяти участниках', async () => {
  current = { error: 'not_started' }; await mount('b')
  assert.equal(button('НАЧАТЬ ДРАФТ'), undefined)
  await mount('a'); startError = 'need_ten'; button('НАЧАТЬ ДРАФТ').click(); await settle()
  assert.match(document.body.textContent, /нужно 10 участников/)
})
test('выбор доступен только активному капитану и адресует серверный RPC', async () => {
  current = active(); await mount('b')
  assert.ok(button('ВЫБРАТЬ').disabled)
  await mount('a'); assert.equal(button('ВЫБРАТЬ').disabled, false)
  button('ВЫБРАТЬ').click(); await settle()
  assert.deepEqual(calls.find((x) => x.name === 'pick_lobby_draft_player').args, { p_lobby_id: 'l1', p_user_id: 'c' })
})
test('после возвращения виден новый состав, отмена убирает старый', async () => {
  current = active(); await mount('a')
  current = { ...active(), team_a: [member('a', 'Хост', true), member('c', 'Игрок C')], pool: [] }
  refresh(); await settle(); assert.ok(button('Игрок C'))
  current = { ...current, status: 'cancelled' }; refresh(); await settle()
  assert.match(document.body.textContent, /Драфт отменён/)
  assert.equal(button('Игрок C'), undefined)
})
