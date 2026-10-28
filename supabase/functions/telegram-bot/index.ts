// NAME MLBB — Telegram bot (webhook).
// Edge function `telegram-bot`. Dependency-free: plain JS + fetch only.
//
// Routes:
//   POST /                       Telegram update incl. callback buttons (needs webhook secret)
//   POST /?action=notify         app -> user notify (needs user JWT, notifies SELF only)
//   GET  /?setup=<SETUP_SECRET>  one-time webhook wiring by owner
//   GET  /?health=1              liveness probe
//
// User commands: /start /profile /rating /unlink /help.
// Admin (linked admin account): /ban /unban /users /userinfo /review /pending.
//
// Required function secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
// TELEGRAM_SETUP_SECRET. Optional: APP_PUBLIC_URL (link shown in bot messages).

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') || ''
const SETUP_SECRET = Deno.env.get('TELEGRAM_SETUP_SECRET') || ''
const APP_URL = Deno.env.get('APP_PUBLIC_URL') || ''
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '')
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const TG = 'https://api.telegram.org/bot' + BOT_TOKEN

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS),
  })
}

async function tg(method, payload) {
  try {
    const r = await fetch(TG + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.ok === false) console.error('tg api error', method, JSON.stringify(j).slice(0, 400))
    return j
  } catch (e) {
    console.error('tg fetch failed', method, String(e))
    return { ok: false }
  }
}

function send(chat_id, text, extra) {
  return tg('sendMessage', Object.assign({
    chat_id: chat_id, text: text, parse_mode: 'HTML', disable_web_page_preview: true,
  }, extra || {}))
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/* ---------------- tiny PostgREST + Auth client (service role) ---------------- */
function svcHeaders(extra) {
  return Object.assign(
    { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
    extra || {},
  )
}

async function dbSelect(table, params) {
  try {
    const q = new URLSearchParams(params || {}).toString()
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + (q ? '?' + q : ''), { headers: svcHeaders() })
    if (!r.ok) { console.error('db select failed', table, r.status); return [] }
    const j = await r.json().catch(() => [])
    return Array.isArray(j) ? j : []
  } catch (e) {
    console.error('db select threw', table, String(e))
    return []
  }
}

async function dbDelete(table, params) {
  try {
    const q = new URLSearchParams(params || {}).toString()
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + (q ? '?' + q : ''), {
      method: 'DELETE', headers: svcHeaders(),
    })
    if (!r.ok) console.error('db delete failed', table, r.status)
    return r.ok
  } catch (e) {
    console.error('db delete threw', table, String(e))
    return false
  }
}

async function dbUpsert(table, row, onConflict) {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?on_conflict=' + encodeURIComponent(onConflict), {
      method: 'POST',
      headers: svcHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(row),
    })
    if (!r.ok) console.error('db upsert failed', table, r.status)
    return r.ok
  } catch (e) {
    console.error('db upsert threw', table, String(e))
    return false
  }
}

async function dbUpdate(table, params, patch) {
  try {
    const q = new URLSearchParams(params || {}).toString()
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + (q ? '?' + q : ''), {
      method: 'PATCH',
      headers: svcHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify(patch),
    })
    if (!r.ok) console.error('db update failed', table, r.status)
    return r.ok
  } catch (e) {
    console.error('db update threw', table, String(e))
    return false
  }
}

async function authGetUser(jwt) {
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + jwt },
    })
    if (!r.ok) return null
    return await r.json().catch(() => null)
  } catch (e) {
    console.error('auth getUser threw', String(e))
    return null
  }
}

/* ---------------- bot logic ---------------- */
const HELP_TEXT = '<b>NAME MLBB — команды</b>\n\n/profile — мой профиль и PTS\n/rating — топ-10 игроков\n/unlink — отвязать Telegram\n/help — это сообщение'
const ADMIN_HELP = '\n\n<b>Модерация</b>\n/ban — заблокировать: <code>/ban НИК причина</code>\n/unban — разблокировать\n/users — последние пользователи\n/userinfo — карточка: <code>/userinfo НИК</code>\n/review — очередь скриншотов\n/pending — сколько на проверке'

function linkPrompt() {
  return 'Я не знаю, кто ты, пока ты не покажешь код из приложения. Как привязать (1 минута):'
    + '\n1) Войди в приложение по почте' + (APP_URL ? ': ' + APP_URL : '') + '.'
    + '\n2) Открой Профиль → «Привязать Telegram» — там появится код из 6 цифр.'
    + '\n3) Нажми «Открыть бота» и нажми START — либо просто отправь мне код сообщением.'
}

async function adminLink(chatId) {
  const links = await dbSelect('telegram_links', { tg_chat_id: 'eq.' + chatId, select: 'user_id' })
  if (links.length === 0) return { link: null, admin: false }
  const admins = await dbSelect('admins', { user_id: 'eq.' + links[0].user_id, select: 'user_id' })
  return { link: links[0], admin: admins.length > 0 }
}

async function linkedChatOf(userId) {
  const rows = await dbSelect('telegram_links', { user_id: 'eq.' + userId, select: 'tg_chat_id' })
  return rows[0] ? rows[0].tg_chat_id : null
}

// Find profiles by nick (exact, case-insensitive) or game_id (substring).
async function resolveTarget(words) {
  const cols = 'user_id,nick,game_id'
  const full = words.join(' ')
  let rows = await dbSelect('player_profiles', { nick: 'ilike.' + full, select: cols, limit: '5' })
  if (rows.length > 0) return { rows, idWords: words.length }
  rows = await dbSelect('player_profiles', { game_id: 'ilike.*' + full + '*', select: cols, limit: '5' })
  if (rows.length > 0) return { rows, idWords: words.length }
  if (words.length > 1) {
    rows = await dbSelect('player_profiles', { nick: 'ilike.' + words[0], select: cols, limit: '5' })
    if (rows.length > 0) return { rows, idWords: 1 }
    rows = await dbSelect('player_profiles', { game_id: 'ilike.*' + words[0] + '*', select: cols, limit: '5' })
    if (rows.length > 0) return { rows, idWords: 1 }
  }
  return { rows: [], idWords: words.length }
}

async function sendReviewItem(adminChatId) {
  const rows = await dbSelect('screenshot_reviews', { status: 'eq.pending', order: 'created_at.asc', limit: '1', select: '*' })
  const rev = rows[0]
  if (!rev) { await send(adminChatId, 'Очередь пуста — все скриншоты рассмотрены.'); return }
  const profs = await dbSelect('player_profiles', { user_id: 'eq.' + rev.user_id, select: 'nick,game_id' })
  const p = profs[0] || {}
  const when = String(rev.created_at || '').slice(0, 16).replace('T', ' ')
  const caption = '<b>Проверка скриншота</b>\n' + esc(p.nick || 'Без ника') + ' (' + esc(p.game_id || '—') + ')\nПрислан: ' + esc(when)
  const keyboard = { inline_keyboard: [[
    { text: '✅ Одобрить', callback_data: 'rev:approve:' + rev.id },
    { text: '❌ Отклонить', callback_data: 'rev:reject:' + rev.id },
  ]] }
  const res = await tg('sendPhoto', { chat_id: adminChatId, photo: rev.url, caption, parse_mode: 'HTML', reply_markup: keyboard })
  if (!res || res.ok === false) {
    await send(adminChatId, caption + '\n\nФото не загрузилось: ' + rev.url, { reply_markup: keyboard })
  }
}

async function linkByCode(chatId, tgUsername, rawCode) {
  const code = String(rawCode || '').trim()
  if (!/^[0-9]{6}$/.test(code)) return 'Код — это 6 цифр из приложения. Проверь и отправь ещё раз.'
  const rows = await dbSelect('telegram_link_codes', { code: 'eq.' + code, select: '*' })
  const row = rows[0]
  if (!row) return 'Такой код не найден. Получи свежий код в профиле приложения.'
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await dbDelete('telegram_link_codes', { code: 'eq.' + code })
    return 'Код истёк (живёт 10 минут). Получи новый в профиле.'
  }
  // One chat = one account: drop previous bindings of this chat, then link.
  await dbDelete('telegram_links', { tg_chat_id: 'eq.' + chatId })
  const ok = await dbUpsert('telegram_links',
    { user_id: row.user_id, tg_chat_id: chatId, tg_username: tgUsername || '' }, 'user_id')
  if (!ok) return 'Не получилось привязать. Попробуй позже.'
  await dbDelete('telegram_link_codes', { code: 'eq.' + code })
  const profs = await dbSelect('player_profiles', { user_id: 'eq.' + row.user_id, select: 'nick' })
  const nick = profs[0] && profs[0].nick ? ' «' + esc(profs[0].nick) + '»' : ''
  return 'Готово! Telegram привязан к профилю' + nick + '. Теперь сюда будут приходить уведомления о матчах.\n\n' + HELP_TEXT
}

async function handleCallback(q) {
  const data = (q && q.data) || ''
  const fromId = q && q.from ? q.from.id : null
  const msg = q ? q.message : null
  if (!data.startsWith('rev:') || !fromId || !msg) return
  const parts = data.split(':')
  const action = parts[1]
  const id = parts[2]
  const adm = await adminLink(fromId)
  if (!adm.link || !adm.admin) {
    await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Только для администраторов.' })
    return
  }
  const rows = await dbSelect('screenshot_reviews', { id: 'eq.' + id, select: '*' })
  const rev = rows[0]
  if (!rev || rev.status !== 'pending') {
    await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Уже рассмотрено.' })
    return
  }
  const ok = action === 'approve'
  await dbUpdate('screenshot_reviews', { id: 'eq.' + id },
    { status: ok ? 'approved' : 'rejected', reviewed_by: adm.link.user_id, reviewed_at: new Date().toISOString() })
  await tg('answerCallbackQuery', { callback_query_id: q.id, text: ok ? 'Одобрено ✅' : 'Отклонено ❌' })
  const profs = await dbSelect('player_profiles', { user_id: 'eq.' + rev.user_id, select: 'nick,game_id' })
  const who = profs[0] ? esc(profs[0].nick || 'Без ника') + ' (' + esc(profs[0].game_id || '—') + ')' : 'пользователь'
  const stamp = (ok ? '✅ Одобрено' : '❌ Отклонено') + ' — ' + who
  if (msg.photo) {
    await tg('editMessageCaption', { chat_id: msg.chat.id, message_id: msg.message_id, caption: stamp, parse_mode: 'HTML' })
  } else {
    await tg('editMessageText', { chat_id: msg.chat.id, message_id: msg.message_id, text: stamp + '\n' + rev.url, parse_mode: 'HTML', disable_web_page_preview: true })
  }
  const chat = await linkedChatOf(rev.user_id)
  if (chat && chat !== msg.chat.id) {
    await send(chat, ok ? 'Твой скриншот одобрен ✅' : 'Твой скриншот отклонён ❌. Загрузи другой в анкете приложения.')
  }
  await sendReviewItem(msg.chat.id)
}

async function handleUpdate(update) {
  if (update && update.callback_query) { await handleCallback(update.callback_query); return }
  const msg = update && update.message
  if (!msg || (msg.chat && msg.chat.type !== 'private') || typeof msg.text !== 'string') return
  const chatId = msg.chat.id
  const tgUsername = (msg.from && msg.from.username) || ''
  const text = msg.text.trim()
  const parts = text.split(/\s+/)
  const cmd = parts[0]
  const arg = parts[1]

  if (cmd === '/start') {
    if (arg) { await send(chatId, await linkByCode(chatId, tgUsername, arg)); return }
    const links = await dbSelect('telegram_links', { tg_chat_id: 'eq.' + chatId, select: '*' })
    if (links[0]) {
      const profs = await dbSelect('player_profiles', { user_id: 'eq.' + links[0].user_id, select: 'nick' })
      const nick = profs[0] && profs[0].nick ? ', ' + esc(profs[0].nick) : ''
      await send(chatId, 'С возвращением' + nick + '! Аккаунт уже привязан.\n\n' + HELP_TEXT)
    } else {
      await send(chatId, 'Привет! Я бот <b>NAME MLBB</b> — пришлю ID лобби и уведомления о матчах.\n\n' + linkPrompt())
    }
    return
  }
  if (/^[0-9]{6}$/.test(cmd) && !arg) { await send(chatId, await linkByCode(chatId, tgUsername, cmd)); return }

  if (cmd === '/profile') {
    const links = await dbSelect('telegram_links', { tg_chat_id: 'eq.' + chatId, select: '*' })
    if (!links[0]) { await send(chatId, linkPrompt()); return }
    const profs = await dbSelect('player_profiles', { user_id: 'eq.' + links[0].user_id, select: '*' })
    const p = profs[0]
    if (!p || !p.nick) { await send(chatId, 'Профиль пока пуст. Заполни анкету в приложении.'); return }
    const lines = [
      '<b>' + esc(p.nick) + '</b>',
      'PTS: <b>' + (p.pts === null || p.pts === undefined ? 0 : p.pts) + '</b>',
    ]
    if (p.rank) lines.push('Ранг: ' + esc(p.rank))
    if (p.roles && p.roles.length) lines.push('Роли: ' + esc(p.roles.join(', ')))
    if (p.game_id) lines.push('Game ID: <code>' + esc(p.game_id) + '</code>')
    await send(chatId, lines.join('\n'))
    return
  }

  if (cmd === '/rating') {
    const data = await dbSelect('player_profiles', { select: 'nick,game_id,pts', order: 'pts.desc', limit: '10' })
    if (!data || data.length === 0) { await send(chatId, 'Рейтинг пока пуст — стань первым!'); return }
    const medals = ['🥇', '🥈', '🥉']
    const lines = data.map((r, i) => (medals[i] || ((i + 1) + '.')) + ' ' + esc(r.nick || 'Без ника') + ' — <b>' + (r.pts || 0) + '</b> PTS')
    await send(chatId, '<b>Топ-10 NAME MLBB</b>\n\n' + lines.join('\n') + '\n\nПока все стартуют с 1000 PTS. Начисление за матчи включим следующим шагом.')
    return
  }

  if (cmd === '/ban' || cmd === '/unban' || cmd === '/users' || cmd === '/userinfo' || cmd === '/review' || cmd === '/pending') {
    const adm = await adminLink(chatId)
    if (!adm.link) { await send(chatId, linkPrompt()); return }
    if (!adm.admin) { await send(chatId, 'Эта команда только для администраторов.'); return }
    if (cmd === '/review') { await sendReviewItem(chatId); return }
    if (cmd === '/pending') {
      const rows = await dbSelect('screenshot_reviews', { status: 'eq.pending', select: 'id', limit: '100' })
      if (rows.length === 0) { await send(chatId, 'На проверке пусто.'); return }
      await send(chatId, 'На проверке: <b>' + rows.length + '</b>' + (rows.length === 100 ? '+' : '') + '. Команда /review — смотреть по одному.')
      return
    }
    if (cmd === '/users') {
      const rows = await dbSelect('player_profiles', { select: 'nick,game_id,is_banned', order: 'updated_at.desc', limit: '10' })
      if (rows.length === 0) { await send(chatId, 'Пользователей пока нет.'); return }
      const lines = rows.map((r) => (r.is_banned ? '⛔' : '•') + ' ' + esc(r.nick || 'Без ника') + ' (' + esc(r.game_id || '—') + ')')
      await send(chatId, '<b>Последние пользователи</b>\n\n' + lines.join('\n'))
      return
    }
    const words = parts.slice(1)
    if (words.length === 0) { await send(chatId, 'Укажи ник или game_id. Например: <code>' + cmd + ' STRANGER</code>'); return }
    const found = await resolveTarget(words)
    if (found.rows.length === 0) { await send(chatId, 'Никого не нашёл. Проверь ник или game_id.'); return }
    if (found.rows.length > 1) {
      const lines = found.rows.map((r) => '• ' + esc(r.nick || 'Без ника') + ' (' + esc(r.game_id || '—') + ')')
      await send(chatId, 'Нашлось несколько. Уточни:\n\n' + lines.join('\n'))
      return
    }
    const target = found.rows[0]
    if (cmd === '/unban') {
      await dbUpdate('player_profiles', { user_id: 'eq.' + target.user_id }, { is_banned: false, ban_reason: null, banned_at: null })
      await send(chatId, '✅ ' + esc(target.nick || 'Без ника') + ' разблокирован.')
      const chat = await linkedChatOf(target.user_id)
      if (chat && chat !== chatId) await send(chat, '✅ Блокировка твоего аккаунта снята.')
      return
    }
    if (cmd === '/userinfo') {
      const full = (await dbSelect('player_profiles', { user_id: 'eq.' + target.user_id, select: '*' }))[0]
      if (!full) { await send(chatId, 'Профиль не найден.'); return }
      const linkRows = await dbSelect('telegram_links', { user_id: 'eq.' + target.user_id, select: 'tg_username' })
      const pend = await dbSelect('screenshot_reviews', { user_id: 'eq.' + target.user_id, status: 'eq.pending', select: 'id', limit: '100' })
      const lines = [
        '<b>' + esc(full.nick || 'Без ника') + '</b>' + (full.is_banned ? ' ⛔ ЗАБЛОКИРОВАН' : ''),
        'Game ID: <code>' + esc(full.game_id || '—') + '</code>',
        'PTS: <b>' + (full.pts === null || full.pts === undefined ? 0 : full.pts) + '</b>',
      ]
      if (full.rank) lines.push('Ранг: ' + esc(full.rank))
      if (full.is_banned && full.ban_reason) lines.push('Причина бана: ' + esc(full.ban_reason))
      lines.push('Telegram: ' + (linkRows[0] ? '@' + esc(linkRows[0].tg_username || '—') : 'не привязан'))
      lines.push('Скриншотов: ' + (full.screenshot_urls || []).length + ', на проверке: ' + pend.length)
      await send(chatId, lines.join('\n'))
      return
    }
    // /ban
    const reason = words.slice(found.idWords).join(' ')
    await dbUpdate('player_profiles', { user_id: 'eq.' + target.user_id }, { is_banned: true, ban_reason: reason || null, banned_at: new Date().toISOString() })
    await send(chatId, '⛔ ' + esc(target.nick || 'Без ника') + ' заблокирован.' + (reason ? '\nПричина: ' + esc(reason) : ''))
    const userChat = await linkedChatOf(target.user_id)
    if (userChat && userChat !== chatId) {
      await send(userChat, '⛔ Твой аккаунт заблокирован.' + (reason ? '\nПричина: ' + esc(reason) : ''))
    }
    return
  }

  if (cmd === '/unlink') {
    await dbDelete('telegram_links', { tg_chat_id: 'eq.' + chatId })
    await send(chatId, 'Готово, Telegram отвязан. Уведомления приходить не будут.')
    return
  }

  if (cmd === '/help') {
    const adm = await adminLink(chatId)
    await send(chatId, adm.admin ? HELP_TEXT + ADMIN_HELP : HELP_TEXT)
    return
  }

  await send(chatId, 'Не понял команду. Вот что я умею:\n\n' + HELP_TEXT)
}

async function handleNotify(req) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/)
  if (!m) return json({ ok: false, error: 'no_auth' }, 401)
  const user = await authGetUser(m[1])
  if (!user || !user.id) return json({ ok: false, error: 'bad_token' }, 401)
  let body = {}
  try { body = await req.json() } catch (e) { body = {} }
  if (!body || body.kind !== 'lobby' || !/^[0-9]{4,12}$/.test(String(body.lobbyId === undefined ? '' : body.lobbyId))) {
    return json({ ok: false, error: 'bad_request' }, 400)
  }
  const links = await dbSelect('telegram_links', { user_id: 'eq.' + user.id, select: '*' })
  if (!links[0]) return json({ ok: false, error: 'not_linked' }, 404)
  await send(links[0].tg_chat_id, '🎮 <b>Лобби готово!</b>\n\nID лобби: <code>' + esc(String(body.lobbyId)) + '</code>\n\nСкопируй ID и заходи в игру. Удачи!')
  return json({ ok: true })
}

async function handleSetup(url) {
  if (!SETUP_SECRET || url.searchParams.get('setup') !== SETUP_SECRET) {
    return json({ ok: false, error: 'forbidden' }, 403)
  }
  if (!BOT_TOKEN) return json({ ok: false, error: 'no_bot_token' }, 500)
  if (!WEBHOOK_SECRET) return json({ ok: false, error: 'no_webhook_secret' }, 500)
  const fnUrl = SUPABASE_URL + '/functions/v1/telegram-bot'
  const hook = await tg('setWebhook', { url: fnUrl, secret_token: WEBHOOK_SECRET, drop_pending_updates: true })
  const me = await tg('getMe', {})
  const cmds = await tg('setMyCommands', { commands: [
    { command: 'start', description: 'Начать / привязать аккаунт' },
    { command: 'profile', description: 'Мой профиль и PTS' },
    { command: 'rating', description: 'Топ-10 игроков' },
    { command: 'ban', description: 'Заблокировать (админ)' },
    { command: 'unban', description: 'Разблокировать (админ)' },
    { command: 'users', description: 'Пользователи (админ)' },
    { command: 'userinfo', description: 'Карточка игрока (админ)' },
    { command: 'review', description: 'Проверка скриншотов (админ)' },
    { command: 'pending', description: 'Сколько на проверке (админ)' },
    { command: 'unlink', description: 'Отвязать Telegram' },
    { command: 'help', description: 'Помощь' },
  ] })
  return json({ ok: true, bot: (me && me.result && me.result.username) || null, webhook: fnUrl, setWebhook: !!(hook && hook.ok), setCommands: !!(cmds && cmds.ok) })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method === 'GET' && url.searchParams.get('health') !== null) {
    return json({ ok: true, time: new Date().toISOString() })
  }
  if (req.method === 'GET' && url.searchParams.has('setup')) return handleSetup(url)
  if (req.method === 'POST' && url.searchParams.get('action') === 'notify') {
    try { return await handleNotify(req) } catch (e) {
      console.error('notify failed', String(e)); return json({ ok: false, error: 'internal' }, 500)
    }
  }
  if (req.method === 'POST') {
    // Telegram update: must carry our webhook secret; always 200 to avoid retry loops.
    try {
      if (!WEBHOOK_SECRET || req.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
        return json({ ok: false, error: 'forbidden' }, 403)
      }
      const update = await req.json().catch(() => null)
      if (update) await handleUpdate(update)
    } catch (e) {
      console.error('update failed', String(e))
    }
    return json({ ok: true })
  }
  return json({ ok: false, error: 'not_found' }, 404)
})
