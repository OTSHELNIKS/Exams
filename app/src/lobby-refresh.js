// Резервное обновление лобби, пока Realtime для него не настроен.
// Оно работает только на открытом экране и при видимом приложении. Не запускаем
// второй запрос, пока первый не завершился; закрытие экрана убирает таймер.
export const LOBBY_REFRESH_INTERVAL_MS = 15000

export function watchLobbyRefresh({ refresh, intervalMs = LOBBY_REFRESH_INTERVAL_MS, documentRef = globalThis.document, timers = globalThis }) {
  let stopped = false
  let running = false

  const run = () => {
    if (stopped || running || documentRef?.visibilityState === 'hidden') return
    running = true
    Promise.resolve()
      .then(() => { if (!stopped) return refresh() })
      .catch(() => { /* Следующая попытка состоится по таймеру. */ })
      .finally(() => { running = false })
  }
  const onVisibility = () => { if (documentRef?.visibilityState !== 'hidden') run() }
  const timer = timers.setInterval(run, intervalMs)
  documentRef?.addEventListener('visibilitychange', onVisibility)

  return () => {
    stopped = true
    timers.clearInterval(timer)
    documentRef?.removeEventListener('visibilitychange', onVisibility)
  }
}
