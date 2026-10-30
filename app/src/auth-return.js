// Разбор возврата с внешнего входа (Google и другие OAuth-провайдеры).
// Supabase после редиректа кидает результат в hash: либо токены сессии,
// либо ошибку вида #error=access_denied&error_description=...&error_code=...
// Здесь только чистые функции — их удобно проверять тестами.

const HASH_KEYS = ['error', 'error_code', 'error_description']

export function parseAuthReturn(href) {
  if (!href) return { error: '', code: '', description: '' }
  let hash = ''
  let search = ''
  try {
    const url = new URL(href, 'https://example.invalid')
    hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
    search = url.search.startsWith('?') ? url.search.slice(1) : url.search
  } catch {
    return { error: '', code: '', description: '' }
  }
  const read = (key) => {
    for (const chunk of [hash, search]) {
      const params = new URLSearchParams(chunk)
      const value = params.get(key)
      if (value) return value
    }
    return ''
  }
  return { error: read('error'), code: read('error_code'), description: read('error_description') }
}

// Убираем из адресной строки служебные параметры ошибки, чтобы F5 не показывал
// её повторно. Токены сессии не трогаем — их читает supabase-js.
export function cleanAuthUrl(href) {
  try {
    const url = new URL(href)
    const hash = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
    const hadError = HASH_KEYS.some((key) => hash.has(key))
    if (!hadError) return null
    HASH_KEYS.forEach((key) => hash.delete(key))
    const rest = hash.toString()
    url.hash = rest ? `#${rest}` : ''
    return url.toString()
  } catch {
    return null
  }
}

// Технические тексты провайдера -> понятная фраза для игрока.
export function describeAuthError({ error, code, description } = {}) {
  const raw = String(description || error || '').toLowerCase()
  const label = (error || code || '').toLowerCase()
  if (!raw && !label) return ''
  if (label.includes('access_denied') || raw.includes('access_denied')) {
    return 'Вход отменён: доступ к аккаунту не выдан. Попробуй ещё раз или войди по почте.'
  }
  if (raw.includes('provider is not enabled') || raw.includes('unsupported provider')) {
    return 'Этот способ входа ещё не включён в проекте. Пока доступны почта и Telegram-бот.'
  }
  if (raw.includes('redirect_uri') || raw.includes('redirect url')) {
    return 'Адрес возврата не разрешён. Добавь https://otshelniks.github.io/Exams/ в Supabase → Authentication → URL Configuration.'
  }
  if (raw.includes('test user') || raw.includes('not verified') || label.includes('verification')) {
    return 'Google пускает только тестовых пользователей: добавь свою почту в Google Auth Platform → Audience → Test users.'
  }
  if (raw.includes('token') && raw.includes('expired')) {
    return 'Срок действия ссылки истёк. Начни вход заново.'
  }
  return description || 'Не удалось завершить вход. Попробуй ещё раз или войди по почте.'
}
