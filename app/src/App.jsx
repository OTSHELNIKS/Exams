import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Home, UserRound, Swords, Gamepad2, Trophy, Globe, ChevronLeft, Sparkles,
  ClipboardList, LogIn, ShieldCheck, LifeBuoy, LogOut,
} from 'lucide-react'
import { AppFrame, Logo } from './ui.jsx'
import { Landing } from './landing.jsx'
import {
  AuthScreen, WizardScreen, HomeScreen, ProfileScreen, DraftScreen,
  MatchScreen, LeaderboardScreen, BannedScreen, SupportScreen,
} from './screens.jsx'
import { AdminScreen } from './admin.jsx'
import { DEFAULT_PROFILE, splitCombinedGameId, SOCIAL_IDS, parseSocial, formatSocial } from './data.js'
import {
  supabase, profileToRow, rowToProfile, syncModerationReviews, clearPendingReviews,
  getTelegramLink, deleteTelegramLink, createTelegramLinkCode,
} from './supabase.js'
import { parseVkReturn, completeVkAuth, startVkAuth, describeVkError, vkConfigured } from './vk-auth.js'
import { parseTikTokReturn, completeTikTokAuth, startTikTokAuth, describeTikTokError } from './tiktok-auth.js'
import { parseAuthReturn, cleanAuthUrl, describeAuthError } from './auth-return.js'

// Возврат с VK: код и device_id приходят в query. Запоминаем адрес и сразу
// вычищаем параметры, чтобы F5 не пытался обменять код повторно.
const VK_RETURN = typeof window === 'undefined'
  ? null
  : (() => {
    const parsed = parseVkReturn(window.location.href)
    if (!parsed) return null
    const href = window.location.href
    try {
      const url = new URL(href)
      ;['code', 'device_id', 'state'].forEach((key) => url.searchParams.delete(key))
      window.history.replaceState({}, '', url.toString())
    } catch { /* noop */ }
    return { href }
  })()

// Возврат с TikTok: приходят ?code=...&state=... (или error). Запоминаем адрес
// и сразу чистим параметры, чтобы F5 не пытался обменять одноразовый код.
const TIKTOK_RETURN = typeof window === 'undefined'
  ? null
  : (() => {
    const parsed = parseTikTokReturn(window.location.href)
    if (!parsed) return null
    const href = window.location.href
    try {
      const url = new URL(href)
      ;['code', 'state', 'scopes', 'error', 'error_description'].forEach((key) => url.searchParams.delete(key))
      window.history.replaceState({}, '', url.toString())
    } catch { /* noop */ }
    return { href }
  })()

// Ошибку внешнего входа (Google и т.п.) читаем один раз при загрузке страницы:
// Supabase кладёт её в hash после редиректа. Чистим адрес, чтобы F5 не повторял.
const AUTH_RETURN = typeof window === 'undefined'
  ? { message: '' }
  : (() => {
    const parsed = parseAuthReturn(window.location.href)
    const message = describeAuthError(parsed)
    if (message) {
      const cleaned = cleanAuthUrl(window.location.href)
      if (cleaned) window.history.replaceState({}, '', cleaned)
    }
    return { message }
  })()

// Экраны онбординга (auth, wizard) видны в меню только до регистрации — см. hideEntry.
const SCREENS = [
  { id: 'auth', label: 'Вход / привязка ID', short: 'Вход', icon: LogIn },
  { id: 'wizard', label: 'Заполните профиль', short: 'Анкета', icon: ClipboardList },
  { id: 'home', label: 'Главная игрока', short: 'Главная', icon: Home },
  { id: 'profile', label: 'Профиль игрока', short: 'Профиль', icon: UserRound },
  { id: 'draft', label: "Captain's Draft", short: 'Драфт', icon: Swords },
  { id: 'match', label: 'Матч готов', short: 'Матч', icon: Gamepad2 },
  { id: 'leaderboard', label: 'Таблица лидеров', short: 'Рейтинг', icon: Trophy },
  { id: 'support', label: 'Поддержка', short: 'Помощь', icon: LifeBuoy },
  { id: 'admin', label: 'Админка', short: 'Админ', icon: ShieldCheck, admin: true },
]

const STORAGE_KEY = 'name-mlbb-profile:v2'
// Метка «идём связывать Google»: после возврата от Google именно она разрешает
// автоматически записать подтверждённый аккаунт в соцсети профиля.
const LINK_GOOGLE_KEY = STORAGE_KEY + ':linkGoogle'

// Почта подтверждённого Google-аккаунта из сессии (или '' если Google не привязан).
function googleEmailOf(user) {
  if (!user) return ''
  const identity = (user.identities || []).find((i) => i.provider === 'google')
  if (identity) return identity.identity_data?.email || user.email || ''
  return user.app_metadata?.provider === 'google' ? (user.email || '') : ''
}
const LEGACY_STORAGE_KEY = 'name-mlbb-profile'

export default function App() {
  const [mode, setMode] = useState('landing')
  const MARKER_TEXT = 'МАРКЕР-APP-NEW'
  const [screen, setScreen] = useState('auth')
  // Гость: возвращаем ID и сервер из localStorage. Старые записи хранили
  // «123456789 (1234)» одной строкой — разбираем на две части.
  const [gameId, setGameId] = useState(() => {
    try { return splitCombinedGameId(localStorage.getItem(STORAGE_KEY + ':gameId') || '').gameId } catch { return '' }
  })
  const [gameServer, setGameServer] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY + ':gameServer') || ''
      if (stored) return stored
      return splitCombinedGameId(localStorage.getItem(STORAGE_KEY + ':gameId') || '').server
    } catch { return '' }
  })
  const [session, setSession] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(Boolean(supabase))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  // Реальная привязка Telegram (таблица telegram_links, её пишет бот).
  const [telegramLink, setTelegramLink] = useState(null)
  // Владение игровым аккаунтом: храним тот Game ID, который игрок подтвердил
  // кодом из внутриигровой почты (отметку ставит edge-функция game-login).
  // Заполненный в анкете Game ID — не повод писать «привязан», поэтому статус
  // сравнивает отметку с текущим ID: поменял ID — снова «не подтверждён».
  const [gameVerifiedId, setGameVerifiedId] = useState('')
  const [tgLoaded, setTgLoaded] = useState(false)
  const [profile, setProfile] = useState(() => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      localStorage.removeItem(LEGACY_STORAGE_KEY + ':gameId')
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      return saved ? { ...DEFAULT_PROFILE, ...saved } : { ...DEFAULT_PROFILE }
    } catch { return { ...DEFAULT_PROFILE } }
  })

  useEffect(() => {
    if (!session && !sessionLoading) {
      try {
        const { avatar, ...rest } = profile
        void avatar
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rest))
        localStorage.setItem(STORAGE_KEY + ':gameId', gameId)
        localStorage.setItem(STORAGE_KEY + ':gameServer', gameServer)
      } catch { /* noop */ }
    }
  }, [profile, gameId, gameServer, session, sessionLoading])

  useEffect(() => {
    if (!supabase) return
    let active = true
    let generation = 0
    let lastUserId
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      const userId = next?.user?.id || null
      setSession(next)
      if (lastUserId === userId) return
      const previousUserId = lastUserId
      lastUserId = userId
      const current = ++generation
      setSessionLoading(true)
      // Defer database access outside the auth callback.
      setTimeout(async () => {
        if (!active || current !== generation) return
        if (next) {
          const { data, error } = await supabase.from('player_profiles').select('*').eq('user_id', next.user.id).maybeSingle()
          if (!active || current !== generation) return
          if (error) { setSaveError('Не удалось загрузить профиль: ' + error.message); setSessionLoading(false); return }
          const loaded = data ? rowToProfile(data, DEFAULT_PROFILE) : { ...DEFAULT_PROFILE }
          setProfile(loaded)
          // Старые профили хранили «123456789 (1234)» одной строкой — разбираем.
          const legacy = splitCombinedGameId(data?.game_id || '')
          setGameId(legacy.gameId)
          setGameServer(data?.game_server || legacy.server)
          // Отметка действует только для того Game ID, который подтверждали.
          setGameVerifiedId(data?.game_verified_at ? String(data?.game_verified_id || '') : '')

          // Вернулись от Google после «Привязать»: аккаунт подтверждён — пишем
          // его в соцсети. Сохраняем сразу из свежезагруженного профиля, чтобы
          // не перетереть остальные поля пустыми.
          const googleEmail = googleEmailOf(next.user)
          let pendingLink = false
          try { pendingLink = localStorage.getItem(LINK_GOOGLE_KEY) === '1' } catch { pendingLink = false }
          if (googleEmail && pendingLink) {
            try { localStorage.removeItem(LINK_GOOGLE_KEY) } catch { /* noop */ }
            const boundNow = (loaded.socials || []).map(parseSocial)
            if (!boundNow.some((x) => x.provider === 'google') && boundNow.length < SOCIAL_IDS.length) {
              const withGoogle = {
                ...loaded,
                socials: [...(loaded.socials || []), formatSocial('google', googleEmail)],
              }
              setProfile(withGoogle)
              const { error: socialError } = await supabase
                .from('player_profiles')
                .upsert(profileToRow(withGoogle, legacy.gameId, data?.game_server || legacy.server, next.user.id))
              if (socialError) setSaveError('Google привязан, но сохранить не удалось: ' + socialError.message)
            }
          }
          try {
            setTelegramLink(await getTelegramLink(next.user.id))
          } catch { setTelegramLink(null) }
          setTgLoaded(true)
          const { data: adminRow } = await supabase.from('admins').select('user_id').eq('user_id', next.user.id).maybeSingle()
          if (!active || current !== generation) return
          setIsAdmin(!!adminRow)
        } else if (previousUserId) {
          setProfile({ ...DEFAULT_PROFILE }); setGameId(''); setGameServer(''); setIsAdmin(false); setGameVerifiedId('')
          setTelegramLink(null)
        }
        setSaveError(''); setSessionLoading(false)
      }, 0)
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    document.body.classList.toggle('app-mode', mode === 'app')
  }, [mode])

  // Аккаунт Google, подтверждённый OAuth: почту руками не спрашиваем.
  const googleAccount = useMemo(() => googleEmailOf(session?.user), [session])

  // Связывание Google с текущим аккаунтом: открывается окно выбора аккаунта.
  const linkGoogle = async () => {
    if (!supabase) return { error: 'Проект не подключён к Supabase.' }
    if (!session) return { error: 'Сначала войди в аккаунт, потом привязывай соцсети.' }
    try {
      localStorage.setItem(LINK_GOOGLE_KEY, '1')
    } catch { /* noop */ }
    try {
      const redirectTo = window.location.origin + window.location.pathname
      const { error } = await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo } })
      if (error) throw error
      return { redirected: true }
    } catch (error) {
      try { localStorage.removeItem(LINK_GOOGLE_KEY) } catch { /* noop */ }
      const raw = String(error?.message || '')
      if (/manual linking|not enabled|disabled/i.test(raw)) {
        return { error: 'Связывание выключено в проекте: Supabase → Authentication → Sign In / Providers → Manual linking. Пока впиши почту вручную.' }
      }
      return { error: raw || 'Не удалось открыть окно Google.' }
    }
  }

  // Актуальный профиль для отложенных колбэков (возврат с VK).
  const profileRef = useRef(profile)
  useEffect(() => { profileRef.current = profile }, [profile])

  // Вернулись с VK после «Войти через VK»: меняем код на токен и пишем ник.
  const vkHandled = useRef(false)
  useEffect(() => {
    if (!VK_RETURN || vkHandled.current || !supabase || sessionLoading || !session) return
    vkHandled.current = true
    ;(async () => {
      try {
        const linked = await completeVkAuth(VK_RETURN.href)
        if (!linked) return
        const base = profileRef.current
        const list = (base.socials || []).map(parseSocial)
        if (list.some((x) => x.provider === 'vk')) return
        const nextProfile = { ...base, socials: [...(base.socials || []), formatSocial('vk', linked.handle)] }
        setProfile(nextProfile)
        const { error } = await supabase
          .from('player_profiles')
          .upsert(profileToRow(nextProfile, gameId, gameServer, session.user.id))
        if (error) setSaveError('VK привязан, но сохранить не удалось: ' + error.message)
      } catch (error) {
        setSaveError(describeVkError(error))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionLoading])

  // Вернулись с TikTok после «Войти через TikTok»: меняем код на ник на сервере
  // и сохраняем привязку в базу (чтобы она пережила перезагрузку).
  const tiktokHandled = useRef(false)
  // Сообщение после возврата с внешней привязки (TikTok): показываем тостом в
  // блоке соцсетей — иначе ошибка уходила в saveError, который виден только в анкете.
  const [socialNotice, setSocialNotice] = useState('')
  useEffect(() => {
    if (!TIKTOK_RETURN || tiktokHandled.current || !supabase || sessionLoading || !session) return
    tiktokHandled.current = true
    ;(async () => {
      try {
        const linked = await completeTikTokAuth(TIKTOK_RETURN.href)
        if (!linked) return
        const base = profileRef.current
        const list = (base.socials || []).map(parseSocial)
        if (list.some((x) => x.provider === 'tiktok')) return
        const next = { ...base, socials: [...(base.socials || []), formatSocial('tiktok', linked.handle)] }
        setProfile(next)
        const { error } = await supabase
          .from('player_profiles')
          .upsert(profileToRow(next, gameId, gameServer, session.user.id))
        setSocialNotice(error ? 'TikTok привязан, но сохранить не удалось: ' + error.message : 'TikTok привязан')
      } catch (error) {
        setSocialNotice(describeTikTokError(error))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionLoading])

  // Кнопка «Войти через VK»: готовим PKCE и уходим на экран разрешения VK.
  const linkVk = async () => {
    if (!supabase) return { error: 'Проект не подключён к Supabase.' }
    if (!session) return { error: 'Сначала войди в аккаунт, потом привязывай соцсети.' }
    if (!vkConfigured) return { error: describeVkError(new Error('VK_ID_NOT_CONFIGURED')) }
    try {
      await startVkAuth()
      return { redirected: true }
    } catch (error) {
      return { error: describeVkError(error) }
    }
  }

  // Кнопка «Войти через TikTok»: уходим на окно разрешения TikTok.
  const linkTikTok = async () => {
    if (!supabase) return { error: 'Проект не подключён к Supabase.' }
    if (!session) return { error: 'Сначала войди в аккаунт, потом привязывай соцсети.' }
    try {
      await startTikTokAuth()
      return { redirected: true }
    } catch (error) {
      return { error: describeTikTokError(error) }
    }
  }

  // Telegram: свежий код для бота и проверка, привязал ли бот.
  const startTelegramLink = async () => {
    if (!supabase || !session) throw new Error('Войди в аккаунт, чтобы получить код.')
    return createTelegramLinkCode(session.user.id)
  }
  const refreshTelegramLink = async () => {
    if (!supabase || !session) return null
    const row = await getTelegramLink(session.user.id)
    if (row) setTelegramLink(row)
    return row
  }

  // Отвязка Telegram: удаляем строку в telegram_links — бот перестанет писать.
  const unlinkTelegram = async () => {
    if (!supabase || !session) { setTelegramLink(null); return }
    try { await deleteTelegramLink(session.user.id) } catch { /* noop */ }
    setTelegramLink(null)
  }

  // «Подтверждён» — только если отметка есть и она про текущий Game ID.
  const gameVerified = Boolean(gameVerifiedId) && String(gameVerifiedId) === String(gameId || '')

  const go = (id) => setScreen(id)

  // Перечитать отметку о подтверждении аккаунта: её ставит edge-функция
  // game-login, когда игрок ввёл код из внутриигровой почты.
  const refreshGameVerification = async () => {
    if (!supabase || !session?.user) return
    try {
      const { data } = await supabase.from('player_profiles')
        .select('game_verified_at,game_verified_id')
        .eq('user_id', session.user.id).maybeSingle()
      setGameVerifiedId(data?.game_verified_at ? String(data?.game_verified_id || '') : '')
    } catch (e) { /* статус просто останется прежним */ }
  }
  const handleGameVerified = (result) => {
    if (result && result.verified) setGameVerifiedId(String(gameId || ''))
    refreshGameVerification()
  }
  const openApp = (id = 'auth') => { setScreen(id); setMode('app') }

  const profileFilled = Boolean(profile.nick && profile.nick.trim())
  // Онбординг пройден: вошёл в аккаунт — «Вход» больше не раздел меню,
  // заполнил анкету — из меню уходит и мастер анкеты (правится из профиля).
  const hideEntry = (id) => (id === 'auth' && Boolean(session)) || (id === 'wizard' && profileFilled)
  const autoEntered = useRef(false)

  // Return visits: skip landing once per load — home for filled profiles, wizard for new ones.
  useEffect(() => {
    if (!supabase || sessionLoading || !session || autoEntered.current) return
    if (mode !== 'landing') return
    autoEntered.current = true
    openApp(profileFilled ? 'home' : 'wizard')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, sessionLoading, session, mode, profileFilled])

  // Вернулся после входа (почта, Google, Telegram) — экран входа больше не в меню:
  // заполненный профиль ведём на главную, новый аккаунт — в анкету.
  useEffect(() => {
    if (!session || screen !== 'auth') return
    if (sessionLoading) return
    setScreen(profileFilled ? 'home' : 'wizard')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, screen, sessionLoading, profileFilled])

  const saveProfile = async () => {
    if (sessionLoading || saving) return
    if (!session || !supabase) { go('home'); return }
    setSaving(true); setSaveError('')
    const { error } = await supabase.from('player_profiles').upsert(profileToRow(profile, gameId, gameServer, session.user.id))
    setSaving(false)
    if (error) { setSaveError('Не удалось сохранить профиль: ' + error.message); return }
    const savedRow = profileToRow(profile, gameId, gameServer, session.user.id)
    try { await syncModerationReviews(session.user.id, { nick: savedRow.nick, avatarUrl: savedRow.avatar_url, screenshots: savedRow.screenshot_urls }) } catch { /* review queue is best-effort */ }
    go('home')
  }

  const resetProfile = async () => {
    if (sessionLoading || saving) return false
    const fresh = { ...DEFAULT_PROFILE }
    setProfile(fresh); setGameId(''); setGameServer('')
    try {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(STORAGE_KEY + ':gameId')
      localStorage.removeItem(STORAGE_KEY + ':gameServer')
    } catch { /* noop */ }
    if (!session || !supabase) return true
    try { await clearPendingReviews(session.user.id) } catch { /* noop */ }
    setSaving(true); setSaveError('')
    const { error } = await supabase.from('player_profiles').upsert(profileToRow(fresh, '', '', session.user.id))
    setSaving(false)
    if (error) { setSaveError('Не удалось очистить профиль: ' + error.message); return false }
    return true
  }

  const [draftTeams, setDraftTeams] = useState(null)

  // Сохранение «лёгких» изменений профиля (соцсети) сразу в базу.
  // Раньше привязка жила только в памяти: после F5 профиль перечитывался из
  // player_profiles, и привязанный Google «пропадал». Теперь сначала пишем
  // строку, и только при успехе меняем состояние — фантомных привязок нет.
  const persistProfileNow = async (next, label) => {
    if (!supabase || !session) {
      return { ok: false, error: 'Войди в аккаунт, чтобы сохранить привязку.' }
    }
    setSaving(true); setSaveError('')
    const { error } = await supabase
      .from('player_profiles')
      .upsert(profileToRow(next, gameId, gameServer, session.user.id))
    setSaving(false)
    if (error) {
      const message = `Не удалось сохранить ${label}: ${error.message}`
      setSaveError(message)
      return { ok: false, error: message }
    }
    setProfile(next)
    return { ok: true }
  }

  const actions = {
    goDraft: () => go('draft'),
    goLeaderboard: () => go('leaderboard'),
    addSlot: () => setProfile((p) => ({ ...p, extraSlots: Math.min(3, (p.extraSlots || 0) + 1) })),
    // Соцсеть добавляется только с ником: [provider, handle]. Без ника
    // привязка бессмысленна — вернуть false, чтобы экран не писал «привязана».
    addSocial: async (provider, handle) => {
      const id = String(provider || '').toLowerCase()
      const nick = String(handle || '').trim()
      if (!SOCIAL_IDS.includes(id) || !nick) return { ok: false, error: 'Укажи ник или почту.' }
      const base = profileRef.current || profile
      const list = (base.socials || []).map(parseSocial)
      if (list.some((x) => x.provider === id)) return { ok: false, error: 'Эта соцсеть уже привязана.' }
      if (list.length >= SOCIAL_IDS.length) return { ok: false, error: 'Свободных слотов нет.' }
      const next = { ...base, socials: [...(base.socials || []), formatSocial(id, nick)] }
      return persistProfileNow(next, 'привязку соцсети')
    },
    removeSocial: async (provider) => {
      const id = String(provider || '').toLowerCase()
      const base = profileRef.current || profile
      const next = { ...base, socials: (base.socials || []).filter((x) => parseSocial(x).provider !== id) }
      // Google подтверждён ещё и identity в сессии. Если её не снять, иконка
      // вернётся после перезагрузки — поэтому отвязываем и identity.
      if (id === 'google' && supabase && session) {
        const identity = (session.user?.identities || []).find((i) => i.provider === 'google')
        if (identity) {
          const { error } = await supabase.auth.unlinkIdentity(identity)
          if (error) {
            const message = 'Не удалось отвязать Google: ' + (error.message || 'ошибка проекта')
            setSaveError(message)
            return { ok: false, error: message }
          }
          try {
            const { data } = await supabase.auth.getSession()
            if (data?.session) setSession(data.session)
          } catch { /* сессия обновится при следующем входе */ }
        }
      }
      return persistProfileNow(next, 'отвязку соцсети')
    },
  }

  const renderScreen = () => {
    switch (screen) {
      case 'auth':
        return <AuthScreen gameId={gameId} setGameId={setGameId} gameServer={gameServer} setGameServer={setGameServer} callbackError={AUTH_RETURN.message} onLogin={() => go(profileFilled ? 'home' : 'wizard')} onPreview={() => go('home')} supabase={supabase} session={session} authReady={!sessionLoading} onSignOut={() => supabase.auth.signOut()} />
      case 'wizard':
        return <WizardScreen profile={profile} setProfile={setProfile} gameId={gameId} setGameId={setGameId} gameServer={gameServer} setGameServer={setGameServer} onDone={saveProfile} onBack={() => go('auth')} saveError={saveError} saving={saving || sessionLoading} supabase={supabase} userId={session?.user?.id || null} onReset={resetProfile} />
      case 'home':
        return <HomeScreen profile={profile} actions={actions} gameId={gameId} gameServer={gameServer} googleAccount={googleAccount} onLinkGoogle={linkGoogle} telegramLink={tgLoaded ? telegramLink : undefined} onUnlinkTelegram={unlinkTelegram} onStartTelegram={startTelegramLink} onRefreshTelegram={refreshTelegramLink} onLinkVk={linkVk} onLinkTikTok={linkTikTok} socialNotice={socialNotice} onSocialNoticeShown={() => setSocialNotice('')} onEdit={() => go('wizard')} isAdmin={isAdmin} onAdmin={() => go('admin')} supabase={supabase} userId={session?.user?.id || null} />
      case 'profile':
        return <ProfileScreen profile={profile} actions={actions} gameId={gameId} gameServer={gameServer} gameVerified={gameVerified} onGameVerified={handleGameVerified} googleAccount={googleAccount} onLinkGoogle={linkGoogle} telegramLink={tgLoaded ? telegramLink : undefined} onUnlinkTelegram={unlinkTelegram} onStartTelegram={startTelegramLink} onRefreshTelegram={refreshTelegramLink} onLinkVk={linkVk} onLinkTikTok={linkTikTok} socialNotice={socialNotice} onSocialNoticeShown={() => setSocialNotice('')} onBack={() => go('home')} onEdit={() => go('wizard')} supabase={supabase} userId={session?.user?.id || null} />
      case 'draft':
        return <DraftScreen supabase={supabase} userId={session?.user?.id || null} onReady={(teams) => { setDraftTeams(teams); go('match') }} onBack={() => go('home')} />
      case 'match':
        return <MatchScreen onBack={() => go('draft')} onLeaderboard={() => go('leaderboard')} onProfile={() => go('profile')} supabase={supabase} teams={draftTeams} userId={session?.user?.id || null} />
      case 'leaderboard':
        return <LeaderboardScreen supabase={supabase} userId={session?.user?.id || null} />
      case 'support':
        return <SupportScreen supabase={supabase} userId={session?.user?.id || null} onBack={() => go('home')} onAuth={() => go('auth')} />
      case 'admin':
        return <AdminScreen supabase={supabase} isAdmin={isAdmin} onBack={() => go('home')} />
      default:
        return null
    }
  }

  if (session && !sessionLoading && profile.isBanned) {
    return (
      <div className="app-shell">
        <main className="app-main">
          <AppFrame>
            <BannedScreen nick={profile.nick} reason={profile.banReason} onSignOut={() => supabase && supabase.auth.signOut()} />
          </AppFrame>
        </main>
      </div>
    )
  }

  if (mode === 'landing') {
    return (
      <Landing
        onOpen={() => openApp('auth')}
        onLogin={() => openApp(profileFilled ? 'home' : 'wizard')}
        onOpenScreen={() => openApp('home')}
        gameId={gameId}
        setGameId={setGameId}
        gameServer={gameServer}
        setGameServer={setGameServer}
        callbackError={AUTH_RETURN.message}
        screensCount={SCREENS.filter((s) => !s.admin).length}
      />
    )
  }

  const current = SCREENS.find((s) => s.id === screen)
  const visibleScreens = SCREENS.filter((s) => {
    if (s.admin && !isAdmin) return false
    if (hideEntry(s.id)) return false
    return true
  })

  return (
    <div className="app-shell">
      <aside className="rail">
        <Logo />
        <p className="rail__note"><Sparkles size={13} /> Соревновательный матчмейкинг MLBB</p>
        <span className="rail__label">РАЗДЕЛЫ</span>
        <nav className="rail__nav">
          {visibleScreens.map((s, i) => {
            const Icon = s.icon
            return (
              <button key={s.id} type="button" className={screen === s.id ? 'is-active' : ''} onClick={() => go(s.id)}>
                <span className="rail__num">{String(i + 1).padStart(2, '0')}</span>
                <Icon size={17} />
                <span>{s.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="rail__foot">
          {session && (
            <button type="button" className="rail__back" onClick={() => supabase.auth.signOut()}>
              <LogOut size={16} /> Выйти
            </button>
          )}
          <button type="button" className="rail__back" onClick={() => setMode('landing')}>
            <Globe size={16} /> Промо-сайт
          </button>
        </div>
      </aside>

      <main className="app-main">
        <div className="app-stage">
          <div className="app-main__head">
            <button type="button" className="icon-btn" onClick={() => setMode('landing')}><ChevronLeft size={20} /></button>
            <div>
              <strong>{current?.label}</strong>
              <small>NAME · мобильное приложение</small>
            </div>
            <span className="app-main__badge">{visibleScreens.length} экранов</span>
          </div>

          <AppFrame>{renderScreen()}</AppFrame>

          <nav className="bottom-nav">
            {SCREENS.filter((s) => ['home', 'draft', 'leaderboard', 'support'].includes(s.id)).map((s) => {
              const Icon = s.icon
              return (
                <button key={s.id} type="button" className={screen === s.id ? 'is-active' : ''} onClick={() => go(s.id)}>
                  <Icon size={20} /><span>{s.short}</span>
                </button>
              )
            })}
            <button key="profile" type="button" className={screen === 'profile' ? 'is-active' : ''} onClick={() => go('profile')}>
              <UserRound size={20} /><span>Профиль</span>
            </button>
            {isAdmin && (
              <button key="admin" type="button" className={screen === 'admin' ? 'is-active' : ''} onClick={() => go('admin')}>
                <ShieldCheck size={20} /><span>Админ</span>
              </button>
            )}
            <button type="button" onClick={() => setMode('landing')}><Globe size={20} /><span>Сайт</span></button>
          </nav>

          <p className="app-main__tip">
            Экран «{current?.label}» · переключайте экраны слева или нижней панелью.
          </p>
        </div>

      </main>
    </div>
  )
}
