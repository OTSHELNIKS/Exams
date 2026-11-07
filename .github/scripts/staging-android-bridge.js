// Used only in the temporary Android test APK, never in production builds.
// The access key is entered on the device; it is not shipped in the APK.
(() => {
  const stage = 'https://bhurngeasoekgzqxzrlq.supabase.co'
  const nativeFetch = window.fetch.bind(window)
  let gate = ''
  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url
    let url
    try { url = new URL(raw, window.location.href) } catch { return nativeFetch(input, init) }
    if (url.origin !== stage || url.pathname !== '/functions/v1/telegram-auth') return nativeFetch(input, init)
    if (!gate) {
      const entered = window.prompt('Введите ключ доступа к тестовой версии:')
      if (!entered || !/^[A-Za-z0-9_-]{22}$/.test(entered.trim())) {
        return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
      }
      gate = entered.trim()
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init.headers || {}).forEach((value, name) => headers.set(name, value))
    headers.set('x-stage-key', gate)
    url.pathname = '/functions/v1/stage-auth-relay'
    const target = input instanceof Request ? new Request(url.toString(), input) : url.toString()
    const response = await nativeFetch(target, { ...init, headers })
    if (response.status === 404) gate = ''
    return response
  }
  document.addEventListener('DOMContentLoaded', () => {
    const label = document.createElement('div')
    label.textContent = 'ТЕСТОВАЯ ВЕРСИЯ'
    Object.assign(label.style, { position: 'fixed', top: '0', right: '0', zIndex: '2147483647', padding: '3px 8px', background: '#9a2f00', color: '#fff', font: '600 11px sans-serif', pointerEvents: 'none' })
    document.body.appendChild(label)
  })
})()
