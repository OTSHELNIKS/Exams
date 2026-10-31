// NAME MLBB — способы регистрации (статическая проверка, без сети).
// Пять плиток на экране входа: Google, Telegram, VK, MLBB, TikTok.
// Тест следит, чтобы набор не разъехался и чтобы «нерабочие» способы не
// выглядели как рабочие: Google — настоящий OAuth, Telegram — бот,
// VK/TikTok/MLBB честно помечены «скоро».
// Run: node tests/auth-methods.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const screens = read('app/src/screens.jsx')
const ui = read('app/src/ui.jsx')
const styles = read('app/src/styles.css')
const auth = screens.slice(screens.indexOf('export function AuthScreen'), screens.indexOf('export function WizardScreen'))

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log('PASS ' + name)
  } catch (error) {
    failed += 1
    console.log('FAIL ' + name + ' — ' + error.message)
  }
}

// VK временно скрыт: приложение VK ID ждёт подтверждения профиля.
// Код привязки (vk-auth.js) остался, включается флагом enabled в data.js.
const METHODS = ['google', 'telegram', 'mlbb', 'tiktok']
const HIDDEN = ['vk']

test('T-AUTH-01 все доступные способы есть на экране входа', () => {
  assert.ok(auth.includes('className="methods"'), 'нет блока способов')
  for (const id of METHODS) {
    assert.ok(auth.includes(`<BrandMark type="${id}" />`), 'нет плитки ' + id)
  }
  assert.ok(auth.includes('СПОСОБЫ РЕГИСТРАЦИИ'), 'нет подписи блока')
})

test('T-AUTH-01b скрытый VK не показывается и не обещает вход', () => {
  for (const id of HIDDEN) {
    assert.ok(!auth.includes(`<BrandMark type="${id}" />`), 'плитка ' + id + ' всё ещё на экране входа')
  }
  const data = read('app/src/data.js')
  assert.ok(/id: 'vk'[^}]*enabled: false/.test(data), 'VK должен быть выключен флагом enabled: false')
  assert.ok(read('app/src/vk-auth.js').includes('DEFAULT_VK_CLIENT_ID'), 'код VK удалять нельзя — только скрыть')
})

test('T-AUTH-02 Google — настоящий OAuth через Supabase', () => {
  assert.ok(auth.includes("signInWithOAuth"), 'нет вызова OAuth')
  assert.ok(/oauth\('google',\s*'Google'\)/.test(auth), 'кнопка Google не запускает OAuth')
  assert.ok(auth.includes('redirectTo'), 'не задан адрес возврата')
})

test('T-AUTH-03 Telegram ведёт в бота без payload', () => {
  assert.ok(/https:\/\/t\.me\/\$\{TELEGRAM_BOT_USERNAME\}/.test(auth), 'нет ссылки на бота')
  assert.ok(!auth.includes('?start=login'), 'payload start=login бот поймёт как код привязки')
  assert.ok(auth.includes('target="_blank"'), 'ссылка на бота должна открываться в новой вкладке')
})

test('T-AUTH-04 MLBB и TikTok не выдают себя за рабочие', () => {
  const soon = (auth.match(/method--soon/g) || []).length
  assert.ok(soon >= 2, 'ожидались две плитки со статусом «скоро», найдено ' + soon)
  for (const label of ['MLBB', 'TikTok']) {
    assert.ok(auth.includes(`<span>${label}</span>`), 'нет подписи ' + label)
  }
  // у «скоро»-плиток нет обработчика OAuth
  for (const provider of ['vk', 'tiktok']) {
    assert.ok(!auth.includes(`oauth('${provider}'`), provider + ' не должен вызывать OAuth')
  }
})

test('T-AUTH-05 у каждого способа есть понятное объяснение при нажатии', () => {
  assert.ok(auth.includes('setMethodNote('), 'нет пояснений для неготовых способов')
  assert.ok(auth.includes('role="status"'), 'пояснение должно озвучиваться скринридером')
  assert.ok(auth.includes('auth-methods__note'), 'нет видимой строки-подсказки')
})

test('T-AUTH-06 иконки брендов отрисованы в BrandMark', () => {
  // Настоящие логотипы живут в brand-icons.jsx: BrandMark берёт их по типу.
  const icons = read('app/src/brand-icons.jsx')
  const ICONS = { google: 'GoogleIcon', telegram: 'TelegramIcon', tiktok: 'TikTokIcon', facebook: 'FacebookIcon' }
  for (const [type, component] of Object.entries(ICONS)) {
    assert.ok(new RegExp(`\\b${component}\\b`).test(ui), 'BrandMark не использует ' + component)
    assert.ok(new RegExp(`export function ${component}`).test(icons), 'нет компонента ' + component)
    assert.ok(new RegExp(`${type}: <${component} />`).test(ui), 'BrandMark не знает ' + type)
  }
  // MLBB остаётся геймпадом: официального логотипа в проекте нет.
  assert.ok(/type === 'mlbb'/.test(ui), 'BrandMark не знает mlbb')
  assert.ok(/export function VkIcon/.test(icons), 'нет VkIcon')
})

test('T-AUTH-07 сетка плиток адаптивная', () => {
  // Четыре способа: 2×2 на телефоне (ни одна плитка не остаётся одна в ряду)
  // и четыре в ряд на ПК.
  assert.ok(/\.methods \{[^}]*grid-template-columns: repeat\(2/.test(styles), 'на телефоне две плитки в ряд')
  assert.ok(/\.methods \{ grid-template-columns: repeat\(4/.test(styles), 'на десктопе четыре плитки в ряд')
  assert.ok(styles.includes('.method__soon'), 'нет бейджа «скоро»')
  assert.ok(styles.includes('.method--game'), 'нет выделения плитки игры')
  assert.ok(auth.includes('auth__game-btn'), 'нет крупной кнопки «Войти через игру»')
})

test('T-AUTH-08 почта осталась основным способом', () => {
  assert.ok(auth.includes('ИЛИ ПО ПОЧТЕ'), 'форма по почте потерялась')
  assert.ok(auth.includes('signInWithPassword'), 'нет входа по паролю')
  assert.ok(auth.includes('signUp'), 'нет регистрации по почте')
})

console.log(`\nauth-methods: ${passed}/${passed + failed}`)
if (failed) process.exit(1)
