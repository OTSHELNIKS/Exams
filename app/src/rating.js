// Рейтинг и титулы: логика без React, чтобы её можно было проверить тестами.
//
// Потолка у шкалы нет намеренно. Пользователь сформулировал это так: если дать
// людям 10 уровней, на десятом они перестанут расти. Поэтому цвет меняется
// каждые ~200 MMR и не заканчивается: выше 3000 идёт «Легенда I…N», и каждая
// ступень требует ещё 300 очков. Останавливаться негде.
//
// Сами очки считает база (public.confirm_match) — здесь только отображение.

export const MMR_START = 1000
export const MMR_FLOOR = 100

// Порог → цвет и подпись. Порядок важен: ищем последний подходящий.
export const MMR_TIERS = [
  { min: 0, id: 'ash', label: 'Пепел', color: '#8d8792' },
  { min: 1000, id: 'steel', label: 'Сталь', color: '#9fb0c4' },
  { min: 1200, id: 'bronze', label: 'Бронза', color: '#b07a4a' },
  { min: 1400, id: 'silver', label: 'Серебро', color: '#c3c8d4' },
  { min: 1600, id: 'gold', label: 'Золото', color: '#ffc83d' },
  { min: 1800, id: 'emerald', label: 'Изумруд', color: '#3fcb7b' },
  { min: 2100, id: 'sapphire', label: 'Сапфир', color: '#4a9cf0' },
  { min: 2400, id: 'amethyst', label: 'Аметист', color: '#a877f0' },
  { min: 2700, id: 'ruby', label: 'Рубин', color: '#f0334f' },
  { min: 3000, id: 'legend', label: 'Легенда', color: '#ff6a1b' },
]

// Выше этой отметки тир «Легенда» продолжается римскими ступенями.
export const LEGEND_MIN = 3000
export const LEGEND_STEP = 300

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

export function parseMmr(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return MMR_START
  return Math.max(MMR_FLOOR, n)
}

// Тир по очкам: id, подпись, цвет, границы и прогресс до следующего.
export function mmrTier(mmr) {
  const pts = parseMmr(mmr)
  let index = 0
  for (let i = 0; i < MMR_TIERS.length; i += 1) {
    if (pts >= MMR_TIERS[i].min) index = i
  }
  const tier = MMR_TIERS[index]
  const next = MMR_TIERS[index + 1] || null

  // У легенды вместо «следующего тира» — следующая ступень.
  if (!next) {
    const step = Math.max(0, Math.floor((pts - LEGEND_MIN) / LEGEND_STEP))
    const base = pts - LEGEND_MIN - step * LEGEND_STEP
    return {
      id: tier.id,
      label: tier.label + ' ' + (ROMAN[Math.min(step, ROMAN.length - 1)] || (step + 1)),
      color: tier.color,
      level: step + 1,
      next: null,
      nextAt: LEGEND_MIN + (step + 1) * LEGEND_STEP,
      toNext: LEGEND_STEP - base,
      progress: Math.round((base / LEGEND_STEP) * 100),
      legend: true,
    }
  }

  const span = next.min - tier.min
  const done = Math.max(0, pts - tier.min)
  return {
    id: tier.id,
    label: tier.label,
    color: tier.color,
    level: index + 1,
    next: next.label,
    nextAt: next.min,
    toNext: Math.max(0, next.min - pts),
    progress: span > 0 ? Math.min(100, Math.round((done / span) * 100)) : 100,
    legend: false,
  }
}

export function mmrColor(mmr) {
  return mmrTier(mmr).color
}

// Титул по месту в рейтинге. То же правило повторяет база во вьюхе
// leaderboard_ranks, поэтому цифра на экране и титул не разъедутся.
export function rankTitle(position) {
  const n = Math.round(Number(position))
  if (!Number.isFinite(n) || n < 1) return ''
  if (n === 1) return 'ТОП-1'
  if (n <= 3) return 'ТОП-3'
  if (n <= 10) return 'ТОП-10'
  return ''
}

export const TITLE_TONE = {
  'ТОП-1': 'gold',
  'ТОП-3': 'silver',
  'ТОП-10': 'bronze',
}

// «+16» / «−12» / «0».
export function formatDelta(delta) {
  const n = Math.round(Number(delta) || 0)
  if (!n) return '0'
  return (n > 0 ? '+' : '−') + Math.abs(n)
}

// Кто капитан: им становится тот, кто собрал лобби. Если хост не в составе —
// берём сильнейшего по MMR, чтобы драфт вообще мог начаться.
export function draftCaptains({ members = [], hostId = null } = {}) {
  const list = (Array.isArray(members) ? members : [])
    .filter((m) => m && m.user_id)
    .slice()
    .sort((a, b) => (parseMmr(b.pts) - parseMmr(a.pts)) || String(a.nick || '').localeCompare(String(b.nick || '')))

  const host = hostId ? list.find((m) => m.user_id === hostId) || null : null
  const rest = list.filter((m) => !host || m.user_id !== host.user_id)

  const captainA = host || rest.shift() || null
  const captainB = rest.shift() || null
  return [captainA, captainB]
}

// Винрейт и КДА из подтверждённого игрового аккаунта — только если они есть.
// Иначе null: выдумывать числа нельзя.
export function playerForm(row = {}) {
  const played = Math.max(0, Number(row.matches_played) || 0)
  const wins = Math.max(0, Math.min(played, Number(row.wins) || 0))
  return {
    played,
    wins,
    losses: Math.max(0, played - wins),
    winrate: played > 0 ? Math.round((wins / played) * 100) : null,
  }
}

// Сколько матчей осталось до достижения (100/500), для шапок и рамок.
export function nextMilestone(played) {
  const n = Math.max(0, Number(played) || 0)
  const goals = [10, 50, 100, 500, 1000]
  const goal = goals.find((g) => n < g)
  return goal ? { goal, left: goal - n, done: false } : { goal: null, left: 0, done: true }
}
