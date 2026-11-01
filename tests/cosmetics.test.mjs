// NAME MLBB — оформление профиля за достижения.
//
// Проверяем то, что обещано игроку и легко ломается:
//   • каталог в JS и в базе — один и тот же список предметов;
//   • рамка — настоящая (палитра + орнамент), шапка — баннер как в Discord;
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
import { readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const esbuild = (await import(join(root, 'app/node_modules/esbuild/lib/main.js'))).default

const {
  COSMETICS, COSMETIC_KINDS, DEFAULTS, REQ, KIND_LABEL, KINDS_TITLE,
  itemsOf, cosmeticById, equippedFromRow, playerState, requirement,
  isUnlocked, itemStatus, catalogue, look, lookFromRow, unlockedIds, nextReward, frameOf,
} = await import('../app/src/cosmetics.js')
// frames.jsx — JSX, поэтому сначала собираем его esbuild'ом (он есть в app).
const framesBundle = join(root, 'app', '.cosmetics-frames.mjs')
await esbuild.build({
  entryPoints: [join(root, 'app/src/frames.jsx')],
  bundle: true,
  format: 'esm',
  outfile: framesBundle,
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  logLevel: 'silent',
})
const { FRAME_PALETTES, FRAME_ART, FRAME_MOTIFS, safeBannerUrl } = await import(framesBundle)

const sql = read('supabase/migrations/20261101180000_cosmetics.sql')
const bannersSql = read('supabase/migrations/20261101210000_profile_banners.sql')
const mediaSql = read('supabase/migrations/20261101220000_banner_media.sql')
const adminSql = read('supabase/migrations/20261101230000_admin_premium.sql')
const plateSql = read('supabase/migrations/20261101240000_nameplates.sql')

let passed = 0
let failed = 0
const queue = []
function test(name, fn) { queue.push({ name, fn }) }

const никто = playerState({})
const админ = playerState({ admin: true })
const админБезПрогресса = playerState({ admin: true, matches: 0, wins: 0, mmr: 1000, verified: false })
const богач = playerState({ verified: true, matches: 5000, wins: 5000, mmr: 9999 })

// ------------------------------------------------------------------- каталог

test('T-COS-01 каталог: 38 предметов, пять видов, уникальные id', () => {
  assert.equal(COSMETICS.length, 38)
  assert.deepEqual(COSMETIC_KINDS, ['frame', 'banner', 'nameplate', 'title', 'color'])
  const ids = COSMETICS.map((i) => i.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const kind of COSMETIC_KINDS) {
    assert.ok(itemsOf(kind).length > 0, `пусто в ${kind}`)
    assert.ok(KIND_LABEL[kind], `нет подписи вида ${kind}`)
    assert.ok(KINDS_TITLE[kind], `нет заголовка вида ${kind}`)
  }
  assert.equal(
    itemsOf('frame').length + itemsOf('banner').length + itemsOf('nameplate').length
      + itemsOf('title').length + itemsOf('color').length,
    38,
  )
})

test('T-COS-02 рамки: у каждой своя палитра и СВОЯ ФОРМА', () => {
  const motifs = []
  for (const item of itemsOf('frame')) {
    assert.ok(FRAME_PALETTES[item.palette], `${item.id}: нет палитры ${item.palette}`)
    assert.ok(FRAME_MOTIFS.includes(item.motif), `${item.id}: неизвестный мотив ${item.motif}`)
    motifs.push(item.motif)
  }
  // Главное требование: рамки отличаются формой, а не только цветом.
  assert.equal(new Set(motifs).size, motifs.length, 'у двух рамок одинаковый мотив')
  assert.equal(FRAME_MOTIFS.length, 9)
  const palette = itemsOf('frame').map((i) => i.palette)
  assert.equal(new Set(palette).size, palette.length)
  // Мотив id в каталоге совпадает с картой frames.jsx.
  assert.equal(FRAME_ART.default, 'classic')
  assert.equal(cosmeticById('frame-neon').motif, 'circuit')
  assert.equal(cosmeticById('frame-ruby').motif, 'horns')
})

test('T-COS-02b шапка профиля — баннер, а не эмодзи рядом с ником', () => {
  const banners = itemsOf('banner')
  assert.equal(banners.length, 11)
  for (const item of banners) {
    assert.equal(item.glyph, undefined, `${item.id}: у шапки не должно быть глифа`)
    // Либо готовый градиент, либо слот под свой файл (картинка/анимация).
    if (item.media) {
      assert.ok(['image', 'animated'].includes(item.media), `${item.id}: тип ${item.media}`)
      assert.equal(item.premium, true, `${item.id}: своё оформление должно быть платным`)
    } else {
      assert.match(item.css, /^pbanner-[a-z]+$/, `${item.id}: css-класс ${item.css}`)
    }
  }
  assert.deepEqual(banners.filter((b) => b.media).map((b) => b.id), ['banner-photo', 'banner-motion'])
  // Все css-классы шапок описаны в styles.css, иначе шапка будет пустой.
  const css = read('app/src/styles.css')
  for (const item of banners.filter((b) => b.css)) {
    assert.match(css, new RegExp('\\.' + item.css + ' \\{'), `в styles.css нет .${item.css}`)
  }
  assert.equal(DEFAULTS.banner, 'banner-none')
  assert.equal(cosmeticById('banner-none').css, 'pbanner-none')
})

test('T-COS-02c слот шапки в базе называется banner_id', () => {
  assert.match(bannersSql, /rename column hat_id to banner_id/)
  assert.match(bannersSql, /'banner-none'/)
  assert.match(bannersSql, /kind in \('frame', 'banner', 'title', 'color'\)/)
})

// id и условия сверяем по обоим файлам: 27 из первого + 9 шапок из второго.
test('T-COS-02d id и условия в JS совпадают с таблицей cosmetic_items', () => {
  const all = sql + '\n' + bannersSql + '\n' + plateSql
  const rows = [...all.matchAll(/\('([a-z0-9-]+)',\s*'(frame|banner|hat|title|color)',\s*'([^']+)',\s*'(always|verified|matches|wins|mmr|entitlement)',\s*(\d+),\s*(true|false)\)/g)]
    .map((m) => ({ id: m[1], kind: m[2], label: m[3], reqKind: m[4], reqValue: Number(m[5]), premium: m[6] === 'true' }))
    .filter((row) => row.kind !== 'hat')
  assert.ok(rows.length >= 28, `в SQL меньше предметов, чем в JS: ${rows.length}`)
  const byId = new Map(COSMETICS.map((i) => [i.id, i]))
  for (const row of rows) {
    const item = byId.get(row.id)
    assert.ok(item, `предмета ${row.id} нет в JS-каталоге`)
    assert.equal(item.kind, row.kind, `вид ${row.id}`)
    // Названия рамок — наши, в базе они исторические: сверяем только вид и условие.
    if (item.kind !== 'frame') assert.equal(item.label, row.label, `название ${row.id}`)
    assert.equal(item.req.kind, row.reqKind, `условие ${row.id}`)
    assert.equal(item.req.value || 0, row.reqValue, `порог ${row.id}`)
    assert.equal(Boolean(item.premium), row.premium, `premium ${row.id}`)
  }
})

test('T-COS-03 базовое оформление открыто всем и без регистрации', () => {
  for (const kind of COSMETIC_KINDS) {
    assert.ok(isUnlocked(cosmeticById(DEFAULTS[kind]), никто), `базовый ${kind} закрыт`)
  }
  // Без достижений доступны: базовая рамка, две шапки, ник без рамки,
  // цвет белый/фирменный, без титула.
  assert.equal(unlockedIds(никто).length, 7)
})

// ------------------------------------------------------------------ условия

test('T-COS-04 порог матчей: 9 не открывает, 10 открывает', () => {
  const frame = cosmeticById('frame-bronze')
  assert.equal(isUnlocked(frame, playerState({ matches: 9 })), false)
  assert.equal(isUnlocked(frame, playerState({ matches: 10 })), true)
  assert.equal(itemStatus(frame, playerState({ matches: 9 }), equippedFromRow()).left, 1)
})

test('T-COS-05 победы считаются отдельно от матчей', () => {
  // Победный предмет — рамка «Чемпион» для 50 побед (появляется только по wins).
  const champion = COSMETICS.find((i) => i.req.kind === 'wins')
  if (champion) {
    assert.equal(isUnlocked(champion, playerState({ matches: 999, wins: 49 })), false)
    assert.equal(isUnlocked(champion, playerState({ matches: 50, wins: 50 })), true)
  }
  // И в любом случае победы без матчей не открывают предметы «за матчи».
  assert.equal(isUnlocked(cosmeticById('frame-bronze'), playerState({ matches: 0, wins: 999 })), false)
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
  assert.equal(isUnlocked(cosmeticById('frame-emerald'), playerState({ mmr: 1799 })), false)
  assert.equal(isUnlocked(cosmeticById('frame-emerald'), playerState({ mmr: 1800 })), true)
})

test('T-COS-08 коллекционные предметы не открываются прогрессом — только правом', () => {
  const premium = COSMETICS.filter((i) => i.premium)
  assert.equal(premium.length, 14)
  for (const item of premium) {
    assert.equal(isUnlocked(item, богач), false, `${item.id} открылся от матчей`)
    assert.equal(isUnlocked(item, playerState({ ...богач, entitlements: [item.id] })), true, `${item.id} не открылся правом`)
  }
})

test('T-COS-31 админ видит весь платный контент открытым', () => {
  for (const item of COSMETICS.filter((i) => i.premium)) {
    assert.equal(isUnlocked(item, админ), true, `${item.id} закрыт для админа`)
    const status = itemStatus(item, админ, equippedFromRow(null))
    assert.equal(status.adminUnlocked, true, `${item.id}: нет отметки «доступно админу»`)
    assert.equal(status.requirement, 'Доступно админу')
  }
  // Платных предметов четырнадцать — все они доступны без покупки.
  assert.equal(COSMETICS.filter((i) => i.premium).length, 14)
})

test('T-COS-32 админский доступ не подменяет бесплатные условия', () => {
  // Иначе легко выпустить баг, которого у игроков не будет: админ «проходит»
  // матчи, MMR и подтверждение аккаунта, и вёрстка выглядит здоровой.
  for (const item of COSMETICS.filter((i) => !i.premium)) {
    assert.equal(
      isUnlocked(item, админБезПрогресса),
      isUnlocked(item, playerState({})),
      `${item.id}: админ получил бесплатный предмет без условия`,
    )
  }
  assert.equal(isUnlocked(cosmeticById('frame-gold'), админБезПрогресса), false)
  assert.equal(isUnlocked(cosmeticById('frame-verified'), админБезПрогресса), false)
})

test('T-COS-33 админский флаг есть только у админа, и он не про деньги', () => {
  assert.equal(никто.admin, false)
  assert.equal(админ.admin, true)
  // Обычный игрок без прав по-прежнему видит платное закрытым.
  for (const item of COSMETICS.filter((i) => i.premium)) {
    assert.equal(isUnlocked(item, никто), false)
  }
})

test('T-COS-34 админу не предлагают купить то, что и так доступно', () => {
  // Ближайшая награда — только про прогресс, платное туда не подмешивается.
  const reward = nextReward(админБезПрогресса)
  assert.ok(reward)
  assert.equal(COSMETICS.find((i) => i.id === reward.id).premium, undefined)
  assert.equal(nextReward(playerState({ admin: true, matches: 5000, wins: 5000, mmr: 9999, verified: true })), null)
})

test('T-COS-35 сервер пускает админа к платному и закрепляет право', () => {
  assert.match(adminSql, /create or replace function public\.is_admin_user\(p_user_id uuid\)/)
  assert.match(adminSql, /from public\.admins a where a\.user_id = p_user_id/)
  // В условии платного предмета админ идёт первым.
  assert.match(adminSql, /when 'entitlement' then public\.is_admin_user\(p_user_id\) or exists/)
  // При надевании право реально записывается — предмет остаётся у админа.
  assert.match(adminSql, /insert into public\.entitlements \(user_id, item_id, source\)\s+values \(v_uid, p_item_id, 'admin'\)/)
  // И своя шапка тоже.
  assert.match(adminSql, /function public\.equip_banner_media/)
  // Одно нажатие — все платные предметы.
  assert.match(adminSql, /function public\.admin_grant_all_premium\(\)/)
  assert.match(adminSql, /if not public\.is_admin_user\(v_uid\) then[\s\S]{0,80}'forbidden'/)
  assert.match(adminSql, /where i\.premium/)
})

test('T-COS-36 выдать себе платное может только админ', () => {
  const fn = adminSql.slice(adminSql.indexOf('function public.admin_grant_all_premium'))
  assert.match(fn, /is_admin_user\(v_uid\)/)
  assert.match(fn, /'forbidden'/)
  assert.match(fn, /revoke all on function public\.admin_grant_all_premium\(\) from anon/)
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
  const хочу = equippedFromRow({ frame_id: 'frame-ruby', banner_id: 'banner-legend', title_id: 'title-legend', color_id: 'color-gold' })
  const shown = look(хочу, playerState({ matches: 3, mmr: 1010 }))
  assert.equal(shown.framePalette, 'steel')
  assert.equal(shown.frameMotif, 'classic')
  assert.equal(shown.bannerCss, 'pbanner-none')
  assert.equal(shown.bannerUrl, '')
  assert.equal(shown.titleText, '')
  assert.equal(shown.colorValue, cosmeticById('color-default').value)
})

test('T-COS-12 открытый предмет рисуется как выбран', () => {
  const state = playerState({ matches: 500, mmr: 2000 })
  const shown = look(equippedFromRow({ frame_id: 'frame-ruby', banner_id: 'banner-legend', title_id: 'title-legend', color_id: 'color-emerald' }), state)
  assert.equal(shown.framePalette, 'ruby')
  assert.equal(shown.frameMotif, 'horns')
  assert.equal(shown.bannerCss, 'pbanner-legend')
  assert.equal(shown.titleText, 'ЛЕГЕНДА')
  assert.equal(shown.colorValue, '#3fcb7b')
  assert.equal(shown.tierColor, '#3fcb7b')
})

test('T-COS-13 lookFromRow рисует оформление другого игрока как есть', () => {
  const other = lookFromRow({ frame_id: 'frame-neon', banner_id: 'banner-neon', title_id: 'title-pioneer', color_id: 'color-neon' })
  assert.equal(other.framePalette, 'neon')
  assert.equal(other.frameMotif, 'circuit')
  assert.equal(other.bannerCss, 'pbanner-neon')
  assert.equal(other.titleText, 'ПЕРВОПРОХОДЕЦ')
  assert.equal(other.colorValue, '#39f0ff')
  // Пустая строка (игрок ничего не надевал) — базовый вид, без падений.
  assert.equal(lookFromRow({}).framePalette, 'steel')
  assert.equal(lookFromRow(null).framePalette, 'steel')
  // Таблица лидеров берёт рамку тем же способом.
  assert.deepEqual(frameOf({ frame_id: 'frame-gold' }), { palette: 'gold', motif: 'laurel', id: 'frame-gold' })
  assert.equal(frameOf({}).palette, 'steel')
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
  assert.equal(all.banner.filter((i) => i.premium).length, 4)
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

// --------------------------------------------- где живёт оформление в приложении

test('T-COS-23 оформление — часть профиля, а не отдельный раздел', () => {
  const app = read('app/src/App.jsx')
  // В навигации (SCREENS) раздела «косметика/оформление» быть не должно.
  const screensBlock = app.slice(app.indexOf('const SCREENS'), app.indexOf(']', app.indexOf('const SCREENS')))
  assert.doesNotMatch(screensBlock, /cosmetics|Косметика|Оформление/, 'оформление снова стало отдельным разделом')
  // Зато из профиля оно открывается, и назад ведёт в профиль.
  assert.match(app, /onCosmetics=\{\(\) => go\('cosmetics'\)\}/)
  assert.match(app, /case 'cosmetics':/)
  assert.match(app, /<AppearanceScreen[\s\S]{0,400}onBack=\{\(\) => go\('profile'\)\}/)
})

test('T-COS-24 слово «косметика» из интерфейса убрано, профиль — карточка с шапкой', () => {
  const screens = read('app/src/screens.jsx')
  assert.match(screens, /Оформление профиля/)
  // Заголовков «Косметика» в интерфейсе больше нет.
  assert.doesNotMatch(screens, /title="Косметика"/)
  assert.doesNotMatch(screens, />\s*Косметика\s*</)
  assert.doesNotMatch(screens, /КОСМЕТИКА И ТИТУЛЫ/)
  // Карточка профиля — общий компонент PlayerCard: баннер сверху и рамка на
  // аватаре. Он же рисует главную и чужую карточку, поэтому вид один.
  assert.match(screens, /export function PlayerCard/)
  assert.match(screens, /<PlayerCard\b/)
  assert.match(screens, /<ProfileBanner css=\{look \? look\.bannerCss : 'pbanner-none'\}/)
  assert.match(screens, /frame=\{look \? look\.framePalette : null\}/)
  assert.match(screens, /frameMotif=\{look \? look\.frameMotif : 'classic'\}/)
})

test('T-COS-25 в профиле и в таблице лидеров нет эмодзи-шапок', () => {
  const screens = read('app/src/screens.jsx')
  assert.doesNotMatch(screens, /hatGlyph|hat_id|avatar__hat|className="cosmetic-card__hat"/)
  const css = read('app/src/styles.css')
  assert.doesNotMatch(css, /\.avatar__hat/)
  // А рамка рисуется вектором — в разметке это ProfileFrame, а не CSS-кольцо.
  assert.match(screens, /<ProfileFrame\b/)
  assert.doesNotMatch(css, /\.frame-neon/)
})

// ------------------------------------------------ рамка имени и блеск

test('T-COS-37 рамка имени: разные плашки, с блеском и без, рамка и без рамки', () => {
  const plates = itemsOf('nameplate')
  assert.equal(plates.length, 8)
  const ids = plates.map((i) => i.id).join(',')
  assert.equal(ids, 'plate-none,plate-steel,plate-gold,plate-gold-nick,plate-emerald,plate-ice,plate-crimson,plate-aurora')

  // 1. Есть варианты с блеском и намеренно без него — блеск не должен быть
  //    обязательным: кому-то он мешает читать ник.
  assert.ok(plates.some((p) => p.shine === false && p.id !== 'plate-none'), 'нет варианта без блеска')
  assert.ok(plates.filter((p) => p.shine).length >= 5, 'мало вариантов с блеском')

  // 2. Есть рамка и есть «только золотой ник» без подложки — как в MLBB.
  assert.ok(plates.some((p) => p.noFrame && p.shine), 'нет переливающегося ника без рамки')
  assert.ok(plates.some((p) => !p.noFrame && p.css), 'нет плашки-рамки')

  // 3. У каждой плашки свой css-класс, иначе варианты выглядели бы одинаково.
  const css = plates.filter((p) => p.css).map((p) => p.css)
  assert.equal(new Set(css).size, css.length, 'у двух рамок имени один класс')

  // 4. Бесплатно — только «без рамки» и матовая «Сталь» за 100 матчей.
  for (const p of plates) {
    if (p.premium) assert.equal(p.req.kind, 'entitlement', `${p.id}: платное должно открываться правом`)
  }
  assert.equal(isUnlocked(cosmeticById('plate-steel'), playerState({ matches: 99 })), false)
  assert.equal(isUnlocked(cosmeticById('plate-steel'), playerState({ matches: 100 })), true)
})

test('T-COS-38 все плашки и анимации описаны в styles.css', () => {
  const css = read('app/src/styles.css')
  for (const item of itemsOf('nameplate').filter((p) => p.css)) {
    assert.ok(css.includes('.' + item.css), `в styles.css нет .${item.css}`)
  }
  // Перелив текста и бегущий блик — реальные анимации, а не «обещание».
  assert.match(css, /@keyframes nickFlow/)
  assert.match(css, /@keyframes nickGleam/)
  assert.match(css, /\.nick--shine \.nick__text[\s\S]{0,200}animation: nickFlow/)
  // Блеск коллекционных рамок — внутри SVG, чтобы масштабировался с аватаром.
  assert.match(css, /\.pframe__shine/)
  // И всё это выключается для тех, кому анимация мешает.
  assert.match(css, /prefers-reduced-motion[\s\S]{0,200}\.nick--shine \.nick__text \{ animation: none; \}/)
  assert.match(css, /prefers-reduced-motion[\s\S]{0,120}\.pframe__shine \{ display: none; \}/)
})

test('T-COS-39 в базе есть слот plate_id и вид nameplate', () => {
  assert.match(plateSql, /kind in \('frame', 'banner', 'nameplate', 'title', 'color'\)/)
  assert.match(plateSql, /add column if not exists plate_id text not null default 'plate-none'/)
  // Надевание пишется в свой слот, остальные не трогаются.
  assert.match(plateSql, /plate_id  = case when v_item\.kind = 'nameplate' then v_item\.id else plate_id end/)
  // Вьюхи отдают рамку имени и в профиль, и в таблицу лидеров.
  assert.match(plateSql, /plate_id,\n  title_id,/)
  assert.match(plateSql, /coalesce\(cl\.plate_id, 'plate-none'\) as plate_id/)
  // Плашки из SQL совпадают по виду/условию с каталогом (проверка T-COS-02d).
  assert.match(plateSql, /\('plate-gold-nick',\s*'nameplate',\s*'Золотой ник',\s*'entitlement',\s*0,\s*true\)/)
})

test('T-COS-40 закрытая рамка имени откатывается к «без рамки»', () => {
  const closed = look(equippedFromRow({ plate_id: 'plate-aurora' }), playerState({}))
  assert.equal(closed.plateId, 'plate-none')
  assert.equal(closed.plateCss, '')
  assert.equal(closed.plateShine, false)
  const open = look(equippedFromRow({ plate_id: 'plate-gold' }), playerState({ entitlements: ['plate-gold'] }))
  assert.equal(open.plateCss, 'plate-gold')
  assert.equal(open.plateShine, true)
  assert.equal(open.plateFrame, true)
  const nick = look(equippedFromRow({ plate_id: 'plate-gold-nick' }), playerState({ entitlements: ['plate-gold-nick'] }))
  assert.equal(nick.plateFrame, false, 'у «Золотого ника» не должно быть подложки')
  // Коллекционные рамки аватара переливаются, бесплатные — нет.
  const ne = look(equippedFromRow({ frame_id: 'frame-neon' }), playerState({ entitlements: ['frame-neon'] }))
  assert.equal(ne.frameShine, true)
  assert.equal(look(equippedFromRow({ frame_id: 'frame-gold' }), playerState({ mmr: 2000 })).frameShine, false)
})

test('T-COS-41 рамка имени другого игрока приходит из вьюхи', () => {
  const other = lookFromRow({ plate_id: 'plate-ice', color_id: 'color-neon' })
  assert.equal(other.plateId, 'plate-ice')
  assert.equal(other.plateCss, 'plate-ice')
  assert.equal(other.plateShine, true)
  assert.equal(other.plateFrame, true)
  // Без записи в базе — обычный ник, без падений.
  assert.equal(lookFromRow(null).plateId, 'plate-none')
  // Экраны рисуют ник через NickPlate, а не голым текстом.
  const screens = read('app/src/screens.jsx')
  assert.match(screens, /<NickPlate/)
  assert.match(screens, /lookFromRow\(r\)\.plateCss/)
})

test('T-COS-42 стили ника и плашек объявлены на верхнем уровне', () => {
  // Реальный баг: блок плашек вставился внутрь правила .pbanner-aurora, и все
  // плашки разом потеряли оформление. Поэтому проверяем вложенность, а не
  // только наличие селектора в файле.
  const css = read('app/src/styles.css')
  const lines = css.split('\n')
  let depth = 0
  const nested = []
  for (const line of lines) {
    const trimmed = line.trim()
    const opensRule = trimmed.endsWith('{')
    if (depth > 0 && opensRule && /^\.(nick|pcard|profile-card|pframe)/.test(trimmed)) {
      nested.push(`${depth}: ${trimmed}`)
    }
    // @media тоже должен стоять снаружи: внутри правила он молча ломает стили.
    if (depth > 0 && trimmed.startsWith('@media')) nested.push(`${depth}: ${trimmed}`)
    depth += (line.match(/\{/g) || []).length
    depth -= (line.match(/\}/g) || []).length
  }
  assert.deepEqual(nested, [], 'есть селекторы, вложенные в чужое правило')
  assert.equal(depth, 0, 'скобки в styles.css не сбалансированы')
  // И шапка «Аврора» содержит ровно свои градиенты.
  const aurora = css.slice(css.indexOf('.pbanner-aurora {'), css.indexOf('.pbanner-aurora {') + 400)
  assert.match(aurora, /background:[\s\S]{0,260}linear-gradient\(120deg, #0a2b3a, #140b2e\);/)
})

// -------------------------------------- своя шапка: картинка и анимация

test('T-COS-26 в базе есть bucket для шапок с лимитом и типами файлов', () => {
  assert.match(mediaSql, /insert into storage\.buckets[\s\S]{0,200}'banners'/)
  assert.match(mediaSql, /file_size_limit[\s\S]{0,200}4000000/)
  assert.match(mediaSql, /image\/gif/)
  assert.match(mediaSql, /image\/webp/)
  // Загружать можно только в свою папку — иначе один игрок перезапишет чужой фон.
  assert.match(mediaSql, /storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/)
})

test('T-COS-27 своя шапка: только наш bucket, свой файл и формат под предмет', () => {
  const fn = mediaSql.slice(mediaSql.indexOf('function public.equip_banner_media'), mediaSql.indexOf('function public.clear_banner_media'))
  // Чужой адрес не принимается.
  assert.match(fn, /position\('\/storage\/v1\/object\/public\/banners\/' \|\| v_uid::text \|\| '\/' in v_url\)/)
  assert.match(fn, /'bad_url'/)
  // Анимация — только GIF/WebP, картинка — только растровые форматы.
  // В SQL это регулярка с экранированной точкой — проверяем вхождение строки.
  assert.ok(fn.includes(String.raw`'\.(gif|webp)$'`), 'нет проверки формата анимации')
  assert.ok(fn.includes(String.raw`'\.(jpe?g|png|webp)$'`), 'нет проверки формата картинки')
  assert.match(fn, /'bad_format'/)
  // И только с правом: своё оформление платное.
  assert.match(fn, /cosmetic_unlocked\(v_uid, p_item_id\)/)
  assert.match(fn, /'locked'/)
})

test('T-COS-28 чужие ссылки не попадают в публичный вид', () => {
  assert.match(mediaSql, /case\s+when banner_url like '%\/storage\/v1\/object\/public\/banners\/%' then banner_url\s+else ''\s+end as banner_url/)
  assert.match(mediaSql, /add column if not exists banner_url text not null default ''/)
  // Убрать свою картинку можно отдельной функцией.
  assert.match(mediaSql, /function public\.clear_banner_media\(\)/)
})

test('T-COS-29 клиент принимает адрес шапки только из нашего хранилища', () => {
  const own = 'https://yjedqdbwvjvikyixsduw.supabase.co/storage/v1/object/public/banners/u1/b.gif'
  assert.equal(safeBannerUrl(own), own)
  assert.equal(safeBannerUrl('https://evil.example.com/x.gif'), '')
  assert.equal(safeBannerUrl('javascript:alert(1)'), '')
  assert.equal(safeBannerUrl(''), '')
  assert.equal(safeBannerUrl(null), '')
})

test('T-COS-30 своё оформление шапки — только за право, не за прогресс', () => {
  for (const id of ['banner-photo', 'banner-motion']) {
    const item = cosmeticById(id)
    assert.equal(item.req.kind, 'entitlement', `${id}: условие ${item.req.kind}`)
    assert.equal(item.premium, true)
    assert.equal(isUnlocked(item, богач), false, `${id} открылся от матчей`)
    assert.equal(isUnlocked(item, playerState({ ...богач, entitlements: [id] })), true)
  }
})

rmSync(framesBundle, { force: true })

// ------------------------------------------------ рамка имени и блеск

test('T-COS-37 рамка имени: разные плашки, с блеском и без, рамка и без рамки', () => {
  const plates = itemsOf('nameplate')
  assert.equal(plates.length, 8)
  const ids = plates.map((i) => i.id).join(',')
  assert.equal(ids, 'plate-none,plate-steel,plate-gold,plate-gold-nick,plate-emerald,plate-ice,plate-crimson,plate-aurora')

  // 1. Есть варианты с блеском и намеренно без него — блеск не должен быть
  //    обязательным: кому-то он мешает читать ник.
  assert.ok(plates.some((p) => p.shine === false && p.id !== 'plate-none'), 'нет варианта без блеска')
  assert.ok(plates.filter((p) => p.shine).length >= 5, 'мало вариантов с блеском')

  // 2. Есть рамка и есть «только золотой ник» без подложки — как в MLBB.
  assert.ok(plates.some((p) => p.noFrame && p.shine), 'нет переливающегося ника без рамки')
  assert.ok(plates.some((p) => !p.noFrame && p.css), 'нет плашки-рамки')

  // 3. У каждой плашки свой css-класс, иначе варианты выглядели бы одинаково.
  const css = plates.filter((p) => p.css).map((p) => p.css)
  assert.equal(new Set(css).size, css.length, 'у двух рамок имени один класс')

  // 4. Бесплатно — только «без рамки» и матовая «Сталь» за 100 матчей.
  for (const p of plates) {
    if (p.premium) assert.equal(p.req.kind, 'entitlement', `${p.id}: платное должно открываться правом`)
  }
  assert.equal(isUnlocked(cosmeticById('plate-steel'), playerState({ matches: 99 })), false)
  assert.equal(isUnlocked(cosmeticById('plate-steel'), playerState({ matches: 100 })), true)
})

test('T-COS-38 все плашки и анимации описаны в styles.css', () => {
  const css = read('app/src/styles.css')
  for (const item of itemsOf('nameplate').filter((p) => p.css)) {
    assert.ok(css.includes('.' + item.css), `в styles.css нет .${item.css}`)
  }
  // Перелив текста и бегущий блик — реальные анимации, а не «обещание».
  assert.match(css, /@keyframes nickFlow/)
  assert.match(css, /@keyframes nickGleam/)
  assert.match(css, /\.nick--shine \.nick__text[\s\S]{0,200}animation: nickFlow/)
  // Блеск коллекционных рамок — внутри SVG, чтобы масштабировался с аватаром.
  assert.match(css, /\.pframe__shine/)
  // И всё это выключается для тех, кому анимация мешает.
  assert.match(css, /prefers-reduced-motion[\s\S]{0,200}\.nick--shine \.nick__text \{ animation: none; \}/)
  assert.match(css, /prefers-reduced-motion[\s\S]{0,120}\.pframe__shine \{ display: none; \}/)
})

test('T-COS-39 в базе есть слот plate_id и вид nameplate', () => {
  assert.match(plateSql, /kind in \('frame', 'banner', 'nameplate', 'title', 'color'\)/)
  assert.match(plateSql, /add column if not exists plate_id text not null default 'plate-none'/)
  // Надевание пишется в свой слот, остальные не трогаются.
  assert.match(plateSql, /plate_id  = case when v_item\.kind = 'nameplate' then v_item\.id else plate_id end/)
  // Вьюхи отдают рамку имени и в профиль, и в таблицу лидеров.
  assert.match(plateSql, /plate_id,\n  title_id,/)
  assert.match(plateSql, /coalesce\(cl\.plate_id, 'plate-none'\) as plate_id/)
  // Плашки из SQL совпадают по виду/условию с каталогом (проверка T-COS-02d).
  assert.match(plateSql, /\('plate-gold-nick',\s*'nameplate',\s*'Золотой ник',\s*'entitlement',\s*0,\s*true\)/)
})

test('T-COS-40 закрытая рамка имени откатывается к «без рамки»', () => {
  const closed = look(equippedFromRow({ plate_id: 'plate-aurora' }), playerState({}))
  assert.equal(closed.plateId, 'plate-none')
  assert.equal(closed.plateCss, '')
  assert.equal(closed.plateShine, false)
  const open = look(equippedFromRow({ plate_id: 'plate-gold' }), playerState({ entitlements: ['plate-gold'] }))
  assert.equal(open.plateCss, 'plate-gold')
  assert.equal(open.plateShine, true)
  assert.equal(open.plateFrame, true)
  const nick = look(equippedFromRow({ plate_id: 'plate-gold-nick' }), playerState({ entitlements: ['plate-gold-nick'] }))
  assert.equal(nick.plateFrame, false, 'у «Золотого ника» не должно быть подложки')
  // Коллекционные рамки аватара переливаются, бесплатные — нет.
  const ne = look(equippedFromRow({ frame_id: 'frame-neon' }), playerState({ entitlements: ['frame-neon'] }))
  assert.equal(ne.frameShine, true)
  assert.equal(look(equippedFromRow({ frame_id: 'frame-gold' }), playerState({ mmr: 2000 })).frameShine, false)
})

test('T-COS-41 рамка имени другого игрока приходит из вьюхи', () => {
  const other = lookFromRow({ plate_id: 'plate-ice', color_id: 'color-neon' })
  assert.equal(other.plateId, 'plate-ice')
  assert.equal(other.plateCss, 'plate-ice')
  assert.equal(other.plateShine, true)
  assert.equal(other.plateFrame, true)
  // Без записи в базе — обычный ник, без падений.
  assert.equal(lookFromRow(null).plateId, 'plate-none')
  // Экраны рисуют ник через NickPlate, а не голым текстом.
  const screens = read('app/src/screens.jsx')
  assert.match(screens, /<NickPlate/)
  assert.match(screens, /lookFromRow\(r\)\.plateCss/)
})

test('T-COS-42 стили ника и плашек объявлены на верхнем уровне', () => {
  // Реальный баг: блок плашек вставился внутрь правила .pbanner-aurora, и все
  // плашки разом потеряли оформление. Поэтому проверяем вложенность, а не
  // только наличие селектора в файле.
  const css = read('app/src/styles.css')
  const lines = css.split('\n')
  let depth = 0
  const nested = []
  for (const line of lines) {
    const trimmed = line.trim()
    const opensRule = trimmed.endsWith('{')
    if (depth > 0 && opensRule && /^\.(nick|pcard|profile-card|pframe)/.test(trimmed)) {
      nested.push(`${depth}: ${trimmed}`)
    }
    // @media тоже должен стоять снаружи: внутри правила он молча ломает стили.
    if (depth > 0 && trimmed.startsWith('@media')) nested.push(`${depth}: ${trimmed}`)
    depth += (line.match(/\{/g) || []).length
    depth -= (line.match(/\}/g) || []).length
  }
  assert.deepEqual(nested, [], 'есть селекторы, вложенные в чужое правило')
  assert.equal(depth, 0, 'скобки в styles.css не сбалансированы')
  // И шапка «Аврора» содержит ровно свои градиенты.
  const aurora = css.slice(css.indexOf('.pbanner-aurora {'), css.indexOf('.pbanner-aurora {') + 400)
  assert.match(aurora, /background:[\s\S]{0,260}linear-gradient\(120deg, #0a2b3a, #140b2e\);/)
})

// -------------------------------------- своя шапка: картинка и анимация

test('T-COS-26 в базе есть bucket для шапок с лимитом и типами файлов', () => {
  assert.match(mediaSql, /insert into storage\.buckets[\s\S]{0,200}'banners'/)
  assert.match(mediaSql, /file_size_limit[\s\S]{0,200}4000000/)
  assert.match(mediaSql, /image\/gif/)
  assert.match(mediaSql, /image\/webp/)
  // Загружать можно только в свою папку — иначе один игрок перезапишет чужой фон.
  assert.match(mediaSql, /storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/)
})

test('T-COS-27 своя шапка: только наш bucket, свой файл и формат под предмет', () => {
  const fn = mediaSql.slice(mediaSql.indexOf('function public.equip_banner_media'), mediaSql.indexOf('function public.clear_banner_media'))
  // Чужой адрес не принимается.
  assert.match(fn, /position\('\/storage\/v1\/object\/public\/banners\/' \|\| v_uid::text \|\| '\/' in v_url\)/)
  assert.match(fn, /'bad_url'/)
  // Анимация — только GIF/WebP, картинка — только растровые форматы.
  // В SQL это регулярка с экранированной точкой — проверяем вхождение строки.
  assert.ok(fn.includes(String.raw`'\.(gif|webp)$'`), 'нет проверки формата анимации')
  assert.ok(fn.includes(String.raw`'\.(jpe?g|png|webp)$'`), 'нет проверки формата картинки')
  assert.match(fn, /'bad_format'/)
  // И только с правом: своё оформление платное.
  assert.match(fn, /cosmetic_unlocked\(v_uid, p_item_id\)/)
  assert.match(fn, /'locked'/)
})

test('T-COS-28 чужие ссылки не попадают в публичный вид', () => {
  assert.match(mediaSql, /case\s+when banner_url like '%\/storage\/v1\/object\/public\/banners\/%' then banner_url\s+else ''\s+end as banner_url/)
  assert.match(mediaSql, /add column if not exists banner_url text not null default ''/)
  // Убрать свою картинку можно отдельной функцией.
  assert.match(mediaSql, /function public\.clear_banner_media\(\)/)
})

test('T-COS-29 клиент принимает адрес шапки только из нашего хранилища', () => {
  const own = 'https://yjedqdbwvjvikyixsduw.supabase.co/storage/v1/object/public/banners/u1/b.gif'
  assert.equal(safeBannerUrl(own), own)
  assert.equal(safeBannerUrl('https://evil.example.com/x.gif'), '')
  assert.equal(safeBannerUrl('javascript:alert(1)'), '')
  assert.equal(safeBannerUrl(''), '')
  assert.equal(safeBannerUrl(null), '')
})

test('T-COS-30 своё оформление шапки — только за право, не за прогресс', () => {
  for (const id of ['banner-photo', 'banner-motion']) {
    const item = cosmeticById(id)
    assert.equal(item.req.kind, 'entitlement', `${id}: условие ${item.req.kind}`)
    assert.equal(item.premium, true)
    assert.equal(isUnlocked(item, богач), false, `${id} открылся от матчей`)
    assert.equal(isUnlocked(item, playerState({ ...богач, entitlements: [id] })), true)
  }
})

rmSync(framesBundle, { force: true })

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
