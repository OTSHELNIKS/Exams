// Проверки формы на искусственных данных и моках; реальная капча и Auth API не вызываются.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'
const here = dirname(fileURLToPath(import.meta.url)), app = join(here, '../app'), nm = join(app, 'node_modules')
const { JSDOM } = await import(join(nm, 'jsdom/lib/api.js'))
const esbuild = (await import(join(nm, 'esbuild/lib/main.js'))).default
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/Exams/', pretendToBeVisual: true })
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Node = dom.window.Node; globalThis.IS_REACT_ACT_ENVIRONMENT = false
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
const bundle = join(app, '.registration-ui-under-test.mjs')
await esbuild.build({ entryPoints: [join(app, 'src/screens.jsx')], bundle: true, format: 'esm', outfile: bundle, jsx: 'automatic', external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'lucide-react'], define: { 'import.meta.env': '{}' }, plugins: [{ name: 'stub-captcha', setup(build) { build.onResolve({ filter: /^@hcaptcha\/react-hcaptcha$/ }, () => ({ path: join(here, 'fixtures/hcaptcha-stub.jsx') })) } }], logLevel: 'silent' })
const React = (await import(join(nm, 'react/index.js'))).default
const { createRoot } = await import(join(nm, 'react-dom/client.js'))
const { AuthScreen } = await import(bundle)
const wait = () => new Promise((r) => setTimeout(r, 45))
let root, calls
const client = { auth: { async signUp(value) { calls.push(['signup', value]); return { data: { session: null }, error: null } }, async signInWithPassword(value) { calls.push(['signin', value]); return { data: {}, error: null } } } }
const btn = (text) => [...document.querySelectorAll('button')].find((el) => el.textContent.includes(text))
function fill(input, value) { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) }
function submit() { document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) }
async function mount(siteKey = 'fake-key') { root?.unmount(); calls = []; globalThis.__captchaResets = 0; root = createRoot(document.getElementById('root')); root.render(React.createElement(AuthScreen, { supabase: client, session: null, gameId: '', gameServer: '', setGameId() {}, setGameServer() {}, captchaSiteKey: siteKey })); await wait() }
async function registerForm() { btn('Зарегистрироваться').click(); await wait() }
function values(confirm = 'password123') { const fields = document.querySelectorAll('form input'); fill(fields[0], 'person@example.test'); fill(fields[1], 'password123'); fill(fields[2], confirm) }
after(() => { root?.unmount(); rmSync(bundle, { force: true }); dom.window.close() })

test('отдельная форма регистрации содержит почту, два пароля, капчу и возврат', async () => { await mount(); assert.doesNotMatch(document.body.textContent, /Посмотреть все экраны/); await registerForm(); assert.equal(document.querySelectorAll('form input').length, 3); assert.ok(btn('Пройти тест капчи')); assert.ok(btn('Вернуться ко входу')); btn('Вернуться ко входу').click(); await wait(); assert.ok(btn('Войти по почте')) })
test('без настроенного ключа регистрация закрыта', async () => { await mount(''); await registerForm(); assert.match(document.body.textContent, /защита от ботов ещё не настроена/); assert.ok(btn('Создать аккаунт').disabled); submit(); await wait(); assert.equal(calls.length, 0) })
test('ошибка несовпадения и отсутствие или истечение капчи блокируют отправку', async () => { await mount(); await registerForm(); values('otherpass'); await wait(); btn('Пройти тест капчи').click(); await wait(); submit(); await wait(); assert.match(document.body.textContent, /Пароли не совпадают/); assert.equal(calls.length, 0); fill(document.querySelectorAll('form input')[2], 'password123'); btn('Истечь капче').click(); await wait(); submit(); await wait(); assert.match(document.body.textContent, /Пройдите проверку капчи/); assert.equal(calls.length, 0) })
test('регистрация передаёт токен в Supabase и сбрасывает его после отправки', async () => { await mount(); await registerForm(); values(); await wait(); btn('Пройти тест капчи').click(); await wait(); submit(); await wait(); assert.equal(calls.length, 1); assert.equal(calls[0][1].options.captchaToken, 'test-captcha-token'); assert.equal(calls[0][1].email, 'person@example.test'); assert.equal(calls[0][1].options.emailRedirectTo, 'https://example.test/Exams/'); assert.equal(globalThis.__captchaResets, 1); assert.match(document.body.textContent, /Проверьте почту/); submit(); await wait(); assert.equal(calls.length, 1) })
test('при включённой капче вход тоже передаёт токен', async () => { await mount(); const inputs = document.querySelectorAll('form input'); fill(inputs[0], 'person@example.test'); fill(inputs[1], 'password123'); await wait(); submit(); await wait(); assert.equal(calls.length, 0); btn('Пройти тест капчи').click(); await wait(); submit(); await wait(); assert.equal(calls[0][0], 'signin'); assert.equal(calls[0][1].options.captchaToken, 'test-captcha-token'); assert.equal(globalThis.__captchaResets, 1) })
