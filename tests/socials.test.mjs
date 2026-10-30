// NAME MLBB — привязка соцсетей (статическая проверка + чистые функции).
// Баг: «+» в блоке СОЦСЕТИ дописывал первый свободный провайдер и писал
// «Соцсеть привязана», хотя игрок ничего не указывал. Тест держит правило:
// привязка возможна только с ником/ссылкой и только после нажатия «Привязать».
// Run: node tests/socials.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const data = read('app/src/data.js')
const screens = read('app/src/screens.jsx')
const app = read('app/src/App.jsx')
const supabase = read('app/src/supabase.js')
const admin = read('app/src/admin.jsx')
const styles = read('app/src/styles.css')
const social = screens.slice(screens.indexOf('export function SocialRow'), screens.indexOf('export function HomeScreen'))

const { formatSocial, parseSocial, socialCaption, SOCIAL_PROVIDERS, SOCIAL_IDS } = await import('../app/src/data.js')

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

test('T-SOC-01 формат «провайдер:ник» разбирается и собирается', () => {
  assert.deepEqual(parseSocial('vk:@durov'), { provider: 'vk', handle: '@durov' })
  assert.deepEqual(parseSocial('telegram'), { provider: 'telegram', handle: '' })
  assert.equal(formatSocial('vk', '@durov'), 'vk:@durov')
  assert.equal(formatSocial('vk', '   '), 'vk')
})

test('T-SOC-02 подпись для игрока и админа', () => {
  assert.equal(socialCaption('vk:@durov'), 'VK · @durov')
  assert.equal(socialCaption('telegram'), 'Telegram, ник не указан')
  assert.equal(SOCIAL_PROVIDERS.length, 3)
  assert.deepEqual(SOCIAL_IDS, ['telegram', 'vk', 'google'])
})

test('T-SOC-03 «+» больше не привязывает соцсеть сам', () => {
  assert.ok(!/onAddSocial\(\); setToast\('Соцсеть привязана'\)/.test(social), 'старый автодобавляющий обработчик остался')
  assert.ok(social.includes('onClick={openAdd}'), 'кнопка + должна открывать выбор соцсети')
  assert.ok(social.includes('setOpen(true)'), 'нет модального окна привязки')
})

test('T-SOC-04 без ника сохранить нельзя', () => {
  assert.ok(/if \(!nick\) \{ setError/.test(social), 'нет проверки пустого ника')
  assert.ok(social.includes('role="alert"'), 'ошибка должна озвучиваться')
  assert.ok(social.includes('Привязать'), 'нет кнопки сохранения')
})

test('T-SOC-05 тост появляется только после реального сохранения', () => {
  const saveBlock = social.slice(social.indexOf('const save = () =>'), social.lastIndexOf('\n  return ('))
  assert.ok(saveBlock.includes('onAddSocial(provider, nick)'), 'сохранение не вызывает onAddSocial')
  assert.ok(saveBlock.includes('setOpen(false)'), 'после сохранения окно не закрывается')
  assert.ok(/setToast\(`\$\{socialLabel\(provider\)\} привязан: \$\{nick\}`\)/.test(saveBlock), 'тост должен содержать ник')
  assert.ok(!/setToast\('Соцсеть привязана'\)/.test(social), 'остался общий фальшивый тост')
})

test('T-SOC-06 в App привязка валидируется и умеет отвязывать', () => {
  assert.ok(/addSocial: \(provider, handle\)/.test(app), 'addSocial не принимает ник')
  assert.ok(app.includes('if (!SOCIAL_IDS.includes(id) || !nick) return false'), 'нет валидации провайдера и ника')
  assert.ok(app.includes('removeSocial'), 'нельзя отвязать соцсеть')
})

test('T-SOC-07 пустые привязки не улетают в Supabase', () => {
  assert.ok(supabase.includes(".filter((x) => x.includes(':') && x.split(':')[1].trim())"), 'в базу попадут записи без ника')
  assert.ok(supabase.includes("x.split(':')[0]"), 'фильтр по провайдеру сломан')
})

test('T-SOC-08 старые привязки без ника видны и перепривязываются', () => {
  assert.ok(social.includes('social-circle--empty'), 'нет пометки неполной привязки')
  assert.ok(social.includes('ник не указан'), 'игрок не понимает, что ник потерян')
  assert.ok(social.includes('social-circle__dot'), 'нет индикатора неполной привязки')
})

test('T-SOC-09 админка показывает ник, а не голый id', () => {
  assert.ok(admin.includes('map(socialCaption)'), 'админка печатает "vk:@nick" как есть')
})

test('T-SOC-10 стили выбора соцсети на месте', () => {
  for (const selector of ['.social-pick', '.social-pick__item', '.social-error', '.social-circle--empty']) {
    assert.ok(styles.includes(selector), 'нет стиля ' + selector)
  }
})

test('T-SOC-11 Google привязывается окном выбора аккаунта, без ввода почты', () => {
  assert.ok(app.includes('supabase.auth.linkIdentity'), 'нет связывания через linkIdentity')
  assert.ok(/linkIdentity\(\{ provider: 'google'/.test(app), 'linkIdentity должен открывать Google')
  assert.ok(app.includes('localStorage.setItem(LINK_GOOGLE_KEY, \'1\')'), 'нет метки возврата от Google')
  assert.ok(social.includes('Выбрать аккаунт Google'), 'нет кнопки выбора аккаунта')
  assert.ok(social.includes('startGoogle'), 'кнопка не запускает OAuth')
  assert.ok(/provider === 'google' && !manual/.test(social), 'для Google всё ещё показывается поле ввода')
})

test('T-SOC-12 подтверждённый Google-аккаунт подставляется сам', () => {
  assert.ok(/provider === 'google' && googleAccount \? googleAccount : handle.trim\(\)/.test(social), 'почта Google не подставляется в привязку')
  assert.ok(social.includes('аккаунт подтверждён Google'), 'нет отметки, что аккаунт проверен')
  assert.ok(app.includes('identity_data?.email'), 'почта не берётся из identity Google')
  assert.ok(app.includes('LINK_GOOGLE_KEY'), 'нет авто-записи после возврата')
  assert.ok(app.includes('googleEmailOf'), 'нет разбора identity Google')
  assert.ok(/upsert\(profileToRow\(withGoogle/.test(app), 'подтверждённый Google не сохраняется в базу')
})

test('T-SOC-13 ручной ввод — только аварийный путь', () => {
  assert.ok(social.includes('вписать почту вручную'), 'нет запасного варианта ввода')
  assert.ok(/manual linking/i.test(app), 'нет понятного сообщения, если связывание выключено')
}) 

test('T-SOC-14 Telegram берётся из telegram_links, а не из массива socials', () => {
  assert.ok(app.includes('getTelegramLink'), 'App не читает реальную привязку Telegram')
  assert.ok(app.includes('setTelegramLink'), 'нет состояния привязки Telegram')
  assert.ok(social.includes('telegramLink'), 'SocialRow не знает о привязке бота')
  assert.ok(/telegramLink \? \[\{ provider: 'telegram'/.test(social), 'иконка Telegram не строится из привязки')
  assert.ok(social.includes("x.provider !== 'telegram'"), 'ручной telegram всё ещё дублирует иконку')
})

test('T-SOC-15 иконка Telegram не пропадает после перезагрузки и честно отвязывается', () => {
  assert.ok(app.includes('deleteTelegramLink'), 'отвязка не удаляет строку в базе')
  assert.ok(app.includes('unlinkTelegram'), 'нет обработчика отвязки Telegram')
  assert.ok(social.includes('onUnlinkTelegram'), 'карточка Telegram не умеет отвязывать')
  assert.ok(social.includes('Telegram отвязан'), 'нет подтверждения отвязки')
  assert.ok(social.includes('через бота'), 'в выборе соцсети Telegram не помечен как «через бота»')
  assert.ok(styles.includes('.social-circle--bot'), 'нет отметки привязки через бота')
})

console.log(`\nsocials: ${passed}/${passed + failed}`)
if (failed) process.exit(1)
