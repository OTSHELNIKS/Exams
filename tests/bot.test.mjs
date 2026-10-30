// NAME MLBB — Telegram bot logic tests (no network, no Telegram).
// Mocks Deno + fetch, loads the REAL function source, drives it with fake updates.
// Run: node tests/bot.test.mjs   (zero dependencies)
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const BOT_SRC = join(here, '../supabase/functions/telegram-bot/index.ts')
const BOT_TMP = '/tmp/name-bot-under-test.mjs'

const SECRET = 'TESTSECRET'
const calls = { tg: [], db: [] }
let SCEN = {}

function J(status, json) {
  return { ok: status >= 200 && status < 300, status, json: async () => json }
}

globalThis.Deno = {
  env: {
    get: (k) => ({
      TELEGRAM_BOT_TOKEN: 'TESTTOKEN',
      TELEGRAM_WEBHOOK_SECRET: SECRET,
      TELEGRAM_SETUP_SECRET: 'TESTSETUP',
      APP_PUBLIC_URL: 'https://example.test',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'SRKEY',
    }[k] || ''),
  },
  serve: (h) => { globalThis.__handler = h },
}

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url)
  if (u.startsWith('https://api.telegram.org/bot')) {
    const method = u.slice(u.lastIndexOf('/') + 1)
    const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData
    calls.tg.push({ method, payload: isForm ? { form: true } : JSON.parse(opts.body || '{}') })
    if (method === 'getMe') return J(200, { ok: true, result: { username: 'name_mlbb_bot' } })
    // Telegram не смог скачать картинку по ссылке — бот должен залить файл.
    if (method === 'sendPhoto' && SCEN.photoFail && !isForm) {
      return J(400, { ok: false, error_code: 400, description: 'wrong file identifier/HTTP URL specified' })
    }
    return J(200, { ok: true, result: {} })
  }
  if (u.startsWith('https://example.test/')) {
    if (SCEN.avatarFail) return { ok: false, status: 404, blob: async () => null }
    return {
      ok: true,
      status: 200,
      blob: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }),
    }
  }
  if (u.includes('/auth/v1/user')) {
    const ok = (opts.headers || {}).Authorization === 'Bearer GOODJWT'
    return ok ? J(200, { id: 'user-1' }) : J(401, {})
  }
  const m = u.match(/\/rest\/v1\/([^?]+)(\?(.*))?$/)
  assert.ok(m, 'unexpected url ' + u)
  const table = m[1]
  const params = new URLSearchParams(m[3] || '')
  const method = (opts.method || 'GET').toUpperCase()
  const body = opts.body ? JSON.parse(opts.body) : null
  calls.db.push({ method, table, params: Object.fromEntries(params), body })
  const h = SCEN[table]
  if (method === 'GET') {
    const rows = typeof h === 'function' ? h({ params, calls }) : (h || [])
    return J(200, rows)
  }
  const hk = method + ' ' + table
  const hw = SCEN[hk] !== undefined ? SCEN[hk] : h
  const out = typeof hw === 'function' ? hw({ params, calls, body }) : (hw !== undefined ? hw : {})
  return J(200, out)
}

// ---- load real bot source ----
writeFileSync(BOT_TMP, readFileSync(BOT_SRC, 'utf8'))
await import(BOT_TMP + '?t=' + Date.now())
assert.ok(globalThis.__handler, 'bot did not call Deno.serve')

async function post(path, { headers = {}, body = null } = {}) {
  const res = await globalThis.__handler(new Request('http://localhost/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === null ? null : JSON.stringify(body),
  }))
  return { status: res.status, json: JSON.parse(await res.text()) }
}
async function get(path) {
  const res = await globalThis.__handler(new Request('http://localhost/' + path))
  return { status: res.status, json: JSON.parse(await res.text()) }
}
const H = { 'x-telegram-bot-api-secret-token': SECRET }
const upd = (text, chat = 111) => ({
  message: { chat: { id: chat, type: 'private' }, from: { id: chat, username: 'tester' }, text },
})
const tgTexts = () => calls.tg.filter((c) => c.method === 'sendMessage').map((c) => c.payload.text).join('\n---\n')
const tgTo = (chatId) => calls.tg.filter((c) => c.payload && c.payload.chat_id === chatId)
function reset(scen = {}) { SCEN = scen; calls.tg.length = 0; calls.db.length = 0 }

const tests = []
const t = (name, fn) => tests.push([name, fn])
const FUTURE = new Date(Date.now() + 3600e3).toISOString()
const PAST = new Date(Date.now() - 3600e3).toISOString()
const ADMIN = [{ user_id: 'admin-1' }]

t('T-BOT-01 health returns ok', async () => {
  const r = await get('?health=1')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
})

t('T-BOT-02 update without webhook secret is rejected', async () => {
  const r = await post('', { body: upd('/start') })
  assert.equal(r.status, 403)
})

t('T-BOT-03 /start for stranger shows link steps', async () => {
  reset({ telegram_links: [] })
  const r = await post('', { headers: H, body: upd('/start') })
  assert.equal(r.status, 200)
  assert.match(tgTexts(), /Как привязать/)
  assert.match(tgTexts(), /Привязать Telegram/)
})

t('T-BOT-04 valid link code binds chat to account', async () => {
  reset({
    telegram_link_codes: [{ code: '123456', user_id: 'user-1', expires_at: FUTURE }],
    player_profiles: [{ nick: 'STRANGER' }],
  })
  await post('', { headers: H, body: upd('123456') })
  assert.match(tgTexts(), /Готово! Telegram привязан/)
  assert.match(tgTexts(), /STRANGER/)
  const up = calls.db.find((c) => c.method === 'POST' && c.table === 'telegram_links')
  assert.ok(up, 'expected upsert into telegram_links')
  assert.equal(up.body.tg_chat_id, 111)
  assert.equal(up.body.user_id, 'user-1')
})

t('T-BOT-05 expired code is refused and deleted', async () => {
  reset({ telegram_link_codes: [{ code: '000001', user_id: 'user-1', expires_at: PAST }] })
  await post('', { headers: H, body: upd('000001') })
  assert.match(tgTexts(), /Код истёк/)
  const del = calls.db.find((c) => c.method === 'DELETE' && c.table === 'telegram_link_codes')
  assert.ok(del, 'expected expired code to be deleted')
})

t('T-BOT-06 unknown code is refused', async () => {
  reset({ telegram_link_codes: [] })
  await post('', { headers: H, body: upd('999999') })
  assert.match(tgTexts(), /не найден/)
})

t('T-BOT-07 /profile shows linked user stats', async () => {
  reset({
    telegram_links: [{ user_id: 'user-1' }],
    player_profiles: [{ nick: 'STRANGER', pts: 1000, rank: 'Mythic', roles: ['Маг'], game_id: '123' }],
  })
  await post('', { headers: H, body: upd('/profile') })
  assert.match(tgTexts(), /STRANGER/)
  assert.match(tgTexts(), /1000/)
})

t('T-BOT-08 /rating orders by PTS desc', async () => {
  reset({ player_profiles: [{ nick: 'Zed', pts: 2000 }, { nick: 'Amy', pts: 1000 }] })
  await post('', { headers: H, body: upd('/rating') })
  assert.match(tgTexts(), /Топ-10/)
  assert.ok(tgTexts().indexOf('Zed') < tgTexts().indexOf('Amy'), 'rating order wrong')
})

t('T-BOT-09 non-admin is stopped at /ban', async () => {
  reset({ telegram_links: [{ user_id: 'user-1' }], admins: [] })
  await post('', { headers: H, body: upd('/ban Amy spam') })
  assert.match(tgTexts(), /только для администраторов/)
})

t('T-BOT-10 admin /ban writes ban and DMs the user', async () => {
  reset({
    telegram_links: ({ params }) => (params.get('user_id') ? [{ tg_chat_id: 222 }] : ADMIN),
    admins: ADMIN,
    player_profiles: ({ params }) => (params.get('nick') === 'ilike.Amy' ? [{ user_id: 'u2', nick: 'Amy', game_id: '1' }] : []),
  })
  await post('', { headers: H, body: upd('/ban Amy спам', 999) })
  const patch = calls.db.find((c) => c.method === 'PATCH' && c.table === 'player_profiles')
  assert.ok(patch, 'expected ban PATCH')
  assert.equal(patch.body.is_banned, true)
  assert.equal(patch.body.ban_reason, 'спам')
  assert.match(tgTexts(), /заблокирован/)
  assert.match(tgTexts(), /спам/)
  const dm = tgTo(222).map((c) => c.payload.text).join(' ')
  assert.match(dm, /заблокирован/)
})

t('T-BOT-11 admin /pending breaks down by kind', async () => {
  reset({
    telegram_links: ADMIN, admins: ADMIN,
    moderation_reviews: [{ kind: 'nick' }, { kind: 'screenshot' }],
  })
  await post('', { headers: H, body: upd('/pending', 999) })
  assert.match(tgTexts(), /На проверке: <b>2<\/b>/)
  assert.match(tgTexts(), /ники: 1/)
  assert.match(tgTexts(), /скриншоты: 1/)
})

t('T-BOT-12 /review shows nick as text with buttons', async () => {
  reset({
    telegram_links: ADMIN, admins: ADMIN,
    moderation_reviews: [{ id: 'rev-1', kind: 'nick', text_value: 'BadNick', user_id: 'user-1', status: 'pending', created_at: '2026-10-29T10:00:00Z' }],
    player_profiles: [{ nick: 'User1', game_id: '777' }],
  })
  await post('', { headers: H, body: upd('/review', 999) })
  assert.match(tgTexts(), /Проверка ника/)
  assert.match(tgTexts(), /BadNick/)
  const msg = calls.tg.find((c) => c.method === 'sendMessage')
  const data = msg.payload.reply_markup.inline_keyboard[0].map((b) => b.callback_data).join(' ')
  assert.match(data, /rev:approve:rev-1/)
  assert.match(data, /rev:reject:rev-1/)
})

t('T-BOT-13 /review shows screenshot as photo', async () => {
  reset({
    telegram_links: ADMIN, admins: ADMIN,
    moderation_reviews: [{ id: 'rev-2', kind: 'screenshot', url: 'https://example.test/s.png', user_id: 'user-1', status: 'pending', created_at: '2026-10-29T10:00:00Z' }],
    player_profiles: [{ nick: 'User1', game_id: '777' }],
  })
  await post('', { headers: H, body: upd('/review', 999) })
  const photo = calls.tg.find((c) => c.method === 'sendPhoto')
  assert.ok(photo, 'expected sendPhoto')
  assert.equal(photo.payload.photo, 'https://example.test/s.png')
  assert.match(photo.payload.caption, /Проверка скриншота/)
})

t('T-BOT-14 approve callback updates DB, stamps, notifies, continues queue', async () => {
  const rev = { id: 'rev-1', kind: 'nick', text_value: 'BadNick', user_id: 'user-1', status: 'pending' }
  reset({
    telegram_links: ({ params }) => (params.get('user_id') ? [{ tg_chat_id: 111 }] : ADMIN),
    admins: ADMIN,
    moderation_reviews: ({ params }) => (params.get('id') ? [rev] : []),
    player_profiles: [{ nick: 'User1', game_id: '777' }],
  })
  const q = { callback_query: { id: 'cq1', from: { id: 999 }, data: 'rev:approve:rev-1', message: { message_id: 5, chat: { id: 999 } } } }
  const r = await post('', { headers: H, body: q })
  assert.equal(r.status, 200)
  const patch = calls.db.find((c) => c.method === 'PATCH' && c.table === 'moderation_reviews')
  assert.ok(patch, 'expected review PATCH')
  assert.equal(patch.body.status, 'approved')
  const ans = calls.tg.find((c) => c.method === 'answerCallbackQuery')
  assert.equal(ans.payload.text, 'Одобрено ✅')
  const edit = calls.tg.find((c) => c.method === 'editMessageText')
  assert.match(edit.payload.text, /Одобрено/)
  assert.match(edit.payload.text, /BadNick/)
  const dm = tgTo(111).map((c) => c.payload.text).join(' ')
  assert.match(dm, /одобрен/)
  assert.match(tgTexts(), /Очередь пуста/)
})

t('T-BOT-15 non-admin callback is rejected', async () => {
  reset({ telegram_links: [] })
  const q = { callback_query: { id: 'cq2', from: { id: 111 }, data: 'rev:approve:rev-1', message: { message_id: 5, chat: { id: 111 } } } }
  await post('', { headers: H, body: q })
  const ans = calls.tg.find((c) => c.method === 'answerCallbackQuery')
  assert.equal(ans.payload.text, 'Только для администраторов.')
})

t('T-BOT-16 lobby notify reaches linked chat', async () => {
  reset({ telegram_links: [{ tg_chat_id: 111 }] })
  const r = await post('?action=notify', {
    headers: { Authorization: 'Bearer GOODJWT' },
    body: { kind: 'lobby', lobbyId: '1234567' },
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  const dm = tgTo(111).map((c) => c.payload.text).join(' ')
  assert.match(dm, /1234567/)
})

t('T-BOT-17 notify without link gives 404', async () => {
  reset({ telegram_links: [] })
  const r = await post('?action=notify', {
    headers: { Authorization: 'Bearer GOODJWT' },
    body: { kind: 'lobby', lobbyId: '1234567' },
  })
  assert.equal(r.status, 404)
  assert.equal(r.json.error, 'not_linked')
})

t('T-BOT-18 notify with bad body gives 400', async () => {
  reset({})
  const r = await post('?action=notify', {
    headers: { Authorization: 'Bearer GOODJWT' },
    body: { kind: 'lobby' },
  })
  assert.equal(r.status, 400)
})

t('T-BOT-19 setup with correct secret wires webhook', async () => {
  reset({})
  const r = await get('?setup=TESTSETUP')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.setWebhook, true)
  assert.equal(r.json.bot, 'name_mlbb_bot')
})

t('T-BOT-20 setup with wrong secret is forbidden', async () => {
  const r = await get('?setup=WRONG')
  assert.equal(r.status, 403)
})

t('T-BOT-21 junk update and group chat are ignored safely', async () => {
  reset({})
  const r1 = await post('', { headers: H, body: {} })
  assert.equal(r1.status, 200)
  const r2 = await post('', { headers: H, body: { message: { chat: { id: -1, type: 'group' }, text: '/start' } } })
  assert.equal(r2.status, 200)
  assert.equal(calls.tg.length, 0, 'expected no telegram calls')
})

t('T-BOT-22 /support without link asks to link', async () => {
  reset({ telegram_links: [] })
  await post('', { headers: H, body: upd('/support помогите') })
  assert.match(tgTexts(), /Как привязать/)
})

t('T-BOT-23 /support with text creates a ticket', async () => {
  reset({
    telegram_links: [{ user_id: 'user-1' }],
    'POST support_tickets': [{ num: 7 }],
  })
  await post('', { headers: H, body: upd('/support не приходит лобби') })
  const ins = calls.db.find((c) => c.method === 'POST' && c.table === 'support_tickets')
  assert.ok(ins, 'expected insert into support_tickets')
  assert.equal(ins.body.user_id, 'user-1')
  assert.match(ins.body.message, /не приходит лобби/)
  assert.match(tgTexts(), /Заявка <b>#7<\/b> создана/)
})

t('T-BOT-24 /support without text lists own tickets', async () => {
  reset({
    telegram_links: [{ user_id: 'user-1' }],
    support_tickets: [
      { num: 7, status: 'open', created_at: '2026-10-30T10:00:00Z', admin_reply: null },
      { num: 6, status: 'answered', created_at: '2026-10-29T10:00:00Z', admin_reply: 'Готово' },
    ],
  })
  await post('', { headers: H, body: upd('/support') })
  assert.match(tgTexts(), /Твои заявки/)
  assert.match(tgTexts(), /#7/)
  assert.match(tgTexts(), /открыта/)
  assert.match(tgTexts(), /Готово/)
})

t('T-BOT-25 non-admin is stopped at /tickets', async () => {
  reset({ telegram_links: [{ user_id: 'user-1' }], admins: [] })
  await post('', { headers: H, body: upd('/tickets') })
  assert.match(tgTexts(), /только для администраторов/)
})

t('T-BOT-26 admin /tickets lists open with nicks', async () => {
  reset({
    telegram_links: ADMIN, admins: ADMIN,
    support_tickets: [
      { num: 1, user_id: 'u2', message: 'Помогите с входом', status: 'open', created_at: '2026-10-30T09:00:00Z' },
      { num: 2, user_id: 'u3', message: 'Куда делись очки', status: 'open', created_at: '2026-10-30T09:30:00Z' },
    ],
    player_profiles: [{ user_id: 'u2', nick: 'Amy' }, { user_id: 'u3', nick: 'Bob' }],
  })
  await post('', { headers: H, body: upd('/tickets', 999) })
  assert.match(tgTexts(), /Открытые заявки/)
  assert.match(tgTexts(), /#1/)
  assert.match(tgTexts(), /Amy/)
  assert.match(tgTexts(), /Помогите с входом/)
})

t('T-BOT-27 admin /ticket shows full text and user', async () => {
  reset({
    telegram_links: ADMIN, admins: ADMIN,
    support_tickets: [{ num: 1, user_id: 'u2', message: 'Помогите с входом', status: 'open', created_at: '2026-10-30T09:00:00Z', admin_reply: null }],
    player_profiles: [{ nick: 'Amy', game_id: '555' }],
  })
  await post('', { headers: H, body: upd('/ticket 1', 999) })
  assert.match(tgTexts(), /Заявка #1/)
  assert.match(tgTexts(), /Помогите с входом/)
  assert.match(tgTexts(), /Amy/)
  const card = calls.tg.find((c) => c.method === 'sendMessage')
  const buttons = card.payload.reply_markup.inline_keyboard.flat().map((b) => b.callback_data).join(' ')
  assert.match(buttons, /t:reply:1/)
  assert.match(buttons, /t:close:1/)
  assert.ok(!/\/reply 1/.test(tgTexts()), 'карточка не должна просить вводить команду')
})

t('T-BOT-28 admin /reply answers and DMs the user', async () => {
  reset({
    telegram_links: ({ params }) => (params.get('user_id') ? [{ tg_chat_id: 222 }] : ADMIN),
    admins: ADMIN,
    support_tickets: [{ num: 1, user_id: 'u2', message: 'Помогите', status: 'open', created_at: '2026-10-30T09:00:00Z', admin_reply: null }],
    player_profiles: [{ nick: 'Amy', game_id: '555' }],
  })
  await post('', { headers: H, body: upd('/reply 1 Всё починили', 999) })
  const patch = calls.db.find((c) => c.method === 'PATCH' && c.table === 'support_tickets')
  assert.ok(patch, 'expected ticket PATCH')
  assert.equal(patch.body.status, 'answered')
  assert.equal(patch.body.admin_reply, 'Всё починили')
  const dm = tgTo(222).map((c) => c.payload.text).join(' ')
  assert.match(dm, /Ответ поддержки/)
  assert.match(dm, /Всё починили/)
})

t('T-BOT-29 admin /close closes and notifies', async () => {
  reset({
    telegram_links: ({ params }) => (params.get('user_id') ? [{ tg_chat_id: 222 }] : ADMIN),
    admins: ADMIN,
    support_tickets: [{ num: 1, user_id: 'u2', message: 'Помогите', status: 'open', created_at: '2026-10-30T09:00:00Z', admin_reply: null }],
    player_profiles: [{ nick: 'Amy', game_id: '555' }],
  })
  await post('', { headers: H, body: upd('/close 1', 999) })
  const patch = calls.db.find((c) => c.method === 'PATCH' && c.table === 'support_tickets')
  assert.ok(patch, 'expected close PATCH')
  assert.equal(patch.body.status, 'closed')
  const dm = tgTo(222).map((c) => c.payload.text).join(' ')
  assert.match(dm, /закрыта/)
})

t('T-BOT-30 /support announces the new ticket to admins', async () => {
  reset({
    telegram_links: ({ params }) => (params.get('user_id') && String(params.get('user_id')).startsWith('in.') ? [] : [{ user_id: 'user-1' }]),
    admins: [{ user_id: 'admin-1' }],
    player_profiles: [{ nick: 'Amy' }],
    'POST support_tickets': [{ id: 'aaaaaaaa-1111-4111-8111-111111111111', num: 7, message: 'не приходит лобби' }],
  })
  // admins -> their chats
  SCEN.telegram_links = ({ params }) => {
    const u = params.get('user_id') || ''
    if (u.startsWith('in.(')) return [{ tg_chat_id: 999 }]
    return [{ user_id: 'user-1' }]
  }
  await post('', { headers: H, body: upd('/support не приходит лобби') })
  const dm = tgTo(999).map((c) => c.payload.text).join(' ')
  assert.match(dm, /Новая заявка поддержки #7/)
  assert.match(dm, /Amy/)
  assert.match(dm, /Нажми «Ответить»/)
  const announce = tgTo(999).find((c) => c.method === 'sendMessage')
  const ab = announce.payload.reply_markup.inline_keyboard.flat().map((b) => b.callback_data).join(' ')
  assert.match(ab, /t:reply:7/)
  assert.match(ab, /t:close:7/)
  const stamp = calls.db.find((c) => c.method === 'PATCH' && c.table === 'support_tickets')
  assert.ok(stamp && stamp.body.notified_at, 'expected notified_at stamp')
})

t('T-BOT-31 notify support announces own ticket once', async () => {
  const ticket = {
    id: 'aaaaaaaa-1111-4111-8111-111111111111', num: 4, user_id: 'user-1',
    message: 'Хочу сменить ник', status: 'open', created_at: '2026-10-30T10:00:00Z', notified_at: null,
  }
  reset({
    admins: [{ user_id: 'admin-1' }],
    telegram_links: () => [{ tg_chat_id: 999 }],
    player_profiles: [{ nick: 'Amy' }],
    support_tickets: [ticket],
  })
  const r = await post('?action=notify', { headers: { authorization: 'Bearer GOODJWT' }, body: { kind: 'support', ticketId: ticket.id } })
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.admins, 1)
  assert.match(tgTo(999).map((c) => c.payload.text).join(' '), /Новая заявка поддержки #4/)
})

t('T-BOT-32 notify support rejects a foreign ticket', async () => {
  const ticket = { id: 'bbbbbbbb-2222-4222-8222-222222222222', num: 5, user_id: 'someone-else', message: 'чужая', status: 'open', notified_at: null }
  reset({ admins: [{ user_id: 'admin-1' }], telegram_links: () => [{ tg_chat_id: 999 }], support_tickets: [ticket] })
  const r = await post('?action=notify', { headers: { authorization: 'Bearer GOODJWT' }, body: { kind: 'support', ticketId: ticket.id } })
  assert.equal(r.status, 403)
  assert.equal(tgTo(999).length, 0)
})

t('T-BOT-33 notify support does not repeat for an announced ticket', async () => {
  const ticket = {
    id: 'cccccccc-3333-4333-8333-333333333333', num: 6, user_id: 'user-1',
    message: 'уже объявлена', status: 'open', notified_at: '2026-10-30T10:05:00Z',
  }
  reset({ admins: [{ user_id: 'admin-1' }], telegram_links: () => [{ tg_chat_id: 999 }], support_tickets: [ticket] })
  const r = await post('?action=notify', { headers: { authorization: 'Bearer GOODJWT' }, body: { kind: 'support', ticketId: ticket.id } })
  assert.equal(r.json.already, true)
  assert.equal(tgTo(999).length, 0)
})

t('T-BOT-34 notify support rejects a malformed id', async () => {
  reset({})
  const r = await post('?action=notify', { headers: { authorization: 'Bearer GOODJWT' }, body: { kind: 'support', ticketId: 'nope' } })
  assert.equal(r.status, 400)
})

t('T-BOT-35 кнопка «Ответить» включает режим ожидания текста', async () => {
  reset({
    telegram_links: ADMIN, admins: ADMIN,
    support_tickets: [{ num: 1, user_id: 'u2', message: 'Помогите', status: 'open', created_at: '2026-10-30T09:00:00Z', admin_reply: null }],
    player_profiles: [{ nick: 'Amy', game_id: '555' }],
  })
  const q = { callback_query: { id: 'cq9', from: { id: 999 }, data: 't:reply:1', message: { message_id: 9, chat: { id: 999 } } } }
  await post('', { headers: H, body: q })
  assert.match(tgTexts(), /Отправь текст ответа/)
  const saved = calls.db.find((c) => c.method === 'POST' && c.table === 'telegram_sessions')
  assert.ok(saved, 'ожидалась запись сессии')
  assert.equal(saved.body.action, 'reply')
  assert.equal(saved.body.chat_id, 999)
  assert.equal(saved.body.payload.num, 1)
})

t('T-BOT-36 обычный текст в режиме ответа уходит в заявку без команды', async () => {
  reset({
    telegram_links: ({ params }) => (params.get('user_id') ? [{ tg_chat_id: 222 }] : ADMIN),
    admins: ADMIN,
    telegram_sessions: [{ chat_id: 999, action: 'reply', payload: { num: 1 }, expires_at: FUTURE }],
    support_tickets: [{ num: 1, user_id: 'u2', message: 'Помогите', status: 'open', created_at: '2026-10-30T09:00:00Z', admin_reply: null }],
    player_profiles: [{ nick: 'Amy', game_id: '555' }],
  })
  await post('', { headers: H, body: upd('Всё починили, заходи', 999) })
  const patch = calls.db.find((c) => c.method === 'PATCH' && c.table === 'support_tickets')
  assert.ok(patch, 'ожидался ответ в заявку')
  assert.equal(patch.body.admin_reply, 'Всё починили, заходи')
  assert.equal(patch.body.status, 'answered')
  assert.match(tgTo(222).map((c) => c.payload.text).join(' '), /Ответ поддержки/)
  assert.ok(calls.db.find((c) => c.method === 'DELETE' && c.table === 'telegram_sessions'), 'сессия должна сброситься')
})

t('T-BOT-37 /reply без текста тоже включает режим ответа', async () => {
  reset({
    telegram_links: ADMIN, admins: ADMIN,
    support_tickets: [{ num: 4, user_id: 'u2', message: 'Не приходит лобби', status: 'open', created_at: '2026-10-30T09:00:00Z', admin_reply: null }],
    player_profiles: [{ nick: 'Amy', game_id: '555' }],
  })
  await post('', { headers: H, body: upd('/reply 4', 999) })
  assert.match(tgTexts(), /Отправь текст ответа/)
  const saved = calls.db.find((c) => c.method === 'POST' && c.table === 'telegram_sessions')
  assert.ok(saved && saved.body.action === 'reply' && saved.body.payload.num === 4)
})

t('T-BOT-38 кнопка «Закрыть» закрывает заявку и уведомляет игрока', async () => {
  reset({
    telegram_links: ({ params }) => (params.get('user_id') ? [{ tg_chat_id: 222 }] : ADMIN),
    admins: ADMIN,
    support_tickets: [{ num: 2, user_id: 'u2', message: 'Вопрос', status: 'open', created_at: '2026-10-30T09:00:00Z', admin_reply: null }],
  })
  const q = { callback_query: { id: 'cq10', from: { id: 999 }, data: 't:close:2', message: { message_id: 10, chat: { id: 999 } } } }
  await post('', { headers: H, body: q })
  const patch = calls.db.find((c) => c.method === 'PATCH' && c.table === 'support_tickets')
  assert.ok(patch && patch.body.status === 'closed')
  assert.match(tgTo(222).map((c) => c.payload.text).join(' '), /закрыта/)
})

t('T-BOT-39 кнопка заявки доступна только админу', async () => {
  reset({ telegram_links: [{ user_id: 'user-1' }], admins: [] })
  const q = { callback_query: { id: 'cq11', from: { id: 111 }, data: 't:reply:1', message: { message_id: 11, chat: { id: 111 } } } }
  await post('', { headers: H, body: q })
  const ans = calls.tg.find((c) => c.method === 'answerCallbackQuery')
  assert.equal(ans.payload.text, 'Только для администраторов.')
  assert.equal(calls.db.filter((c) => c.table === 'telegram_sessions').length, 0)
})

t('T-BOT-40 поддержка: кнопка «Написать» + текст без команды', async () => {
  reset({
    telegram_links: [{ user_id: 'user-1' }],
    support_tickets: [],
    'POST support_tickets': [{ id: 'dddddddd-4444-4444-8444-444444444444', num: 12 }],
  })
  await post('', { headers: H, body: upd('/support') })
  const list = calls.tg.find((c) => c.method === 'sendMessage')
  assert.match(list.payload.reply_markup.inline_keyboard[0][0].callback_data, /s:new/)

  const q = { callback_query: { id: 'cq12', from: { id: 111 }, data: 's:new', message: { message_id: 12, chat: { id: 111 } } } }
  await post('', { headers: H, body: q })
  const session = calls.db.find((c) => c.method === 'POST' && c.table === 'telegram_sessions')
  assert.ok(session && session.body.action === 'support')
  assert.match(tgTexts(), /Опиши проблему/)

  reset({
    telegram_links: [{ user_id: 'user-1' }],
    telegram_sessions: [{ chat_id: 111, action: 'support', payload: {}, expires_at: FUTURE }],
    'POST support_tickets': [{ id: 'dddddddd-4444-4444-8444-444444444444', num: 12 }],
  })
  await post('', { headers: H, body: upd('Не приходит ID лобби') })
  const ins = calls.db.find((c) => c.method === 'POST' && c.table === 'support_tickets')
  assert.ok(ins, 'ожидалась новая заявка из обычного сообщения')
  assert.equal(ins.body.message, 'Не приходит ID лобби')
  assert.match(tgTexts(), /Заявка <b>#12<\/b> создана/)
})

t('T-BOT-41 /cancel сбрасывает режим', async () => {
  reset({
    telegram_links: ADMIN, admins: ADMIN,
    telegram_sessions: [{ chat_id: 999, action: 'reply', payload: { num: 1 }, expires_at: FUTURE }],
  })
  await post('', { headers: H, body: upd('/cancel', 999) })
  assert.match(tgTexts(), /отменил/)
  assert.ok(calls.db.find((c) => c.method === 'DELETE' && c.table === 'telegram_sessions'))
})

t('T-BOT-42 без режима обычный текст по-прежнему даёт подсказку', async () => {
  reset({ telegram_links: [{ user_id: 'user-1' }] })
  await post('', { headers: H, body: upd('привет', 111) })
  assert.match(tgTexts(), /Не понял команду/)
})

t('T-BOT-43 /start присылает приветственную картинку', async () => {
  reset({ telegram_links: [] })
  await post('', { headers: H, body: upd('/start') })
  const photo = calls.tg.find((c) => c.method === 'sendPhoto')
  assert.ok(photo, 'ожидалась картинка-приветствие')
  assert.equal(photo.payload.photo, 'https://example.test/bot-avatar.jpg')
  assert.match(photo.payload.caption, /NAME/)
  assert.match(photo.payload.caption, /Mobile Legends/)
  assert.match(tgTexts(), /Как привязать/)
})

t('T-BOT-44 приветствие ведёт в приложение кнопкой', async () => {
  reset({ telegram_links: [] })
  await post('', { headers: H, body: upd('/start') })
  const msg = calls.tg.find((c) => c.method === 'sendMessage')
  const btn = msg.payload.reply_markup.inline_keyboard[0][0]
  assert.equal(btn.url, 'https://example.test/')
  assert.match(btn.text, /Открыть приложение/)
})

t('T-BOT-45 /start привязанному: та же картинка, ник и меню', async () => {
  reset({ telegram_links: [{ user_id: 'user-1' }], player_profiles: [{ nick: 'Amy' }] })
  await post('', { headers: H, body: upd('/start') })
  const photo = calls.tg.find((c) => c.method === 'sendPhoto')
  assert.ok(photo, 'привязанный тоже должен видеть визитку')
  assert.equal(photo.payload.photo, 'https://example.test/bot-avatar.jpg')
  assert.match(photo.payload.caption, /С возвращением/)
  assert.match(photo.payload.caption, /Amy/)
  assert.match(tgTexts(), /команды/)
  const msg = calls.tg.find((c) => c.method === 'sendMessage')
  assert.ok(msg.payload.reply_markup.inline_keyboard[0][0].url)
})

t('T-BOT-47 если Telegram не скачал картинку — бот заливает файл', async () => {
  reset({ telegram_links: [], photoFail: true })
  await post('', { headers: H, body: upd('/start') })
  const photos = calls.tg.filter((c) => c.method === 'sendPhoto')
  assert.equal(photos.length, 2, 'сначала ссылка, потом файл')
  assert.equal(photos[0].payload.photo, 'https://example.test/bot-avatar.jpg')
  assert.equal(photos[1].payload.form, true)
  assert.match(tgTexts(), /Как привязать/)
})

t('T-BOT-48 если картинки нет совсем — приветствие уходит текстом', async () => {
  reset({ telegram_links: [], photoFail: true, avatarFail: true })
  await post('', { headers: H, body: upd('/start') })
  assert.match(tgTexts(), /Mobile Legends/)
  assert.match(tgTexts(), /Как привязать/)
})

t('T-BOT-46 ?setup прописывает описание бота', async () => {
  reset({})
  const r = await get('?setup=TESTSETUP')
  assert.equal(r.json.setDescription, true)
  assert.equal(r.json.setShortDescription, true)
  const d = calls.tg.find((c) => c.method === 'setMyDescription')
  assert.ok(d && d.payload.description.length > 40)
  const sd = calls.tg.find((c) => c.method === 'setMyShortDescription')
  assert.ok(sd && sd.payload.short_description.length <= 120)
})

let pass = 0
let fail = 0
for (const [name, fn] of tests) {
  try {
    await fn()
    pass++
    console.log('PASS ' + name)
  } catch (e) {
    fail++
    console.log('FAIL ' + name + '\n  ' + String((e && e.message) || e).split('\n').slice(0, 4).join('\n  '))
  }
}
console.log(`\n${pass} passed, ${fail} failed, ${tests.length} total`)
process.exit(fail ? 1 : 0)
