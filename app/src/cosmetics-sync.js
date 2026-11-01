// A public loadout contains only appearance IDs and the public banner URL.
// Re-fetch after changes and after reconnect, so views and RLS remain authoritative.
let nextChannel = 0
export function watchCosmeticChanges(client, userId, onChange) {
  if (!client || typeof client.channel !== 'function') return () => {}
  let active = true
  const notify = () => { if (active) onChange() }
  const filter = { event: '*', schema: 'public', table: 'cosmetic_loadout' }
  if (userId) filter.filter = `user_id=eq.${userId}`
  const channel = client.channel(`cosmetics:${userId || 'leaderboard'}:${++nextChannel}`)
    .on('postgres_changes', filter, notify)
    .subscribe((status) => { if (status === 'SUBSCRIBED') notify() })
  return () => {
    active = false
    if (typeof client.removeChannel === 'function') client.removeChannel(channel)
  }
}

const LOADOUT_FIELDS = { frame: 'frame_id', banner: 'banner_id', nameplate: 'plate_id', title: 'title_id', color: 'color_id' }
// Only confirmed server responses can be applied; do not accept arbitrary keys.
export function confirmedLoadoutPatch(change) {
  const patch = {}
  const field = LOADOUT_FIELDS[change?.kind]
  if (field && typeof change.itemId === 'string' && change.itemId) patch[field] = change.itemId
  if (typeof change?.bannerUrl === 'string') patch.banner_url = change.bannerUrl
  return patch
}
