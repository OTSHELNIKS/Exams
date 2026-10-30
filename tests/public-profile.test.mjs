// NAME MLBB — просмотр профиля других игроков.
// Проверяем три вещи:
//   1) публичная вьюха отдаёт только безопасные поля (без Game ID, почты, бана);
//   2) клиент читает карточку именно из неё;
//   3) вход в чужой профиль есть из рейтинга и из драфта, приватность подписана.
// Run: node tests/public-profile.test.mjs   (zero dependencies)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const sql = read('supabase/migrations/20261031150000_public_player_profiles.sql')
const api = read('app/src/supabase.js')
const screens = read('app/src/screens.jsx')
const styles = read('app/src/styles.css')

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

test('T-PUB-01 вьюха публичной карточки создана', () => {
  assert.match(sql, /create or replace view public\.player_profiles_public/i)
  assert.match(sql, /comment on view public\.player_profiles_public/i)
})

test('T-PUB-02 вьюха не отдаёт приватные поля', () => {
  const body = sql.slice(sql.indexOf('select'), sql.indexOf('from public.player_profiles'))
  for (const secret of ['game_id', 'game_server', 'screenshot', 'email', 'age', 'gender', 'ban_reason', 'is_banned as']) {
    assert.ok(!body.toLowerCase().includes(secret), 'в публичную карточку утекло: ' + secret)
  }
})

test('T-PUB-03 вьюха содержит всё, что нужно для карточки', () => {
  for (const field of ['user_id', 'nick', 'pts', 'rank', 'roles', 'regions', 'heroes', 'bio', 'avatar_url', 'socials']) {
    assert.ok(sql.includes(field), 'нет поля ' + field)
  }
})

test('T-PUB-04 почта Google не уходит другим игрокам', () => {
  assert.ok(sql.includes("split_part(s, ':', 1) = 'google' then 'google'"), 'соцсеть Google отдаётся вместе с адресом почты')
  assert.ok(!/when split_part\(s, ':', 1\) = 'google' then s/.test(sql), 'почта Google попадает в ответ')
})

test('T-PUB-05 права: только вошедшим, анонимам закрыто', () => {
  assert.match(sql, /revoke all on public\.player_profiles_public from anon, authenticated/i)
  assert.match(sql, /grant select on public\.player_profiles_public to authenticated/i)
})

test('T-PUB-06 скрытые и забаненные профили не публикуются', () => {
  assert.match(sql, /coalesce\(p\.nick, ''\) <> ''/, 'профиль без ника попадает в публичный список')
  assert.match(sql, /coalesce\(p\.is_banned, false\) = false/, 'забаненный игрок виден другим')
})

test('T-PUB-07 клиент читает карточку из публичной вьюхи', () => {
  assert.match(api, /export async function getPublicProfile\(userId\)/)
  assert.match(api, /\.from\('player_profiles_public'\)/)
  assert.ok(!/getPublicProfile[\s\S]{0,300}from\('player_profiles'\)/.test(api), 'карточка грузится из приватной таблицы')
})

test('T-PUB-08 карточка другого игрока — отдельный компонент', () => {
  assert.match(screens, /export function PublicProfileModal\(\{ userId, isMe, supabase, onClose, onPick, pickLabel \}\)/)
  assert.ok(screens.includes('Загружаем профиль…'), 'нет состояния загрузки')
  assert.ok(screens.includes('Не удалось открыть профиль'), 'нет понятной ошибки')
  assert.ok(screens.includes('Профиль закрыт'), 'нет честного ответа для скрытого профиля')
})

test('T-PUB-09 в рейтинге игрок открывается нажатием', () => {
  const lb = screens.slice(screens.indexOf('export function LeaderboardScreen'), screens.indexOf('/* ============================================================== SUPPORT'))
  assert.ok(lb.includes('rank-row--btn'), 'строка рейтинга осталась некликабельной')
  assert.ok(lb.includes('onClick={() => setOpenPlayer(r.user_id)}'), 'нажатие не открывает профиль')
  assert.ok(/aria-label=\{`Открыть профиль \$\{r\.nick\}`\}/.test(lb), 'нет доступного имени кнопки')
  assert.ok(lb.includes('<PublicProfileModal'), 'модалка профиля не подключена')
})

test('T-PUB-10 из драфта видно профиль капитана и игрока пула', () => {
  assert.ok(screens.includes('onOpenProfile={(id) => { setPeek(null); setOpenProfile(id) }}'), 'нет перехода из карточки игрока в профиль')
  assert.ok(screens.includes('Открыть профиль'), 'нет кнопки «Открыть профиль»')
})

test('T-PUB-14 в лобби сокомандник открывается нажатием на ник', () => {
  assert.ok(screens.includes('className="voice-row__who"'), 'ник в голосовом чате не кликабелен')
  assert.ok(/onClick=\{\(\) => setOpenProfile\(m\.user_id\)\}/.test(screens), 'нажатие не открывает профиль')
  assert.ok(/aria-label=\{`Открыть профиль \$\{m\.nick\}`\}/.test(screens), 'нет доступного имени кнопки')
  assert.ok(screens.includes('voice-row__text'), 'текст строки потерял обёртку')
  const match = screens.slice(screens.indexOf('export function MatchScreen'), screens.indexOf('/* ===================================================== PUBLIC PROFILE'))
  assert.ok(match.includes('<PublicProfileModal'), 'в лобби нет модалки профиля')
})

test('T-PUB-11 карточка ничего не даёт редактировать', () => {
  const modal = screens.slice(screens.indexOf('export function PublicProfileModal'), screens.indexOf('/* ========================================================= LEADERBOARD'))
  for (const action of ['onAddSocial', 'onRemoveSocial', 'onEdit', 'upsert(', 'setProfile']) {
    assert.ok(!modal.includes(action), 'чужая карточка умеет ' + action)
  }
  assert.ok(modal.includes('Game ID, скриншоты и почта видны только владельцу профиля.'), 'нет подписи о приватности')
})

test('T-PUB-12 у своего профиля в карточке есть пометка', () => {
  assert.ok(screens.includes("isMe ? ' (вы)' : ''"), 'не видно, что это мой профиль')
  assert.ok(screens.includes('isMe={openPlayer === userId}'), 'лидерборд не передаёт признак своего профиля')
})

test('T-PUB-13 стили карточки и кликабельной строки на месте', () => {
  for (const selector of ['.rank-row--btn', '.rank-row__more', '.pub__chip', '.pub__social', '.pub__note', '.modal--player']) {
    assert.ok(styles.includes(selector), 'нет стиля ' + selector)
  }
})

console.log(`\npublic-profile: ${passed}/${passed + failed}`)
if (failed) process.exit(1)
