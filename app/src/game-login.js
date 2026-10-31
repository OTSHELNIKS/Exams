// Вход через саму игру: Game ID + сервер + подтверждение владения аккаунтом.
//
// Два канала, оба проверяются на сервере (edge-функция `game-login`):
//   ingame   — код приходит на внутриигровую почту MLBB (основной путь);
//   telegram — код приходит в привязанный Telegram-бот (запасной путь).
//
// Пароль и почта игроку не нужны: сервер выдаёт одноразовую ссылку на сессию,
// клиент меняет её через supabase.auth.verifyOtp.

const FUNCTION = 'game-login'

export const GAME_CHANNELS = {
  ingame: { id: 'ingame', label: 'На внутриигровую почту', short: 'в игре' },
  telegram: { id: 'telegram', label: 'В Telegram-бота', short: 'в Telegram' },
}

function actionUrl(action) {
  const fromWindow = typeof window !== 'undefined' ? window.__NAME_SUPABASE_URL__ : ''
  const fromEnv = import.meta.env?.VITE_SUPABASE_URL
  const base = String(fromWindow || fromEnv || '').replace(/\/+$/, '')
  return base
    ? `${base}/functions/v1/${FUNCTION}?action=${action}`
    : `/functions/v1/${FUNCTION}?action=${action}`
}

async function post(action, payload) {
  const res = await fetch(actionUrl(action), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok && data.ok !== false, data, status: res.status }
}

// Шаг 1: код уходит в игру или в Telegram — что выбрал игрок.
export async function requestGameCode({ gameId, gameServer, channel = 'ingame' }) {
  const { data } = await post('code', { gameId, gameServer, channel })
  if (!data.ok) throw new Error(data.error || 'internal')
  return { ttl: data.ttl || 300, nick: data.nick || '', channel: data.channel || channel }
}

// Шаг 2: код проверяется на сервере (в игре — через игровой шлюз), затем сессия.
export async function signInWithGameCode({ gameId, gameServer, code, channel = 'ingame', supabase }) {
  const { data } = await post('session', { gameId, gameServer, code, channel })
  if (!data.ok) {
    const error = new Error(data.error || 'internal')
    if (data.attemptsLeft !== undefined) error.attemptsLeft = data.attemptsLeft
    throw error
  }
  if (!data.tokenHash) throw new Error('internal')
  if (!supabase) throw new Error('no_supabase')
  const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: data.tokenHash })
  if (error) throw new Error(error.message || 'verify_failed')
  // Сервер отвечает verified:true только за код из внутриигровой почты —
  // это единственный вход, который подтверждает владение аккаунтом.
  return { verified: data.verified === true }
}

// Технический код -> фраза для игрока.
export function describeGameLoginError(error) {
  const raw = String(error?.message || error || '')
  const left = error?.attemptsLeft
  switch (raw) {
    case 'bad_game_id':
      return 'Game ID — это 6–12 цифр из профиля MLBB. Проверь значение.'
    case 'profile_not_found':
      return 'Аккаунта с таким Game ID и сервером нет. Проверь цифры или сначала зарегистрируйся по почте.'
    case 'telegram_not_linked':
      return 'К этому профилю не привязан Telegram. Выбери код на внутриигровую почту — он работает без бота.'
    case 'ingame_unavailable':
      return 'Почта в игре сейчас недоступна. Попробуй код в Telegram или через минуту.'
    case 'ingame_failed':
      return 'Игра не приняла запрос на письмо. Проверь Game ID и сервер — цифры должны быть как в профиле MLBB.'
    case 'too_often':
      return 'Код уже отправлен меньше 30 секунд назад. Подожди немного и попробуй снова.'
    case 'too_many_attempts':
      return 'Слишком много неверных попыток. Запроси новый код.'
    case 'telegram_failed':
      return 'Telegram не принял сообщение. Проверь, что бот не заблокирован, и попробуй ещё раз.'
    case 'bad_request':
      return 'Проверь Game ID и код: код из письма в игре — 4 цифры.'
    case 'bad_code':
      return left !== undefined && left > 0
        ? `Код не подошёл. Осталось попыток: ${left}.`
        : 'Код не подошёл. Проверь цифры из письма или запроси новый.'
    case 'code_expired':
      return 'Код живёт 5 минут и не успел. Запроси новый — он придёт в игру или бота.'
    case 'no_email':
      return 'В аккаунте не осталось почты — вход по коду невозможен. Войди по почте и привяжи её заново.'
    case 'no_supabase':
      return 'Проект не подключён к Supabase — вход недоступен.'
    case 'internal':
      return 'Сервис не ответил. Попробуй ещё раз через минуту.'
    default:
      return raw || 'Не удалось войти через игру. Попробуй ещё раз.'
  }
}
