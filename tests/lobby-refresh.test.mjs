// Проверки фонового обновления лобби без сети и реальных пользователей.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { watchLobbyRefresh, LOBBY_REFRESH_INTERVAL_MS } from '../app/src/lobby-refresh.js'

const flush = () => new Promise((resolve) => setImmediate(resolve))
function harness(refresh) {
  const listeners = new Map()
  const documentRef = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type) },
  }
  let interval, timeout, cleared = false
  const timers = {
    setInterval(fn, ms) { interval = fn; timeout = ms; return 42 },
    clearInterval(id) { assert.equal(id, 42); cleared = true },
  }
  const stop = watchLobbyRefresh({ refresh, documentRef, timers })
  return { documentRef, stop, tick: () => interval(), visibility: () => listeners.get('visibilitychange')?.(), listeners, get timeout() { return timeout }, get cleared() { return cleared } }
}

test('обновляет открытое лобби каждые 15 секунд и прекращает после выхода', async () => {
  let calls = 0
  const h = harness(async () => { calls++ })
  assert.equal(h.timeout, LOBBY_REFRESH_INTERVAL_MS)
  assert.equal(h.timeout, 15000)
  h.tick(); await flush()
  assert.equal(calls, 1)
  h.stop()
  assert.equal(h.cleared, true)
  assert.equal(h.listeners.size, 0)
  h.tick(); await flush()
  assert.equal(calls, 1)
})

test('не опрашивает скрытое приложение и обновляет при возвращении', async () => {
  let calls = 0
  const h = harness(async () => { calls++ })
  h.documentRef.visibilityState = 'hidden'
  h.tick(); h.visibility(); await flush()
  assert.equal(calls, 0)
  h.documentRef.visibilityState = 'visible'
  h.visibility(); await flush()
  assert.equal(calls, 1)
  h.stop()
})

test('не делает параллельные запросы и повторяет после ошибки', async () => {
  let calls = 0, rejectFirst
  const h = harness(() => {
    calls++
    return calls === 1 ? new Promise((_, reject) => { rejectFirst = reject }) : Promise.resolve()
  })
  h.tick(); await flush()
  h.tick(); h.visibility(); await flush()
  assert.equal(calls, 1)
  rejectFirst(new Error('offline'))
  await flush()
  h.tick(); await flush()
  assert.equal(calls, 2)
  h.stop()
})

test('если закрыть экран до выполнения отложенной задачи, запрос не отправится', async () => {
  let calls = 0
  const h = harness(() => { calls++ })
  h.tick(); h.stop(); await flush()
  assert.equal(calls, 0)
})
