// NAME MLBB — юридические страницы для проверки TikTok Login Kit.
// TikTok требует рабочие URL Terms of Service и Privacy Policy. Тест держит
// их живыми, честными (описан реальный scope user.info.basic) и доступными из сайта.
// Run: node tests/legal.test.mjs   (zero dependencies)
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const privacy = read('app/public/privacy.html')
const terms = read('app/public/terms.html')
const landing = read('app/src/landing.jsx')
const fn = read('supabase/functions/tiktok-auth/index.ts')

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

test('T-LGL-01 обе страницы существуют и собираются в сайт', () => {
  assert.ok(existsSync(join(root, 'app/public/privacy.html')), 'нет privacy.html')
  assert.ok(existsSync(join(root, 'app/public/terms.html')), 'нет terms.html')
})

test('T-LGL-02 страницы отдают нормальный HTML с заголовком и датой', () => {
  for (const [name, html] of [['privacy', privacy], ['terms', terms]]) {
    assert.match(html, /<!doctype html>/i, name + ': нет doctype')
    assert.match(html, /<html lang="ru">/, name + ': нет языка')
    assert.match(html, /<meta name="viewport"/, name + ': не адаптивно')
    assert.match(html, /Обновлено 31 октября 2026/, name + ': нет даты обновления')
    assert.match(html, /<h1>/, name + ': нет заголовка')
  }
})

test('T-LGL-03 описан реальный доступ TikTok, без обещаний лишнего', () => {
  assert.match(privacy, /user\.info\.basic/, 'не указан scope')
  assert.match(privacy, /не публикуем ничего от вашего имени/i, 'не сказано, что постить не будем')
  assert.match(privacy, /токен/i, 'не сказано, что токен не хранится')
  assert.match(privacy, /display name|ник/i, 'не сказано, что получаем ник')
})

test('T-LGL-04 приватность честно описывает, что видят другие игроки', () => {
  assert.match(privacy, /Game ID, скриншоты/i, 'не сказано, что Game ID скрыт')
  assert.match(privacy, /без адреса почты/i, 'почта Google не упомянута как скрытая')
  assert.match(privacy, /Supabase/, 'не указан обработчик данных')
  assert.match(privacy, /удалени/i, 'нет описания удаления данных')
})

test('T-LGL-05 условия покрывают аккаунт, правила и призы', () => {
  for (const topic of ['Аккаунт', 'Правила матчей', 'Модерация', 'призы', 'Ответственность', '13 лет']) {
    assert.ok(terms.includes(topic), 'в условиях нет раздела: ' + topic)
  }
})

test('T-LGL-06 обе страницы содержат английское резюме для ревьюера', () => {
  for (const [name, html] of [['privacy', privacy], ['terms', terms]]) {
    assert.ok(html.includes('Summary in English'), name + ': нет английского блока')
    assert.ok(html.includes('https://t.me/name_mlbb_bot'), name + ': нет контакта')
  }
})

test('T-LGL-07 страницы связаны между собой и с приложением', () => {
  assert.ok(privacy.includes('./terms.html'), 'нет ссылки на условия')
  assert.ok(terms.includes('./privacy.html'), 'нет ссылки на политику')
  assert.ok(privacy.includes('./') && terms.includes('./'), 'нет возврата в приложение')
  assert.ok(landing.includes('./privacy.html') && landing.includes('./terms.html'), 'на лендинге нет ссылок на документы')
})

test('T-LGL-08 документы не противоречат коду TikTok', () => {
  assert.match(fn, /open_id,display_name,avatar_url/, 'сервер запрашивает не только базовый профиль')
  assert.ok(!fn.includes('video.list') && !fn.includes('video.publish'), 'функция просит лишние права')
  assert.ok(!/access_token/i.test(privacy.split('Summary in English')[0].replace(/токен/gi, '')), 'в политике упомянут токен как хранимый')
})

test('T-LGL-09 файл подтверждения URL от TikTok лежит в корне сайта', () => {
  // Имя файла выдаёт TikTok: tiktok<key>.txt, внутри строка
  // "tiktok-developers-site-verification=<key>". Лежит в app/public — значит
  // попадает в корень https://otshelniks.github.io/Exams/.
  const dir = join(root, 'app/public')
  const files = readdirSync(dir).filter((f) => /^tiktok.*\.txt$/.test(f))
  assert.equal(files.length, 1, 'файла подтверждения нет (или их несколько)')
  const content = readFileSync(join(dir, files[0]), 'utf8').trim()
  assert.match(content, /^tiktok-developers-site-verification=.+$/, 'неверный формат файла')
  const key = files[0].replace(/^tiktok/, '').replace(/\.txt$/, '')
  assert.ok(content.endsWith(key), 'ключ в имени файла и в содержимом не совпадают')
})

test('T-LGL-10 страница-шпаргалка для формы TikTok: значения и копирование', () => {
  const helper = read('app/public/tiktok-setup.html')
  // Каждое обязательное поле формы есть на странице ровно в том виде, в каком
  // его ждёт TikTok: ссылки, категория, описание, текст для ревьюера.
  for (const value of [
    'https://otshelniks.github.io/Exams/terms.html',
    'https://otshelniks.github.io/Exams/privacy.html',
    'https://otshelniks.github.io/Exams/',
    'NAME MLBB',
  ]) {
    assert.ok(helper.includes(value), 'на шпаргалке нет значения: ' + value)
  }
  assert.ok(helper.includes('user.info.basic'), 'не указан scope')
  assert.ok(helper.includes('Login Kit'), 'не указан продукт')
  assert.ok(/Redirect URI/.test(helper), 'нет отдельного поля Redirect URI для Login Kit')
  assert.ok(helper.includes('Sandbox'), 'не напомнила про Sandbox')
  assert.ok(helper.includes('tiktok-icon-1024.png'), 'нет ссылки на иконку')
  assert.ok(/data-copy="/.test(helper) && /clipboard/.test(helper), 'кнопки копирования не работают')
  // Текст описания не длиннее лимита TikTok (120 символов).
  const desc = helper.match(/data-copy="(Матчмейкинг[^"]+)"/)
  assert.ok(desc && desc[1].length <= 120, 'описание длиннее 120 символов')
  // Шпаргалка не должна светить секретами и не собирает данные.
  assert.ok(!/client_secret|TIKTOK_CLIENT_SECRET/.test(helper), 'на странице упомянут секрет')
  assert.ok(!/<form|fetch\(/.test(helper), 'страница что-то отправляет на сервер')
})

console.log(`\nlegal: ${passed}/${passed + failed}`)
if (failed) process.exit(1)
