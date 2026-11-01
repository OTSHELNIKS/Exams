// Косметика: рамки, шапки, титулы и цвет ника.
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

export const COSMETIC_KINDS = ['frame', 'hat', 'title', 'color']

export const KIND_LABEL = {
  frame: 'Рамка аватара',
  hat: 'Шапка',
  title: 'Титул',
  color: 'Цвет ника',
}

export const KINDS_TITLE = {
  frame: 'РАМКИ АВАТАРА',
  hat: 'ШАПКИ',
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
    return {
      ok: list.includes(item.id),
      text: 'Коллекционное: покупается на сайте или активируется кодом',
      locked: true,
    }
  },
}

// ------------------------------------------------------------------- каталог

// frame: gradient / border для аватара. hat: глиф рядом с ником. title: текст.
// color: цвет ника. Платные помечаются premium: true — интерфейс показывает их
// в отдельном разделе и никогда не рисует кнопку «купить» внутри приложения.
export const COSMETICS = [
  // ----- рамки
  { id: 'frame-default', kind: 'frame', label: 'Классика', req: { kind: 'always' }, css: 'frame-default' },
  { id: 'frame-verified', kind: 'frame', label: 'Проверенный', req: { kind: 'verified' }, css: 'frame-verified' },
  { id: 'frame-bronze', kind: 'frame', label: 'Бронза', req: { kind: 'matches', value: 10 }, css: 'frame-bronze' },
  { id: 'frame-silver', kind: 'frame', label: 'Серебро', req: { kind: 'matches', value: 100 }, css: 'frame-silver' },
  { id: 'frame-ruby', kind: 'frame', label: 'Рубин', req: { kind: 'matches', value: 500 }, css: 'frame-ruby' },
  { id: 'frame-gold', kind: 'frame', label: 'Золото', req: { kind: 'mmr', value: 1600 }, css: 'frame-gold' },
  { id: 'frame-emerald', kind: 'frame', label: 'Изумруд', req: { kind: 'mmr', value: 1800 }, css: 'frame-emerald' },
  { id: 'frame-neon', kind: 'frame', label: 'Неон', req: { kind: 'entitlement' }, css: 'frame-neon', premium: true },
  { id: 'frame-diamond', kind: 'frame', label: 'Алмаз', req: { kind: 'entitlement' }, css: 'frame-diamond', premium: true },

  // ----- шапки
  { id: 'hat-none', kind: 'hat', label: 'Без шапки', req: { kind: 'always' }, glyph: '' },
  { id: 'hat-rookie', kind: 'hat', label: 'Новобранец', req: { kind: 'matches', value: 10 }, glyph: '🎖' },
  { id: 'hat-veteran', kind: 'hat', label: 'Ветеран', req: { kind: 'matches', value: 100 }, glyph: '🛡' },
  { id: 'hat-legend', kind: 'hat', label: 'Легенда', req: { kind: 'matches', value: 500 }, glyph: '🏆' },
  { id: 'hat-champion', kind: 'hat', label: 'Чемпион', req: { kind: 'wins', value: 50 }, glyph: '👑' },
  { id: 'hat-top', kind: 'hat', label: 'Вершина', req: { kind: 'mmr', value: 2500 }, glyph: '💠' },
  { id: 'hat-crown', kind: 'hat', label: 'Корона фаундера', req: { kind: 'entitlement' }, glyph: '🜲', premium: true },
  { id: 'hat-halo', kind: 'hat', label: 'Неоновый ореол', req: { kind: 'entitlement' }, glyph: '✨', premium: true },

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
  hat: 'hat-none',
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
    hat: (row && row.hat_id) || DEFAULTS.hat,
    title: (row && row.title_id) || DEFAULTS.title,
    color: (row && row.color_id) || DEFAULTS.color,
  }
}

// Состояние игрока для проверки условий. Всё, кроме entitlements, приходит из
// базы: подделать в браузере нельзя, сервер всё равно перепроверит.
export function playerState({ verified = false, matches = 0, wins = 0, mmr = 1000, entitlements = [] } = {}) {
  return { verified: Boolean(verified), matches: Number(matches) || 0, wins: Number(wins) || 0, mmr: Number(mmr) || 1000, entitlements }
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
  const hat = pick('hat')
  const title = pick('title')
  const color = pick('color')
  return {
    frameId: frame ? frame.id : DEFAULTS.frame,
    frameClass: frame && frame.css ? frame.css : 'frame-default',
    hatGlyph: hat && hat.glyph ? hat.glyph : '',
    hatId: hat ? hat.id : DEFAULTS.hat,
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
    .filter((x) => !x.req.ok && Number.isFinite(x.req.left))
    .sort((a, b) => a.req.left - b.req.left)
  const first = locked[0]
  return first ? { id: first.item.id, label: first.item.label, kind: first.item.kind, left: first.req.left, text: first.req.text } : null
}

// Оформление другого игрока: сервер уже проверил условие при надевании
// (equip_cosmetic), поэтому здесь перепроверять нечего — просто рисуем.
export function lookFromRow(row) {
  const src = row || {}
  const frame = cosmeticById(src.frame_id) || cosmeticById(DEFAULTS.frame)
  const hat = cosmeticById(src.hat_id) || cosmeticById(DEFAULTS.hat)
  const title = cosmeticById(src.title_id) || cosmeticById(DEFAULTS.title)
  const color = cosmeticById(src.color_id) || cosmeticById(DEFAULTS.color)
  return {
    frameId: frame.id,
    frameClass: frame.css || 'frame-default',
    hatGlyph: hat.glyph || '',
    hatId: hat.id,
    titleText: title.value || '',
    colorValue: color.value || '#f4f1ea',
    tierColor: '',
  }
}
