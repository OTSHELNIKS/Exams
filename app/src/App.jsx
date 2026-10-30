import React, { useEffect, useRef, useState } from 'react'
import {
  Home, UserRound, Swords, Gamepad2, Trophy, Globe, ChevronLeft, ChevronRight, Sparkles,
  ClipboardList, LogIn, ShieldCheck, LifeBuoy, Send,
} from 'lucide-react'
import { AppFrame, Logo } from './ui.jsx'
import { Landing } from './landing.jsx'
import {
  AuthScreen, WizardScreen, HomeScreen, ProfileScreen, DraftScreen,
  MatchScreen, LeaderboardScreen, BannedScreen, SupportScreen,
} from './screens.jsx'
import { AdminScreen } from './admin.jsx'
import { DEFAULT_PROFILE } from './data.js'
import { supabase, profileToRow, rowToProfile, syncModerationReviews, clearPendingReviews } from './supabase.js'

const BOT_URL = 'https://t.me/name_mlbb_bot'

const SCREENS = [
  {
    id: 'auth', label: 'Вход / привязка ID', short: 'Вход', icon: LogIn,
    desc: 'Точка входа в приложение: почта без пароля, затем Game ID и Telegram-бот.',
    points: ['Ссылка для входа приходит на почту', 'Game ID привязывается к аккаунту', 'Код для бота живёт 10 минут'],
  },
  {
    id: 'wizard', label: 'Заполните профиль', short: 'Анкета', icon: ClipboardList,
    desc: 'Анкета игрока: ник, ранг, роли, серверы и скриншоты статистики.',
    points: ['Ник и фото уходят на проверку админу', 'Серверы выбираются по пингу', 'До 4 скриншотов статистики'],
  },
  {
    id: 'home', label: 'Главная игрока', short: 'Главная', icon: Home,
    desc: 'Карточка игрока: аватар, PTS, ранг и статус проверки статистики.',
    points: ['PTS стартуют с 1000', 'Статус модерации виден сразу', 'Отсюда переход в драфт и рейтинг'],
  },
  {
    id: 'profile', label: 'Профиль игрока', short: 'Профиль', icon: UserRound,
    desc: 'Полный профиль: серверы, роли, соцсети и привязка Telegram.',
    points: ['Публичные данные для драфта', 'Привязка и отвязка бота', 'Доп. слоты под фото'],
  },
  {
    id: 'draft', label: "Captain's Draft", short: 'Драфт', icon: Swords,
    desc: 'Два капитана с лучшим MMR по очереди собирают команды из общего пула.',
    points: ['Пул из 10 игроков', 'Капитаны выбираются по рейтингу', 'Порядок пиков виден всем'],
  },
  {
    id: 'match', label: 'Матч готов', short: 'Матч', icon: Gamepad2,
    desc: 'Составы собраны: бот отдаёт ID лобби и напоминает зайти в игру.',
    points: ['ID лобби приходит в Telegram', 'Кнопка «Отправить в бота»', 'После матча — начисление PTS'],
  },
  {
    id: 'leaderboard', label: 'Таблица лидеров', short: 'Рейтинг', icon: Trophy,
    desc: 'Сезонный топ-10 по PTS с призовыми местами и своей позицией.',
    points: ['Топ-3 получают призы', 'Свой результат виден в списке', 'Рейтинг обновляется после матча'],
  },
  {
    id: 'support', label: 'Поддержка', short: 'Помощь', icon: LifeBuoy,
    desc: 'Заявка из приложения сразу уходит админу в Telegram, ответ — сюда же.',
    points: ['Один экран вместо переписки', 'Статус заявки обновляется сам', 'Тот же чат работает в боте'],
  },
  {
    id: 'admin', label: 'Админка', short: 'Админ', icon: ShieldCheck, admin: true,
    desc: 'Рабочее место админа: аналитика, заявки, проверка анкет и баны.',
    points: ['Сводка по игрокам и заявкам', 'Очередь проверки анкет', 'Модерация в один тап'],
  },
]

const STORAGE_KEY = 'name-mlbb-profile:v2'
const LEGACY_STORAGE_KEY = 'name-mlbb-profile'

export default function App() {
  const [mode, setMode] = useState('landing')
  const [screen, setScreen] = useState('auth')
  const [gameId, setGameId] = useState('')
  const [session, setSession] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(Boolean(supabase))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
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
      } catch { /* noop */ }
    }
  }, [profile, gameId, session, sessionLoading])

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
          setProfile(data ? rowToProfile(data, DEFAULT_PROFILE) : { ...DEFAULT_PROFILE })
          setGameId(data?.game_id || '')
          const { data: adminRow } = await supabase.from('admins').select('user_id').eq('user_id', next.user.id).maybeSingle()
          if (!active || current !== generation) return
          setIsAdmin(!!adminRow)
        } else if (previousUserId) {
          setProfile({ ...DEFAULT_PROFILE }); setGameId(''); setIsAdmin(false)
        }
        setSaveError(''); setSessionLoading(false)
      }, 0)
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    document.body.classList.toggle('app-mode', mode === 'app')
  }, [mode])

  const go = (id) => setScreen(id)
  const openApp = (id = 'auth') => { setScreen(id); setMode('app') }

  const profileFilled = Boolean(profile.nick && profile.nick.trim())
  const autoEntered = useRef(false)

  // Return visits: skip landing once per load — home for filled profiles, wizard for new ones.
  useEffect(() => {
    if (!supabase || sessionLoading || !session || autoEntered.current) return
    if (mode !== 'landing') return
    autoEntered.current = true
    openApp(profileFilled ? 'home' : 'wizard')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, sessionLoading, session, mode, profileFilled])

  const saveProfile = async () => {
    if (sessionLoading || saving) return
    if (!session || !supabase) { go('home'); return }
    setSaving(true); setSaveError('')
    const { error } = await supabase.from('player_profiles').upsert(profileToRow(profile, gameId, session.user.id))
    setSaving(false)
    if (error) { setSaveError('Не удалось сохранить профиль: ' + error.message); return }
    const savedRow = profileToRow(profile, gameId, session.user.id)
    try { await syncModerationReviews(session.user.id, { nick: savedRow.nick, avatarUrl: savedRow.avatar_url, screenshots: savedRow.screenshot_urls }) } catch { /* review queue is best-effort */ }
    go('home')
  }

  const resetProfile = async () => {
    if (sessionLoading || saving) return false
    const fresh = { ...DEFAULT_PROFILE }
    setProfile(fresh); setGameId('')
    try {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(STORAGE_KEY + ':gameId')
    } catch { /* noop */ }
    if (!session || !supabase) return true
    try { await clearPendingReviews(session.user.id) } catch { /* noop */ }
    setSaving(true); setSaveError('')
    const { error } = await supabase.from('player_profiles').upsert(profileToRow(fresh, '', session.user.id))
    setSaving(false)
    if (error) { setSaveError('Не удалось очистить профиль: ' + error.message); return false }
    return true
  }

  const [draftTeams, setDraftTeams] = useState(null)

  const actions = {
    goDraft: () => go('draft'),
    goLeaderboard: () => go('leaderboard'),
    addSlot: () => setProfile((p) => ({ ...p, extraSlots: Math.min(3, (p.extraSlots || 0) + 1) })),
    addSocial: () => setProfile((p) => {
      const order = ['telegram', 'vk', 'google']
      const next = order.find((x) => !(p.socials || []).includes(x))
      if (!next) return p
      return { ...p, socials: [...(p.socials || []), next] }
    }),
  }

  const renderScreen = () => {
    switch (screen) {
      case 'auth':
        return <AuthScreen gameId={gameId} setGameId={setGameId} onLogin={() => go(profileFilled ? 'home' : 'wizard')} onPreview={() => go('home')} supabase={supabase} session={session} authReady={!sessionLoading} onSignOut={() => supabase.auth.signOut()} />
      case 'wizard':
        return <WizardScreen profile={profile} setProfile={setProfile} onDone={saveProfile} onBack={() => go('auth')} saveError={saveError} saving={saving || sessionLoading} supabase={supabase} userId={session?.user?.id || null} onReset={resetProfile} />
      case 'home':
        return <HomeScreen profile={profile} actions={actions} gameId={gameId} onEdit={() => go('wizard')} isAdmin={isAdmin} onAdmin={() => go('admin')} supabase={supabase} userId={session?.user?.id || null} />
      case 'profile':
        return <ProfileScreen profile={profile} actions={actions} gameId={gameId} onBack={() => go('home')} onEdit={() => go('wizard')} supabase={supabase} userId={session?.user?.id || null} />
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
        screensCount={SCREENS.filter((s) => !s.admin).length}
      />
    )
  }

  const current = SCREENS.find((s) => s.id === screen)
  const visibleScreens = SCREENS.filter((s) => !s.admin || isAdmin)
  const currentIndex = Math.max(visibleScreens.findIndex((s) => s.id === screen), 0)

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
        <button type="button" className="rail__back" onClick={() => setMode('landing')}>
          <Globe size={16} /> Промо-сайт
        </button>
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

        <aside className="app-side">
          <div className="app-side__card">
            <div className="app-side__top">
              <span className="app-side__kicker">ЭКРАН {String(currentIndex + 1).padStart(2, '0')} / {String(visibleScreens.length).padStart(2, '0')}</span>
              <span className="app-side__dots">
                {visibleScreens.map((s, i) => (
                  <i key={s.id} className={i <= currentIndex ? 'is-on' : ''} />
                ))}
              </span>
            </div>
            <h2 className="app-side__title">{current?.label}</h2>
            <p className="app-side__desc">{current?.desc}</p>
            <ul className="app-side__points">
              {(current?.points || []).map((point) => <li key={point}>{point}</li>)}
            </ul>
            <div className="app-side__nav">
              <button type="button" onClick={() => go(visibleScreens[Math.max(currentIndex - 1, 0)].id)} disabled={currentIndex === 0}>
                <ChevronLeft size={15} /> Назад
              </button>
              <button type="button" onClick={() => go(visibleScreens[Math.min(currentIndex + 1, visibleScreens.length - 1)].id)} disabled={currentIndex >= visibleScreens.length - 1}>
                Дальше <ChevronRight size={15} />
              </button>
            </div>
          </div>

          <div className="app-side__card app-side__card--flat">
            <span className="app-side__kicker">ЖИВОЙ ПРОДУКТ</span>
            <div className="app-side__actions">
              <a className="btn btn--primary btn--glow" href={BOT_URL} target="_blank" rel="noreferrer">
                <Send size={15} /> Telegram-бот
              </a>
              <button type="button" className="btn btn--ghost" onClick={() => setMode('landing')}>
                <Globe size={15} /> Промо-сайт
              </button>
            </div>
            <p className="app-side__note">
              Бот присылает ID лобби, ответы поддержки и уведомления о матчах. Привязка — в профиле игрока.
            </p>
          </div>

          <div className="app-side__facts">
            <span><b>10</b> игроков в лобби</span>
            <span><b>2</b> капитана драфтят</span>
            <span><b>20 000 ₽</b> за первое место</span>
          </div>
        </aside>
      </main>
    </div>
  )
}
