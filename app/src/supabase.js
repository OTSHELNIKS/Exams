import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const supabase = url && key ? createClient(url, key) : null

export function profileToRow(profile, gameId, userId) {
  return {
    user_id: userId, game_id: String(gameId || '').trim(), nick: String(profile.nick || '').trim(),
    age: String(profile.age || ''), gender: profile.gender || '', rank: profile.rank || '',
    roles: profile.roles || [], regions: profile.regions || [], bio: profile.bio || '',
    heroes: profile.heroes || [], hero_classes: profile.heroClasses || [],
    socials: (profile.socials || []).filter((x) => ['telegram', 'vk', 'google'].includes(x)).slice(0, 3),
    extra_slots: Math.max(0, Math.min(3, profile.extraSlots || 0)),
    avatar_url: profile.avatarUrl || '',
    screenshot_urls: (profile.screenshots || []).filter((u) => typeof u === 'string' && u.startsWith('http')),
    updated_at: new Date().toISOString(),
  }
}
export function rowToProfile(row, defaults) {
  return { ...defaults, nick: row.nick, age: row.age, gender: row.gender, rank: row.rank,
    roles: row.roles, regions: row.regions, bio: row.bio, heroes: row.heroes,
    heroClasses: row.hero_classes, socials: row.socials || [], extraSlots: row.extra_slots || 0,
    avatarUrl: row.avatar_url || '', screenshots: row.screenshot_urls || [],
    elo: row.pts === null || row.pts === undefined ? null : row.pts,
    isBanned: !!row.is_banned, banReason: row.ban_reason || '', avatar: null }
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export function validateImage(file) {
  if (!file) return 'Файл не выбран'
  if (!ALLOWED_TYPES.includes(file.type)) return 'Только изображения: JPG, PNG, WebP или GIF'
  if (file.size > MAX_IMAGE_BYTES) return 'Файл больше 5 МБ'
  return ''
}

function extOf(file) {
  const byType = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
  return byType[file.type] || 'jpg'
}

async function uploadToBucket(bucket, path, file) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600', upsert: true, contentType: file.type,
  })
  if (error) throw error
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

/** Upload avatar for the current user. Returns the public URL. */
export async function uploadAvatar(file, userId) {
  const err = validateImage(file)
  if (err) throw new Error(err)
  return uploadToBucket('avatars', `${userId}/avatar.${extOf(file)}`, file)
}

/** Upload one MLBB stat screenshot. Returns the public URL. */
export async function uploadScreenshot(file, userId) {
  const err = validateImage(file)
  if (err) throw new Error(err)
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return uploadToBucket('screenshots', `${userId}/${stamp}-${rand}.${extOf(file)}`, file)
}

/** Best-effort delete of a screenshot object by its public URL. */
export async function deleteScreenshot(publicUrl, userId) {
  try {
    const marker = '/screenshots/'
    const idx = publicUrl.indexOf(marker)
    if (idx === -1) return
    const path = publicUrl.slice(idx + marker.length)
    if (!path.startsWith(`${userId}/`)) return
    await supabase.storage.from('screenshots').remove([path])
  } catch { /* noop: URL row update is the source of truth */ }
}

export const TELEGRAM_BOT_USERNAME = 'name_mlbb_bot'
const LINK_CODE_TTL_MS = 10 * 60 * 1000

const TG_TIMEOUT_MS = 20000

/** Reject a hanging request so the UI never freezes silently. */
function withTimeout(promise, ms = TG_TIMEOUT_MS) {
  let timer = null
  const gate = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms)
  })
  return Promise.race([promise, gate]).finally(() => clearTimeout(timer))
}

export function functionsUrl(path) {
  return `${url}/functions/v1/${path}`
}

/** Issue a fresh 6-digit Telegram link code (valid 10 minutes). */
export async function createTelegramLinkCode(userId) {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  await withTimeout(supabase.from('telegram_link_codes').delete().eq('user_id', userId))
  const { error } = await withTimeout(supabase.from('telegram_link_codes').insert({
    code, user_id: userId,
    expires_at: new Date(Date.now() + LINK_CODE_TTL_MS).toISOString(),
  }))
  if (error) throw error
  return code
}

export async function getTelegramLink(userId) {
  const { data, error } = await withTimeout(supabase.from('telegram_links').select('*').eq('user_id', userId).maybeSingle())
  if (error) throw error
  return data
}

export async function deleteTelegramLink(userId) {
  const { error } = await withTimeout(supabase.from('telegram_links').delete().eq('user_id', userId))
  if (error) throw error
}

/** Mirror nick, avatar and screenshots into the moderation queue (best-effort). */
export async function syncModerationReviews(userId, { nick, avatarUrl, screenshots }) {
  const want = []
  const cleanNick = (nick || '').trim()
  if (cleanNick) want.push({ kind: 'nick', url: null, text_value: cleanNick })
  if (typeof avatarUrl === 'string' && avatarUrl.startsWith('http')) {
    want.push({ kind: 'avatar', url: avatarUrl, text_value: null })
  }
  const shots = [...new Set((screenshots || []).filter((u) => typeof u === 'string' && u.startsWith('http')))]
  shots.forEach((url) => want.push({ kind: 'screenshot', url, text_value: null }))
  const key = (r) => r.kind + '|' + (r.kind === 'nick' ? r.text_value : r.url)
  const { data: existing, error: selErr } = await supabase.from('moderation_reviews')
    .select('id, kind, url, text_value, status').eq('user_id', userId)
  if (selErr) throw selErr
  const rows = existing || []
  const wantKeys = new Set(want.map(key))
  const stale = rows.filter((r) => r.status === 'pending' && !wantKeys.has(key(r))).map((r) => r.id)
  if (stale.length) {
    const { error } = await supabase.from('moderation_reviews').delete().in('id', stale)
    if (error) throw error
  }
  const byKey = new Map(rows.map((r) => [key(r), r]))
  const fresh = want.filter((w) => !byKey.has(key(w)))
  if (fresh.length) {
    const { error } = await supabase.from('moderation_reviews')
      .insert(fresh.map((w) => ({ user_id: userId, kind: w.kind, url: w.url, text_value: w.text_value, status: 'pending' })))
    if (error) throw error
  }
  const resubmit = want.map(key).map((k) => byKey.get(k)).filter((r) => r && r.status === 'rejected').map((r) => r.id)
  if (resubmit.length) {
    const { error } = await supabase.from('moderation_reviews').update({ status: 'pending', reviewed_by: null, reviewed_at: null }).in('id', resubmit)
    if (error) throw error
  }
}

export async function clearPendingReviews(userId) {
  const { error } = await supabase.from('moderation_reviews')
    .delete().eq('user_id', userId).eq('status', 'pending')
  if (error) throw error
}

/** Ask the bot to DM the lobby ID to the current user's linked Telegram. */
export async function notifyLobbyToTelegram(lobbyId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('no_session')
  const r = await withTimeout(fetch(functionsUrl('telegram-bot?action=notify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ kind: 'lobby', lobbyId }),
  }))
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false) throw new Error(j.error || 'notify_failed')
  return true
}
