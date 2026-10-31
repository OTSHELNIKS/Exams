// NAME MLBB — Game ID и сервер хранятся отдельно (статическая проверка).
// Защищает от регрессии: снова одно поле «123456789 (1234)», потеря сервера
// при сохранении в Supabase или неразобранные старые записи.
// Run: node tests/gameid.test.mjs
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
const landing = read('app/src/landing.jsx')
const styles = read('app/src/styles.css')
const migration = read('supabase/migrations/20261030200000_game_server.sql')

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

// --- чистые функции: поведение, а не текст
const { normalizeGameId, normalizeServerId, splitCombinedGameId, formatGameId, GAME_ID_MAX, GAME_SERVER_MAX } =
  await import('../app/src/data.js')

test('T-ID-01 нормализация: только цифры и лимиты', () => {
  assert.equal(GAME_ID_MAX, 12)
  assert.equal(GAME_SERVER_MAX, 6)
  assert.equal(normalizeGameId('134 0937-090abc'), '1340937090')
  assert.equal(normalizeGameId('1234567890123456'), '123456789012')
  assert.equal(normalizeServerId('(6634)'), '6634')
  assert.equal(normalizeServerId('66 34 99 12'), '663499')
})

test('T-ID-02 старые составные значения разбираются на две части', () => {
  assert.deepEqual(splitCombinedGameId('1340937090 (6634)'), { gameId: '1340937090', server: '6634' })
  assert.deepEqual(splitCombinedGameId('1340937090(6634)'), { gameId: '1340937090', server: '6634' })
  assert.deepEqual(splitCombinedGameId('1340937090 6634'), { gameId: '1340937090', server: '6634' })
  assert.deepEqual(splitCombinedGameId('1340937090'), { gameId: '1340937090', server: '' })
  assert.deepEqual(splitCombinedGameId(''), { gameId: '', server: '' })
})

test('T-ID-03 склейка для показа в профиле и админке', () => {
  assert.equal(formatGameId('1340937090', '6634'), '1340937090 (6634)')
  assert.equal(formatGameId('1340937090', ''), '1340937090')
  assert.equal(formatGameId('', '6634'), '')
})

test('T-ID-04 в форме регистрации два отдельных поля, без составного плейсхолдера', () => {
  assert.ok(!screens.includes('123456789 (1234)'), 'остался составной плейсхолдер')
  const auth = screens.slice(screens.indexOf('export function AuthScreen'), screens.indexOf('export function WizardScreen'))
  assert.ok(auth.includes('className="id-fields"'), 'нет контейнера двух полей')
  assert.ok(/aria-label="Game ID"/.test(auth), 'нет поля Game ID')
  assert.ok(/aria-label="Сервер \(зона\)"/.test(auth), 'нет поля сервера')
  assert.ok(auth.includes('setGameId(normalizeGameId'), 'ID не нормализуется')
  assert.ok(auth.includes('setGameServer(normalizeServerId'), 'сервер не нормализуется')
  // Модалка входа через игру — отдельный компонент GameLoginModal, в форме её нет.
  const form = auth.slice(0, auth.indexOf('<GameLoginModal'))
  assert.equal((form.match(/inputMode="numeric"/g) || []).length, 2, 'оба поля должны быть цифровыми')
  const modal = screens.slice(screens.indexOf('export function GameLoginModal'), screens.indexOf('export function GameAccountCard'))
  assert.equal((modal.match(/inputMode="numeric"/g) || []).length, 3, 'в модалке входа ID, сервер и код — цифровые')
})

test('T-ID-05 при регистрации Game ID обязателен, сервер опционален', () => {
  const auth = screens.slice(screens.indexOf('export function AuthScreen'), screens.indexOf('export function WizardScreen'))
  assert.ok(/register && !\/\^\\d\{6,12\}\$\/\.test\(gameId\)/.test(auth), 'нет проверки 6–12 цифр при регистрации')
  assert.ok(!/gameServer.*\|\|.*setAuthError/.test(auth), 'сервер не должен быть обязательным')
})

test('T-ID-06 анкета даёт исправить оба числа после регистрации', () => {
  const wizard = screens.slice(screens.indexOf('export function WizardScreen'), screens.indexOf('export function HomeScreen'))
  assert.ok(wizard.includes('className="wizard__ids"'), 'нет блока ID + сервер в анкете')
  assert.ok(wizard.includes('setGameServer(normalizeServerId'), 'сервер не редактируется в анкете')
})

test('T-ID-07 сервер сохраняется и читается из Supabase отдельной колонкой', () => {
  assert.ok(/profileToRow\(profile, gameId, gameServer, userId\)/.test(supabase), 'game_server не попадает в строку БД')
  assert.ok(supabase.includes('game_server'), 'нет поля game_server в profileToRow')
  assert.ok(app.includes('splitCombinedGameId'), 'старый gameId не разбирается при загрузке профиля')
  assert.ok(app.includes("STORAGE_KEY + ':gameServer'"), 'сервер не кэшируется локально')
})

test('T-ID-08 миграция добавляет колонку и разбирает старые записи', () => {
  assert.ok(/add column if not exists game_server/.test(migration), 'нет колонки game_server')
  assert.ok(/with parsed as/.test(migration) && /update public\.player_profiles/.test(migration), 'нет backfill')
  assert.ok(migration.includes('comment on column'), 'нет описания колонки')
})

test('T-ID-09 главная, профиль и админка показывают сервер', () => {
  assert.ok(screens.includes('formatGameId'), 'в экранах нет склейки id + сервер')
  assert.ok(screens.includes('gameServer={gameServer}') || screens.includes('gameServer'), 'параметры сервера не доходят до экранов')
  assert.ok(landing.includes('setGameServer={setGameServer}'), 'лендинг не прокидывает сервер в форму')
  assert.ok(admin.includes('game_server'), 'админка не показывает сервер')
  assert.ok(/r\.game_server/.test(admin), 'поиск в админке не учитывает сервер')
})

test('T-ID-10 стили двух полей на месте, включая мобильную сетку', () => {
  assert.ok(styles.includes('.id-fields'), 'нет .id-fields')
  assert.ok(styles.includes('.wizard__ids'), 'нет .wizard__ids')
  assert.ok(/\.id-fields \{[^}]*grid-template-columns/.test(styles), 'поля не стоят в ряд')
})

console.log(`\ngameid: ${passed}/${passed + failed}`)
if (failed) process.exit(1)
