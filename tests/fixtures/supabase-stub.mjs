// Стаб сервера для тестов интерфейса: вместо Supabase — простые функции,
// которые можно заставить тормозить или отказать. Нужен, чтобы проверять
// настоящие клики в jsdom, а не только текст исходников.
export const supabase = { from() {}, rpc() {}, auth: {} }
export const TELEGRAM_BOT_USERNAME = 'name_mlbb_bot'

export const state = (globalThis.__stubState = {
  loadout: { user_id: 'u1', frame_id: 'frame-default', banner_id: 'banner-none', title_id: 'title-none', color_id: 'color-default' },
  entitlements: [],
  calls: [],
  failNext: null,
  loadLatency: 0,
  equipLatency: 0,
})

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function resetStub(overrides = {}) {
  Object.assign(state, {
    loadout: { user_id: 'u1', frame_id: 'frame-default', banner_id: 'banner-none', title_id: 'title-none', color_id: 'color-default' },
    entitlements: [],
    calls: [],
    failNext: null,
    loadLatency: 0,
    equipLatency: 0,
  }, overrides)
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
  return { ...state.loadout }
}

export async function equipCosmetic(itemId) {
  state.calls.push(itemId)
  await wait(state.equipLatency)
  if (state.failNext) {
    const error = state.failNext
    state.failNext = null
    return { error }
  }
  const kind = itemId.split('-')[0]
  const key = kind === 'banner' ? 'banner_id' : `${kind}_id`
  state.loadout = { ...state.loadout, [key]: itemId }
  return { ok: true, kind, itemId }
}

export async function redeemCosmeticCode() { return { ok: true, itemId: 'frame-neon' } }

// Всё остальное, что импортирует screens.jsx.
export const uploadAvatar = async () => ({})
export const uploadScreenshot = async () => ({})
export const deleteScreenshot = async () => ({})
export const validateImage = () => null
export const createTelegramLinkCode = async () => ({})
export const getTelegramLink = async () => null
export const deleteTelegramLink = async () => ({})
export const notifyLobbyToTelegram = async () => ({})
export const getPublicProfile = async () => null
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
export const loadLeaderboardRanks = async () => []
export const reportMatch = async () => ({})
export const confirmMatch = async () => ({})
export const disputeMatch = async () => ({})
export const loadMatchHistory = async () => []
export const transferLobbyHost = async () => ({})
