import React, { useEffect, useRef, useState } from 'react'
import { MatchScreen } from './screens.jsx'
import { findDraftLobby, draftAction, draftTeams, describeDraftError } from './draft-server.js'
import { watchLobbyRefresh } from './lobby-refresh.js'

// Карточка матча никогда не использует сохранённый в браузере состав как истину.
export function ServerMatchScreen({ supabase, userId, lobbyCode, ...props }) {
  const [teams, setTeams] = useState(null)
  const [message, setMessage] = useState('Проверяем составы…')
  const generation = useRef(0)
  const sequence = useRef(0)
  const lobbyRef = useRef(null)

  const refresh = async () => {
    const gen = generation.current
    const seq = ++sequence.current
    let lobby = lobbyRef.current
    if (!lobby) {
      const result = await findDraftLobby(supabase, lobbyCode)
      if (gen !== generation.current || seq !== sequence.current) return
      if (result.error) { setTeams(null); setMessage(describeDraftError(result.error)); return }
      lobby = result.lobby; lobbyRef.current = lobby
    }
    const state = await draftAction(supabase, 'get', lobby.id)
    if (gen !== generation.current || seq !== sequence.current) return
    if (state.error || state.status !== 'complete') {
      setTeams(null)
      setMessage(state.error ? describeDraftError(state.error) : 'Составы ещё не готовы или драфт отменён.')
    } else { setTeams(draftTeams(state, lobbyCode)); setMessage('') }
  }

  useEffect(() => {
    generation.current += 1
    lobbyRef.current = null
    setTeams(null); setMessage('Проверяем составы…')
    if (!userId) { setMessage(describeDraftError('unauthorized')); return () => { generation.current += 1 } }
    void refresh()
    const stop = watchLobbyRefresh({ refresh, intervalMs: 5000 })
    return () => { generation.current += 1; stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, userId, lobbyCode])

  const transfer = async (_side, target) => {
    const gen = generation.current
    const lobby = lobbyRef.current
    if (!lobby) return { error: describeDraftError('no_lobby') }
    const result = await draftAction(supabase, 'transfer', lobby.id, target)
    if (gen !== generation.current) return { error: describeDraftError('closed') }
    if (result.error) { await refresh(); return { error: describeDraftError(result.error) } }
    ++sequence.current
    if (result.status !== 'complete') { setTeams(null); setMessage('Составы ещё не готовы или драфт отменён.'); return { error: describeDraftError('not_active') } }
    setTeams(draftTeams(result, lobbyCode))
    return { ok: true }
  }
  if (!teams) return <div className="screen match"><div className="empty-block"><p role="status">{message}</p><button type="button" className="btn btn--ghost" onClick={props.onBack}>К драфту</button></div></div>
  return <MatchScreen {...props} supabase={supabase} userId={userId} lobbyCode={lobbyCode} teams={teams} onTransferCaptain={transfer} />
}
