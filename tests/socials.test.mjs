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

const dataModule = await import('../app/src/data.js')
const { formatSocial, parseSocial, socialCaption, SOCIAL_PROVIDERS, SOCIAL_IDS } = dataModule
const await_import = () => dataModule

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
  assert.ok(/await onAddSocial\(provider, nick\)/.test(social), 'сохранение не вызывает onAddSocial')
  assert.ok(social.includes('result.ok === false'), 'ошибка сохранения не показывается игроку')
  assert.ok(!/setToast\('Соцсеть привязана'\)/.test(social), 'остался общий фальшивый тост')
  assert.ok(social.includes('setToast(`Google привязан'), 'нет тоста с подтверждённым аккаунтом Google')
  assert.ok(social.includes('onAddSocial(\'google\', googleAccount)'), 'аккаунт Google не записывается по кнопке «Привязать»')
})

test('T-SOC-06 в App привязка валидируется и умеет отвязывать', () => {
  assert.ok(/addSocial: async \(provider, handle\)/.test(app), 'addSocial не принимает ник')
  assert.ok(app.includes("if (!SOCIAL_IDS.includes(id) || !nick) return { ok: false"), 'нет валидации провайдера и ника')
  assert.ok(/removeSocial: async \(provider\)/.test(app), 'нельзя отвязать соцсеть')
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
  assert.ok(/googleAccount \? \(\s*<div className="social-account">/.test(social), 'для Google показывается ввод вместо карточки аккаунта')
  assert.ok(/provider === 'google' && manual/.test(social), 'ручной ввод Google должен быть только по ссылке')
})

test('T-SOC-12 подтверждённый Google-аккаунт подставляется сам', () => {
  assert.ok(social.includes('onAddSocial(\'google\', googleAccount)'), 'почта Google не подставляется в привязку')
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

test('T-SOC-16 Telegram привязывается через бота, ник не вводится', () => {
  assert.ok(social.includes('onStartTelegram'), 'нет получения кода у бота')
  assert.ok(social.includes('https://t.me/${TELEGRAM_BOT_USERNAME}?start=${tgCode}'), 'бот не открывается с готовым кодом')
  assert.ok(social.includes('onRefreshTelegram'), 'нет проверки, привязал ли бот')
  assert.ok(/setInterval\(async \(\) =>/.test(social), 'нет опроса привязки')
  assert.ok(social.includes('Получить код для бота'), 'нет кнопки получения кода')
  assert.ok(app.includes('createTelegramLinkCode'), 'код не создаётся в App')
  assert.ok(!/provider === 'telegram' && !manual/.test(social), 'у Telegram остался ручной ввод')
})

test('T-SOC-17a VK скрыт из выбора соцсетей, старые привязки видны', () => {
  const { SOCIAL_ACTIVE, SOCIAL_ACTIVE_IDS } = await_import()
  assert.ok(!SOCIAL_ACTIVE_IDS.includes('vk'), 'VK не должен быть в активных')
  assert.deepEqual(SOCIAL_ACTIVE_IDS, ['telegram', 'google'])
  assert.ok(SOCIAL_ACTIVE.every((p) => p.enabled), 'в активные попал выключенный провайдер')
  assert.ok(social.includes('const pickable = SOCIAL_ACTIVE'), 'окно выбора должно строиться из активных')
})

test('T-SOC-17 VK привязывается окном VK ID, а не ником', () => {
  assert.ok(social.includes('startVk'), 'нет запуска VK OAuth')
  assert.ok(social.includes('Войти через VK'), 'нет кнопки входа через VK')
  assert.ok(app.includes('startVkAuth'), 'App не запускает VK OAuth')
  assert.ok(app.includes('completeVkAuth'), 'App не завершает VK OAuth')
  assert.ok(app.includes('describeVkError'), 'нет понятных ошибок VK')
  assert.ok(!/provider === 'vk' \?/.test(social), 'у VK остался ручной ввод')
})

test('T-SOC-18 стили потока привязки и кода бота', () => {
  for (const selector of ['.social-flow', '.social-flow__code', '.social-flow__cta', '.social-flow__again']) {
    assert.ok(styles.includes(selector), 'нет стиля ' + selector)
  }
})

test('T-SOC-19 привязка соцсети сразу уходит в базу — не пропадает после F5', () => {
  assert.ok(app.includes('const persistProfileNow = async (next, label) =>'), 'нет общей точки сохранения')
  assert.ok(/\.from\('player_profiles'\)\s*\n?\s*\.upsert\(profileToRow\(next, gameId, gameServer, session\.user\.id\)\)/.test(app),
    'изменение соцсетей не сохраняется в player_profiles')
  assert.ok(app.includes("return persistProfileNow(next, 'привязку соцсети')"), 'addSocial не пишет в базу')
  assert.ok(app.includes("return persistProfileNow(next, 'отвязку соцсети')"), 'removeSocial не пишет в базу')
  // Состояние меняется только после успешной записи: фантомных привязок нет.
  assert.ok(app.indexOf('setProfile(next)') > app.indexOf('const { error } = await supabase'), 'профиль меняется до сохранения')
  assert.ok(!/addSocial: async[\s\S]{0,400}setProfile\(\(p\) =>/.test(app), 'addSocial снова меняет только память')
})

test('T-SOC-20 подтверждённый Google виден и без строки в socials', () => {
  assert.ok(social.includes('googleInSocials'), 'иконка Google строится только из socials')
  assert.ok(/googleAccount && !googleInSocials/.test(social), 'подтверждённый Google не попадает в список привязок')
  assert.ok(social.includes('viaGoogle'), 'нет пометки, что Google подтверждён OAuth')
  assert.ok(social.includes('· подтверждено Google'), 'пометка не выводится в карточке')
})

test('T-SOC-21 отвязка Google снимает и identity — иконка не возвращается', () => {
  assert.ok(app.includes('supabase.auth.unlinkIdentity(identity)'), 'identity Google остаётся после отвязки')
  assert.ok(app.includes("find((i) => i.provider === 'google')"), 'identity Google не находится')
  assert.ok(app.includes('await supabase.auth.getSession()'), 'сессия не обновляется после отвязки')
  assert.ok(social.includes("setError((result && result.error) || 'Не удалось отвязать"), 'ошибка отвязки не показывается')
})

console.log(`\nsocials: ${passed}/${passed + failed}`)
if (failed) process.exit(1)
