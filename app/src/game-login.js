// Вход через саму игру: Game ID + сервер + код из Telegram-бота.
// Клиент только просит код и обменивает его на сессию — проверка и выдача
// одноразовой ссылки живут в edge-функции `game-login` (service role).
// Пароль и почта игроку не нужны: код приходит в Telegram, привязанный к профилю.

import { supabase, functionsUrl } from './supabase.js'

const ACTION_URL = (action) => `${functionsUrl('game-login')}?action=${action}`

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok && data.ok !== false, data, status: res.status }
}

// Шаг 1: код уходит в Telegram, привязанный к профилю с этим Game ID.
export async function requestGameCode({ gameId, gameServer }) {
  const { data } = await postJson(ACTION_URL('code'), { gameId, gameServer })
  if (!data.ok) throw new Error(data.error || 'internal')
  return { ttl: data.ttl || 300, nick: data.nick || '' }
}

// Шаг 2: меняем код на одноразовую ссылку и поднимаем сессию.
export async function signInWithGameCode({ gameId, gameServer, code }) {
  const { data } = await postJson(ACTION_URL('session'), { gameId, gameServer, code })
  if (!data.ok || !data.tokenHash) throw new Error(data.error || 'internal')
  if (!supabase) throw new Error('no_supabase')
  const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: data.tokenHash })
  if (error) throw new Error(error.message || 'verify_failed')
  return true
}

// Технический код -> фраза для игрока.
export function describeGameLoginError(error) {
  const raw = String(error?.message || error || '')
  switch (raw) {
    case 'bad_game_id':
      return 'Game ID — это 6–12 цифр из профиля MLBB. Проверь значение.'
    case 'profile_not_found':
      return 'Аккаунта с таким Game ID и сервером нет. Проверь цифры или сначала зарегистрируйся по почте.'
    case 'telegram_not_linked':
      return 'К этому профилю не привязан Telegram. Войди по почте/Google один раз, привяжи бота в Профиле — дальше сможешь входить через игру.'
    case 'too_often':
      return 'Код уже отправлен меньше 30 секунд назад. Подожди немного и попробуй снова.'
    case 'telegram_failed':
      return 'Telegram не принял сообщение. Проверь, что бот не заблокирован, и попробуй ещё раз.'
    case 'bad_request':
      return 'Проверь Game ID и код: в коде ровно 6 цифр.'
    case 'bad_code':
      return 'Код не подошёл. Проверь цифры из сообщения бота или запроси новый.'
    case 'code_expired':
      return 'Код действует 5 минут и не успел. Запроси новый.'
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
