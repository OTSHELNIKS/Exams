// NAME MLBB — возврат с внешнего входа (Google и другие OAuth).
// После редиректа Supabase отдаёт в hash либо сессию, либо ошибку. Тест
// проверяет разбор адреса и человеческие тексты, чтобы игрок не видел
// «error_description=invalid_request» и пустой экран.
// Run: node tests/auth-return.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const { parseAuthReturn, cleanAuthUrl, describeAuthError } = await import('../app/src/auth-return.js')

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

test('T-RET-01 успешный возврат не считается ошибкой', () => {
  const ok = parseAuthReturn('https://otshelniks.github.io/Exams/#access_token=abc&refresh_token=def&expires_in=3600')
  assert.equal(ok.error, '')
  assert.equal(describeAuthError(ok), '')
  assert.equal(cleanAuthUrl('https://otshelniks.github.io/Exams/#access_token=abc&refresh_token=def'), null)
})

test('T-RET-02 ошибка из hash разбирается целиком', () => {
  const err = parseAuthReturn('https://otshelniks.github.io/Exams/#error=server_error&error_code=unexpected_failure&error_description=Provider+is+not+enabled')
  assert.equal(err.error, 'server_error')
  assert.equal(err.code, 'unexpected_failure')
  assert.equal(err.description, 'Provider is not enabled')
})

test('T-RET-03 ошибка из query тоже ловится', () => {
  const err = parseAuthReturn('https://otshelniks.github.io/Exams/?error=access_denied&error_description=User+denied')
  assert.equal(err.error, 'access_denied')
  assert.match(describeAuthError(err), /отмен/i)
})

test('T-RET-04 адрес очищается только при ошибке', () => {
  const cleaned = cleanAuthUrl('https://otshelniks.github.io/Exams/#error=access_denied&error_description=Nope&access_token=x')
  assert.ok(cleaned, 'адрес не очищен')
  assert.ok(!cleaned.includes('error='), 'ошибка осталась в адресе')
  assert.ok(cleaned.includes('access_token=x'), 'токены должны остаться для supabase-js')
})

test('T-RET-05 тексты ошибок понятны игроку', () => {
  assert.match(describeAuthError({ description: 'Provider is not enabled' }), /не включён/i)
  assert.match(describeAuthError({ description: 'redirect_uri mismatch' }), /Адрес возврата/i)
  assert.match(describeAuthError({ description: 'not a test user' }), /тестов/i)
  assert.match(describeAuthError({ error: 'access_denied' }), /Вход отменён/i)
  assert.match(describeAuthError({ error: 'boom', description: 'Boom happened' }), /Boom happened/)
  assert.match(describeAuthError({ error: 'unknown_thing' }), /Не удалось завершить вход/)
})

test('T-RET-06 экран входа показывает ошибку возврата и статус Google', () => {
  const screens = read('app/src/screens.jsx')
  assert.ok(screens.includes('callbackError'), 'AuthScreen не принимает ошибку возврата')
  assert.ok(/useState\(callbackError \|\| ''\)/.test(screens), 'ошибка возврата не попадает в подсказку')
  assert.ok(screens.includes('googleReady'), 'нет проверки, включён ли Google')
  assert.ok(screens.includes('skip_http_redirect=true'), 'проверка провайдера без редиректа')
  const app = read('app/src/App.jsx')
  assert.ok(app.includes('parseAuthReturn(window.location.href)'), 'App не разбирает возврат')
  // Текст ошибки возврата идёт на экран входа; в приложении к нему добавляется
  // ошибка обмена deep-link кода, поэтому допускаем префикс.
  assert.ok(/callbackError=\{(?:\w+ \|\| )?AUTH_RETURN\.message\}/.test(app), 'сообщение не доходит до экрана')
  const landing = read('app/src/landing.jsx')
  assert.ok(landing.includes('callbackError={callbackError}'), 'лендинг не прокидывает ошибку')
})

test('T-RET-07 новый аккаунт после входа попадает в анкету, а не в пустую главную', () => {
  const app = read('app/src/App.jsx')
  assert.ok(/setScreen\(profileFilled \? 'home' : 'wizard'\)/.test(app), 'после входа нет развилки home/wizard')
  assert.ok(app.includes('if (sessionLoading) return'), 'ждём загрузку профиля перед переходом')
})

console.log(`\nauth-return: ${passed}/${passed + failed}`)
if (failed) process.exit(1)
