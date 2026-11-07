export * from '../../app/src/supabase.js'
let callback
export const loadLoadout = async () => ({ loadout: null })
export const loadEntitlements = async () => ({ entitlements: [] })
export const getTelegramLink = async () => null
export const getTelegramLinkStatus = async () => ({ link: null, needsReconfirm: false })
export const supabase = {
  auth: {
    onAuthStateChange(fn) { callback = fn; setTimeout(() => fn('INITIAL_SESSION', null), 0); return { data: { subscription: { unsubscribe() {} } } } },
    signOut() { callback('SIGNED_OUT', null) },
  },
  from() { return { select() { return this }, eq() { return this }, async maybeSingle() { return { data: null, error: null } } } },
}
globalThis.__accountSession = (user) => callback('SIGNED_IN', user ? { user } : null)
