// NAME MLBB — рейтинг, титулы и фиксация результата.
//
// Проверяем правила, которые легко сломать незаметно:
//   • шкала MMR без потолка (легенда продолжается ступенями);
//   • титул ТОП-N выдаётся только по фактическому месту, вручную его не поставить;
//   • капитаном драфта становится тот, кто собрал лобби;
//   • результат матча не двигает рейтинг, пока соперник не подтвердил;
//   • клиент не может записать себе pts/матчи напрямую.
//
// Run: node tests/rating.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const {
  MMR_START, MMR_FLOOR, MMR_TIERS, LEGEND_MIN, LEGEND_STEP,
  parseMmr, mmrTier, mmrColor, rankTitle, formatDelta, draftCaptains, playerForm, nextMilestone,
  withCaptain, captainOf, isCaptain, transferCaptain,
} = await import('../app/src/rating.js')

let passed = 0
let failed = 0
const queue = []
function test(name, fn) { queue.push({ name, fn }) }

// ------------------------------------------------------------------- шкала

test('T-MMR-01 стартовый рейтинг — 1000, ниже пола не опускается', () => {
  assert.equal(MMR_START, 1000)
  assert.equal(parseMmr(undefined), 1000)
  assert.equal(parseMmr('abc'), 1000)
  assert.equal(parseMmr(-50), MMR_FLOOR)
  assert.equal(parseMmr(1249.6), 1250)
})

test('T-MMR-02 каждый порог даёт свой цвет', () => {
  for (const tier of MMR_TIERS) {
    if (tier.id === 'legend') continue
    const result = mmrTier(tier.min)
    assert.equal(result.id, tier.id, 'порог ' + tier.min + ' не попал в свой тир')
    assert.equal(result.color, tier.color)
  }
  assert.equal(mmrTier(500).id, 'ash')
  assert.equal(mmrTier(1000).id, 'steel')
  assert.equal(mmrTier(3000).id, 'legend')
})

test('T-MMR-03 у шкалы нет потолка: легенда продолжается ступенями', () => {
  const first = mmrTier(3000)
  assert.equal(first.legend, true)
  assert.match(first.label, /Легенда I$/)

  const second = mmrTier(3000 + LEGEND_STEP)
  assert.match(second.label, /Легенда II$/)
  assert.ok(second.level === first.level + 1, 'ступень не выросла')

  const giant = mmrTier(3000 + LEGEND_STEP * 40)
  assert.ok(giant.level > 1, 'на очень высоком MMR уровень должен продолжать расти')
  assert.match(giant.label, /Легенда/)
})

test('T-MMR-04 прогресс показывает, сколько осталось до следующего тира', () => {
  const silver = mmrTier(1500)
  assert.equal(silver.next, 'Золото')
  assert.equal(silver.nextAt, 1600)
  assert.equal(silver.toNext, 100)
  assert.equal(silver.progress, 50)

  assert.equal(mmrTier(1599).toNext, 1)
  assert.equal(mmrTier(1600).progress, 0, 'на пороге прогресс начинается заново')
})

test('T-MMR-05 цвет рейтинга доступен отдельной функцией', () => {
  assert.equal(mmrColor(1650), '#ffc83d')
  assert.equal(mmrColor(0), MMR_TIERS[0].color)
})

// ------------------------------------------------------------------ титулы

test('T-MMR-06 титул зависит только от места', () => {
  assert.equal(rankTitle(1), 'ТОП-1')
  assert.equal(rankTitle(2), 'ТОП-2')
  assert.equal(rankTitle(3), 'ТОП-3')
  assert.equal(rankTitle(4), 'ТОП-4')
  assert.equal(rankTitle(10), 'ТОП-10')
  assert.equal(rankTitle(11), 'ТОП-11')
  assert.equal(rankTitle('2'), 'ТОП-2')
  assert.equal(rankTitle(2.5), '')
  assert.equal(rankTitle(-1), '')
  assert.equal(rankTitle(0), '')
  assert.equal(rankTitle(null), '')
})

test('T-MMR-07 титул считает база, а не клиент', () => {
  const sql = read('supabase/migrations/20261101290000_exact_rank_titles.sql')
  assert.match(sql, /create or replace view public\.leaderboard_ranks/i)
  assert.match(sql, /row_number\(\) over \(order by l\.pts desc/i)
  assert.match(sql, /'ТОП-'\s*\|\|\s*row_number\(\)/i)
  assert.doesNotMatch(sql, /drop view/i)

})

// ------------------------------------------------------------- капитаны

test('T-MMR-08 капитан — тот, кто собрал лобби, даже если он не топ по MMR', () => {
  const members = [
    { user_id: 'u1', nick: 'Сильный', pts: 2600 },
    { user_id: 'u2', nick: 'Хост', pts: 1100 },
    { user_id: 'u3', nick: 'Средний', pts: 1500 },
  ]
  const [a, b] = draftCaptains({ members, hostId: 'u2' })
  assert.equal(a.user_id, 'u2', 'капитаном должен быть хост')
  assert.equal(b.user_id, 'u1', 'второй капитан — сильнейший из оставшихся')
})

test('T-MMR-09 если хост не в составе — капитаном становится сильнейший', () => {
  const members = [
    { user_id: 'u1', nick: 'А', pts: 1200 },
    { user_id: 'u2', nick: 'Б', pts: 1900 },
  ]
  const [a, b] = draftCaptains({ members, hostId: 'нет-такого' })
  assert.equal(a.user_id, 'u2')
  assert.equal(b.user_id, 'u1')
})

test('T-MMR-10 один игрок — один капитан, второй пустой', () => {
  const [a, b] = draftCaptains({ members: [{ user_id: 'u1', nick: 'Соло', pts: 1000 }], hostId: 'u1' })
  assert.equal(a.user_id, 'u1')
  assert.equal(b, null)
  assert.deepEqual(draftCaptains({}), [null, null])
})

test('T-MMR-11 драфт больше не бросает монетку за капитана', () => {
  const screens = read('app/src/screens.jsx')
  const draft = screens.slice(screens.indexOf('export function DraftScreen'), screens.indexOf('export function MatchScreen'))
  assert.ok(!/Math\.random\(\) > 0\.5/.test(draft), 'в драфте остался случайный выбор первого хода')
  assert.match(draft, /draftCaptains\(/, 'драфт не использует капитана лобби')
  assert.match(draft, /captainId/, 'драфт не принимает хоста лобби')
})

// ------------------------------------------------------------- результат

test('T-MMR-12 рейтинг меняет только подтверждение, и только база', () => {
  const sql = read('supabase/migrations/20261101150000_matches.sql')
  assert.match(sql, /function public\.confirm_match/i)
  assert.match(sql, /if v_match\.status = 'confirmed' then[\s\S]*already_confirmed/i, 'нет защиты от двойного начисления')
  assert.match(sql, /if v_match\.status <> 'pending' then/, 'подтверждать можно не только ожидающий матч')
  assert.match(sql, /not_opponent/, 'подтвердить может отправитель')
  assert.match(sql, /revoke update \(matches_played, wins\)/, 'клиент может править счётчик матчей')
  assert.match(sql, /revoke update \(pt|revoke all on function public\.confirm_match/)
})

test('T-MMR-13 MMR не падает ниже 100 даже на серии поражений', () => {
  const sql = read('supabase/migrations/20261101150000_matches.sql')
  assert.match(sql, /greatest\(100, v_before \+ v_step\)/)
  assert.equal(MMR_FLOOR, 100)
})

test('T-MMR-14 формула Elo на сервере совпадает с ожиданиями', () => {
  const sql = read('supabase/migrations/20261101150000_matches.sql')
  assert.match(sql, /power\(10, \(p_opponent - p_rating\) \/ 400\.0\)/)
  assert.match(sql, /case when d = 0 then/, 'нулевой дельта не превращается в ±1')
  assert.match(sql, /v_k := case when v_match\.mode = '1v1' then 32 else 24 end/)
})

test('T-MMR-15 результат в приложении: отправить → подтвердить или оспорить', () => {
  const screens = read('app/src/screens.jsx')
  const match = screens.slice(screens.indexOf('export function MatchScreen'), screens.indexOf('export function LobbyScreen'))
  assert.match(match, /reportMatch\(/, 'нельзя отправить результат')
  assert.match(match, /confirmMatch\(/, 'соперник не может подтвердить')
  assert.match(match, /disputeMatch\(/, 'нельзя оспорить результат')
  assert.match(match, /Рейтинг не меняется|Рейтинг изменится, когда соперник подтвердит/, 'игрок не видит, почему рейтинг стоит')
})

test('T-MMR-16 дельта показывается со знаком', () => {
  assert.equal(formatDelta(16), '+16')
  assert.equal(formatDelta(-12), '−12')
  assert.equal(formatDelta(0), '0')
  assert.equal(formatDelta('abc'), '0')
})

// ------------------------------------------------------------ достижения

test('T-MMR-17 винрейт считается только по сыгранным матчам', () => {
  assert.deepEqual(playerForm({ matches_played: 0, wins: 0 }), { played: 0, wins: 0, losses: 0, winrate: null })
  assert.equal(playerForm({ matches_played: 20, wins: 13 }).winrate, 65)
  assert.equal(playerForm({ matches_played: 3, wins: 99 }).wins, 3, 'побед не может быть больше матчей')
})

test('T-MMR-18 вехи 100/500 матчей считаются честно', () => {
  assert.deepEqual(nextMilestone(0), { goal: 10, left: 10, done: false })
  assert.deepEqual(nextMilestone(99), { goal: 100, left: 1, done: false })
  assert.deepEqual(nextMilestone(500), { goal: 1000, left: 500, done: false })
  assert.deepEqual(nextMilestone(1000), { goal: null, left: 0, done: true })
})

// ------------------------------------------------- передача капитанства

const команда = (ids) => ids.map((id, i) => ({ user_id: id, nick: id, isCaptain: i === 0 }))
const составы = () => ({ teamA: команда(['a1', 'a2', 'a3']), teamB: команда(['b1', 'b2']) })

test('T-MMR-19 withCaptain гарантирует ровно одного капитана в команде', () => {
  const teams = withCaptain({ teamA: [{ user_id: 'x' }, { user_id: 'y' }], teamB: [{ user_id: 'z' }] })
  assert.deepEqual(teams.teamA.map((m) => m.isCaptain), [true, false])
  assert.deepEqual(teams.teamB.map((m) => m.isCaptain), [true])
  // Уже назначенного капитана не перебивает.
  const kept = withCaptain({ teamA: [{ user_id: 'x' }, { user_id: 'y', isCaptain: true }] })
  assert.equal(captainOf(kept.teamA).user_id, 'y')
})

test('T-MMR-20 капитан передаёт место своему игроку, флаг переезжает целиком', () => {
  const next = transferCaptain(составы(), 'A', 'a3')
  assert.equal(captainOf(next.teamA).user_id, 'a3')
  assert.equal(next.teamA.filter((m) => m.isCaptain).length, 1)
  assert.equal(isCaptain(next.teamA, 'a1'), false)
  // Другая команда не тронута.
  assert.equal(captainOf(next.teamB).user_id, 'b1')
})

test('T-MMR-21 чужой игрок и игрок из другой команды капитаном не становятся', () => {
  const teams = составы()
  assert.equal(transferCaptain(teams, 'A', 'b1'), teams)
  assert.equal(transferCaptain(teams, 'A', 'незнакомец'), teams)
  assert.equal(transferCaptain(teams, 'A', ''), teams)
  assert.equal(transferCaptain(teams, 'A', null), teams)
  assert.equal(captainOf(transferCaptain(teams, 'A', 'b2').teamA).user_id, 'a1')
})

test('T-MMR-22 передача капитана во второй команде не задевает первую', () => {
  const next = transferCaptain(составы(), 'b', 'b2')
  assert.equal(captainOf(next.teamB).user_id, 'b2')
  assert.equal(captainOf(next.teamA).user_id, 'a1')
  assert.equal(next.teamA.length, 3)
})

for (const { name, fn } of queue) {
  try {
    await fn()
    passed += 1
    console.log('PASS ' + name)
  } catch (error) {
    failed += 1
    console.log('FAIL ' + name + ' — ' + error.message)
  }
}

console.log(`\nrating: ${passed}/${passed + failed}`)
process.exitCode = failed ? 1 : 0
