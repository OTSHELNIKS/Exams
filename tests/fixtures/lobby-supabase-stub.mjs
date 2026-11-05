export * from './supabase-stub.mjs'

export const lobbyState = (globalThis.__lobbyTestState = {
  lobby: null,
  members: [],
  nextLoad: null,
  nextSave: null,
  failLeave: false,
})
export async function joinLobby(code) {
  return code === lobbyState.lobby?.code
    ? { lobbyId: lobbyState.lobby.id, code }
    : { error: 'not_found' }
}
export async function loadLobby() {
  const snapshot = { ...lobbyState.lobby }
  if (lobbyState.nextLoad) {
    const wait = lobbyState.nextLoad
    lobbyState.nextLoad = null
    await wait
  }
  return { lobby: snapshot }
}
export async function loadLobbyMembers() { return { members: lobbyState.members.map((m) => ({ ...m })) } }
export async function leaveLobby() { return lobbyState.failLeave ? { error: 'server' } : { ok: true } }
export async function setLobbyRoom(_id, roomId, roomPassword) {
  if (lobbyState.nextSave) {
    const wait = lobbyState.nextSave
    lobbyState.nextSave = null
    await wait
  }
  lobbyState.lobby.room_id = roomId
  lobbyState.lobby.room_password = roomPassword
  return { ok: true }
}
export async function setLobbyCheckedIn() { return { ok: true } }
