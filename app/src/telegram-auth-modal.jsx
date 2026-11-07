import React, { useEffect, useRef, useState } from 'react'
import { Modal } from './ui.jsx'
import { watchLobbyRefresh } from './lobby-refresh.js'
import { beginTelegramAuth, completeTelegramAuth, clearTelegramAuth, loadTelegramAuth, saveTelegramAuth } from './telegram-auth.js'

// Бот подтверждает только ранее привязанный аккаунт; браузер хранит отдельный секрет.
export function TelegramAuthModal({ open, onClose, supabase, botUsername }) {
  const [pending, setPending] = useState(() => loadTelegramAuth())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const generation = useRef(0)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const start = async () => {
    const gen = generation.current
    setBusy(true); setMessage('')
    try {
      const value = await beginTelegramAuth()
      if (gen === generation.current) { saveTelegramAuth(value); setPending(value) }
    } catch (error) { if (gen === generation.current) setMessage(error?.message === 'too_many_requests' ? 'Слишком много попыток. Подожди несколько минут и попробуй снова.' : 'Не удалось начать вход. Попробуй ещё раз.') }
    finally { if (gen === generation.current) setBusy(false) }
  }
  const close = () => { generation.current += 1; clearTelegramAuth(); setPending(null); setMessage(''); onCloseRef.current?.() }
  useEffect(() => {
    if (!open) return undefined
    generation.current += 1
    if (!pending) void start()
    return () => { generation.current += 1 }
    // start only once per opening; retry is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => {
    if (!open || !pending) return undefined
    const gen = generation.current
    const refresh = async () => {
      if (pending.expiresAt <= Date.now()) { clearTelegramAuth(); setPending(null); setMessage('Ссылка истекла. Запроси новую.'); return }
      try {
        const result = await completeTelegramAuth(pending, supabase, () => gen === generation.current)
        if (gen !== generation.current) return
        if (result.ok) { clearTelegramAuth(); setPending(null); onCloseRef.current?.() }
        else if (result.pending) setMessage('')
      } catch (err) {
        if (gen !== generation.current) return
        if (err?.message === 'expired') { clearTelegramAuth(); setPending(null); setMessage('Ссылка истекла или уже использована. Запроси новую.') }
        else if (err?.message === 'too_many_requests') setMessage('Слишком много запросов. Проверим подтверждение ещё раз немного позже.')
        else setMessage('Не удалось проверить вход. Проверим ещё раз при следующем обновлении.')
      }
    }
    return watchLobbyRefresh({ refresh, intervalMs: 3000 })
  }, [open, pending, supabase])
  return <Modal open={open} onClose={close} labelledBy="telegram-auth-title">
    <h3 id="telegram-auth-title">Вход через Telegram</h3>
    <p className="modal__role">Для входа Telegram должен быть заранее привязан к профилю NAME.</p>
    {pending && <><p className="field-hint">Открой бота и сверь код <b>{pending.botToken.slice(0, 6)}</b> с сообщением. Подтверди вход в боте и вернись сюда.</p>
      <a className="social social--primary social-modal__link" href={`https://t.me/${botUsername}?start=login_${pending.botToken}`} target="_blank" rel="noreferrer">Открыть Telegram-бота</a>
      <p className="field-hint" role="status">Ожидаем подтверждение…</p></>}
    {!pending && !busy && <button type="button" className="btn btn--primary" onClick={start}>Получить ссылку</button>}
    {busy && <p role="status">Готовим защищённую ссылку…</p>}
    {message && <p role="alert">{message}</p>}
    <button type="button" className="link-btn" onClick={close}>Отмена</button>
  </Modal>
}
