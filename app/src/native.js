// NAME MLBB — мобильная оболочка (Capacitor).
//
// Здесь только то, чего нет в браузере: системный статус-бар, сплэш, аппаратная
// кнопка «назад» на Android, внешние ссылки в системном браузере и возврат в
// приложение по deep link после OAuth.
//
// ВАЖНО: модуль полностью безвреден в вебе. Все импорты плагинов ленивые, все
// вызовы обёрнуты в try/catch — если приложение открыто в обычном браузере
// (GitHub Pages), функция выходит на первой строке и ничего не трогает.

export function isNativeApp() {
  try {
    return Boolean(globalThis.Capacitor && globalThis.Capacitor.isNativePlatform && globalThis.Capacitor.isNativePlatform())
  } catch {
    return false
  }
}

const BG = '#08080b'

export async function initNative() {
  if (!isNativeApp()) return false

  let App, Browser, StatusBar, SplashScreen
  try {
    ;[{ App }, { Browser }, { StatusBar }, { SplashScreen }] = await Promise.all([
      import('@capacitor/app'),
      import('@capacitor/browser'),
      import('@capacitor/status-bar'),
      import('@capacitor/splash-screen'),
    ])
  } catch (e) {
    console.error('native: плагины недоступны', e)
    return false
  }

  // Тёмный статус-бар под цвет фона приложения.
  try {
    await StatusBar.setStyle({ style: 'DARK' })
    await StatusBar.setBackgroundColor({ color: BG })
  } catch { /* на iOS нет цвета фона — плагин сам проигнорирует */ }
  try { await SplashScreen.hide() } catch { /* сплэш уже скрыт */ }

  // Аппаратная «назад»: сначала закрываем окно, потом уходим на главную,
  // и только если идти некуда — выходим из приложения.
  try {
    await App.addListener('backButton', () => {
      // Открыта модалка — закрываем её тем же путём, что и крестик.
      if (document.querySelector('.modal')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        return
      }
      // Экраны слушают name:back и отменяют событие, уводя на главную.
      // Никто не отменил — значит мы на главной, выходим из приложения.
      const unhandled = window.dispatchEvent(new CustomEvent('name:back', { cancelable: true }))
      if (unhandled) App.exitApp()
    })
  } catch (e) { console.error('native: back button', e) }

  // Внешние ссылки (Telegram, документация, TikTok) — в системном браузере,
  // а не внутри WebView: иначе бот не откроется, а OAuth попадёт под запрет
  // Google на вход из WebView.
  document.addEventListener('click', (event) => {
    const link = event.target && event.target.closest ? event.target.closest('a[href]') : null
    if (!link) return
    const href = link.getAttribute('href') || ''
    if (!/^https?:/i.test(href)) return
    if (href.startsWith(window.location.origin)) return
    event.preventDefault()
    Browser.open({ url: href }).catch(() => window.open(href, '_system'))
  }, true)

  // Возврат из системного браузера: com.namemlbb.app://... превращается в событие,
  // которое разбирает auth-return.js (обмен кода на сессию Supabase).
  try {
    await App.addListener('appUrlOpen', ({ url }) => {
      window.dispatchEvent(new CustomEvent('name:app-url', { detail: url }))
    })
  } catch (e) { console.error('native: deep link', e) }

  return true
}

// Открыть MLBB из приложения: WebView не умеет intent://, поэтому просим
// систему через AppLauncher. Если игры нет — бросаем ошибку, и вызывающий код
// уводит игрока в магазин приложений.
export async function openGameApp(url = 'mlbb://') {
  const { AppLauncher } = await import('@capacitor/app-launcher')
  const { value } = await AppLauncher.canOpenUrl({ url })
  if (!value) throw new Error('game_not_installed')
  await AppLauncher.openUrl({ url })
}

// Открыть внешний адрес так, как это делает система (для OAuth и «Открыть игру»).
export async function openExternal(url) {
  if (!url) return false
  if (isNativeApp()) {
    try {
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url })
      return true
    } catch { /* упадёт ниже в window.open */ }
  }
  window.open(url, '_blank', 'noopener')
  return true
}
