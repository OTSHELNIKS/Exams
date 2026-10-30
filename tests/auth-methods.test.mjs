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

const METHODS = ['google', 'telegram', 'vk', 'mlbb', 'tiktok']

test('T-AUTH-01 все пять способов есть на экране входа', () => {
  assert.ok(auth.includes('className="methods"'), 'нет блока способов')
  for (const id of METHODS) {
    assert.ok(auth.includes(`<BrandMark type="${id}" />`), 'нет плитки ' + id)
  }
  assert.ok(auth.includes('СПОСОБЫ РЕГИСТРАЦИИ'), 'нет подписи блока')
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

test('T-AUTH-04 VK, MLBB и TikTok не выдают себя за рабочие', () => {
  const soon = (auth.match(/method--soon/g) || []).length
  assert.ok(soon >= 3, 'ожидались три плитки со статусом «скоро», найдено ' + soon)
  for (const label of ['VK', 'MLBB', 'TikTok']) {
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
  for (const type of METHODS) {
    assert.ok(new RegExp(`type === '${type}'`).test(ui), 'BrandMark не знает ' + type)
  }
})

test('T-AUTH-07 сетка плиток адаптивная', () => {
  assert.ok(/\.methods \{[^}]*grid-template-columns: repeat\(3/.test(styles), 'на телефоне три плитки в ряд')
  assert.ok(/\.methods \{ grid-template-columns: repeat\(5/.test(styles), 'на десктопе пять плиток в ряд')
  assert.ok(styles.includes('.method__soon'), 'нет бейджа «скоро»')
})

test('T-AUTH-08 почта осталась основным способом', () => {
  assert.ok(auth.includes('ИЛИ ПО ПОЧТЕ'), 'форма по почте потерялась')
  assert.ok(auth.includes('signInWithPassword'), 'нет входа по паролю')
  assert.ok(auth.includes('signUp'), 'нет регистрации по почте')
})

console.log(`\nauth-methods: ${passed}/${passed + failed}`)
if (failed) process.exit(1)
