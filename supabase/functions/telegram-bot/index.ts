// NAME MLBB — Telegram bot (webhook).
// Edge function `telegram-bot`. Dependency-free: plain JS + fetch only.
//
// Routes:
//   POST /                       Telegram update incl. callback buttons (needs webhook secret)
//   POST /?action=notify         app -> notify: kind=lobby (self DM) or kind=support
//                                (announce own ticket to linked admins, once)
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
const BUILD = 'ticket-dialog-v2'

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

async function dbInsert(table, row) {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: svcHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify(row),
    })
    if (!r.ok) { console.error('db insert failed', table, r.status); return null }
    const j = await r.json().catch(() => null)
    return Array.isArray(j) ? j[0] : null
  } catch (e) {
    console.error('db insert threw', table, String(e))
    return null
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
const HELP_TEXT = '<b>NAME MLBB — команды</b>\n\n/profile — мой профиль и PTS\n/rating — топ-10 игроков\n/support — задать вопрос поддержке\n/unlink — отвязать Telegram\n/help — это сообщение'
const ADMIN_HELP = '\n\n<b>Модерация</b>\n/ban — заблокировать: <code>/ban НИК причина</code>\n/unban — разблокировать\n/users — последние пользователи\n/userinfo — карточка: <code>/userinfo НИК</code>\n/review — очередь проверки (ники, фото, скриншоты)\n/pending — сколько на проверке\n/tickets — открытые заявки\n/ticket — заявка: <code>/ticket 3</code>\n/reply — ответить на заявку: <code>/reply 3</code>, дальше просто текст\n/close — закрыть заявку'

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

// Telegram chats of every admin that linked their account.
async function adminChatIds() {
  const admins = await dbSelect('admins', { select: 'user_id' })
  if (admins.length === 0) return []
  const ids = admins.map((a) => a.user_id)
  const links = await dbSelect('telegram_links', { user_id: 'in.(' + ids.join(',') + ')', select: 'tg_chat_id' })
  return [...new Set(links.map((l) => l.tg_chat_id).filter((c) => c !== null && c !== undefined))]
}

// DM the same text to all linked admins. Returns how many messages went out.
async function notifyAdmins(text, exceptChatId, extra) {
  const chats = await adminChatIds()
  let sent = 0
  for (const chat of chats) {
    if (exceptChatId !== undefined && String(chat) === String(exceptChatId)) continue
    const res = await send(chat, text, extra)
    if (res && res.ok !== false) sent += 1
  }
  return sent
}

function ticketAnnounce(ticket, nick) {
  const when = String(ticket.created_at || new Date().toISOString()).slice(0, 16).replace('T', ' ')
  return '<b>Новая заявка поддержки #' + ticket.num + '</b>'
    + '\n' + esc(nick || 'Без ника') + ' · ' + esc(when)
    + '\n\n' + esc(String(ticket.message || '').slice(0, 500))
    + '\n\nНажми «Ответить» — текст отправишь обычным сообщением, команду писать не нужно.'
}

/* ---------------- ticket cards, buttons and dialog sessions ----------------
   Раньше админу приходилось набирать /reply 6 текст. Теперь он жмёт кнопку
   в карточке заявки, бот запоминает «жду текст» (таблица telegram_sessions)
   и принимает следующее обычное сообщение как ответ. */

const SESSION_TTL_MS = 20 * 60 * 1000

async function setSession(chatId, action, payload) {
  return dbUpsert('telegram_sessions', {
    chat_id: chatId,
    action,
    payload: payload || {},
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  }, 'chat_id')
}

async function clearSession(chatId) {
  return dbDelete('telegram_sessions', { chat_id: 'eq.' + chatId })
}

async function getSession(chatId) {
  const rows = await dbSelect('telegram_sessions', { chat_id: 'eq.' + chatId, select: '*' })
  const row = rows[0]
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await clearSession(chatId)
    return null
  }
  return row
}

function ticketKeyboard(num) {
  return { inline_keyboard: [
    [
      { text: '✍️ Ответить', callback_data: 't:reply:' + num },
      { text: '✅ Закрыть', callback_data: 't:close:' + num },
    ],
    [{ text: '⬅️ Все заявки', callback_data: 't:list' }],
  ] }
}

async function ticketCard(num) {
  const rows = await dbSelect('support_tickets', { num: 'eq.' + num, select: '*' })
  const ticket = rows[0]
  if (!ticket) return null
  const profs = await dbSelect('player_profiles', { user_id: 'eq.' + ticket.user_id, select: 'nick,game_id' })
  const who = profs[0]
    ? esc(profs[0].nick || 'Без ника') + ' (' + esc(profs[0].game_id || '—') + ')'
    : 'пользователь'
  const when = String(ticket.created_at || '').slice(0, 16).replace('T', ' ')
  let text = '<b>Заявка #' + ticket.num + '</b> · ' + (TICKET_STATUS[ticket.status] || ticket.status)
    + '\n' + who + ' · ' + when
    + '\n\n' + esc(String(ticket.message || ''))
  if (ticket.admin_reply) text += '\n\n<b>Ответ:</b> ' + esc(ticket.admin_reply)
  return { ticket, text }
}

async function sendTicketCard(chatId, num) {
  const card = await ticketCard(num)
  if (!card) { await send(chatId, 'Заявка #' + num + ' не найдена.'); return }
  await send(chatId, card.text, { reply_markup: ticketKeyboard(card.ticket.num) })
}

async function sendTicketList(chatId) {
  const open = await dbSelect('support_tickets',
    { status: 'eq.open', order: 'created_at.asc', limit: '20', select: 'num,user_id,message,created_at' })
  if (!open || open.length === 0) { await send(chatId, 'Открытых заявок нет.'); return }
  const ids = [...new Set(open.map((x) => x.user_id))]
  const profs = await dbSelect('player_profiles', { user_id: 'in.(' + ids.join(',') + ')', select: 'user_id,nick' })
  const names = {}
  profs.forEach((p) => { names[p.user_id] = p.nick || 'Без ника' })
  const lines = open.map((x) => {
    const when = String(x.created_at || '').slice(0, 16).replace('T', ' ')
    return '#' + x.num + ' · ' + esc(names[x.user_id] || '—') + ' · ' + when
      + '\n> ' + esc(String(x.message || '').slice(0, 120))
  })
  const buttons = open.slice(0, 12).map((x) => ({ text: '#' + x.num, callback_data: 't:open:' + x.num }))
  const rows = []
  for (let i = 0; i < buttons.length; i += 4) rows.push(buttons.slice(i, i + 4))
  await send(chatId,
    '<b>Открытые заявки</b>\n\n' + lines.join('\n\n') + '\n\nНажми номер заявки, чтобы открыть её.',
    { reply_markup: { inline_keyboard: rows } })
}

async function answerTicket(chatId, adminUserId, num, rawText) {
  const text = String(rawText || '').trim()
  if (text.length < 2) {
    await send(chatId, 'Ответ слишком короткий — напиши хотя бы пару слов.')
    return false
  }
  const rows = await dbSelect('support_tickets', { num: 'eq.' + num, select: '*' })
  const ticket = rows[0]
  if (!ticket) { await send(chatId, 'Заявка #' + num + ' не найдена.'); return false }
  await dbUpdate('support_tickets', { num: 'eq.' + num },
    { admin_reply: text, status: 'answered', answered_by: adminUserId, answered_at: new Date().toISOString() })
  await send(chatId, '✅ Ответ на заявку <b>#' + num + '</b> отправлен игроку.')
  const userChat = await linkedChatOf(ticket.user_id)
  if (userChat && String(userChat) !== String(chatId)) {
    await send(userChat, '<b>Ответ поддержки</b> (заявка #' + num + ')\n\n' + esc(text))
  }
  return true
}

async function closeTicket(chatId, num) {
  const rows = await dbSelect('support_tickets', { num: 'eq.' + num, select: '*' })
  const ticket = rows[0]
  if (!ticket) { await send(chatId, 'Заявка #' + num + ' не найдена.'); return false }
  if (ticket.status === 'closed') { await send(chatId, 'Заявка #' + num + ' уже закрыта.'); return false }
  await dbUpdate('support_tickets', { num: 'eq.' + num }, { status: 'closed' })
  await send(chatId, 'Заявка #' + num + ' закрыта.')
  const chat = await linkedChatOf(ticket.user_id)
  if (chat && String(chat) !== String(chatId)) await send(chat, 'Твоя заявка #' + num + ' закрыта.')
  return true
}

async function createTicket(chatId, userId, rawQuestion) {
  const question = String(rawQuestion || '').trim()
  if (question.length < 5) {
    await send(chatId, 'Опиши проблему подробнее — хотя бы пара слов.')
    return false
  }
  if (question.length > 2000) {
    await send(chatId, 'Слишком длинно — умести вопрос в 2000 символов.')
    return false
  }
  const created = await dbInsert('support_tickets', { user_id: userId, message: question })
  if (!created) { await send(chatId, 'Не получилось создать заявку. Попробуй позже.'); return false }
  await send(chatId, 'Заявка <b>#' + created.num + '</b> создана. Админ ответит сюда, в этот чат.')
  const profs = await dbSelect('player_profiles', { user_id: 'eq.' + userId, select: 'nick' })
  const sent = await notifyAdmins(ticketAnnounce(created, profs[0] && profs[0].nick), undefined,
    { reply_markup: ticketKeyboard(created.num) })
  if (sent > 0 && created.id) {
    await dbUpdate('support_tickets', { id: 'eq.' + created.id }, { notified_at: new Date().toISOString() })
  }
  return true
}

// Следующее обычное сообщение (без команды) в рамках начатого диалога.
async function handlePlainText(chatId, text) {
  const session = await getSession(chatId)
  if (!session) return false
  const payload = session.payload || {}

  if (session.action === 'reply') {
    const adm = await adminLink(chatId)
    if (!adm.link || !adm.admin) {
      await clearSession(chatId)
      await send(chatId, 'Эта команда только для администраторов.')
      return true
    }
    const num = parseInt(payload.num, 10)
    if (!num) {
      await clearSession(chatId)
      await send(chatId, 'Потерял номер заявки — открой её заново: /tickets')
      return true
    }
    if (await answerTicket(chatId, adm.link.user_id, num, text)) await clearSession(chatId)
    return true
  }

  if (session.action === 'support') {
    const links = await dbSelect('telegram_links', { tg_chat_id: 'eq.' + chatId, select: 'user_id' })
    if (!links[0]) {
      await clearSession(chatId)
      await send(chatId, linkPrompt())
      return true
    }
    if (await createTicket(chatId, links[0].user_id, text)) await clearSession(chatId)
    return true
  }

  await clearSession(chatId)
  return false
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

const KIND_TITLE = { screenshot: 'скриншот', nick: 'ник', avatar: 'фото профиля' }
const TICKET_STATUS = { open: 'открыта', answered: 'есть ответ', closed: 'закрыта' }

function reviewVerdict(rev, ok) {
  if (rev.kind === 'nick') {
    const nick = '\u00ab' + (rev.text_value || '') + '\u00bb'
    return ok ? 'Твой ник ' + nick + ' одобрен \u2705' : 'Твой ник ' + nick + ' отклонён \u274c. Смени его в анкете приложения.'
  }
  if (rev.kind === 'avatar') {
    return ok ? 'Твоё фото профиля одобрено \u2705' : 'Твоё фото профиля отклонено \u274c. Загрузи другое в анкете приложения.'
  }
  return ok ? 'Твой скриншот одобрен \u2705' : 'Твой скриншот отклонён \u274c. Загрузи другой в анкете приложения.'
}

function pendingSummary(rows) {
  if (!rows || rows.length === 0) return '0'
  const seen = {}
  const kinds = []
  rows.forEach((r) => {
    const k = KIND_TITLE[r.kind] || r.kind
    if (!seen[k]) { seen[k] = true; kinds.push(k) }
  })
  return rows.length + ' (' + kinds.join(', ') + ')'
}

async function sendReviewItem(adminChatId) {
  const rows = await dbSelect('moderation_reviews', { status: 'eq.pending', order: 'created_at.asc', limit: '1', select: '*' })
  const rev = rows[0]
  if (!rev) { await send(adminChatId, 'Очередь пуста — всё рассмотрено.'); return }
  const profs = await dbSelect('player_profiles', { user_id: 'eq.' + rev.user_id, select: 'nick,game_id' })
  const p = profs[0] || {}
  const when = String(rev.created_at || '').slice(0, 16).replace('T', ' ')
  const who = esc(p.nick || 'Без ника') + ' (' + esc(p.game_id || '—') + ')'
  const keyboard = { inline_keyboard: [[
    { text: '✅ Одобрить', callback_data: 'rev:approve:' + rev.id },
    { text: '❌ Отклонить', callback_data: 'rev:reject:' + rev.id },
  ]] }
  if (rev.kind === 'nick') {
    await send(adminChatId, '<b>Проверка ника</b>\n' + who + '\nНик: <b>' + esc(rev.text_value || '') + '</b>\nПрислан: ' + esc(when), { reply_markup: keyboard })
    return
  }
  const title = rev.kind === 'avatar' ? 'Проверка фото профиля' : 'Проверка скриншота'
  const caption = '<b>' + title + '</b>\n' + who + '\nПрислан: ' + esc(when)
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

async function handleSupportCallback(q) {
  const data = String((q && q.data) || '')
  const fromId = q && q.from ? q.from.id : null
  const msg = q ? q.message : null
  if (data !== 's:new' || !fromId || !msg) return
  const links = await dbSelect('telegram_links', { tg_chat_id: 'eq.' + fromId, select: 'user_id' })
  if (!links[0]) {
    await tg('answerCallbackQuery', {
      callback_query_id: q.id,
      text: 'Сначала привяжи аккаунт: Профиль → «Привязать Telegram».',
    })
    return
  }
  await setSession(fromId, 'support', {})
  await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Жду описание' })
  await send(fromId, 'Опиши проблему одним сообщением — команду писать не нужно.\nОтмена — /cancel.')
}

async function handleTicketCallback(q) {
  const data = String((q && q.data) || '')
  const fromId = q && q.from ? q.from.id : null
  const msg = q ? q.message : null
  if (!fromId || !msg) return
  const [, action, rawNum] = data.split(':')
  const adm = await adminLink(fromId)
  if (!adm || !adm.link || !adm.admin) {
    await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Только для администраторов.' })
    return
  }
  const chatId = msg.chat.id

  if (action === 'list') {
    await tg('answerCallbackQuery', { callback_query_id: q.id })
    await sendTicketList(chatId)
    return
  }

  const num = parseInt(rawNum || '', 10)
  if (!num) {
    await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Не понял номер заявки.' })
    return
  }

  if (action === 'open') {
    await tg('answerCallbackQuery', { callback_query_id: q.id })
    await sendTicketCard(chatId, num)
    return
  }

  if (action === 'reply') {
    const card = await ticketCard(num)
    if (!card) {
      await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Заявка не найдена.' })
      return
    }
    await setSession(chatId, 'reply', { num })
    await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Жду текст ответа' })
    await send(chatId, 'Отвечаю на заявку <b>#' + num + '</b>\n> '
      + esc(String(card.ticket.message || '').slice(0, 200))
      + '\n\nОтправь текст ответа следующим сообщением — команду писать не нужно.\nОтмена — /cancel.')
    return
  }

  if (action === 'close') {
    await closeTicket(chatId, num)
    await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Закрыто' })
    return
  }
}

async function handleCallback(q) {
  const data = (q && q.data) || ''
  const fromId = q && q.from ? q.from.id : null
  const msg = q ? q.message : null
  if (data.startsWith('t:')) { await handleTicketCallback(q); return }
  if (data.startsWith('s:')) { await handleSupportCallback(q); return }
  if (!data.startsWith('rev:') || !fromId || !msg) return
  const parts = data.split(':')
  const action = parts[1]
  const id = parts[2]
  const adm = await adminLink(fromId)
  if (!adm.link || !adm.admin) {
    await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Только для администраторов.' })
    return
  }
  const rows = await dbSelect('moderation_reviews', { id: 'eq.' + id, select: '*' })
  const rev = rows[0]
  if (!rev || rev.status !== 'pending') {
    await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Уже рассмотрено.' })
    return
  }
  const ok = action === 'approve'
  await dbUpdate('moderation_reviews', { id: 'eq.' + id },
    { status: ok ? 'approved' : 'rejected', reviewed_by: adm.link.user_id, reviewed_at: new Date().toISOString() })
  await tg('answerCallbackQuery', { callback_query_id: q.id, text: ok ? 'Одобрено ✅' : 'Отклонено ❌' })
  const profs = await dbSelect('player_profiles', { user_id: 'eq.' + rev.user_id, select: 'nick,game_id' })
  const who = profs[0] ? esc(profs[0].nick || 'Без ника') + ' (' + esc(profs[0].game_id || '—') + ')' : 'пользователь'
  const stamp = (ok ? '✅ Одобрено' : '❌ Отклонено') + ': ' + (KIND_TITLE[rev.kind] || 'проверка') + ' — ' + who
  if (msg.photo) {
    await tg('editMessageCaption', { chat_id: msg.chat.id, message_id: msg.message_id, caption: stamp, parse_mode: 'HTML' })
  } else {
    await tg('editMessageText', { chat_id: msg.chat.id, message_id: msg.message_id, text: stamp + '\n' + (rev.kind === 'nick' ? '«' + (rev.text_value || '') + '»' : rev.url), parse_mode: 'HTML', disable_web_page_preview: true })
  }
  const chat = await linkedChatOf(rev.user_id)
  if (chat && chat !== msg.chat.id) {
    await send(chat, reviewVerdict(rev, ok))
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

  // Начатый диалог («Ответить» / «Написать в поддержку»): команда не нужна.
  if (!text.startsWith('/') && !/^[0-9]{6}$/.test(text)) {
    if (await handlePlainText(chatId, text)) return
  }

  if (cmd === '/cancel' || cmd === '/отмена') {
    await clearSession(chatId)
    await send(chatId, 'Ок, отменил. Все команды — /help.')
    return
  }

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

  if (cmd === '/ban' || cmd === '/unban' || cmd === '/users' || cmd === '/userinfo' || cmd === '/review' || cmd === '/pending' || cmd === '/tickets' || cmd === '/ticket' || cmd === '/reply' || cmd === '/close') {
    const adm = await adminLink(chatId)
    if (!adm.link) { await send(chatId, linkPrompt()); return }
    if (!adm.admin) { await send(chatId, 'Эта команда только для администраторов.'); return }
    if (cmd === '/review') { await sendReviewItem(chatId); return }
    if (cmd === '/pending') {
      const rows = await dbSelect('moderation_reviews', { status: 'eq.pending', select: 'kind', limit: '100' })
      if (rows.length === 0) { await send(chatId, 'На проверке пусто.'); return }
      const n = { nick: 0, avatar: 0, screenshot: 0 }
      rows.forEach((r) => { if (n[r.kind] !== undefined) n[r.kind] += 1 })
      const bits = []
      if (n.nick) bits.push('ники: ' + n.nick)
      if (n.avatar) bits.push('фото: ' + n.avatar)
      if (n.screenshot) bits.push('скриншоты: ' + n.screenshot)
      await send(chatId, 'На проверке: <b>' + rows.length + '</b>' + (rows.length === 100 ? '+' : '') + ' (' + bits.join(', ') + '). Команда /review — смотреть по одному.')
      return
    }
    if (cmd === '/tickets') {
      await sendTicketList(chatId)
      return
    }
    if (cmd === '/ticket' || cmd === '/reply' || cmd === '/close') {
      const num = parseInt(parts[1] || '', 10)
      if (!num) { await send(chatId, 'Укажи номер заявки. Например: <code>/ticket 3</code>'); return }
      if (cmd === '/ticket') { await sendTicketCard(chatId, num); return }
      if (cmd === '/close') { await closeTicket(chatId, num); return }
      // /reply без текста — переходим в диалог: дальше просто сообщение.
      const replyText = parts.slice(2).join(' ').trim()
      const card = await ticketCard(num)
      if (!card) { await send(chatId, 'Заявка #' + num + ' не найдена.'); return }
      if (!replyText) {
        await setSession(chatId, 'reply', { num })
        await send(chatId, 'Отвечаю на заявку <b>#' + num + '</b>\n> '
          + esc(String(card.ticket.message || '').slice(0, 200))
          + '\n\nОтправь текст ответа следующим сообщением — команду писать не нужно.\nОтмена — /cancel.')
        return
      }
      await answerTicket(chatId, adm.link.user_id, num, replyText)
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
      const pend = await dbSelect('moderation_reviews', { user_id: 'eq.' + target.user_id, status: 'eq.pending', select: 'kind', limit: '100' })
      const lines = [
        '<b>' + esc(full.nick || 'Без ника') + '</b>' + (full.is_banned ? ' ⛔ ЗАБЛОКИРОВАН' : ''),
        'Game ID: <code>' + esc(full.game_id || '—') + '</code>',
        'PTS: <b>' + (full.pts === null || full.pts === undefined ? 0 : full.pts) + '</b>',
      ]
      if (full.rank) lines.push('Ранг: ' + esc(full.rank))
      if (full.is_banned && full.ban_reason) lines.push('Причина бана: ' + esc(full.ban_reason))
      lines.push('Telegram: ' + (linkRows[0] ? '@' + esc(linkRows[0].tg_username || '—') : 'не привязан'))
      lines.push('Скриншотов: ' + (full.screenshot_urls || []).length + ', на проверке: ' + pendingSummary(pend))
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

  if (cmd === '/support') {
    const links = await dbSelect('telegram_links', { tg_chat_id: 'eq.' + chatId, select: 'user_id' })
    if (!links[0]) { await send(chatId, linkPrompt()); return }
    const question = parts.slice(1).join(' ').trim()
    if (!question) {
      const mine = await dbSelect('support_tickets', { user_id: 'eq.' + links[0].user_id, select: 'num,status,created_at,admin_reply', order: 'created_at.desc', limit: '5' })
      const newBtn = { inline_keyboard: [[{ text: '✍️ Написать в поддержку', callback_data: 's:new' }]] }
      if (mine.length === 0) {
        await send(chatId, 'У тебя пока нет заявок. Нажми кнопку ниже — и просто опиши проблему сообщением.', { reply_markup: newBtn })
        return
      }
      const lines = mine.map((x) => {
        const when = String(x.created_at || '').slice(0, 16).replace('T', ' ')
        let s = '#' + x.num + ' · ' + (TICKET_STATUS[x.status] || x.status) + ' · ' + when
        if (x.status === 'answered' && x.admin_reply) s += '\nОтвет: ' + esc(x.admin_reply.slice(0, 200))
        return s
      })
      await send(chatId, '<b>Твои заявки</b>\n\n' + lines.join('\n\n'), { reply_markup: newBtn })
      return
    }
    await createTicket(chatId, links[0].user_id, question)
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
  if (!body || typeof body.kind !== 'string') return json({ ok: false, error: 'bad_request' }, 400)

  if (body.kind === 'support') {
    // Announce a ticket the caller owns to the admins' Telegram, exactly once.
    const id = String(body.ticketId === undefined ? '' : body.ticketId)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return json({ ok: false, error: 'bad_request' }, 400)
    }
    const rows = await dbSelect('support_tickets', { id: 'eq.' + id, select: '*' })
    const ticket = rows[0]
    if (!ticket || ticket.user_id !== user.id) return json({ ok: false, error: 'forbidden' }, 403)
    if (ticket.notified_at) return json({ ok: true, already: true, admins: 0 })
    const profs = await dbSelect('player_profiles', { user_id: 'eq.' + user.id, select: 'nick' })
    const admins = await notifyAdmins(ticketAnnounce(ticket, profs[0] && profs[0].nick), undefined,
      { reply_markup: ticketKeyboard(ticket.num) })
    await dbUpdate('support_tickets', { id: 'eq.' + id }, { notified_at: new Date().toISOString() })
    return json({ ok: true, admins })
  }

  if (body.kind !== 'lobby' || !/^[0-9]{4,12}$/.test(String(body.lobbyId === undefined ? '' : body.lobbyId))) {
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
  let hook = await tg('setWebhook', { url: fnUrl, secret_token: WEBHOOK_SECRET, drop_pending_updates: true })
  if (!hook || hook.ok !== true) {
    // Retry once: Telegram occasionally rejects a burst of setWebhook calls.
    await new Promise((resolve) => setTimeout(resolve, 700))
    hook = await tg('setWebhook', { url: fnUrl, secret_token: WEBHOOK_SECRET, drop_pending_updates: true })
  }
  const me = await tg('getMe', {})
  const cmds = await tg('setMyCommands', { commands: [
    { command: 'start', description: 'Начать / привязать аккаунт' },
    { command: 'profile', description: 'Мой профиль и PTS' },
    { command: 'rating', description: 'Топ-10 игроков' },
    { command: 'support', description: 'Вопрос поддержке' },
    { command: 'ban', description: 'Заблокировать (админ)' },
    { command: 'unban', description: 'Разблокировать (админ)' },
    { command: 'users', description: 'Пользователи (админ)' },
    { command: 'userinfo', description: 'Карточка игрока (админ)' },
    { command: 'review', description: 'Проверка анкет (админ)' },
    { command: 'pending', description: 'Сколько на проверке (админ)' },
    { command: 'tickets', description: 'Открытые заявки (админ)' },
    { command: 'ticket', description: 'Читать заявку (админ)' },
    { command: 'reply', description: 'Ответить на заявку (админ)' },
    { command: 'close', description: 'Закрыть заявку (админ)' },
    { command: 'unlink', description: 'Отвязать Telegram' },
    { command: 'help', description: 'Помощь' },
  ] })
  const hookOk = !!(hook && hook.ok === true)
  return json({
    ok: true,
    bot: (me && me.result && me.result.username) || null,
    webhook: fnUrl,
    setWebhook: hookOk,
    setWebhookError: hookOk ? null : ((hook && (hook.description || hook.error_code)) || 'no_response'),
    setCommands: !!(cmds && cmds.ok),
  })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method === 'GET' && url.searchParams.get('health') !== null) {
    return json({ ok: true, build: BUILD, time: new Date().toISOString() })
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
