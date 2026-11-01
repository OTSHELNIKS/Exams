// NAME MLBB — оформление профиля должно доезжать до всех экранов.
//
// Проверка не по исходникам, а по-настоящему: монтируем экраны в jsdom и
// смотрим, что выбранные рамка, шапка, рамка имени, титул и цвет ника
// действительно нарисованы — на главной, в профиле, в карточке игрока и в
// строке таблицы лидеров.
//
// Почему это отдельный тест: данные для каждого экрана приходят своим путём
// (свой loadout, публичная вьюха, вьюха рейтинга), и раньше рамка в строке
// рейтинга просто не рисовалась, хотя CSS для неё уже был.
//
// Run: node tests/cosmetics-apply.test.mjs   (нужны app/node_modules)
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const app = join(root, 'app')
const nm = join(app, 'node_modules')

let passed = 0
let failed = 0
const queue = []
function test(name, fn) { queue.push({ name, fn }) }

const need = ['react', 'react-dom', 'jsdom', 'esbuild']
const missing = need.filter((pkg) => !existsSync(join(nm, pkg)))
if (missing.length) {
  console.log('SKIP cosmetics-apply: нет app/node_modules (' + missing.join(', ') + ')')
  process.exit(0)
}

const { JSDOM } = await import(join(nm, 'jsdom/lib/api.js'))
const esbuild = (await import(join(nm, 'esbuild/lib/main.js'))).default

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://otshelniks.github.io/Exams/',
  pretendToBeVisual: true,
})
const cssText = readFileSync(join(app, 'src/styles.css'), 'utf8')
const styleEl = dom.window.document.createElement('style')
styleEl.textContent = cssText
dom.window.document.head.appendChild(styleEl)

globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.localStorage = dom.window.localStorage
globalThis.IS_REACT_ACT_ENVIRONMENT = false

const bundle = join(app, '.cosmetics-apply.mjs')
await esbuild.build({
  entryPoints: [join(app, 'src/screens.jsx')],
  bundle: true,
  format: 'esm',
  outfile: bundle,
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'lucide-react'],
  plugins: [{
    name: 'stub-supabase',
    setup(build) {
      build.onResolve({ filter: /supabase\.js$/ }, (args) => (
        args.importer.endsWith('screens.jsx') ? { path: join(here, 'fixtures/supabase-stub.mjs') } : undefined
      ))
    },
  }],
  define: { 'import.meta.env': '{}' },
  logLevel: 'silent',
})

const React = (await import(join(nm, 'react/index.js'))).default
const { createRoot } = await import(join(nm, 'react-dom/client.js'))
const S = await import(bundle)
const stub = globalThis.__stubState
const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))
// Public look is loaded asynchronously; wait for the actual state instead of
// assuming a fixed timer is always enough on a busy CI runner.
async function waitFor(predicate, timeout = 2000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate()) return
    await settle(25)
  }
  throw new Error('асинхронное оформление не загрузилось вовремя')
}
console.error = () => {}

// Оформление, которое выбрал игрок: золотая рамка-лавр, шапка «Закат»,
// золотая плашка имени, титул и свой цвет ника.
const LOOK = {
  frameId: 'frame-gold',
  framePalette: 'gold',
  frameMotif: 'legend',
  frameShine: false,
  bannerId: 'banner-ember',
  bannerCss: 'pbanner-ember',
  bannerUrl: '',
  bannerMedia: '',
  plateId: 'plate-gold',
  plateCss: 'plate-gold',
  plateShine: true,
  plateFrame: true,
  titleText: 'ВЕТЕРАН',
  colorValue: '#ffc83d',
}

const PROFILE = {
  nick: 'QA', level: 4, roles: ['Маг'], regions: ['СНГ'], heroes: ['Тигрил'],
  socials: [], screenshots: [], elo: 1016, rank: 'Легенда',
  matchesPlayed: 120, wins: 70, bio: 'Играю мид',
  gameKda: 2.45, gameWinrate: 58, gameMatches: 120, gameStatsAt: '2026-11-01T10:00:00Z',
  avatarUrl: '',
}

let reactRoot = null
let host = null
async function mount(element) {
  if (reactRoot) { reactRoot.unmount(); host.remove() }
  host = document.createElement('div')
  document.body.appendChild(host)
  reactRoot = createRoot(host)
  reactRoot.render(element)
  await settle()
  return host
}

const baseProps = {
  // null — как в app-boot: иначе VerificationCard полезет в настоящий клиент.
  supabase: null, userId: 'u1', onBack() {}, onReady() {}, onLeaderboard() {},
  onProfile() {}, onLobby() {}, onEquip() {}, onTransferCaptain: async () => {},
  onEdit() {}, onClose() {},
  actions: { goLeaderboard() {}, goDraft() {}, addSlot() {}, addSocial() {}, removeSocial() {} },
}

const has = (sel) => Boolean(document.querySelector(sel))
const text = () => document.body.textContent || ''
const homeProps = { ...baseProps, profile: PROFILE, gameId: '123456789', gameServer: '1234', gameVerified: true }

/** Один и тот же набор проверок для «своей» карточки. */
function assertOwnLook(where) {
  assert.ok(has('.profile-card'), `${where}: нет карточки игрока`)
  const banner = document.querySelector('.profile-card .pbanner')
  assert.ok(banner, `${where}: нет шапки профиля`)
  assert.match(banner.getAttribute('class'), /pbanner-ember/, `${where}: шапка не применилась`)
  assert.equal(banner.style.height, '150px')

  const frame = document.querySelector('.profile-card .pframe')
  assert.ok(frame, `${where}: нет рамки аватара`)
  assert.match(frame.getAttribute('class'), /pframe--gold/, `${where}: палитра рамки не та`)
  assert.match(frame.getAttribute('class'), /pframe--legend/, `${where}: форма рамки не та`)

  const nick = document.querySelector('.profile-card .nick')
  assert.ok(nick, `${where}: нет плашки ника`)
  assert.match(nick.getAttribute('class'), /plate-gold/, `${where}: рамка имени не применилась`)
  assert.match(nick.getAttribute('class'), /nick--shine/, `${where}: нет перелива`)

  assert.match(text(), /ВЕТЕРАН/, `${where}: нет титула`)
  assert.match(text(), /QA/, `${where}: нет ника`)
}

test('T-APPLY-01 главная: рамка, шапка, плашка, титул', async () => {
  await mount(React.createElement(S.HomeScreen, { ...homeProps, look: LOOK }))
  assertOwnLook('главная')
  // Цифры и данные игры тоже на месте — это часть той же карточки.
  assert.match(text(), /Game ID • 123456789/)
  assert.match(text(), /2\.45/)
})

test('T-APPLY-02 профиль: то же оформление, что на главной', async () => {
  await mount(React.createElement(S.ProfileScreen, { ...homeProps, look: LOOK }))
  assertOwnLook('профиль')
  // И кнопка перехода в оформление на месте — оттуда всё это и выбирается.
  assert.match(text(), /Оформление профиля/)
})

test('T-APPLY-03 карточка игрока: оформление из публичной вьюхи', async () => {
  Object.assign(stub, {
    publicProfile: {
      nick: 'RIVAL', rank: 'Мифик', roles: ['Лесник'], regions: ['Европа'], heroes: ['Ланселот'],
      socials: [], bio: 'Лес', pts: 1420,
      game_kda: 3.1, game_winrate: 61, game_matches: 90, game_stats_at: '2026-10-30T10:00:00Z',
      game_verified: true, avatar_url: '',
    },
    publicLook: {
      frame_id: 'frame-gold', banner_id: 'banner-ember', plate_id: 'plate-gold',
      title_id: 'title-veteran', color_id: 'color-gold', banner_url: '',
    },
  })
  await mount(React.createElement(S.PublicProfileModal, { ...baseProps, userId: 'u2', isMe: false }))
  await waitFor(() => document.querySelector('.pbanner')?.classList.contains('pbanner-ember'))

  const banner = document.querySelector('.pbanner')
  assert.ok(banner, 'в карточке нет шапки')
  assert.match(banner.getAttribute('class'), /pbanner-ember/, 'шапка не применилась')
  assert.equal(banner.style.height, '112px')
  const frame = document.querySelector('.pframe')
  assert.ok(frame, 'в карточке нет рамки аватара')
  assert.match(frame.getAttribute('class'), /pframe--legend/, 'форма рамки не та')
  const nick = document.querySelector('.nick')
  assert.match(nick.getAttribute('class'), /plate-gold/, 'рамка имени не применилась')
  assert.match(text(), /ВЕТЕРАН/, 'нет титула')
  assert.match(text(), /3\.1/, 'нет КДА из игры')
  // Сами Game ID чужому игроку не показываем (подпись «видны только владельцу» — можно).
  assert.equal(document.querySelector('.profile__gameid'), null, 'в чужой карточке показан Game ID')
  assert.doesNotMatch(text(), /Game ID • /)
})

test('T-APPLY-04 в строке рейтинга видно рамку, плашку и цвет', async () => {
  Object.assign(stub, {
    leaderboardRows: [
      {
        user_id: 'u2', nick: 'RIVAL', pts: 1420, position: 1, title: 'ТОП-1', avatar_url: '',
        frame_id: 'frame-gold', banner_id: 'banner-ember', plate_id: 'plate-gold',
        title_id: 'title-veteran', color_id: 'color-gold',
      },
      {
        user_id: 'u3', nick: 'NEON', pts: 1350, position: 2, title: '', avatar_url: '',
        frame_id: 'frame-starlight', banner_id: 'banner-neon', plate_id: 'plate-ice',
        title_id: 'title-none', color_id: 'color-neon',
      },
      {
        user_id: 'u4', nick: 'PLAIN', pts: 1300, position: 3, title: '', avatar_url: '',
        frame_id: 'frame-default', banner_id: 'banner-none', plate_id: 'plate-none',
        title_id: 'title-none', color_id: 'color-default',
      },
    ],
  })
  // Таблице нужен «подключённый» сервер (данные берутся из стаба).
  await mount(React.createElement(S.LeaderboardScreen, { ...baseProps, supabase: {}, userId: 'u1' }))

  const rows = Array.from(document.querySelectorAll('.rank-row'))
  assert.equal(rows.length, 3, `строк в таблице: ${rows.length}`)

  const first = rows[0]
  assert.ok(first.querySelector('.pframe--gold.pframe--legend'), 'в строке нет рамки «Лавр»')
  assert.ok(first.querySelector('.nick--plate.plate-gold'), 'в строке нет рамки имени')
  assert.ok(first.querySelector('.tier-title'), 'в строке нет отметки ТОП-1')
  assert.match(first.textContent, /ВЕТЕРАН/, 'в строке нет надетого титула')

  const second = rows[1]
  assert.ok(second.querySelector('.pframe--azure'), 'во второй строке нет коллекционной рамки')
  assert.match(second.querySelector('.pframe').style.backgroundImage, /mlbb-frames\/1-10\.png/)

  // Без оформления — базовая рамка и обычный ник, никакой «примерки».
  const third = rows[2]
  assert.ok(third.querySelector('.pframe--steel'), 'нет базовой рамки')
  assert.equal(third.querySelector('.pframe__shine'), null, 'блеск появился у бесплатной рамки')
  assert.doesNotMatch(third.querySelector('.nick').getAttribute('class'), /nick--plate/)
  // Титула нет — значит и плашки титула нет, а не пустой значок.
  assert.equal(third.querySelector('.rank-title'), null, 'пустой титул нарисован на пустоте')
})

test('T-APPLY-05 без права показывается базовое оформление', async () => {
  // Так выглядит look(), если предмет в базе есть, а условие не выполнено:
  // откат к базовому виду делает cosmetics.js, экран просто рисует.
  await mount(React.createElement(S.HomeScreen, {
    ...homeProps,
    look: {
      ...LOOK,
      frameId: 'frame-default', framePalette: 'steel', frameMotif: 'default', frameShine: false,
      plateId: 'plate-none', plateCss: '', plateShine: false, plateFrame: false,
    },
  }))
  assert.ok(has('.profile-card .pframe--steel'), 'нет базовой рамки')
  assert.equal(document.querySelector('.pframe--gold'), null, 'закрытая рамка всё-таки нарисована')
  assert.doesNotMatch(document.querySelector('.profile-card .nick').getAttribute('class'), /plate-/)
})

test('T-APPLY-06 цвет ника применяется, когда плашки нет', async () => {
  await mount(React.createElement(S.HomeScreen, {
    ...homeProps,
    look: {
      ...LOOK,
      plateId: 'plate-none', plateCss: '', plateShine: false, plateFrame: false,
      colorValue: '#39f0ff',
    },
  }))
  const nick = document.querySelector('.profile-card .nick')
  assert.ok(nick, 'нет ника')
  assert.equal(nick.style.getPropertyValue('--nick-color'), '#39f0ff', 'цвет ника не передан')
  // jsdom не вычисляет var(), поэтому проверяем правило: ник берёт цвет из
  // переменной, которую выставил компонент.
  assert.match(cssText, /\.nick \{[^}]*color: var\(--nick-color/)
})

test('T-APPLY-07 после смены оформления экран показывает новое, а не старое', async () => {
  // Меняем look так, как это делает App после reloadCosmetics: другой набор.
  const changed = {
    ...LOOK,
    frameId: 'frame-neon', framePalette: 'neon', frameMotif: 'glory', frameShine: true,
    bannerId: 'banner-neon', bannerCss: 'pbanner-neon',
    plateId: 'plate-ice', plateCss: 'plate-ice', plateShine: true, plateFrame: true,
    titleText: 'ПЕРВОПРОХОДЕЦ', colorValue: '#39f0ff',
  }
  await mount(React.createElement(S.HomeScreen, { ...homeProps, look: changed }))
  const frame = document.querySelector('.profile-card .pframe')
  assert.match(frame.getAttribute('class'), /pframe--neon/, 'рамка не обновилась')
  assert.match(frame.getAttribute('class'), /pframe--glory/)
  assert.match(frame.style.backgroundImage, /mlbb-frames\/1-08\.png/)
  assert.match(document.querySelector('.profile-card .pbanner').getAttribute('class'), /pbanner-neon/)
  assert.match(document.querySelector('.profile-card .nick').getAttribute('class'), /plate-ice/)
  assert.match(text(), /ПЕРВОПРОХОДЕЦ/)
})

test('T-APPLY-08 своя картинка/GIF шапки видна и на главной, и в карточке', async () => {
  const url = 'https://yjedqdbwvjvikyixsduw.supabase.co/storage/v1/object/public/banners/u2/loop.gif'
  // Своя шапка у себя: адрес приходит из loadout.
  await mount(React.createElement(S.HomeScreen, {
    ...homeProps,
    look: { ...LOOK, bannerCss: 'pbanner-none', bannerUrl: url, bannerMedia: 'animated' },
  }))
  const own = document.querySelector('.profile-card .pbanner')
  assert.match(own.getAttribute('class'), /pbanner--media/, 'на главной нет своей шапки')
  assert.equal(own.querySelector('img').getAttribute('src'), url)

  // И у другого игрока — из публичной вьюхи.
  Object.assign(stub, {
    publicLook: {
      frame_id: 'frame-gold', banner_id: 'banner-motion', plate_id: 'plate-none',
      title_id: 'title-none', color_id: 'color-default', banner_url: url,
    },
  })
  await mount(React.createElement(S.PublicProfileModal, { ...baseProps, userId: 'u2', isMe: false }))
  await waitFor(() => document.querySelector('.pbanner--media img')?.getAttribute('src') === url)
  const other = document.querySelector('.pbanner')
  assert.match(other.getAttribute('class'), /pbanner--media/, 'в карточке нет шапки другого игрока')
  assert.equal(other.querySelector('img').getAttribute('src'), url)
})

test('T-APPLY-09 фото круглое без рамки и в маске под рамкой', async () => {
  const photoProps = { ...homeProps, profile: { ...PROFILE, avatarUrl: 'https://example.com/avatar.jpg' } }
  await mount(React.createElement(S.HomeScreen, { ...photoProps, look: { ...LOOK, frameId: 'frame-none', framePalette: null } }))
  let avatar = document.querySelector('.profile-card .avatar')
  let photo = avatar.querySelector('img')
  assert.equal(avatar.querySelector('.pframe'), null)
  assert.equal(avatar.classList.contains('avatar--ring'), false)
  assert.equal(dom.window.getComputedStyle(photo).borderRadius, '50%')
  await mount(React.createElement(S.HomeScreen, { ...photoProps, look: LOOK }))
  avatar = document.querySelector('.profile-card .avatar')
  photo = avatar.querySelector('img')
  const photoStyle = dom.window.getComputedStyle(photo)
  assert.match(photoStyle.borderRadius, /^0(?:px)?$/)
  assert.equal(photoStyle.width, '100%')
  assert.equal(photoStyle.height, '100%')
  assert.match(avatar.style.getPropertyValue('--avatar-mask'), /mlbb-frame-masks\/1-06\.png/ )
  assert.ok(Number(photoStyle.zIndex) < Number(dom.window.getComputedStyle(avatar.querySelector('.pframe')).zIndex))
})

test('T-APPLY-10 рейтинг уважает выбор без рамки и маску каждой рамки', async () => {
  Object.assign(stub, { leaderboardRows: [
    { user_id: 'u2', nick: 'CIRCLE', pts: 1420, position: 1, frame_id: 'frame-none', avatar_url: 'https://example.com/a.jpg' },
    { user_id: 'u3', nick: 'SQUARE', pts: 1350, position: 2, frame_id: 'frame-starlight', avatar_url: 'https://example.com/b.jpg' },
  ] })
  await mount(React.createElement(S.LeaderboardScreen, { ...baseProps, supabase: {}, userId: 'u1' }))
  const [plain, framed] = document.querySelectorAll('.rank-row')
  assert.equal(plain.querySelector('.pframe'), null)
  assert.equal(dom.window.getComputedStyle(plain.querySelector('.rank-row__picture')).borderRadius, '50%')
  assert.ok(framed.querySelector('.pframe'))
  const picture = dom.window.getComputedStyle(framed.querySelector('.rank-row__picture'))
  assert.match(picture.borderRadius, /^0(?:px)?$/)
  assert.equal(picture.width, '100%')
  assert.match(framed.querySelector('.rank-row__avatar').style.getPropertyValue('--avatar-mask'), /mlbb-frame-masks\/1-10\.png/ )
  assert.ok(Number(picture.zIndex) < Number(dom.window.getComputedStyle(framed.querySelector('.pframe')).zIndex))
})

rmSync(bundle, { force: true })

for (const { name, fn } of queue) {
  try {
    await fn()
    passed += 1
    console.log('PASS', name)
  } catch (e) {
    failed += 1
    console.log('FAIL', name, '—', e.message)
  }
}

console.log(`\ncosmetics-apply: ${passed}/${passed + failed}`)
if (failed) process.exit(1)
