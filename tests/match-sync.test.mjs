import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'
const here = dirname(fileURLToPath(import.meta.url)), app = join(here, '../app'), nm = join(app, 'node_modules')
const { JSDOM } = await import(join(nm, 'jsdom/lib/api.js'))
const esbuild = (await import(join(nm, 'esbuild/lib/main.js'))).default
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/', pretendToBeVisual: true })
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Node = dom.window.Node; globalThis.IS_REACT_ACT_ENVIRONMENT = false
const bundle = join(app, '.match-sync-under-test.mjs')
await esbuild.build({ entryPoints: [join(app, 'src/server-match.jsx')], bundle: true, format: 'esm', outfile: bundle, jsx: 'automatic', external: ['react', 'react/jsx-runtime'], plugins: [{ name: 'stub-screen', setup(build) { build.onResolve({ filter: /screens\.jsx$/ }, () => ({ path: join(here, 'fixtures/match-screen-stub.jsx') })) } }], logLevel: 'silent' })
const React = (await import(join(nm, 'react/index.js'))).default
const { createRoot } = await import(join(nm, 'react-dom/client.js'))
const { ServerMatchScreen } = await import(bundle)
const wait = () => new Promise((r) => setTimeout(r, 35))
const m = (user_id, nick, isCaptain = false) => ({ user_id, nick, isCaptain })
const initial = () => ({ status: 'complete', lobby_id: 'l1', team_a: [m('a', 'Хост', true)], team_b: [m('b', 'Капитан B', true), m('c', 'Игрок C')] })
let state, response, calls, root
const client = { from() { return { select() { return this }, eq() { return this }, async maybeSingle() { return { data: { id: 'l1', host_id: 'a' } } } } }, async rpc(name, args) { calls.push({ name, args }); return { data: name === 'transfer_draft_captain' ? response : state } } }
async function mount() { root?.unmount(); calls = []; state = initial(); response = null; globalThis.__transferResult = null; root = createRoot(document.getElementById('root')); root.render(React.createElement(ServerMatchScreen, { supabase: client, userId: 'b', lobbyCode: '123456', onBack() {} })); for (let i = 0; i < 50 && !document.body.textContent.includes('Капитан B капитан'); i++) await wait() }
function refresh() { document.dispatchEvent(new dom.window.Event('visibilitychange')) }
after(() => { root?.unmount(); rmSync(bundle, { force: true }); dom.window.close() })
test('повторный вход загружает составы с сервера, не локальную копию', async () => { await mount(); assert.match(document.body.textContent, /Капитан B капитан/); assert.equal(calls[0].name, 'get_lobby_draft') })
test('отказ сервера не переносит капитанство, успешная передача меняет только команду B', async () => {
  await mount(); response = { error: 'not_teammate' }; document.querySelector('button').click(); await wait()
  assert.ok(globalThis.__transferResult.error); assert.match(document.body.textContent, /Капитан B капитан/)
  state = { ...initial(), team_b: [m('b', 'Капитан B'), m('c', 'Игрок C', true)] }; response = state
  document.querySelector('button').click(); await wait(); assert.ok(globalThis.__transferResult.ok)
  assert.match(document.body.textContent, /Хост капитан/); assert.match(document.body.textContent, /Игрок C капитан/)
  assert.equal(calls.filter((c) => c.name === 'transfer_draft_captain').length, 2)
})
test('отмена драфта очищает экран матча после обновления', async () => { await mount(); state = { ...initial(), status: 'cancelled' }; refresh(); await wait(); assert.match(document.body.textContent, /драфт отменён/); assert.doesNotMatch(document.body.textContent, /Капитан B/) })
