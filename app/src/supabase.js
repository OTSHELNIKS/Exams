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
    avatar_url: profile.avatarUrl || '',
    screenshot_urls: (profile.screenshots || []).filter((u) => typeof u === 'string' && u.startsWith('http')),
    updated_at: new Date().toISOString(),
  }
}
export function rowToProfile(row, defaults) {
  return { ...defaults, nick: row.nick, age: row.age, gender: row.gender, rank: row.rank,
    roles: row.roles, regions: row.regions, bio: row.bio, heroes: row.heroes,
    heroClasses: row.hero_classes, avatarUrl: row.avatar_url || '', screenshots: row.screenshot_urls || [],
    avatar: null }
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
