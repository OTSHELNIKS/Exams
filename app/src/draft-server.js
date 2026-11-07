// Клиент серверного драфта. Состав и права определяются только в базе.
export async function findDraftLobby(client, code) {
  if (!client || !/^\d{6}$/.test(String(code || ''))) return { error: 'no_lobby' }
  try {
    const { data, error } = await client.from('lobbies').select('id,host_id,status').eq('code', code).maybeSingle()
    if (error) return { error: 'server' }
    return data ? { lobby: data } : { error: 'no_lobby' }
  } catch { return { error: 'server' } }
}

export async function draftAction(client, action, lobbyId, userId) {
  if (!client || !lobbyId) return { error: 'no_lobby' }
  const names = {
    get: 'get_lobby_draft', start: 'start_lobby_draft', pick: 'pick_lobby_draft_player',
    auto: 'auto_pick_lobby_draft_player', transfer: 'transfer_draft_captain',
  }
  if (!names[action]) return { error: 'server' }
  const args = { p_lobby_id: lobbyId }
  if (action === 'pick' || action === 'transfer') args.p_user_id = userId
  try {
    const { data, error } = await client.rpc(names[action], args)
    if (error) return { error: 'server' }
    return data && typeof data === 'object' ? data : { error: 'server' }
  } catch { return { error: 'server' } }
}

export function draftTeams(state, code) {
  return { teamA: state.team_a || [], teamB: state.team_b || [], lobbyId: state.lobby_id, lobbyCode: code }
}

const ERRORS = {
  no_lobby: 'Сначала создай лобби или войди в него по коду.',
  unauthorized: 'Войди в аккаунт, чтобы участвовать в драфте.',
  not_member: 'Ты не участник этого лобби.',
  closed: 'Лобби закрыто или драфт больше недоступен.',
  not_host: 'Начать драфт может только организатор лобби.',
  need_ten: 'Для драфта 5 на 5 нужно 10 участников в лобби.',
  bad_roster: 'Не удалось проверить состав. Обнови лобби и попробуй снова.',
  not_active: 'Драфт уже завершён или отменён.',
  not_turn: 'Сейчас ход другого капитана.',
  turn_expired: 'Время хода вышло. Подожди автоматического выбора.',
  too_early: 'Время хода ещё не истекло.',
  not_in_pool: 'Этот игрок уже выбран или отсутствует в лобби.',
  team_full: 'В команде уже пять игроков.',
  bad_target: 'Выбери другого участника своей команды.',
  not_teammate: 'Капитанство можно передать только своей команде.',
  not_captain: 'Передать капитанство может только действующий капитан.',
  server: 'Не удалось связаться с сервером. Попробуй ещё раз.',
}
export function describeDraftError(error) { return ERRORS[error] || ERRORS.server }
