// NAME MLBB — OAuth в мобильном приложении.
//
// Google (и большинство провайдеров) запрещают вход из встроенного WebView:
// окно авторизации открывается в системном браузере, а назад приложение
// возвращается по deep link. Поэтому:
//
//   1. ссылку на провайдера открываем через Browser.open (см. native.js);
//   2. в options.redirectTo кладём com.namemlbb.app://auth;
//   3. Supabase возвращает туда ?code=… — этот адрес нужно добавить в
//      Authentication → URL Configuration → Redirect URLs;
//   4. приложение ловит appUrlOpen и меняет code на сессию.
//
// В вебе всё работает по-старому: обычный https-редирект на тот же адрес.

import { isNativeApp, openExternal } from './native.js'

// Схема совпадает с appId в capacitor.config.ts (Android: intent-filter,
// iOS: CFBundleURLSchemes). Менять только вместе с ними.
export const NATIVE_SCHEME = 'com.namemlbb.app'
export const NATIVE_REDIRECT = `${NATIVE_SCHEME}://auth`

// Куда Supabase должен вернуть игрока после OAuth.
export function authRedirectTo() {
  if (isNativeApp()) return NATIVE_REDIRECT
  if (typeof window === 'undefined') return undefined
  return window.location.protocol.startsWith('http')
    ? window.location.origin + window.location.pathname
    : undefined
}

// Разбираем возврат из системного браузера. Поддерживаем оба варианта,
// которые умеет Supabase: ?code= (PKCE) и #access_token=… (implicit).
export function parseNativeAuthUrl(url) {
  if (!url) return { code: '', error: '', description: '' }
  try {
    const parsed = new URL(String(url))
    const hash = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash)
    const read = (key) => parsed.searchParams.get(key) || hash.get(key) || ''
    return {
      code: read('code'),
      error: read('error') || read('error_code'),
      description: read('error_description'),
    }
  } catch {
    return { code: '', error: '', description: '' }
  }
}

// Меняем код на сессию. Возвращаем { ok, error } — тексты ошибок на русском,
// потому что их показывает экран входа.
export async function completeNativeAuth(url, supabase) {
  const parsed = parseNativeAuthUrl(url)
  if (parsed.error) {
    return { ok: false, error: parsed.description || 'Вход отменён на стороне провайдера.' }
  }
  if (!parsed.code) return { ok: false, error: 'Провайдер не вернул код входа.' }
  if (!supabase) return { ok: false, error: 'Проект не подключён к Supabase.' }
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code)
    if (error) throw new Error(error.message || 'Не удалось открыть окно входа.')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || 'Не удалось завершить вход.' }
  }
}

// Запуск OAuth «правильным» способом для текущей среды.
//
// В браузере — обычный редирект Supabase. В приложении — skipBrowserRedirect:
// получаем готовый адрес провайдера и открываем его в системном браузере,
// иначе Google откажет («disallowed_useragent»).
//
// link: true — привязка соцсети к уже подтверждённому аккаунту (linkIdentity),
// иначе обычный вход (signInWithOAuth).
export async function startOAuth(supabase, { provider, link = false, open = openExternal } = {}) {
  if (!supabase) throw new Error('Проект не подключён к Supabase.')
  const native = isNativeApp()
  const redirectTo = authRedirectTo()
  const options = redirectTo ? { redirectTo } : {}
  if (native) options.skipBrowserRedirect = true

  const { data, error } = link
    ? await supabase.auth.linkIdentity({ provider, options })
    : await supabase.auth.signInWithOAuth({ provider, options })
  if (error) throw new Error(error.message || 'Не удалось открыть окно входа.')

  if (native) {
    const url = data && data.url
    if (!url) throw new Error('Провайдер не вернул адрес входа.')
    await open(url)
  }
  return { redirected: true }
}
