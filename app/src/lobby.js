// Лобби по региону: логика без React, чтобы её можно было прогнать тестами.
//
// Честно о границах: MLBB не даёт снаружи управлять матчмейкингом — регион
// привязан к аккаунту, а поиск игры нельзя запрограммировать. Поэтому «кинуть
// на выбранный сервер» невозможно. Зато в игре есть Custom Room: игрок сам
// создаёт комнату (Custom → Create Room → Room ID + пароль), и туда попадают
// только те, кому он передал ID.
//
// Что делает приложение:
//   1. собирает всех в одно лобби с выбранным регионом и кодом приглашения;
//   2. сверяет серверы игроков с сервером хоста (номера наружу не отдаём);
//   3. хост переносит Room ID и пароль из игры — их видят все участники;
//   4. каждый отмечает «я в игре», хост видит, кто ещё не зашёл.
//
// Когда появится автоматизация (своя программа/шлюз), ей достаточно заполнить
// room_id/room_password в строке лобби — остальной интерфейс уже готов.

export const REGIONS = [
  { id: 'ru', label: 'СНГ', hint: 'Серверы 3xxx, 8xxx · RU / CIS' },
  { id: 'eu', label: 'Европа', hint: 'Серверы 2xxx · Europe' },
  { id: 'sea', label: 'Юго-Восточная Азия', hint: 'Серверы 1xxx, 2xxx · SEA' },
  { id: 'na', label: 'Северная Америка', hint: 'Серверы 6xxx · North America' },
  { id: 'sa', label: 'Южная Америка', hint: 'Серверы 7xxx · South America' },
  { id: 'me', label: 'Ближний Восток', hint: 'Серверы 5xxx · MENA' },
  { id: 'jp', label: 'Япония / Корея', hint: 'Серверы 4xxx · JP / KR' },
]

export const LOBBY_CAPACITY = 10
export const ROOM_HINT = 'Custom → Create Room → скопируй Room ID и пароль'

export function isRegion(value) {
  return REGIONS.some((r) => r.id === value)
}

export function regionLabel(value) {
  const found = REGIONS.find((r) => r.id === value)
  return found ? found.label : 'Регион не выбран'
}

export function regionHint(value) {
  const found = REGIONS.find((r) => r.id === value)
  return found ? found.hint : ''
}

// Код приглашения — ровно 6 цифр. Игроки диктуют его голосом в дискорде,
// поэтому пробелы и дефисы при вводе просто выбрасываем.
export function normalizeLobbyCode(raw) {
  return String(raw || '').replace(/\D/g, '').slice(0, 6)
}

export function lobbyCodeValid(code) {
  // Именно шесть цифр: лишние знаки не «срезаем» — иначе игрок с опечаткой
  // попадёт в чужое лобби.
  return /^[0-9]{6}$/.test(String(code || '').trim())
}

// Room ID в MLBB — число, но копируют его по-разному: с пробелами, решёткой
// или как «Room ID: 12345678». Оставляем только цифры (до 12 знаков).
export function normalizeRoomId(raw) {
  return String(raw || '')
    .replace(/^.*?(?:id|номер)\s*[:№]?\s*/i, '')
    .replace(/\D/g, '')
    .slice(0, 12)
}

export function normalizeRoomPassword(raw) {
  return String(raw || '').replace(/\s+/g, '').slice(0, 12)
}

// Разбор ответа функции create_lobby/join_lobby: сервер отдаёт jsonb, но
// клиент Supabase может вернуть и объект, и текст.
export function parseLobbyReply(data) {
  let payload = data
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) } catch { payload = null }
  }
  if (!payload || typeof payload !== 'object') return { error: 'server' }
  if (payload.error) return { error: String(payload.error) }
  if (!payload.lobby_id || !payload.code) return { error: 'server' }
  return {
    lobbyId: payload.lobby_id,
    code: String(payload.code),
    region: payload.region || '',
    status: payload.status || 'open',
  }
}

const ERROR_TEXT = {
  unauthorized: 'Войди в аккаунт, чтобы собирать лобби.',
  bad_region: 'Выбери регион, в котором будете играть.',
  bad_code: 'Код приглашения — шесть цифр.',
  not_found: 'Лобби с таким кодом не нашлось. Проверь цифры.',
  closed: 'Хост закрыл лобби. Попроси у него новый код.',
  code_busy: 'Не удалось выдать код. Попробуй создать лобби ещё раз.',
  full: 'В лобби уже 10 человек — больше в комнату не влезет.',
  server: 'Сервер не ответил. Проверь интернет и попробуй снова.',
}

export function describeLobbyError(code) {
  return ERROR_TEXT[code] || 'Не получилось. Попробуй ещё раз.'
}

// Кого не хватает до полного состава. В MLBB custom room — до 10 человек.
export function lobbyProgress(members = []) {
  const list = Array.isArray(members) ? members.filter(Boolean) : []
  const checked = list.filter((m) => m.checked_in).length
  return {
    total: list.length,
    checked,
    free: Math.max(0, LOBBY_CAPACITY - list.length),
    full: list.length >= LOBBY_CAPACITY,
    allIn: list.length > 0 && checked === list.length,
  }
}

// Сверка серверов. Номера серверов наружу не отдаём (по ним уводят аккаунт),
// поэтому вьюха присылает только флаг same_server относительно хоста.
export function serverMismatch(members = []) {
  const list = Array.isArray(members) ? members : []
  const others = list.filter((m) => m.same_server === false)
  const unknown = list.filter((m) => m.same_server === null || m.same_server === undefined)
  return {
    others,
    unknown,
    ok: others.length === 0,
    message: others.length
      ? `У ${others.length} ${plural(others.length, 'игрока', 'игроков', 'игроков')} другой сервер — в комнату они могут не попасть.`
      : unknown.length
        ? 'Не у всех в профиле указан сервер — сверься до старта.'
        : list.length > 1
          ? 'Все на одном сервере — комната должна найтись.'
          : '',
  }
}

function plural(n, one, few, many) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

// Тексты, которые видит игрок. Вынесены сюда, чтобы их проверяли тесты.
export function lobbyRoomState(lobby) {
  const roomId = normalizeRoomId(lobby && lobby.room_id)
  if (!roomId) {
    return { ready: false, title: 'Комната ещё не создана', text: ROOM_HINT, roomId: '', password: '' }
  }
  return {
    ready: true,
    title: 'Комната в MLBB',
    text: 'Custom → Join Room → введи Room ID',
    roomId,
    password: normalizeRoomPassword(lobby && lobby.room_password),
  }
}

// Приглашение для дискорда/телеграма: код, регион и что делать дальше.
export function lobbyInvite({ code, region }) {
  return [
    `Лобби NAME · ${regionLabel(region)}`,
    `Код приглашения: ${normalizeLobbyCode(code)}`,
    'Открой NAME → Лобби → «Войти по коду».',
  ].join('\n')
}

// Ссылка на лобби внутри приложения (в вебе — обычный адрес сайта).
export function lobbyDeepLink(code) {
  const clean = normalizeLobbyCode(code)
  return clean ? `lobby:${clean}` : ''
}
