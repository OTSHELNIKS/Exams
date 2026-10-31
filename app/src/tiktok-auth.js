// Привязка TikTok через Login Kit (OAuth 2.0, authorization code).
//
// Как это работает у TikTok:
//   1. Уводим игрока на https://www.tiktok.com/v2/auth/authorize/ с client_key,
//      scope=user.info.basic, redirect_uri и state (защита от подмены).
//   2. TikTok показывает свой экран «Разрешить» — в приложении или в браузере.
//   3. Возвращаемся с ?code=...&state=... — код живёт минуты и одноразовый.
//   4. Код меняется на токен ТОЛЬКО на сервере (edge-функция `tiktok-auth`):
//      у TikTok обмен требует client_secret, а секрету не место в браузере.
//   5. Сервер отдаёт ник и аватар, токены не сохраняет и не возвращает.
//
// Client key — публичный идентификатор приложения, он и так уходит в браузер.

const TIKTOK_AUTH = 'https://www.tiktok.com/v2/auth/authorize/'
const STATE_KEY = 'name-mlbb:tiktok-state'
const SCOPE = 'user.info.basic'

export const DEFAULT_TIKTOK_CLIENT_KEY = ''

// Читаем через window намеренно: иначе бандлер подставит пустую строку и
// вырежет модуль как мёртвый код (так уже было с VK).
export const TIKTOK_CLIENT_KEY = (() => {
  const fromWindow = typeof window !== 'undefined' ? window.__NAME_TIKTOK_CLIENT_KEY__ : ''
  const fromEnv = import.meta.env?.VITE_TIKTOK_CLIENT_KEY
  return String(fromWindow || fromEnv || DEFAULT_TIKTOK_CLIENT_KEY).trim()
})()

export const tiktokConfigured = Boolean(TIKTOK_CLIENT_KEY)

// Адрес edge-функции. Собираем здесь, а не тянем из supabase.js: модуль остаётся
// без зависимостей (его можно проверить в node без Vite-окружения).
export function exchangeUrl() {
  const fromWindow = typeof window !== 'undefined' ? window.__NAME_SUPABASE_URL__ : ''
  const fromEnv = import.meta.env?.VITE_SUPABASE_URL
  const base = String(fromWindow || fromEnv || '').replace(/\/+$/, '')
  return base ? `${base}/functions/v1/tiktok-auth?action=exchange` : '/functions/v1/tiktok-auth?action=exchange'
}

export function redirectUri() {
  if (typeof window === 'undefined') return ''
  return window.location.origin + window.location.pathname
}

const randomString = (len = 32) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export function buildTikTokAuthUrl({ clientKey = TIKTOK_CLIENT_KEY, redirect = redirectUri(), state, scope = SCOPE }) {
  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: 'code',
    scope,
    redirect_uri: redirect,
    state,
  })
  return `${TIKTOK_AUTH}?${params.toString()}`
}

// Готовим state и уводим на TikTok. Ссылку возвращаем — удобно для тестов.
export async function startTikTokAuth({ clientKey = TIKTOK_CLIENT_KEY, redirect = redirectUri() } = {}) {
  if (!clientKey) throw new Error('TIKTOK_NOT_CONFIGURED')
  const state = randomString(40)
  try { sessionStorage.setItem(STATE_KEY, state) } catch { /* приватный режим — тогда state не проверим */ }
  const url = buildTikTokAuthUrl({ clientKey, redirect, state })
  if (typeof window !== 'undefined') window.location.assign(url)
  return url
}

// Что вернул TikTok в адресе (или null, если это не возврат с TikTok).
export function parseTikTokReturn(href) {
  if (!href) return null
  try {
    const url = new URL(href, 'https://example.invalid')
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error') || url.searchParams.get('error_description')
    const state = url.searchParams.get('state') || ''
    if (!code && !error) return null
    return { code: code || '', state, error: error || '' }
  } catch {
    return null
  }
}

export function takeState() {
  try {
    const state = sessionStorage.getItem(STATE_KEY) || ''
    sessionStorage.removeItem(STATE_KEY)
    return state
  } catch {
    return ''
  }
}

// Обмен кода на ник: делает сервер, клиент только передаёт код.
// fetchImpl — чтобы тест мог подставить свой fetch.
export async function exchangeTikTokCode({ code, redirect = redirectUri(), fetchImpl = fetch }) {
  const res = await fetchImpl(exchangeUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirectUri: redirect }),
  })
  const data = await res.json().catch(() => ({}))
  if (!data.ok) throw new Error('TIKTOK_' + String(data.error || 'failed').toUpperCase())
  return { openId: data.openId || '', handle: data.handle || '', name: data.name || '', avatar: data.avatar || '' }
}

// Полный цикл после возврата с TikTok: state, обмен, ник.
export async function completeTikTokAuth(href, { fetchImpl = fetch } = {}) {
  const parsed = parseTikTokReturn(href)
  if (!parsed) return null
  if (parsed.error) throw new Error('TIKTOK_DENIED')
  const expected = takeState()
  if (expected && parsed.state && expected !== parsed.state) throw new Error('TIKTOK_STATE_MISMATCH')
  if (!expected) throw new Error('TIKTOK_STATE_LOST')
  const info = await exchangeTikTokCode({ code: parsed.code, fetchImpl })
  const handle = info.handle || (info.openId ? `id${info.openId.slice(0, 8)}` : '')
  if (!handle) throw new Error('TIKTOK_NO_HANDLE')
  return { openId: info.openId, handle, name: info.name, avatar: info.avatar }
}

// Технические коды -> понятная фраза для игрока.
export function describeTikTokError(error) {
  const raw = String(error?.message || error || '')
  if (raw.includes('TIKTOK_NOT_CONFIGURED')) {
    return 'TikTok ещё не подключён: нужно приложение TikTok for Developers (Login Kit) и его client key. Пока привяжи Telegram или Google.'
  }
  if (raw.includes('TIKTOK_STATE_LOST') || raw.includes('TIKTOK_STATE_MISMATCH')) {
    return 'Сессия привязки TikTok истекла. Нажми «Войти через TikTok» ещё раз.'
  }
  if (raw.includes('TIKTOK_DENIED')) return 'Ты не разрешил доступ в TikTok — привязка отменена.'
  if (raw.includes('TIKTOK_NOT_CONFIGURED_SECRET') || raw.includes('TIKTOK_NOT_CONFIGURED')) {
    return 'Сервер TikTok не настроен: нет client key/secret. Напиши в поддержку.'
  }
  if (raw.includes('TIKTOK_NOT_CONFIGURED_SERVER')) return 'Сервер TikTok не настроен: нет client key/secret.'
  if (raw.includes('TIKTOK_REDIRECT_MISMATCH')) {
    return 'TikTok не принял адрес возврата: в настройках приложения должен быть указан ровно этот адрес сайта (со слешем на конце).'
  }
  if (raw.includes('TIKTOK_CODE_EXPIRED')) return 'Код TikTok устарел. Попробуй привязать ещё раз.'
  if (raw.includes('TIKTOK_NOT_CONFIGURED_SERVER')) return 'Сервер TikTok не настроен.'
  if (raw.includes('TIKTOK_NO_HANDLE')) return 'TikTok не отдал ник — проверь, что в приложении включён доступ к базовым данным профиля.'
  if (raw.includes('TIKTOK_TOKEN_FAILED')) return 'TikTok отказал в доступе. Проверь настройки приложения TikTok for Developers.'
  if (raw.includes('TIKTOK_INTERNAL')) return 'Сервер TikTok не ответил. Попробуй ещё раз через минуту.'
  return raw || 'Не удалось привязать TikTok. Попробуй ещё раз.'
}
