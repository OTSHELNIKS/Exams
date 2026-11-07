import React from 'react'
export function MatchScreen({ teams, onTransferCaptain }) {
  return <div><p>{teams.teamA.map((p) => `${p.nick}${p.isCaptain ? ' капитан' : ''}`).join(', ')}</p><p>{teams.teamB.map((p) => `${p.nick}${p.isCaptain ? ' капитан' : ''}`).join(', ')}</p><button onClick={async () => { const result = await onTransferCaptain('b', 'c'); globalThis.__transferResult = result }}>Передать</button></div>
}
