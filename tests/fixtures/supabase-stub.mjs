// Стаб сервера для тестов интерфейса: вместо Supabase — простые функции,
// которые можно заставить тормозить или отказать. Нужен, чтобы проверять
// настоящие клики в jsdom, а не только текст исходников.
export const supabase = { from() {}, rpc() {}, auth: {} }
export const TELEGRAM_BOT_USERNAME = 'name_mlbb_bot'

export const state = (globalThis.__stubState = {
  loadout: { user_id: 'u1', frame_id: 'frame-default', banner_id: 'banner-none', plate_id: 'plate-none', title_id: 'title-none', color_id: 'color-default' },
  entitlements: [],
  calls: [],
  failNext: null,
  loadLatency: 0,
  equipLatency: 0,
  admin: false,
  publicProfile: null,
  publicLook: null,
  leaderboardRows: [],
})

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function resetStub(overrides = {}) {
  Object.assign(state, {
    loadout: { user_id: 'u1', frame_id: 'frame-default', banner_id: 'banner-none', plate_id: 'plate-none', title_id: 'title-none', color_id: 'color-default' },
    entitlements: [],
    calls: [],
    failNext: null,
    loadLatency: 0,
    equipLatency: 0,
    admin: false,
    publicProfile: null,
    publicLook: null,
    leaderboardRows: [],
  }, overrides)
  uploads.length = 0
}

export async function loadLoadout() {
  await wait(state.loadLatency)
  return { loadout: { ...state.loadout } }
}

export async function loadEntitlements() {
  await wait(state.loadLatency)
  return { entitlements: [...state.entitlements] }
}

export async function loadPublicLook() {
  await wait(state.loadLatency)
  return { ...(state.publicLook || state.loadout) }
}

export async function equipCosmetic(itemId) {
  state.calls.push(itemId)
  await wait(state.equipLatency)
  if (state.failNext) {
    const error = state.failNext
    state.failNext = null
    return { error }
  }
  // plate-* — это рамка имени; в базе слот называется plate_id, а вид — nameplate.
  const raw = itemId.split('-')[0]
  const kind = raw === 'plate' ? 'nameplate' : raw
  const key = kind === 'banner' ? 'banner_id' : kind === 'nameplate' ? 'plate_id' : `${kind}_id`
  state.loadout = { ...state.loadout, [key]: itemId }
  return { ok: true, kind, itemId }
}

export async function redeemCosmeticCode() { return { ok: true, itemId: 'frame-neon' } }

// --- своя шапка (картинка/анимация)
export const uploads = (globalThis.__stubUploads = [])

export function validateBanner(file) {
  if (!file) return 'Файл не выбран'
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) return 'Только JPG, PNG, WebP или GIF'
  if (file.size > 4 * 1024 * 1024) return 'Файл больше 4 МБ'
  return ''
}

export async function uploadBanner(file, userId) {
  const bad = validateBanner(file)
  if (bad) throw new Error(bad)
  const ext = (file.type || '').includes('gif') ? 'gif' : 'jpg'
  const url = `https://example.supabase.co/storage/v1/object/public/banners/${userId}/banner-${uploads.length}.${ext}`
  uploads.push({ userId, type: file.type, url })
  return url
}

export async function equipBannerMedia(itemId, url) {
  state.calls.push(itemId)
  await wait(state.equipLatency)
  if (!state.admin && !state.entitlements.includes(itemId)) return { error: 'locked' }
  if (itemId === 'banner-motion' && !/\.(gif|webp)$/i.test(url)) return { error: 'bad_format' }
  state.loadout = { ...state.loadout, banner_id: itemId, banner_url: url }
  return { ok: true, kind: 'banner', itemId, url }
}

// Админ: одно нажатие — все права на платные предметы.
export async function adminGrantAllPremium() {
  if (!state.admin) return { error: 'forbidden' }
  const ids = [
    'frame-neon', 'frame-diamond',
    'banner-neon', 'banner-aurora', 'banner-photo', 'banner-motion',
    'plate-gold', 'plate-gold-nick', 'plate-emerald', 'plate-ice', 'plate-crimson', 'plate-aurora',
    'title-pioneer', 'color-neon',
  ]
  for (const id of ids) if (!state.entitlements.includes(id)) state.entitlements.push(id)
  return { ok: true, entitlements: state.entitlements.length }
}

export async function clearBannerMedia() {
  state.loadout = { ...state.loadout, banner_url: '' }
  return { ok: true }
}

// Всё остальное, что импортирует screens.jsx.
export const uploadAvatar = async () => ({})
export const uploadScreenshot = async () => ({})
export const deleteScreenshot = async () => ({})
export const validateImage = () => null
export const createTelegramLinkCode = async () => ({})
export const cancelTelegramLink = async () => ({})
export const getTelegramLink = async () => null
export const getTelegramLinkStatus = async () => ({ link: null, needsReconfirm: false })
export const deleteTelegramLink = async () => ({})
export const notifyLobbyToTelegram = async () => ({})
export const getPublicProfile = async () => state.publicProfile
export const createSupportTicket = async () => ({})
export const fetchSupportTickets = async () => []
export const announceSupportTicket = async () => ({})
export const createLobby = async () => ({})
export const joinLobby = async () => ({})
export const leaveLobby = async () => ({})
export const loadLobby = async () => ({})
export const loadLobbyMembers = async () => []
export const setLobbyRoom = async () => ({})
export const setLobbyCheckedIn = async () => ({})
export const loadLeaderboardRanks = async () => ({ rows: state.leaderboardRows })
export const reportMatch = async () => ({})
export const confirmMatch = async () => ({})
export const disputeMatch = async () => ({})
export const loadMatchHistory = async () => []
export const transferLobbyHost = async () => ({})
