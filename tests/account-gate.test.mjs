// Интеграционные клики по App с мок-сессиями, без доступа в сеть.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'
const here = dirname(fileURLToPath(import.meta.url)), app = join(here, '../app'), nm = join(app, 'node_modules')
const { JSDOM } = await import(join(nm, 'jsdom/lib/api.js'))
const esbuild = (await import(join(nm, 'esbuild/lib/main.js'))).default
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/', pretendToBeVisual: true })
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Node = dom.window.Node; globalThis.localStorage = dom.window.localStorage; globalThis.IS_REACT_ACT_ENVIRONMENT = false
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
const bundle = join(app, '.account-gate-under-test.mjs')
await esbuild.build({ entryPoints: [join(app, 'src/App.jsx')], bundle: true, format: 'esm', outfile: bundle, jsx: 'automatic', external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'lucide-react'], define: { 'import.meta.env': '{}' }, plugins: [{ name: 'stub-api', setup(build) { build.onResolve({ filter: /supabase\.js$/ }, (args) => args.importer.startsWith(join(app, 'src')) ? { path: join(here, 'fixtures/account-app-supabase.mjs') } : undefined) } }], logLevel: 'silent' })
const React = (await import(join(nm, 'react/index.js'))).default
const { createRoot } = await import(join(nm, 'react-dom/client.js'))
const { default: App } = await import(bundle)
const wait = () => new Promise((r) => setTimeout(r, 100))
const findButton = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text))
let root
after(() => { root?.unmount(); rmSync(bundle, { force: true }); dom.window.close() })

test('гостю и анонимной сессии недоступны профиль и анкета; после входа анкета открывается, при выходе закрывается', async () => {
  localStorage.setItem('name-mlbb-profile:v2', JSON.stringify({ nick: 'Старый гость' }))
  root = createRoot(document.getElementById('root')); root.render(React.createElement(App)); await wait()
  assert.doesNotMatch(document.body.textContent, /Все \d+ экранов приложения/)
  findButton('Открыть приложение').click(); await wait()
  assert.equal(findButton('Анкета'), undefined)
  document.querySelector('.bottom-nav button:nth-last-child(2)').click(); await wait()
  assert.ok(document.querySelector('.screen.auth')); assert.equal(document.querySelector('.screen.wizard'), null)
  globalThis.__accountSession({ id: 'guest', is_anonymous: true }); await wait()
  document.querySelector('.bottom-nav button:nth-last-child(2)').click(); await wait()
  assert.ok(document.querySelector('.screen.auth')); assert.equal(document.querySelector('.screen.wizard'), null)
  globalThis.__accountSession({ id: 'member', is_anonymous: false }); await wait()
  assert.ok(document.querySelector('.screen.wizard')); assert.doesNotMatch(document.body.textContent, /Старый гость/)
  globalThis.__accountSession(null); await wait()
  assert.equal(document.querySelector('.screen.wizard'), null); assert.ok(document.querySelector('.screen.auth'))
})
