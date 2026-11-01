// Оформление профиля: рамки аватара, шапки (баннеры), рамки имени, титулы и
// цвет ника.
//
// Правила, которые заложены здесь и проверяются тестами:
//   • бесплатное открывается только за то, что реально считается на сервере
//     (подтверждённый игровой аккаунт, подтверждённые матчи, MMR, победы);
//   • платное и коллекционное приходит правом (entitlement): оплата на сайте
//     или код активации — внутри приложения ничего не продаётся;
//   • в каталоге нет «просто так»: у каждого предмета либо условие, либо право.
//
// Тот же список id лежит в базе (таблица cosmetic_items), чтобы серверная
// проверка при надевании не разъехалась с интерфейсом. Совпадение проверяет
// tests/cosmetics.test.mjs.

import { mmrTier } from './rating.js'

export const COSMETIC_KINDS = ['frame', 'banner', 'nameplate', 'title', 'color']

export const KIND_LABEL = {
  frame: 'Рамка',
  banner: 'Шапка профиля',
  nameplate: 'Рамка имени',
  title: 'Титул',
  color: 'Цвет ника',
}

export const KINDS_TITLE = {
  frame: 'РАМКИ АВАТАРА',
  banner: 'ШАПКИ ПРОФИЛЯ',
  nameplate: 'РАМКИ ИМЕНИ',
  title: 'ТИТУЛЫ',
  color: 'ЦВЕТ НИКА',
}

// ------------------------------------------------------------------ условия

export const REQ = {
  always: (item) => ({ ok: true, text: 'Доступно всем' }),
  verified: (item, state) => ({
    ok: Boolean(state.verified),
    text: 'Подтверди игровой аккаунт кодом из MLBB',
    left: state.verified ? 0 : 1,
  }),
  matches: (item, state) => {
    const need = item.req.value
    const have = Math.max(0, Number(state.matches) || 0)
    return { ok: have >= need, text: `Сыграно ${need} матчей на платформе`, left: Math.max(0, need - have) }
  },
  wins: (item, state) => {
    const need = item.req.value
    const have = Math.max(0, Number(state.wins) || 0)
    return { ok: have >= need, text: `Побед: ${need}`, left: Math.max(0, need - have) }
  },
  mmr: (item, state) => {
    const need = item.req.value
    const have = Math.max(0, Number(state.mmr) || 0)
    return { ok: have >= need, text: `Дойти до ${need} MMR`, left: Math.max(0, need - have) }
  },
  entitlement: (item, state) => {
    const list = Array.isArray(state.entitlements) ? state.entitlements : []
    // Админу платное доступно без покупки — сервер считает так же.
    if (state.admin) {
      return { ok: true, text: 'Доступно админу', left: 0, admin: true }
    }
    return {
      ok: list.includes(item.id),
      text: item && item.media
        ? 'Своё оформление: покупка на сайте или код активации'
        : 'Коллекционное: покупается на сайте или активируется кодом',
      locked: true,
    }
  },
}

// ------------------------------------------------------------------- каталог

// frame: палитра + уровень орнамента для рамки (рисует frames.jsx).
// nameplate: css-класс рамки вокруг ника + shine (анимированный блеск).
//   Рамка может отсутствовать (`noFrame`) — тогда переливается сам текст:
//   так сделан «Золотой ник», как золотая плашка имени в MLBB без подложки.
// banner: css-класс шапки профиля (градиент-полоса над аватаром, как в Discord).
// title: текст под ником. color: цвет ника. Платные помечаются premium: true —
// интерфейс показывает их, но никогда не рисует кнопку «купить» в приложении.
export const COSMETICS = [
  // ----- рамки аватара: палитра + мотив (у каждой своя форма, см. frames.jsx)
  { id: 'frame-default', kind: 'frame', label: 'Классика', req: { kind: 'always' }, palette: 'steel', motif: 'classic' },
  { id: 'frame-verified', kind: 'frame', label: 'Крылья', req: { kind: 'verified' }, palette: 'azure', motif: 'wings' },
  { id: 'frame-bronze', kind: 'frame', label: 'Корона', req: { kind: 'matches', value: 10 }, palette: 'bronze', motif: 'crest' },
  { id: 'frame-silver', kind: 'frame', label: 'Щит', req: { kind: 'matches', value: 100 }, palette: 'silver', motif: 'shield' },
  { id: 'frame-ruby', kind: 'frame', label: 'Рога', req: { kind: 'matches', value: 500 }, palette: 'ruby', motif: 'horns' },
  { id: 'frame-gold', kind: 'frame', label: 'Лавр', req: { kind: 'mmr', value: 1600 }, palette: 'gold', motif: 'laurel' },
  { id: 'frame-emerald', kind: 'frame', label: 'Пламя', req: { kind: 'mmr', value: 1800 }, palette: 'emerald', motif: 'flame' },
  { id: 'frame-neon', kind: 'frame', label: 'Контур', req: { kind: 'entitlement' }, palette: 'neon', motif: 'circuit', premium: true },
  { id: 'frame-diamond', kind: 'frame', label: 'Кристалл', req: { kind: 'entitlement' }, palette: 'diamond', motif: 'crystal', premium: true },

  // ----- шапки профиля: полоса-баннер над аватаром, как в Discord
  { id: 'banner-none', kind: 'banner', label: 'Без шапки', req: { kind: 'always' }, css: 'pbanner-none' },
  { id: 'banner-ember', kind: 'banner', label: 'Закат', req: { kind: 'always' }, css: 'pbanner-ember' },
  { id: 'banner-verified', kind: 'banner', label: 'Проверенный', req: { kind: 'verified' }, css: 'pbanner-verified' },
  { id: 'banner-bronze', kind: 'banner', label: 'Бронза', req: { kind: 'matches', value: 10 }, css: 'pbanner-bronze' },
  { id: 'banner-legend', kind: 'banner', label: 'Легенда', req: { kind: 'matches', value: 500 }, css: 'pbanner-legend' },
  { id: 'banner-gold', kind: 'banner', label: 'Золото', req: { kind: 'mmr', value: 1600 }, css: 'pbanner-gold' },
  { id: 'banner-emerald', kind: 'banner', label: 'Изумруд', req: { kind: 'mmr', value: 1800 }, css: 'pbanner-emerald' },
  { id: 'banner-neon', kind: 'banner', label: 'Неон', req: { kind: 'entitlement' }, css: 'pbanner-neon', premium: true },
  { id: 'banner-aurora', kind: 'banner', label: 'Аврора', req: { kind: 'entitlement' }, css: 'pbanner-aurora', premium: true },
  // Своё оформление: картинка и анимация (GIF/WebP). Только за право — это платный контент.
  { id: 'banner-photo', kind: 'banner', label: 'Своя картинка', req: { kind: 'entitlement' }, media: 'image', premium: true },
  { id: 'banner-motion', kind: 'banner', label: 'Анимация', req: { kind: 'entitlement' }, media: 'animated', premium: true },

  // ----- рамки имени: вокруг ника, с бегущим бликом (shine) или без него
  { id: 'plate-none', kind: 'nameplate', label: 'Без рамки', req: { kind: 'always' }, css: '', noFrame: true, shine: false },
  // Матовая, без анимации — для тех, кому блеск мешает читать ник.
  { id: 'plate-steel', kind: 'nameplate', label: 'Сталь', req: { kind: 'matches', value: 100 }, css: 'plate-steel', shine: false },
  { id: 'plate-gold', kind: 'nameplate', label: 'Золото', req: { kind: 'entitlement' }, css: 'plate-gold', shine: true, premium: true },
  // Без рамки: только золотой переливающийся ник.
  { id: 'plate-gold-nick', kind: 'nameplate', label: 'Золотой ник', req: { kind: 'entitlement' }, css: 'plate-gold-nick', noFrame: true, shine: true, premium: true },
  { id: 'plate-emerald', kind: 'nameplate', label: 'Изумруд', req: { kind: 'entitlement' }, css: 'plate-emerald', shine: true, premium: true },
  { id: 'plate-ice', kind: 'nameplate', label: 'Иней', req: { kind: 'entitlement' }, css: 'plate-ice', shine: true, premium: true },
  { id: 'plate-crimson', kind: 'nameplate', label: 'Багрянец', req: { kind: 'entitlement' }, css: 'plate-crimson', shine: true, premium: true },
  { id: 'plate-aurora', kind: 'nameplate', label: 'Аврора', req: { kind: 'entitlement' }, css: 'plate-aurora', shine: true, premium: true },

  // ----- титулы
  { id: 'title-none', kind: 'title', label: 'Без титула', req: { kind: 'always' }, value: '' },
  { id: 'title-verified', kind: 'title', label: 'Проверенный', req: { kind: 'verified' }, value: 'ПРОВЕРЕН' },
  { id: 'title-veteran', kind: 'title', label: 'Ветеран', req: { kind: 'matches', value: 100 }, value: 'ВЕТЕРАН' },
  { id: 'title-legend', kind: 'title', label: 'Легенда', req: { kind: 'matches', value: 500 }, value: 'ЛЕГЕНДА' },
  { id: 'title-pioneer', kind: 'title', label: 'Первопроходец', req: { kind: 'entitlement' }, value: 'ПЕРВОПРОХОДЕЦ', premium: true },

  // ----- цвет ника (значения совпадают с CSS-переменными)
  { id: 'color-default', kind: 'color', label: 'Белый', req: { kind: 'always' }, value: '#f4f1ea' },
  { id: 'color-orange', kind: 'color', label: 'Фирменный', req: { kind: 'always' }, value: '#ff6a1b' },
  { id: 'color-gold', kind: 'color', label: 'Золото', req: { kind: 'mmr', value: 1600 }, value: '#ffc83d' },
  { id: 'color-emerald', kind: 'color', label: 'Изумруд', req: { kind: 'mmr', value: 1800 }, value: '#3fcb7b' },
  { id: 'color-neon', kind: 'color', label: 'Неон', req: { kind: 'entitlement' }, value: '#39f0ff', premium: true },
]

export const DEFAULTS = {
  frame: 'frame-default',
  banner: 'banner-none',
  nameplate: 'plate-none',
  title: 'title-none',
  color: 'color-default',
}

export function itemsOf(kind) {
  return COSMETICS.filter((item) => item.kind === kind)
}

export function cosmeticById(id) {
  return COSMETICS.find((item) => item.id === id) || null
}

export function equippedFromRow(row) {
  return {
    frame: (row && row.frame_id) || DEFAULTS.frame,
    banner: (row && row.banner_id) || DEFAULTS.banner,
    // Своя картинка/анимация шапки: адрес в нашем хранилище, не чужая ссылка.
    bannerUrl: (row && row.banner_url) || '',
    nameplate: (row && row.plate_id) || DEFAULTS.nameplate,
    title: (row && row.title_id) || DEFAULTS.title,
    color: (row && row.color_id) || DEFAULTS.color,
  }
}

// Состояние игрока для проверки условий. Всё, кроме entitlements, приходит из
// базы: подделать в браузере нельзя, сервер всё равно перепроверит.
export function playerState({ verified = false, matches = 0, wins = 0, mmr = 1000, entitlements = [], admin = false } = {}) {
  return {
    verified: Boolean(verified),
    matches: Number(matches) || 0,
    wins: Number(wins) || 0,
    mmr: Number(mmr) || 1000,
    entitlements: Array.isArray(entitlements) ? entitlements : [],
    // Админ видит весь платный контент открытым — так же, как его видит сервер
    // (cosmetic_unlocked). Это только интерфейс: надеть предмет всё равно
    // можно лишь через RPC, где права проверяются заново.
    admin: Boolean(admin),
  }
}

export function requirement(item, state) {
  const rule = REQ[item && item.req && item.req.kind] || REQ.always
  return rule(item, playerState(state))
}

export function isUnlocked(item, state) {
  return requirement(item, state).ok
}

// Что показать в списке: открыто / заперто и насколько близко.
export function itemStatus(item, state, equipped) {
  const st = playerState(state)
  const req = requirement(item, st)
  return {
    id: item.id,
    kind: item.kind,
    label: item.label,
    premium: Boolean(item.premium),
    unlocked: req.ok,
    equipped: item.id === (equipped || {})[item.kind],
    requirement: req.text,
    left: req.left || 0,
    // Платный предмет открыт потому, что игрок админ (в интерфейсе — отдельная подпись).
    adminUnlocked: Boolean(req.admin),
  }
}

export function catalogue(state, equipped) {
  return COSMETIC_KINDS.reduce((acc, kind) => {
    acc[kind] = itemsOf(kind).map((item) => itemStatus(item, state, equipped))
    return acc
  }, {})
}

// Оформление для аватара и ника. Если предмет закрыт (например, рамка на
// 500 матчей, а у игрока их 3) — возвращаем базовый вид, а не «примерку».
export function look(equipped, state = {}) {
  const eq = equipped || DEFAULTS
  const st = playerState(state)
  const pick = (kind) => {
    const item = cosmeticById(eq[kind]) || cosmeticById(DEFAULTS[kind])
    if (!item) return null
    return isUnlocked(item, st) ? item : cosmeticById(DEFAULTS[kind])
  }
  const frame = pick('frame')
  const banner = pick('banner')
  const plate = pick('nameplate')
  const title = pick('title')
  const color = pick('color')
  return {
    frameId: frame ? frame.id : DEFAULTS.frame,
    framePalette: frame && frame.palette ? frame.palette : 'steel',
    frameMotif: frame && frame.motif ? frame.motif : 'classic',
    // Коллекционные рамки переливаются: бегущий блик по орнаменту.
    frameShine: Boolean(frame && frame.premium),
    bannerId: banner ? banner.id : DEFAULTS.banner,
    bannerCss: banner && banner.css ? banner.css : 'pbanner-none',
    // Картинку показываем только если надет предмет, который её разрешает.
    bannerUrl: banner && banner.media && eq.bannerUrl ? eq.bannerUrl : '',
    bannerMedia: banner && banner.media ? banner.media : '',
    plateId: plate ? plate.id : DEFAULTS.nameplate,
    plateCss: plate && plate.css ? plate.css : '',
    plateShine: Boolean(plate && plate.shine),
    plateFrame: Boolean(plate && !plate.noFrame),
    titleText: title && title.value ? title.value : '',
    colorValue: color && color.value ? color.value : '#f4f1ea',
    tierColor: mmrTier(st.mmr).color,
  }
}

// Какие достижения открылись — для списка «что дают за что».
export function unlockedIds(state) {
  const st = playerState(state)
  return COSMETICS.filter((item) => isUnlocked(item, st)).map((item) => item.id)
}

// Следующая награда, до которой ближе всего: мотивация без потолка.
// Считаем только числовой прогресс — «подтверди аккаунт» нельзя измерить
// в «осталось 1», иначе оно вечно висело бы ближайшей наградой.
const COUNTABLE = new Set(['matches', 'wins', 'mmr'])

export function nextReward(state) {
  const st = playerState(state)
  const locked = COSMETICS
    .filter((item) => !item.premium && COUNTABLE.has(item.req.kind))
    .map((item) => ({ item, req: requirement(item, st) }))
    .filter((x) => !x.req.ok && !x.req.admin && Number.isFinite(x.req.left))
    .sort((a, b) => a.req.left - b.req.left)
  const first = locked[0]
  return first ? { id: first.item.id, label: first.item.label, kind: first.item.kind, left: first.req.left, text: first.req.text } : null
}

/** Рамка имени другого игрока: css-класс, блеск и есть ли подложка. */
export function plateOf(row) {
  const item = cosmeticById(row && row.plate_id) || cosmeticById(DEFAULTS.nameplate)
  return { id: item.id, css: item.css || '', shine: Boolean(item.shine), frame: !item.noFrame }
}

/** Рамка другого игрока: палитра и орнамент по id из вьюхи. */
export function frameOf(row) {
  const item = cosmeticById(row && row.frame_id) || cosmeticById(DEFAULTS.frame)
  return { palette: item.palette || 'steel', motif: item.motif || 'classic', id: item.id }
}

// Оформление другого игрока: сервер уже проверил условие при надевании
// (equip_cosmetic), поэтому здесь перепроверять нечего — просто рисуем.
export function lookFromRow(row) {
  const src = row || {}
  const frame = cosmeticById(src.frame_id) || cosmeticById(DEFAULTS.frame)
  const banner = cosmeticById(src.banner_id) || cosmeticById(DEFAULTS.banner)
  const plate = cosmeticById(src.plate_id) || cosmeticById(DEFAULTS.nameplate)
  const title = cosmeticById(src.title_id) || cosmeticById(DEFAULTS.title)
  const color = cosmeticById(src.color_id) || cosmeticById(DEFAULTS.color)
  return {
    frameId: frame.id,
    framePalette: frame.palette || 'steel',
    frameMotif: frame.motif || 'classic',
    frameShine: Boolean(frame.premium),
    bannerId: banner.id,
    bannerCss: banner.css || 'pbanner-none',
    bannerUrl: banner.media && src.banner_url ? src.banner_url : '',
    plateId: plate.id,
    plateCss: plate.css || '',
    plateShine: Boolean(plate.shine),
    plateFrame: !plate.noFrame,
    titleText: title.value || '',
    colorValue: color.value || '#f4f1ea',
    tierColor: '',
  }
}
