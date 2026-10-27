import React, { useEffect, useState } from 'react'
import {
  Home, UserRound, Swords, Gamepad2, Trophy, Globe, ChevronLeft, Sparkles,
  ClipboardList, LogIn,
} from 'lucide-react'
import { PhoneFrame, Logo } from './ui.jsx'
import { Landing } from './landing.jsx'
import {
  AuthScreen, WizardScreen, HomeScreen, ProfileScreen, DraftScreen,
  MatchScreen, LeaderboardScreen,
} from './screens.jsx'
import { DEFAULT_PROFILE } from './data.js'

const SCREENS = [
  { id: 'auth', label: 'Вход / привязка ID', short: 'Вход', icon: LogIn },
  { id: 'wizard', label: 'Заполните профиль', short: 'Анкета', icon: ClipboardList },
  { id: 'home', label: 'Главная игрока', short: 'Главная', icon: Home },
  { id: 'profile', label: 'Профиль игрока', short: 'Профиль', icon: UserRound },
  { id: 'draft', label: "Captain's Draft", short: 'Драфт', icon: Swords },
  { id: 'match', label: 'Матч готов', short: 'Матч', icon: Gamepad2 },
  { id: 'leaderboard', label: 'Таблица лидеров', short: 'Рейтинг', icon: Trophy },
]

const STORAGE_KEY = 'name-mlbb-profile'

export default function App() {
  const [mode, setMode] = useState('landing')
  const [screen, setScreen] = useState('auth')
  const [gameId, setGameId] = useState('')
  const [profile, setProfile] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      return saved ? { ...DEFAULT_PROFILE, ...saved } : DEFAULT_PROFILE
    } catch { return DEFAULT_PROFILE }
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)) } catch { /* noop */ }
  }, [profile])

  useEffect(() => {
    document.body.classList.toggle('app-mode', mode === 'app')
  }, [mode])

  const go = (id) => setScreen(id)
  const openApp = (id = 'auth') => { setScreen(id); setMode('app') }

  const actions = {
    goDraft: () => go('draft'),
    goLeaderboard: () => go('leaderboard'),
    addSlot: () => setProfile((p) => ({ ...p, extraSlots: Math.min(3, (p.extraSlots || 0) + 1) })),
    addSocial: () => setProfile((p) => ({ ...p, extraSocials: Math.min(3, (p.extraSocials || 0) + 1) })),
  }

  const renderScreen = () => {
    switch (screen) {
      case 'auth':
        return <AuthScreen gameId={gameId} setGameId={setGameId} onLogin={() => go('wizard')} onPreview={() => go('home')} />
      case 'wizard':
        return <WizardScreen profile={profile} setProfile={setProfile} onDone={() => go('home')} onBack={() => go('auth')} />
      case 'home':
        return <HomeScreen profile={profile} actions={actions} />
      case 'profile':
        return <ProfileScreen profile={profile} onBack={() => go('home')} onEdit={() => go('wizard')} />
      case 'draft':
        return <DraftScreen onReady={() => go('match')} onBack={() => go('home')} />
      case 'match':
        return <MatchScreen onBack={() => go('draft')} onLeaderboard={() => go('leaderboard')} />
      case 'leaderboard':
        return <LeaderboardScreen />
      default:
        return null
    }
  }

  if (mode === 'landing') {
    return (
      <Landing
        onOpen={() => openApp('auth')}
        onLogin={() => openApp('wizard')}
        onOpenScreen={() => openApp('home')}
        gameId={gameId}
        setGameId={setGameId}
      />
    )
  }

  const current = SCREENS.find((s) => s.id === screen)

  return (
    <div className="app-shell">
      <aside className="rail">
        <Logo />
        <p className="rail__note"><Sparkles size={13} /> Интерактивный прототип по макету заказчика</p>
        <span className="rail__label">ЭКРАНЫ МАКЕТА</span>
        <nav className="rail__nav">
          {SCREENS.map((s, i) => {
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
        <div className="app-main__head">
          <button type="button" className="icon-btn" onClick={() => setMode('landing')}><ChevronLeft size={20} /></button>
          <div>
            <strong>{current?.label}</strong>
            <small>NAME · прототип мобильного приложения</small>
          </div>
          <span className="app-main__badge">7 экранов</span>
        </div>

        <PhoneFrame>{renderScreen()}</PhoneFrame>

        <nav className="bottom-nav">
          {SCREENS.filter((s) => ['home', 'profile', 'draft', 'match', 'leaderboard'].includes(s.id)).map((s) => {
            const Icon = s.icon
            return (
              <button key={s.id} type="button" className={screen === s.id ? 'is-active' : ''} onClick={() => go(s.id)}>
                <Icon size={20} /><span>{s.short}</span>
              </button>
            )
          })}
          <button type="button" onClick={() => setMode('landing')}><Globe size={20} /><span>Сайт</span></button>
        </nav>

        <p className="app-main__tip">
          Экран «{current?.label}» · переключайте экраны слева или нижней панелью.
        </p>
      </main>
    </div>
  )
}
