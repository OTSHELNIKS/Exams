// Открытие MLBB из браузера: игрок нажимает «Открыть игру», смотрит свой
// Game ID и сервер в профиле, читает письмо с кодом на внутриигровой почте —
// и возвращается на сайт ввести код.
//
// Прямой схемы (myapp://) Moonton не публикует, поэтому используем:
//   • Android — intent:// с пакетом com.mobile.legends: если игра стоит,
//     откроется она, иначе Chrome сам уйдёт в Play Маркет;
//   • iOS — mlbb://, а если приложение не установлено, ведём в App Store;
//   • компьютер — магазин приложений не нужен: показываем подсказку.
// Никаких обещаний «войдёт сам»: игра не умеет возвращать сессию сайту,
// поэтому подтверждение всегда через код.

export const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.mobile.legends'
export const IOS_SEARCH = 'https://apps.apple.com/ru/search?term=Mobile%20Legends'
export const GAME_SITE = 'https://m.mobilelegends.com/'
export const ANDROID_PACKAGE = 'com.mobile.legends'

// Платформа по строке user-agent (по умолчанию — из браузера).
export function detectPlatform(ua) {
  const raw = String(ua === undefined ? (typeof navigator !== 'undefined' ? navigator.userAgent : '') : ua).toLowerCase()
  if (/iphone|ipad|ipod/.test(raw)) return 'ios'
  if (/android/.test(raw)) return 'android'
  return 'desktop'
}

// Куда вести игрока: сначала попытка открыть само приложение, потом магазин.
export function gameLinks(platform = detectPlatform()) {
  if (platform === 'android') {
    const fallback = encodeURIComponent(PLAY_URL)
    return {
      direct: `intent://launch#Intent;scheme=mlbb;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`,
      store: PLAY_URL,
      note: 'Откроем MLBB. Если игра не установлена — Play Маркет.',
    }
  }
  if (platform === 'ios') {
    return {
      direct: 'mlbb://',
      store: IOS_SEARCH,
      note: 'Откроем MLBB. Если приложение не установлено — App Store.',
    }
  }
  return {
    direct: '',
    store: '',
    note: 'Открой игру на телефоне: на компьютере MLBB не запускается.',
  }
}

// Пробуем открыть игру и, если приложение не подхватило ссылку, уводим в магазин.
// Возвращает { opened, via } — visited для проверки в тестах.
export async function openGame({
  platform = detectPlatform(),
  navigate = (url) => { if (typeof window !== 'undefined') window.location.href = url },
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  isHidden = () => (typeof document !== 'undefined' ? document.hidden : false),
  waitMs = 1200,
} = {}) {
  const links = gameLinks(platform)
  const visited = []
  if (!links.direct) return { opened: false, via: 'desktop', visited, note: links.note }

  try {
    navigate(links.direct)
    visited.push(links.direct)
  } catch {
    /* браузер может запретить переход — просто уходим в магазин */
  }
  await sleep(waitMs)
  if (isHidden()) return { opened: true, via: links.direct, visited, note: links.note }

  try {
    if (links.store) { navigate(links.store); visited.push(links.store) }
  } catch { /* ничего не поделать, покажем подсказку в интерфейсе */ }
  return { opened: false, via: 'store', visited, note: links.note }
}

// Что делать, если игра не открылась: понятная подсказка вместо пустого экрана.
export function gameHelpText(platform = detectPlatform()) {
  if (platform === 'desktop') {
    return 'Игру можно открыть только с телефона. Game ID и сервер видно в профиле MLBB под ником.'
  }
  return 'Если игра не открылась — открой её вручную. Game ID и сервер видны в профиле под ником, письмо с кодом придёт на внутриигровую почту.'
}
