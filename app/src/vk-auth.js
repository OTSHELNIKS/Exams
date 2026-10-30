// Вход/привязка через VK ID (OAuth 2.1 + PKCE) — без сервера, прямо из браузера.
//
// Как это работает у VK:
//   1. Открываем https://id.vk.ru/authorize с client_id, redirect_uri и PKCE.
//   2. На телефоне VK подхватывает ссылку и показывает свой экран «Разрешить»
//      (или окно со списком аккаунтов), на компьютере — обычное окно VK.
//   3. VK возвращает на redirect_uri код, device_id и state.
//   4. Меняем код на токен (POST /oauth2/auth), забираем id и ник через users.get.
//
// Client ID — публичный идентификатор приложения VK ID. Секрет не нужен:
// VK ID разрешает обмен кода на токен на фронтенде при PKCE.

const VK_AUTH = 'https://id.vk.ru/authorize'
const VK_TOKEN = 'https://id.vk.ru/oauth2/auth'
const VK_API = 'https://api.vk.com/method'
const VERIFIER_KEY = 'name-mlbb:vk-verifier'
const STATE_KEY = 'name-mlbb:vk-state'

// Идентификатор приложения VK ID. Берём из сборки (VITE_VK_CLIENT_ID) или из
// window.__NAME_VK_CLIENT_ID__ — второй путь нужен, чтобы значение можно было
// подставить без пересборки. Читаем через window намеренно: иначе бандлер
// подставит пустую строку на этапе сборки и вырежет весь модуль как мёртвый код.
// Публичный ID приложения VK ID «NAME» (dev.vk.com). Не секрет: он и так
// уходит в браузер. Переопределяется переменной сборки или window.
export const DEFAULT_VK_CLIENT_ID = '54867424'

export const VK_CLIENT_ID = (() => {
  const fromWindow = typeof window !== 'undefined' ? window.__NAME_VK_CLIENT_ID__ : ''
  const fromEnv = import.meta.env?.VITE_VK_CLIENT_ID
  return String(fromWindow || fromEnv || DEFAULT_VK_CLIENT_ID).trim()
})()

export const vkConfigured = Boolean(VK_CLIENT_ID)

export function redirectUri() {
  if (typeof window === 'undefined') return ''
  return window.location.origin + window.location.pathname
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const randomString = (len = 64) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export async function codeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return b64url(digest)
}

// Ссылка на экран разрешения VK.
export function buildVkAuthUrl({ clientId = VK_CLIENT_ID, redirect = redirectUri(), state, challenge }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: 'vkid.personal_info',
  })
  return `${VK_AUTH}?${params.toString()}`
}

// Готовим PKCE и уводим на VK. Возвращает ссылку (удобно и для тестов).
export async function startVkAuth({ clientId = VK_CLIENT_ID, redirect = redirectUri() } = {}) {
  if (!clientId) throw new Error('VK_ID_NOT_CONFIGURED')
  const verifier = randomString(64)
  const state = randomString(48)
  const challenge = await codeChallenge(verifier)
  try {
    sessionStorage.setItem(VERIFIER_KEY, verifier)
    sessionStorage.setItem(STATE_KEY, state)
  } catch { /* приватный режим — тогда обмен не пройдёт, но ошибку покажем понятно */ }
  const url = buildVkAuthUrl({ clientId, redirect, state, challenge })
  if (typeof window !== 'undefined') window.location.assign(url)
  return url
}

// Что вернул VK в адресе (или null, если это не возврат с VK).
export function parseVkReturn(href) {
  if (!href) return null
  try {
    const url = new URL(href, 'https://example.invalid')
    const code = url.searchParams.get('code')
    const deviceId = url.searchParams.get('device_id')
    if (!code || !deviceId) return null
    return { code, deviceId, state: url.searchParams.get('state') || '' }
  } catch {
    return null
  }
}

export function takeVerifier() {
  try {
    const verifier = sessionStorage.getItem(VERIFIER_KEY) || ''
    const state = sessionStorage.getItem(STATE_KEY) || ''
    sessionStorage.removeItem(VERIFIER_KEY)
    sessionStorage.removeItem(STATE_KEY)
    return { verifier, state }
  } catch {
    return { verifier: '', state: '' }
  }
}

// Обмен кода на токен. Отдельно от сети — чтобы можно было подставить fetch в тестах.
export async function exchangeVkCode({ code, deviceId, state, verifier, clientId = VK_CLIENT_ID, redirect = redirectUri(), fetchImpl = fetch }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: clientId,
    device_id: deviceId,
    redirect_uri: redirect,
    state,
  })
  const res = await fetchImpl(VK_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.error || !json.access_token) {
    const reason = json.error_description || json.error || `HTTP ${res.status}`
    throw new Error(`VK_TOKEN: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`)
  }
  return { accessToken: json.access_token, userId: String(json.user_id || '') }
}

// Ник и имя через открытый метод VK. Ошибку не считаем фатальной: id уже есть.
export async function fetchVkProfile({ accessToken, userId, fetchImpl = fetch }) {
  try {
    const params = new URLSearchParams({
      user_ids: userId,
      fields: 'screen_name,first_name,last_name',
      access_token: accessToken,
      v: '5.199',
    })
    const res = await fetchImpl(`${VK_API}/users.get?${params.toString()}`)
    const json = await res.json().catch(() => ({}))
    const user = json?.response?.[0]
    if (!user) return { handle: userId ? `id${userId}` : '', name: '' }
    const nick = user.screen_name ? `@${user.screen_name}` : `id${userId}`
    return { handle: nick, name: [user.first_name, user.last_name].filter(Boolean).join(' ') }
  } catch {
    return { handle: userId ? `id${userId}` : '', name: '' }
  }
}

// Полный цикл после возврата с VK: проверка state, токен, профиль.
export async function completeVkAuth(href, { fetchImpl = fetch } = {}) {
  const parsed = parseVkReturn(href)
  if (!parsed) return null
  const { verifier, state } = takeVerifier()
  if (!verifier) throw new Error('VK_STATE_LOST')
  if (state && parsed.state && state !== parsed.state) throw new Error('VK_STATE_MISMATCH')
  const { accessToken, userId } = await exchangeVkCode({ ...parsed, verifier, fetchImpl })
  const profile = await fetchVkProfile({ accessToken, userId, fetchImpl })
  return { userId, handle: profile.handle, name: profile.name }
}

// Технические ошибки VK -> понятная фраза.
export function describeVkError(error) {
  const raw = String(error?.message || error || '')
  if (raw.includes('VK_ID_NOT_CONFIGURED')) {
    return 'VK ещё не подключён: нужно приложение VK ID. Создать можно на dev.vk.com → «Создать приложение» → VK ID, затем прислать его ID.'
  }
  if (raw.includes('VK_STATE_LOST') || raw.includes('VK_STATE_MISMATCH')) {
    return 'Сессия входа в VK истекла. Нажми «Войти через VK» ещё раз.'
  }
  if (raw.includes('VK_TOKEN')) {
    return 'VK не выдал доступ: ' + raw.replace('VK_TOKEN: ', '') + '. Проверь доверенный redirect URL в настройках приложения VK ID.'
  }
  return raw || 'Не удалось войти через VK. Попробуй ещё раз.'
}
