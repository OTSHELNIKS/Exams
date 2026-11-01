// Stateful Supabase stand-in for a real App navigation test; no network calls.
import { state } from './supabase-stub.mjs'
export * from './supabase-stub.mjs'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const channels = new Set()
let session = { user: { id: 'u1', identities: [], app_metadata: {} } }
let authListener = null
const profile = { nick: 'QA', roles: [], regions: [], heroes: [], socials: [], matchesPlayed: 600, wins: 200, elo: 2000 }

export const supabase = {
  auth: {
    onAuthStateChange(cb) {
      let active = true
      authListener = cb
      setTimeout(() => { if (active) cb('INITIAL_SESSION', session) }, 0)
      return { data: { subscription: { unsubscribe() { active = false; authListener = null } } } }
    },
    getSession: async () => ({ data: { session } }),
    signOut: async () => ({}),
  },
  from(table) {
    const result = { data: table === 'player_profiles' ? profile : null, error: null }
    const query = {
      select() { return this }, eq() { return this }, order() { return this }, limit() { return this },
      upsert: async () => ({ error: null }), maybeSingle: async () => result,
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) },
    }
    return query
  },
  channel(name) {
    const entry = { name, filter: null, callback: null, active: true,
      on(_event, filter, callback) { this.filter = filter; this.callback = callback; return this },
      subscribe(callback) { this.status = callback; channels.add(this); setTimeout(() => { if (this.active) callback?.('SUBSCRIBED') }, 0); return this },
    }
    return entry
  },
  removeChannel(channel) { channel.active = false; channels.delete(channel) },
}
export function emitCosmetic(userId = 'u1') {
  for (const channel of channels) {
    const filter = channel.filter?.filter
    if (!filter || filter === `user_id=eq.${userId}`) channel.callback?.({ eventType: 'UPDATE', new: { user_id: userId } })
  }
}
export function channelCount() { return channels.size }
globalThis.__emitCosmetic = emitCosmetic
globalThis.__cosmeticChannelCount = channelCount
globalThis.__cosmeticReconnect = () => { for (const channel of channels) channel.status?.('SUBSCRIBED') }
globalThis.__changeUser = id => { session = id ? { user: { id, identities: [], app_metadata: {} } } : null; authListener?.('SIGNED_IN', session) }
export const profileToRow = () => ({})
export const rowToProfile = (row, defaults) => ({ ...defaults, ...row })
export const syncModerationReviews = async () => ({})
export const clearPendingReviews = async () => ({})
export const transferLobbyHostByCode = async () => ({})
// Capture at request start so tests can return an older response out of order.
export async function loadLoadout() {
  const snapshot = { ...state.loadout }
  const delay = state.appLoadDelay || 0
  await wait(delay)
  return state.appReadError ? { error: 'server' } : { loadout: snapshot }
}
export async function loadEntitlements() {
  const snapshot = [...state.entitlements]
  await wait(state.appLoadDelay || 0)
  return state.appReadError ? { error: 'server' } : { entitlements: snapshot }
}
export async function loadPublicLook() {
  const snapshot = { ...(state.publicLook || state.loadout) }
  await wait(state.appLoadDelay || 0)
  return snapshot
}
export async function loadLeaderboardRanks() {
  const snapshot = (state.leaderboardRows || []).map(row => row.user_id === 'u1' ? { ...row, ...state.loadout } : { ...row })
  await wait(state.appLoadDelay || 0)
  return { rows: snapshot }
}
