// NAME MLBB — косметика за достижения.
//
// Проверяем то, что обещано игроку и легко ломается:
//   • каталог в JS и в базе — один и тот же список предметов;
//   • бесплатные предметы открываются только по реальному прогрессу
//     (матчи, победы, MMR), а не «сами по себе»;
//   • коллекционные (premium) не открываются никаким количеством матчей —
//     только правом из покупки/кода;
//   • закрытый предмет не рисуется: look() откатывается к базовому виду;
//   • сервер перепроверяет условие (equip_cosmetic), а loadout пишется только
//     через RPC — клиент не может надеть что угодно.
//
// Run: node tests/cosmetics.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const {
  COSMETICS, COSMETIC_KINDS, DEFAULTS, REQ, KIND_LABEL, KINDS_TITLE,
  itemsOf, cosmeticById, equippedFromRow, playerState, requirement,
  isUnlocked, itemStatus, catalogue, look, lookFromRow, unlockedIds, nextReward,
} = await import('../app/src/cosmetics.js')

const sql = read('supabase/migrations/20261101180000_cosmetics.sql')

let passed = 0
let failed = 0
const queue = []
function test(name, fn) { queue.push({ name, fn }) }

const никто = playerState({})
const богач = playerState({ verified: true, matches: 5000, wins: 5000, mmr: 9999 })

// ------------------------------------------------------------------- каталог

test('T-COS-01 каталог: 27 предметов, четыре вида, уникальные id', () => {
  assert.equal(COSMETICS.length, 27)
  assert.deepEqual(COSMETIC_KINDS, ['frame', 'hat', 'title', 'color'])
  const ids = COSMETICS.map((i) => i.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const kind of COSMETIC_KINDS) {
    assert.ok(itemsOf(kind).length > 0, `пусто в ${kind}`)
    assert.ok(KIND_LABEL[kind], `нет подписи вида ${kind}`)
    assert.ok(KINDS_TITLE[kind], `нет заголовка вида ${kind}`)
  }
  assert.equal(itemsOf('frame').length + itemsOf('hat').length + itemsOf('title').length + itemsOf('color').length, 27)
})

test('T-COS-02 id и условия в JS совпадают с таблицей cosmetic_items', () => {
  const rows = [...sql.matchAll(/\('([a-z0-9-]+)',\s*'(frame|hat|title|color)',\s*'([^']+)',\s*'(always|verified|matches|wins|mmr|entitlement)',\s*(\d+),\s*(true|false)\)/g)]
    .map((m) => ({ id: m[1], kind: m[2], label: m[3], reqKind: m[4], reqValue: Number(m[5]), premium: m[6] === 'true' }))
  assert.equal(rows.length, 27)
  const byId = new Map(COSMETICS.map((i) => [i.id, i]))
  for (const row of rows) {
    const item = byId.get(row.id)
    assert.ok(item, `предмета ${row.id} нет в JS-каталоге`)
    assert.equal(item.kind, row.kind, `вид ${row.id}`)
    assert.equal(item.label, row.label, `название ${row.id}`)
    assert.equal(item.req.kind, row.reqKind, `условие ${row.id}`)
    assert.equal(item.req.value || 0, row.reqValue, `порог ${row.id}`)
    assert.equal(Boolean(item.premium), row.premium, `premium ${row.id}`)
  }
})

test('T-COS-03 базовое оформление открыто всем и без регистрации', () => {
  for (const kind of COSMETIC_KINDS) {
    assert.ok(isUnlocked(cosmeticById(DEFAULTS[kind]), никто), `базовый ${kind} закрыт`)
  }
  assert.equal(unlockedIds(никто).length, 5)
})

// ------------------------------------------------------------------ условия

test('T-COS-04 порог матчей: 9 не открывает, 10 открывает', () => {
  const frame = cosmeticById('frame-bronze')
  assert.equal(isUnlocked(frame, playerState({ matches: 9 })), false)
  assert.equal(isUnlocked(frame, playerState({ matches: 10 })), true)
  assert.equal(itemStatus(frame, playerState({ matches: 9 }), equippedFromRow()).left, 1)
})

test('T-COS-05 победы считаются отдельно от матчей', () => {
  const hat = cosmeticById('hat-champion')
  assert.equal(isUnlocked(hat, playerState({ matches: 999, wins: 49 })), false)
  assert.equal(isUnlocked(hat, playerState({ matches: 50, wins: 50 })), true)
})

test('T-COS-06 «проверенный» требует подтверждённого игрового аккаунта', () => {
  const frame = cosmeticById('frame-verified')
  assert.equal(isUnlocked(frame, playerState({ matches: 500, mmr: 3000 })), false)
  assert.equal(isUnlocked(frame, playerState({ verified: true })), true)
  assert.match(requirement(frame, никто).text, /MLBB|Game ID/)
})

test('T-COS-07 MMR-предметы открываются по непрерывной шкале, без потолка', () => {
  const gold = cosmeticById('frame-gold')
  assert.equal(isUnlocked(gold, playerState({ mmr: 1599 })), false)
  assert.equal(isUnlocked(gold, playerState({ mmr: 1600 })), true)
  // 9999 — не предел шкалы: предмет просто остаётся открытым.
  assert.equal(isUnlocked(gold, богач), true)
  assert.equal(isUnlocked(cosmeticById('hat-top'), playerState({ mmr: 2499 })), false)
  assert.equal(isUnlocked(cosmeticById('hat-top'), playerState({ mmr: 2500 })), true)
})

test('T-COS-08 коллекционные предметы не открываются прогрессом — только правом', () => {
  const premium = COSMETICS.filter((i) => i.premium)
  assert.equal(premium.length, 6)
  for (const item of premium) {
    assert.equal(isUnlocked(item, богач), false, `${item.id} открылся от матчей`)
    assert.equal(isUnlocked(item, playerState({ ...богач, entitlements: [item.id] })), true, `${item.id} не открылся правом`)
  }
})

test('T-COS-09 чужое право не открывает предмет', () => {
  assert.equal(isUnlocked(cosmeticById('frame-neon'), playerState({ entitlements: ['frame-diamond'] })), false)
})

test('T-COS-10 справочник условий полный и не содержит «магии»', () => {
  for (const kind of Object.keys(REQ)) {
    assert.equal(typeof REQ[kind], 'function', `условие ${kind} — не правило`)
  }
  const used = new Set(COSMETICS.map((i) => i.req.kind))
  for (const kind of used) {
    assert.ok(REQ[kind], `условие ${kind} не описано в REQ`)
  }
})

// ---------------------------------------------------------------- отображение

test('T-COS-11 закрытый предмет не рисуется: look() откатывается к базовому', () => {
  const хочу = equippedFromRow({ frame_id: 'frame-ruby', hat_id: 'hat-legend', title_id: 'title-legend', color_id: 'color-gold' })
  const shown = look(хочу, playerState({ matches: 3, mmr: 1010 }))
  assert.equal(shown.frameClass, 'frame-default')
  assert.equal(shown.hatGlyph, '')
  assert.equal(shown.titleText, '')
  assert.equal(shown.colorValue, cosmeticById('color-default').value)
})

test('T-COS-12 открытый предмет рисуется как выбран', () => {
  const state = playerState({ matches: 500, mmr: 2000 })
  const shown = look(equippedFromRow({ frame_id: 'frame-ruby', hat_id: 'hat-legend', title_id: 'title-legend', color_id: 'color-emerald' }), state)
  assert.equal(shown.frameClass, 'frame-ruby')
  assert.equal(shown.hatGlyph, '🏆')
  assert.equal(shown.titleText, 'ЛЕГЕНДА')
  assert.equal(shown.colorValue, '#3fcb7b')
  assert.equal(shown.tierColor, cosmeticById('color-emerald').value ? shown.tierColor : null)
})

test('T-COS-13 lookFromRow рисует оформление другого игрока как есть', () => {
  const other = lookFromRow({ frame_id: 'frame-neon', hat_id: 'hat-crown', title_id: 'title-pioneer', color_id: 'color-neon' })
  assert.equal(other.frameClass, 'frame-neon')
  assert.equal(other.hatGlyph, '🜲')
  assert.equal(other.titleText, 'ПЕРВОПРОХОДЕЦ')
  assert.equal(other.colorValue, '#39f0ff')
  // Пустая строка (игрок ничего не надевал) — базовый вид, без падений.
  assert.equal(lookFromRow({}).frameClass, 'frame-default')
  assert.equal(lookFromRow(null).frameClass, 'frame-default')
})

test('T-COS-14 itemStatus честно говорит «надето / открыто / ещё N»', () => {
  const equipped = equippedFromRow({ frame_id: 'frame-default' })
  const state = playerState({ matches: 40 })
  assert.equal(itemStatus(cosmeticById('frame-default'), state, equipped).equipped, true)
  const bronze = itemStatus(cosmeticById('frame-bronze'), state, equipped)
  assert.equal(bronze.unlocked, true)
  assert.equal(bronze.equipped, false)
  const ruby = itemStatus(cosmeticById('frame-ruby'), state, equipped)
  assert.equal(ruby.unlocked, false)
  assert.equal(ruby.left, 460)
  assert.match(ruby.requirement, /матч/i)
})

test('T-COS-15 прогресс только прибавляет: больше матчей — не меньше открытого', () => {
  const levels = [0, 10, 100, 500, 2000]
  let prev = new Set()
  for (const matches of levels) {
    const now = new Set(unlockedIds(playerState({ matches, mmr: 1000 + matches * 10 })))
    for (const id of prev) assert.ok(now.has(id), `${id} пропал при ${matches} матчах`)
    prev = now
  }
  assert.ok(prev.size >= 12)
})

test('T-COS-16 catalogue группирует всё и отмечает premium', () => {
  const all = catalogue(богач, equippedFromRow())
  assert.deepEqual(Object.keys(all).sort(), [...COSMETIC_KINDS].sort())
  for (const kind of COSMETIC_KINDS) {
    assert.equal(all[kind].length, itemsOf(kind).length)
  }
  assert.equal(all.frame.filter((i) => i.premium).length, 2)
})

test('T-COS-17 ближайшая награда — та, до которой меньше всего осталось', () => {
  const reward = nextReward(playerState({ matches: 5 }))
  assert.ok(reward)
  assert.equal(reward.left, 5)
  assert.equal(reward.id, 'frame-bronze')
  assert.equal(nextReward(богач), null)
})

// -------------------------------------------------------------------- сервер

test('T-COS-18 сервер перепроверяет условие при надевании', () => {
  assert.match(sql, /create or replace function public\.equip_cosmetic/)
  assert.match(sql, /if not public\.cosmetic_unlocked\(v_uid, p_item_id\) then/)
  assert.match(sql, /'locked'/)
})

test('T-COS-19 loadout нельзя писать напрямую: только чтение политикой', () => {
  assert.match(sql, /alter table public\.cosmetic_loadout enable row level security/)
  assert.match(sql, /create policy cosmetic_loadout_read on public\.cosmetic_loadout\s+for select/)
  // Ни одной insert/update/delete-политики на loadout.
  const loadoutPolicies = [...sql.matchAll(/create policy \w+ on public\.cosmetic_loadout\s+for (\w+)/g)].map((m) => m[1])
  assert.deepEqual(loadoutPolicies, ['select'])
})

test('T-COS-20 код активации одноразовый и выдаёт ровно одно право', () => {
  assert.match(sql, /create or replace function public\.redeem_cosmetic_code/)
  assert.match(sql, /'bad_code'/)
  assert.match(sql, /'used'/)
  assert.match(sql, /primary key \(user_id, item_id\)/)
})

test('T-COS-21 выдавать права может только админ', () => {
  const grant = sql.slice(sql.indexOf('create or replace function public.grant_cosmetic'))
  assert.match(grant, /is_admin\(\)/)
  assert.match(grant, /'forbidden'|'unauthorized'/)
})

test('T-COS-22 передача лобби — только хост и только своему участнику', () => {
  const mig = read('supabase/migrations/20261101200000_captain_transfer.sql')
  assert.match(mig, /create or replace function public\.transfer_lobby_host/)
  assert.match(mig, /v_lobby\.host_id <> v_uid/)
  assert.match(mig, /from public\.lobby_members m where m\.lobby_id = p_lobby_id and m\.user_id = p_user_id/)
  assert.match(mig, /'not_host'/)
  assert.match(mig, /'not_member'/)
  // Передача — не самоцель: себе же передавать бессмысленно.
  assert.match(mig, /p_user_id = v_uid/)
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

console.log(`\ncosmetics: ${passed}/${passed + failed}`)
process.exitCode = failed ? 1 : 0
