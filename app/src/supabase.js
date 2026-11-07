import { createClient } from '@supabase/supabase-js'
import { parseLobbyReply, normalizeLobbyCode, normalizeRoomId, normalizeRoomPassword } from './lobby.js'
import { telegramBotUsername } from './telegram-config.js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const supabase = url && key ? createClient(url, key) : null

export function profileToRow(profile, gameId, gameServer, userId) {
  return {
    user_id: userId,
    game_id: String(gameId || '').trim(),
    game_server: String(gameServer || '').trim(),
    nick: String(profile.nick || '').trim(),
    age: String(profile.age || ''), gender: profile.gender || '', rank: profile.rank || '',
    roles: profile.roles || [], regions: profile.regions || [], bio: profile.bio || '',
    heroes: profile.heroes || [], hero_classes: profile.heroClasses || [],
    // В базу пишем "провайдер:ник" и не сохраняем пустые привязки.
    socials: (profile.socials || [])
      .map((x) => String(x || '').trim())
      .filter((x) => ['telegram', 'vk', 'google', 'tiktok'].includes(x.split(':')[0]))
      .filter((x) => x.includes(':') && x.split(':')[1].trim())
      .slice(0, 4),
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
    // Матчи и победы платформы: нужны для косметики и вех (100/500 матчей).
    matchesPlayed: row.matches_played || 0, wins: row.wins || 0,
    elo: row.pts === null || row.pts === undefined ? null : row.pts,
    // КДА/винрейт игры: те же цифры, что видит чужой игрок в карточке.
    gameKda: row.game_kda === null || row.game_kda === undefined ? null : Number(row.game_kda),
    gameWinrate: row.game_winrate === null || row.game_winrate === undefined ? null : Number(row.game_winrate),
    gameMatches: row.game_matches === null || row.game_matches === undefined ? null : Number(row.game_matches),
    gameStatsAt: row.game_stats_at || '',
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

// Free-plan storage is 1 GB for the whole project, so big phone photos are
// downscaled in the browser before upload (no server-side processing involved).
const MAX_UPLOAD_SIDE = 1600
const UPLOAD_QUALITY = 0.82
const COMPRESS_OVER_BYTES = 300 * 1024

/** Downscale/compress a photo client-side. Falls back to the original file. */
async function prepareImage(file) {
  if (file.type === 'image/gif') return file // keep animation
  if (file.size <= COMPRESS_OVER_BYTES) return file
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_UPLOAD_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    if (typeof bitmap.close === 'function') bitmap.close()
    const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/webp', UPLOAD_QUALITY) })
    if (!blob || blob.size >= file.size) return file
    const type = blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], base + (type === 'image/webp' ? '.webp' : '.jpg'), { type })
  } catch {
    return file
  }
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
  const prepared = await prepareImage(file)
  return uploadToBucket('avatars', `${userId}/avatar.${extOf(prepared)}`, prepared)
}

/** Upload one MLBB stat screenshot. Returns the public URL. */
export async function uploadScreenshot(file, userId) {
  const err = validateImage(file)
  if (err) throw new Error(err)
  const prepared = await prepareImage(file)
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return uploadToBucket('screenshots', `${userId}/${stamp}-${rand}.${extOf(prepared)}`, prepared)
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

// Шапка профиля: картинка или анимация. GIF не пережимаем — иначе умрёт
// анимация; статичные картинки ужимаем, чтобы 4 МБ лимит bucket не мешал.
const BANNER_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const BANNER_MAX_BYTES = 4 * 1024 * 1024
const BANNER_MAX_SIDE = 1920

export function validateBanner(file) {
  if (!file) return 'Файл не выбран'
  if (!BANNER_TYPES.includes(file.type)) return 'Только JPG, PNG, WebP или GIF'
  if (file.size > BANNER_MAX_BYTES) return 'Файл больше 4 МБ'
  return ''
}

/** Загрузить шапку в свой bucket и вернуть публичный адрес. */
export async function uploadBanner(file, userId) {
  const err = validateBanner(file)
  if (err) throw new Error(err)
  let prepared = file
  if (file.type !== 'image/gif' && file.size > 200 * 1024
      && typeof createImageBitmap === 'function' && typeof document !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, BANNER_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        if (typeof bitmap.close === 'function') bitmap.close()
        const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/webp', 0.85) })
        if (blob && blob.size < file.size) prepared = new File([blob], 'banner.webp', { type: 'image/webp' })
      }
    } catch { /* остаётся исходный файл */ }
  }
  const ext = extOf(prepared)
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 6)
  const { error } = await supabase.storage.from('banners').upload(
    `${userId}/banner-${stamp}-${rand}.${ext}`,
    prepared,
    { cacheControl: '3600', upsert: false, contentType: prepared.type },
  )
  if (error) throw error
  const { data } = supabase.storage.from('banners').getPublicUrl(`${userId}/banner-${stamp}-${rand}.${ext}`)
  return data.publicUrl
}

/** Надеть свою картинку/анимацию: сервер проверит право и формат. */
export async function equipBannerMedia(itemId, url) {
  const { data, error } = await supabase.rpc('equip_banner_media', { p_item_id: itemId, p_url: url })
  if (error) return { error: 'server', detail: error.message }
  if (data && data.error) return { error: data.error }
  return { ok: true, kind: 'banner', itemId: data.item_id, url: data.url }
}

/** Убрать свою картинку — вернуться к градиенту. */
export async function clearBannerMedia() {
  const { data, error } = await supabase.rpc('clear_banner_media')
  if (error) return { error: 'server', detail: error.message }
  if (data && data.error) return { error: data.error }
  return { ok: true }
}

export const TELEGRAM_BOT_USERNAME = telegramBotUsername(import.meta.env.VITE_TELEGRAM_BOT_USERNAME)
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

/** Публичная карточка игрока: безопасные поля чужого профиля.
 *  Источник — вьюха player_profiles_public: без Game ID, скриншотов, почты и бана. */
export async function getPublicProfile(userId) {
  if (!supabase) throw new Error('Нет подключения к серверу.')
  if (!userId) return null
  const { data, error } = await supabase
    .from('player_profiles_public')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data || null
}

/** Сервер создаёт одноразовую ссылку только для вошедшего пользователя. */
export async function createTelegramLinkCode() {
  if (!supabase) throw new Error('Нет подключения к серверу.')
  const { data, error } = await withTimeout(supabase.rpc('issue_telegram_link'))
  if (error) throw error
  if (data?.error === 'too_often') throw new Error('Подожди немного перед повторным запросом ссылки.')
  if (!data?.token || !/^[0-9a-f]{48}$/.test(data.token)) throw new Error('Не удалось получить ссылку. Войди в аккаунт и попробуй ещё раз.')
  return data.token
}

export async function cancelTelegramLink(token) {
  if (!supabase || !/^[0-9a-f]{48}$/.test(token || '')) return
  const { data, error } = await withTimeout(supabase.rpc('cancel_telegram_link', { p_token: token }))
  if (error || !data?.ok) throw new Error('Не удалось отменить ссылку; она истечёт автоматически.')
}

// Older schemas contain no verification columns. Such a row is visible to its
// owner for migration messaging, but is never treated as a trusted link.
export async function getTelegramLinkStatus(userId) {
  const { data, error } = await withTimeout(supabase.from('telegram_links').select('*').eq('user_id', userId).maybeSingle())
  if (error) throw error
  const verified = Boolean(data?.verified_at && data?.link_instance_id)
  return { link: verified ? data : null, needsReconfirm: Boolean(data && !verified) }
}
export async function getTelegramLink(userId) {
  return (await getTelegramLinkStatus(userId)).link
}

export async function deleteTelegramLink(userId) {
  const { data, error } = await withTimeout(supabase.from('telegram_links').delete().eq('user_id', userId).select('user_id'))
  if (error) throw error
  if (!Array.isArray(data) || data.length !== 1) throw new Error('Не удалось подтвердить отвязку Telegram.')
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

/** Create a support ticket for the signed-in player. Returns the created row. */
export async function createSupportTicket(userId, message) {
  const text = String(message || '').trim()
  if (text.length < 5) throw new Error('too_short')
  if (text.length > 2000) throw new Error('too_long')
  const { data, error } = await withTimeout(supabase.from('support_tickets')
    .insert({ user_id: userId, message: text })
    .select('id, num, message, status, created_at').single())
  if (error) throw error
  return data
}

/** Own support tickets, newest first. */
export async function fetchSupportTickets(userId) {
  const { data, error } = await withTimeout(supabase.from('support_tickets')
    .select('id, num, message, status, admin_reply, answered_at, created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(30))
  if (error) throw error
  return data || []
}

/** Ask the bot to announce a fresh ticket to the admins (best-effort, once). */
export async function announceSupportTicket(ticketId) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return false
    const r = await withTimeout(fetch(functionsUrl('telegram-bot?action=notify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ kind: 'support', ticketId }),
    }))
    const j = await r.json().catch(() => ({}))
    return Boolean(r.ok && j.ok)
  } catch { return false }
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

/* ------------------------------------------------------------------ лобби */

/**
 * Создать лобби в выбранном регионе. Код приглашения выдаёт база
 * (create_lobby), поэтому он всегда уникальный.
 * Возвращает { lobbyId, code, region } или { error }.
 */
export async function createLobby(region) {
  const { data, error } = await supabase.rpc('create_lobby', { p_region: region })
  if (error) return { error: 'server', detail: error.message }
  return parseLobbyReply(data)
}

/** Войти в лобби по шестизначному коду приглашения. */
export async function joinLobby(code) {
  const { data, error } = await supabase.rpc('join_lobby', { p_code: normalizeLobbyCode(code) })
  if (error) return { error: 'server', detail: error.message }
  return parseLobbyReply(data)
}

/** Выйти из лобби (хост при выходе закрывает комнату). */
export async function leaveLobby(lobbyId) {
  const { data, error } = await supabase.rpc('leave_lobby', { p_lobby_id: lobbyId })
  if (error) return { error: 'server', detail: error.message }
  if (data?.error) return { error: String(data.error) }
  return { ok: true }
}

/** Само лобби: регион, Room ID и пароль из игры. */
export async function loadLobby(lobbyId) {
  const { data, error } = await supabase
    .from('lobbies')
    .select('id, code, region, host_id, room_id, room_password, status, created_at')
    .eq('id', lobbyId)
    .maybeSingle()
  if (error) return { error: 'server', detail: error.message }
  if (!data) return { error: 'not_found' }
  return { lobby: data }
}

/** Состав лобби: ники без номеров серверов (только флаг same_server). */
export async function loadLobbyMembers(lobbyId) {
  const { data, error } = await supabase
    .from('lobby_members_public')
    .select('user_id, nick, avatar_url, rank, roles, checked_in, same_server, is_host, joined_at')
    .eq('lobby_id', lobbyId)
    .order('joined_at', { ascending: true })
  if (error) return { error: 'server', detail: error.message }
  return { members: data || [] }
}

/** Хост записывает Room ID и пароль, которые создал в игре. */
export async function setLobbyRoom(lobbyId, roomId, roomPassword) {
  const { data, error } = await supabase
    .from('lobbies')
    .update({
      room_id: normalizeRoomId(roomId),
      room_password: normalizeRoomPassword(roomPassword),
      updated_at: new Date().toISOString(),
    })
    .eq('id', lobbyId)
    .select('id')
    .maybeSingle()
  if (error) return { error: 'server', detail: error.message }
  if (!data) return { error: 'not_found' }
  return { ok: true }
}

/** «Я в игре»: игрок сам отмечается, что уже внутри комнаты MLBB. */
export async function setLobbyCheckedIn(lobbyId, userId, checkedIn) {
  const { data, error } = await supabase
    .from('lobby_members')
    .update({ checked_in: Boolean(checkedIn) })
    .eq('lobby_id', lobbyId)
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle()
  if (error) return { error: 'server', detail: error.message }
  if (!data) return { error: 'not_found' }
  return { ok: true }
}

/* ------------------------------------------------------ матчи и рейтинг */

/** Капитан отправляет результат. MMR не меняется до подтверждения соперником. */
export async function reportMatch({ teamA, teamB, winner, lobbyId = null }) {
  const { data, error } = await supabase.rpc('report_match', {
    p_team_a: teamA,
    p_team_b: teamB,
    p_winner: winner,
    p_lobby_id: lobbyId,
  })
  if (error) return { error: 'server', detail: error.message }
  return data && data.error ? { error: data.error } : { matchId: data.match_id, mode: data.mode }
}

/** Подтверждение от соперника: здесь и только здесь начисляется MMR. */
export async function confirmMatch(matchId) {
  const { data, error } = await supabase.rpc('confirm_match', { p_match_id: matchId })
  if (error) return { error: 'server', detail: error.message }
  return data && data.error ? { error: data.error } : { ok: true, changes: data.changes || [] }
}

/** «Результат неверный» — рейтинг не двигается, разбирает админ. */
export async function disputeMatch(matchId, reason = '') {
  const { data, error } = await supabase.rpc('dispute_match', { p_match_id: matchId, p_reason: reason })
  if (error) return { error: 'server', detail: error.message }
  return data && data.error ? { error: data.error } : { ok: true }
}

/** История матчей платформы: ники, счёт и изменение рейтинга. */
export async function loadMatchHistory(limit = 20) {
  const { data, error } = await supabase
    .from('match_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return { error: 'server', detail: error.message }
  return { matches: data || [] }
}

/** Рейтинг с местом и подписью ТОП-N по фактической позиции. */
export async function loadLeaderboardRanks(limit = 100) {
  const { data, error } = await supabase
    .from('leaderboard_ranks')
    .select('*')
    .order('position', { ascending: true })
    .limit(limit)
  if (error) return { error: 'server', detail: error.message }
  return { rows: data || [] }
}

/* --------------------------------------------------------------- косметика */

/** Что надето у игрока (null, если ничего не выбирал). */
export async function loadLoadout(userId) {
  const { data, error } = await supabase
    .from('cosmetic_loadout')
    .select('frame_id, banner_id, banner_url, plate_id, title_id, color_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return { error: 'server', detail: error.message }
  return { loadout: data || null }
}

/** Открытые права: коллекционные предметы из покупок и кодов. */
export async function loadEntitlements(userId) {
  const { data, error } = await supabase
    .from('entitlements')
    .select('item_id')
    .eq('user_id', userId)
  if (error) return { error: 'server', detail: error.message }
  return { entitlements: (data || []).map((row) => row.item_id) }
}

/** Надеть предмет. Сервер сам проверит условие — обойти нельзя. */
export async function equipCosmetic(itemId) {
  const { data, error } = await supabase.rpc('equip_cosmetic', { p_item_id: itemId })
  if (error) return { error: 'server', detail: error.message }
  if (data && data.error) return { error: data.error }
  return { ok: true, kind: data.kind, itemId: data.item_id }
}

/** Активировать код покупки. Один код — одно право, повторно не сработает. */
export async function redeemCosmeticCode(code) {
  const { data, error } = await supabase.rpc('redeem_cosmetic_code', { p_code: String(code || '').trim().toUpperCase() })
  if (error) return { error: 'server', detail: error.message }
  if (data && data.error) return { error: data.error }
  return { ok: true, itemId: data.item_id }
}

/** Передать лобби (и капитанство) участнику этой же комнаты. */
export async function transferLobbyHost(lobbyId, userId) {
  const { data, error } = await supabase.rpc('transfer_lobby_host', { p_lobby_id: lobbyId, p_user_id: userId })
  if (error) return { error: 'server', detail: error.message }
  if (data && data.error) return { error: data.error }
  return { ok: true, hostId: data.host_id }
}

/** Передать лобби по коду: экран матча знает код, а RPC ждёт id. */
export async function transferLobbyHostByCode(code, userId) {
  const normalized = String(code || '').trim().toUpperCase()
  if (!normalized) return { error: 'not_found' }
  const { data, error } = await supabase
    .from('lobbies')
    .select('id')
    .eq('code', normalized)
    .maybeSingle()
  if (error) return { error: 'server', detail: error.message }
  if (!data) return { error: 'not_found' }
  return transferLobbyHost(data.id, userId)
}

/** Оформление другого игрока: рамка и шапка видны в чужой карточке. */
export async function loadPublicLook(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase
    .from('cosmetic_loadouts_public')
    .select('frame_id, banner_id, banner_url, plate_id, title_id, color_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data || null
}

/** Админу: выдать себе права на весь платный контент (одно нажатие). */
export async function adminGrantAllPremium() {
  const { data, error } = await supabase.rpc('admin_grant_all_premium')
  if (error) return { error: 'server', detail: error.message }
  if (data && data.error) return { error: data.error }
  return { ok: true, entitlements: data.entitlements || 0 }
}
