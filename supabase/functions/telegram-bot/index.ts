// NAME MLBB — Telegram bot (webhook).
// Deployed as edge function `telegram-bot`.
//
// Routes:
//   POST /                       Telegram update (needs X-Telegram-Bot-Api-Secret-Token)
//   POST /?action=notify         app -> user notify (needs user JWT, notifies SELF only)
//   GET  /?setup=<SETUP_SECRET>  one-time webhook wiring by owner
//   GET  /?health=1              liveness probe
//
// Required function secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
// TELEGRAM_SETUP_SECRET. Optional: APP_PUBLIC_URL (link shown in bot messages).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.44.0'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
const SETUP_SECRET = Deno.env.get('TELEGRAM_SETUP_SECRET') ?? ''
const APP_URL = Deno.env.get('APP_PUBLIC_URL') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

async function tg(method: string, payload: Record<string, unknown>): Promise<any> {
  try {
    const r = await fetch(`${TG}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j?.ok === false) console.error('tg api error', method, JSON.stringify(j).slice(0, 400))
    return j
  } catch (e) {
    console.error('tg fetch failed', method, String(e))
    return { ok: false }
  }
}

const send = (chat_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra })

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const HELP_TEXT = `<b>NAME MLBB — команды</b>\n\n/profile — мой профиль и PTS\n/rating — топ-10 игроков\n/unlink — отвязать Telegram\n/help — это сообщение`

function linkPrompt(): string {
  return `Сначала привяжи аккаунт: открой профиль в приложении${APP_URL ? ` (${APP_URL})` : ''}, нажми «Привязать Telegram» и отправь мне 6-значный код.`
}

async function linkByCode(chatId: number, tgUsername: string, rawCode: string): Promise<string> {
  const code = rawCode.trim()
  if (!/^[0-9]{6}$/.test(code)) return 'Код — это 6 цифр из приложения. Проверь и отправь ещё раз.'
  const { data: row } = await sb.from('telegram_link_codes').select('*').eq('code', code).maybeSingle()
  if (!row) return 'Такой код не найден. Получи свежий код в профиле приложения.'
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await sb.from('telegram_link_codes').delete().eq('code', code)
    return 'Код истёк (живёт 10 минут). Получи новый в профиле.'
  }
  // One chat = one account: drop previous bindings of this chat, then link.
  await sb.from('telegram_links').delete().eq('tg_chat_id', chatId)
  const { error } = await sb.from('telegram_links').upsert(
    { user_id: row.user_id, tg_chat_id: chatId, tg_username: tgUsername },
    { onConflict: 'user_id' },
  )
  if (error) {
    console.error('link upsert failed', error.message)
    return 'Не получилось привязать. Попробуй позже.'
  }
  await sb.from('telegram_link_codes').delete().eq('code', code)
  const { data: profile } = await sb.from('player_profiles').select('nick').eq('user_id', row.user_id).maybeSingle()
  const nick = profile?.nick ? ` «${esc(profile.nick)}»` : ''
  return `Готово! Telegram привязан к профилю${nick}. Теперь сюда будут приходить уведомления о матчах.\n\n${HELP_TEXT}`
}

async function handleUpdate(update: any): Promise<void> {
  const msg = update?.message
  if (!msg || msg.chat?.type !== 'private' || typeof msg.text !== 'string') return
  const chatId: number = msg.chat.id
  const tgUsername: string = msg.from?.username ?? ''
  const text: string = msg.text.trim()
  const [cmd, arg] = text.split(/\s+/, 2)

  if (cmd === '/start') {
    if (arg) { await send(chatId, await linkByCode(chatId, tgUsername, arg)); return }
    const { data: link } = await sb.from('telegram_links').select('*').eq('tg_chat_id', chatId).maybeSingle()
    if (link) {
      const { data: profile } = await sb.from('player_profiles').select('nick').eq('user_id', link.user_id).maybeSingle()
      await send(chatId, `С возвращением${profile?.nick ? `, ${esc(profile.nick)}` : ''}! Аккаунт уже привязан.\n\n${HELP_TEXT}`)
    } else {
      await send(chatId, `Привет! Я бот <b>NAME MLBB</b> — пришлю ID лобби и уведомления о матчах.\n\n${linkPrompt()}`)
    }
    return
  }
  if (/^[0-9]{6}$/.test(cmd) && !arg) { await send(chatId, await linkByCode(chatId, tgUsername, cmd)); return }

  if (cmd === '/profile') {
    const { data: link } = await sb.from('telegram_links').select('*').eq('tg_chat_id', chatId).maybeSingle()
    if (!link) { await send(chatId, linkPrompt()); return }
    const { data: p } = await sb.from('player_profiles').select('*').eq('user_id', link.user_id).maybeSingle()
    if (!p || !p.nick) { await send(chatId, 'Профиль пока пуст. Заполни анкету в приложении.'); return }
    const lines = [
      `<b>${esc(p.nick)}</b>`,
      `PTS: <b>${p.pts ?? 0}</b>`,
      p.rank ? `Ранг: ${esc(p.rank)}` : null,
      (p.roles?.length ? `Роли: ${esc(p.roles.join(', '))}` : null),
      p.game_id ? `Game ID: <code>${esc(p.game_id)}</code>` : null,
    ].filter(Boolean)
    await send(chatId, (lines as string[]).join('\n'))
    return
  }

  if (cmd === '/rating') {
    const { data } = await sb.from('player_profiles').select('nick, game_id, pts').order('pts', { ascending: false }).limit(10)
    if (!data || data.length === 0) { await send(chatId, 'Рейтинг пока пуст — стань первым!'); return }
    const medals = ['🥇', '🥈', '🥉']
    const lines = data.map((r: any, i: number) =>
      `${medals[i] ?? `${i + 1}.`} ${esc(r.nick || 'Без ника')} — <b>${r.pts ?? 0}</b> PTS`)
    await send(chatId, `<b>Топ-10 NAME MLBB</b>\n\n${lines.join('\n')}\n\nПока все стартуют с 1000 PTS. Начисление за матчи включим следующим шагом.`)
    return
  }

  if (cmd === '/unlink') {
    await sb.from('telegram_links').delete().eq('tg_chat_id', chatId)
    await send(chatId, 'Готово, Telegram отвязан. Уведомления приходить не будут.')
    return
  }

  if (cmd === '/help') { await send(chatId, HELP_TEXT); return }

  await send(chatId, `Не понял команду. Вот что я умею:\n\n${HELP_TEXT}`)
}

async function handleNotify(req: Request): Promise<Response> {
  const m = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/)
  if (!m) return json({ ok: false, error: 'no_auth' }, 401)
  const { data: { user }, error } = await sb.auth.getUser(m[1])
  if (error || !user) return json({ ok: false, error: 'bad_token' }, 401)
  let body: any = {}
  try { body = await req.json() } catch { /* noop */ }
  if (body?.kind !== 'lobby' || !/^[0-9]{4,12}$/.test(String(body?.lobbyId ?? ''))) {
    return json({ ok: false, error: 'bad_request' }, 400)
  }
  const { data: link } = await sb.from('telegram_links').select('*').eq('user_id', user.id).maybeSingle()
  if (!link) return json({ ok: false, error: 'not_linked' }, 404)
  await send(link.tg_chat_id, `🎮 <b>Лобби готово!</b>\n\nID лобби: <code>${esc(String(body.lobbyId))}</code>\n\nСкопируй ID и заходи в игру. Удачи!`)
  return json({ ok: true })
}

async function handleSetup(url: URL): Promise<Response> {
  if (!SETUP_SECRET || url.searchParams.get('setup') !== SETUP_SECRET) {
    return json({ ok: false, error: 'forbidden' }, 403)
  }
  if (!BOT_TOKEN) return json({ ok: false, error: 'no_bot_token' }, 500)
  if (!WEBHOOK_SECRET) return json({ ok: false, error: 'no_webhook_secret' }, 500)
  const fnUrl = `${SUPABASE_URL}/functions/v1/telegram-bot`
  const me = await tg('getMe', {})
  const hook = await tg('setWebhook', { url: fnUrl, secret_token: WEBHOOK_SECRET, drop_pending_updates: true })
  const cmds = await tg('setMyCommands', { commands: [
    { command: 'start', description: 'Начать / привязать аккаунт' },
    { command: 'profile', description: 'Мой профиль и PTS' },
    { command: 'rating', description: 'Топ-10 игроков' },
    { command: 'unlink', description: 'Отвязать Telegram' },
    { command: 'help', description: 'Помощь' },
  ]})
  return json({ ok: true, bot: me?.result?.username ?? null, webhook: fnUrl, setWebhook: hook?.ok === true, setCommands: cmds?.ok === true })
}

Deno.serve(async (req: Request) => {
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
