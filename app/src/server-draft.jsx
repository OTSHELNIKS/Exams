import React, { useEffect, useRef, useState } from 'react'
import { Clock3, Crown, Plus, UserRound } from 'lucide-react'
import { DRAFT_FILTERS } from './data.js'
import { Chip, PrimaryButton } from './ui.jsx'
import { watchLobbyRefresh } from './lobby-refresh.js'
import { findDraftLobby, draftAction, draftTeams, describeDraftError } from './draft-server.js'

const ROLE_MAP = { МИД: ['Маг'], ЛЕС: ['Лесник'], РОУМ: ['Поддержка'], БОЕЦ: ['Боец'], СТРЕЛОК: ['Стрелок'], ТАНК: ['Танк'] }

// Все действия проходят через сервер. Таймер используется только для показа;
// база сама проверяет срок, очередь, капитана, участников и составы.
export function ServerDraftScreen({ supabase, userId, lobbyCode = '', onReady, onBack, onLobby, onOpenProfile }) {
  const [lobby, setLobby] = useState(null)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [filter, setFilter] = useState('ВСЕ')
  const [clock, setClock] = useState(Date.now())
  const [clockOffset, setClockOffset] = useState(0)
  const lobbyRef = useRef(null)
  const generation = useRef(0)
  const sequence = useRef(0)
  const autoAttempt = useRef(0)

  const read = async () => {
    const gen = generation.current
    const seq = ++sequence.current
    let current = lobbyRef.current
    if (!current) {
      const result = await findDraftLobby(supabase, lobbyCode)
      if (gen !== generation.current || seq !== sequence.current) return
      if (result.error) { setError(describeDraftError(result.error)); setLoading(false); return }
      current = result.lobby
      lobbyRef.current = current
      setLobby(current)
    }
    const state = await draftAction(supabase, 'get', current.id)
    if (gen !== generation.current || seq !== sequence.current) return
    if (state.error === 'not_started') { setDraft(null); setError('') }
    else if (state.error) { setDraft(null); setError(describeDraftError(state.error)) }
    else {
      setDraft(state); setError('')
      const serverMs = Date.parse(state.server_time)
      if (Number.isFinite(serverMs)) setClockOffset(serverMs - Date.now())
    }
    setLoading(false)
  }

  useEffect(() => {
    generation.current += 1
    lobbyRef.current = null
    setLobby(null); setDraft(null); setError(''); setLoading(true)
    if (!supabase || !userId || !lobbyCode) {
      setError(describeDraftError(!userId ? 'unauthorized' : 'no_lobby'))
      setLoading(false)
      return () => { generation.current += 1 }
    }
    void read()
    const stop = watchLobbyRefresh({ refresh: read, intervalMs: 5000 })
    return () => { generation.current += 1; stop() }
    // read intentionally captures the current lobby and session for this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, userId, lobbyCode])

  useEffect(() => {
    if (draft?.status !== 'active') return undefined
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [draft?.status])

  const perform = async (action, target) => {
    if (!lobby || busy) return
    const gen = generation.current
    setBusy(action); setError('')
    const result = await draftAction(supabase, action, lobby.id, target)
    if (gen !== generation.current) return
    setBusy('')
    await read()
    if (gen !== generation.current) return
    // Другой клиент мог уже сделать авто-выбор; обновим общее состояние.
    if (result.error && (action !== 'auto' || !['too_early', 'not_active'].includes(result.error))) {
      setError(describeDraftError(result.error))
    }
  }

  const deadline = draft ? Date.parse(draft.deadline) : NaN
  const seconds = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - (clock + clockOffset)) / 1000)) : null
  useEffect(() => {
    if (draft?.status !== 'active' || seconds !== 0 || busy || !lobby || document.visibilityState === 'hidden') return
    if (Date.now() - autoAttempt.current < 5000) return
    autoAttempt.current = Date.now()
    void perform('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, draft?.deadline, draft?.status, seconds, busy, lobby?.id])

  const openLobby = onLobby || onBack
  if (loading) return <div className="screen draft"><div className="empty-block"><p>Загружаем драфт…</p></div></div>
  if (!lobby) return <div className="screen draft"><div className="empty-block"><p>{error}</p><button type="button" className="btn btn--ghost" onClick={openLobby}>В лобби</button></div></div>

  if (!draft || draft.status === 'cancelled') {
    return (
      <div className="screen draft">
        <div className="draft__head"><div><h1>CAPTAIN'S DRAFT</h1><p>Формат 5v5 · участники этого лобби</p></div></div>
        <div className="empty-block">
          <p>{draft?.status === 'cancelled' ? 'Драфт отменён: состав лобби изменился. Соберите команду снова.' : 'Для начала соберите в лобби 10 игроков.'}</p>
          {lobby.host_id === userId
            ? <button type="button" className="btn btn--primary" onClick={() => perform('start')} disabled={Boolean(busy)}>{busy ? 'ЗАПУСКАЕМ…' : 'НАЧАТЬ ДРАФТ'}</button>
            : <p>Драфт запустит организатор лобби.</p>}
          {error && <p role="alert">{error}</p>}
          <button type="button" className="btn btn--ghost" onClick={openLobby}>В лобби</button>
        </div>
      </div>
    )
  }

  const activeCaptain = draft.turn === 'a' ? draft.captain_a : draft.captain_b
  const myTurn = draft.status === 'active' && activeCaptain === userId && seconds !== 0
  const visible = (draft.pool || []).filter((p) => filter === 'ВСЕ' || (p.roles || []).some((role) => (ROLE_MAP[filter] || []).includes(role)))
  const teamCard = (side, roster, captainId) => {
    const captain = roster.find((m) => m.user_id === captainId)
    return (
      <div className={`team-card team-card--${side} ${draft.status === 'active' && draft.turn === side ? 'is-active' : ''}`}>
        <div className="team-card__head"><span>TEAM {side.toUpperCase()}</span><b>{roster.length}/5</b></div>
        {captain && <div className="team-card__captain"><span className="team-card__avatar">{(captain.nick?.[0] || '?').toUpperCase()}</span><div><strong><button type="button" className="draft-profile-link" aria-label={`Открыть профиль ${captain.nick}`} onClick={() => onOpenProfile?.(captain.user_id)}><Crown size={16} /> {captain.nick}{captain.user_id === userId ? ' (вы)' : ''}</button></strong><small>Капитан · {captain.pts ?? '—'} MMR</small></div></div>}
        <div className="team-card__slots">{Array.from({ length: 5 }, (_, i) => <span key={i} className={roster[i] ? 'is-filled' : ''} title={roster[i]?.nick || 'Свободно'}>{roster[i] ? (roster[i].nick?.[0] || '?').toUpperCase() : <Plus size={16} />}</span>)}</div>
        {captainId === userId && roster.length > 1 && <div className="team-card__handover"><small>Передать капитанство внутри команды:</small>{roster.filter((m) => m.user_id !== userId).map((m) => <button key={m.user_id} type="button" className="btn btn--small" onClick={() => perform('transfer', m.user_id)} disabled={Boolean(busy)}>{m.nick}</button>)}</div>}
      </div>
    )
  }

  return (
    <div className="screen draft">
      <div className="draft__head"><div><h1>CAPTAIN'S DRAFT</h1><p>Формат 5v5 · общий драфт лобби</p></div>{draft.status === 'active' && <div className="draft__timer"><Clock3 size={16} /> {seconds === null ? '—' : `00:${String(seconds).padStart(2, '0')}`}</div>}</div>
      <div className="draft__turn"><span>Очередь:</span><b>{draft.status === 'complete' ? 'СОСТАВЫ ГОТОВЫ' : `КОМАНДА ${draft.turn.toUpperCase()}`}</b>{draft.status === 'active' && <em>{myTurn ? 'Твой ход — выбери игрока' : 'Ожидаем выбор капитана'}</em>}</div>
      <div className="draft__teams">{teamCard('a', draft.team_a || [], draft.captain_a)}<div className="draft__vs">VS</div>{teamCard('b', draft.team_b || [], draft.captain_b)}</div>
      {draft.status === 'active' && <><div className="chips chips--scroll">{DRAFT_FILTERS.map((f) => <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>{f}</Chip>)}</div><div className="section-head draft__poolhead"><span>УЧАСТНИКИ ЛОББИ</span><b>{draft.pool.length} свободно</b></div><div className="pool">{visible.map((p) => <div key={p.user_id} className="pool-row"><button type="button" className="pool-row__info" aria-label={`Открыть профиль ${p.nick}`} onClick={() => onOpenProfile?.(p.user_id)}><span className="pool-row__avatar">{(p.nick?.[0] || '?').toUpperCase()}</span><span className="pool-row__text"><strong>{p.nick}{p.user_id === userId ? ' (вы)' : ''} <em>{p.pts ?? '—'}</em></strong><small>{(p.roles || []).join(', ') || 'Без ролей'}{p.rank ? ` · ${p.rank}` : ''}</small></span></button><button type="button" className="pick-btn" disabled={!myTurn || Boolean(busy)} onClick={() => perform('pick', p.user_id)}><UserRound size={15} /> ВЫБРАТЬ</button></div>)}{visible.length === 0 && <div className="empty">Игроков с такой ролью не осталось</div>}</div></>}
      {error && <p className="lobby__error" role="alert">{error}</p>}
      <div className="draft__bottom">{draft.status === 'complete' ? <PrimaryButton onClick={() => onReady(draftTeams(draft, lobbyCode))}>СОСТАВЫ ГОТОВЫ — ОТКРЫТЬ МАТЧ</PrimaryButton> : <button type="button" className="btn btn--ghost" onClick={openLobby}>В лобби</button>}</div>
    </div>
  )
}
