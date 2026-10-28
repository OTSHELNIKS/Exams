import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Gamepad2, Send, ChevronLeft, Camera, Settings, Clock3, Lock, Plus, Copy, Mic,
  MicOff, Headphones, LogOut, Crown, RotateCcw, Check, ShieldCheck, Zap, Bot,
  Trophy, Sparkles, ArrowRight, X, UserRound, Upload, Coins, Server, Image as ImageIcon,
} from 'lucide-react'
import {
  Logo, BrandMark, Chip, Label, PrimaryButton, BackHeader, Avatar, VerificationCard,
  StatBadge, Steps, GameIdIcon, CrownIcon, SuccessCheck, CloseIcon, DemoTag,
} from './ui.jsx'
import {
  RANKS, ROLES, REGIONS, HERO_CLASSES, HEROES, CAPTAINS, DRAFT_POOL, DRAFT_FILTERS,
  MATCH_TEAM, LEADERBOARDS,
} from './data.js'
import { uploadAvatar, uploadScreenshot, deleteScreenshot, validateImage } from './supabase.js'

/* ================================================================ AUTH ==== */
export function AuthScreen({ gameId, setGameId, onLogin, onPreview, supabase, session, onSignOut }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const auth = async (register) => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 6) {
      setAuthError('Укажите корректную почту и пароль не короче 6 символов.'); return
    }
    setBusy(true); setAuthError(''); setNotice('')
    try {
      const result = register
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password })
      if (result.error) throw result.error
      if (register && !result.data.session) setNotice('Проверьте почту и подтвердите регистрацию, затем войдите.')
    } catch (error) { setAuthError(error.message || 'Ошибка входа') }
    finally { setBusy(false) }
  }
  const [notice, setNotice] = useState('')
  const login = (provider) => {
    setNotice(`Вход через ${provider}…`)
    setTimeout(() => onLogin(provider), 380)
  }
  return (
    <div className="screen auth">
      <div className="auth__logo"><Logo size="lg" /></div>

      <h1 className="hero-title">
        <span>Играй.</span>
        <span>Побеждай.</span>
        <span className="accent">Зарабатывай.</span>
      </h1>
      <p className="auth__subtitle">Соревновательный матчмейкинг MLBB</p>

      <Label>БЫСТРАЯ ПРИВЯЗКА GAME ID</Label>
      <div className="input-wrap">
        <GameIdIcon />
        <input
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
          placeholder="123456789 (1234)"
          inputMode="numeric"
          aria-label="Game ID"
        />
      </div>

      {supabase && (session ? (
        <div className="account-box">
          <p>Вы вошли: {session.user.email}</p>
          <button type="button" className="social social--primary" onClick={onLogin}>Открыть профиль</button>
          <button type="button" className="social" onClick={onSignOut}>Выйти из аккаунта</button>
        </div>
      ) : (
        <form className="account-box" onSubmit={(e) => { e.preventDefault(); auth(false) }}>
          <Label>АККАУНТ ПО ПОЧТЕ</Label>
          <label className="field"><span>EMAIL</span><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field"><span>ПАРОЛЬ</span><input type="password" autoComplete="current-password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="social social--primary" disabled={busy} type="submit">Войти по почте</button>
          <button className="social" disabled={busy} type="button" onClick={() => auth(true)}>Зарегистрироваться</button>
          {authError && <p role="alert">{authError}</p>}
        </form>
      ))}
      <p className="field-hint">Социальные кнопки ниже — демонстрация, не реальный вход.</p>
      <button type="button" className="social social--primary" onClick={() => login('Telegram')}>
        <BrandMark type="telegram" /><span>Войти через Telegram</span>
      </button>
      <button type="button" className="social" onClick={() => login('VK')}>
        <BrandMark type="vk" /><span>Войти через VK</span>
      </button>
      <button type="button" className="social" onClick={() => login('Google')}>
        <BrandMark type="google" /><span>Войти через Google</span>
      </button>
      <button type="button" className="social" onClick={() => login('Facebook')}>
        <BrandMark type="facebook" /><span>Войти через Facebook</span>
      </button>

      {notice && <div className="toast">{notice}</div>}

      <div className="auth__foot">
        <ShieldCheck size={16} color="#ff6a2b" />
        <span>Античит и верификация каждого игрока</span>
      </div>
      {onPreview && (
        <button type="button" className="link-btn" onClick={onPreview}>
          Посмотреть все экраны <ArrowRight size={15} />
        </button>
      )}
    </div>
  )
}

/* ============================================================== WIZARD ==== */
export function WizardScreen({ profile, setProfile, onDone, onBack, saveError, saving, supabase, userId, onReset }) {
  const [step, setStep] = useState(1)
  const [toast, setToast] = useState('')
  const [uploading, setUploading] = useState('')
  const fileRef = useRef(null)
  const shotRef = useRef(null)
  const canUpload = Boolean(supabase && userId)
  const avatarPreview = profile.avatar || profile.avatarUrl || null
  const shots = profile.screenshots || []

  const set = (patch) => setProfile((p) => ({ ...p, ...patch }))
  const toggle = (key, value, max) => setProfile((p) => {
    const arr = p[key] || []
    if (arr.includes(value)) return { ...p, [key]: arr.filter((v) => v !== value) }
    if (max && arr.length >= max) { setToast(`Можно выбрать не больше ${max}`); return p }
    return { ...p, [key]: [...arr, value] }
  })

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const readAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  const onAvatar = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const err = validateImage(file)
    if (err) { setToast(err); return }
    try {
      set({ avatar: await readAsDataUrl(file) })
    } catch { setToast('Не удалось прочитать файл'); return }
    if (!canUpload) { setToast('Войди по почте, чтобы фото сохранилось в профиле'); return }
    setUploading('avatar')
    try {
      const publicUrl = await uploadAvatar(file, userId)
      set({ avatarUrl: publicUrl })
      setToast('Фото загружено')
    } catch (error) {
      setToast('Не удалось загрузить фото: ' + (error.message || 'ошибка'))
    } finally {
      setUploading('')
    }
  }

  const onShots = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    const room = 4 - shots.length
    if (room <= 0) { setToast('Максимум 4 скриншота'); return }
    const picked = files.slice(0, room)
    for (const file of picked) {
      const err = validateImage(file)
      if (err) { setToast(err); return }
    }
    if (!canUpload) {
      try {
        const previews = await Promise.all(picked.map(readAsDataUrl))
        setProfile((p) => ({ ...p, screenshots: [...(p.screenshots || []), ...previews].slice(0, 4) }))
      } catch { setToast('Не удалось прочитать файлы'); return }
      setToast('Войди по почте, чтобы скриншоты сохранились')
      return
    }
    setUploading('shots')
    try {
      const urls = []
      for (const file of picked) {
        urls.push(await uploadScreenshot(file, userId))
      }
      setProfile((p) => ({ ...p, screenshots: [...(p.screenshots || []), ...urls].slice(0, 4) }))
      setToast('Скриншоты загружены')
    } catch (error) {
      setToast('Не удалось загрузить: ' + (error.message || 'ошибка'))
    } finally {
      setUploading('')
    }
  }

  const removeShot = (shot) => {
    setProfile((p) => ({ ...p, screenshots: (p.screenshots || []).filter((s) => s !== shot) }))
    if (canUpload && typeof shot === 'string' && shot.startsWith('http')) {
      deleteScreenshot(shot, userId)
    }
  }

  const next = () => {
    if (uploading) { setToast('Дождись окончания загрузки'); return }
    if (step === 1 && !profile.nick.trim()) { setToast('Укажи свой ник'); return }
    if (step === 1 && profile.age && (!/^\d{1,3}$/.test(String(profile.age)) || Number(profile.age) < 1 || Number(profile.age) > 120)) { setToast('Укажи корректный возраст от 1 до 120'); return }
    if (step < 3) { setStep(step + 1); return }
    onDone()
  }

  return (
    <div className="screen wizard">
      <div className="wizard__top">
        <button type="button" className="icon-btn" onClick={step === 1 ? onBack : () => setStep(step - 1)}>
          <ChevronLeft size={22} />
        </button>
        <Steps current={step} total={3} />
      </div>
      <h1 className="screen-title wizard__title">Заполните<br />профиль</h1>
      <p className="screen-subtitle">Как тебя видят другие игроки</p>

      {step === 1 && (
        <>
          <div className="wizard__identity">
            <button type="button" className="avatar-upload" onClick={() => fileRef.current?.click()} disabled={uploading === 'avatar'}>
              {avatarPreview
                ? <img src={avatarPreview} alt="avatar" />
                : <><Camera size={24} color="#ff5722" /><span>Установить<br />фото</span></>}
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={onAvatar} />
            {uploading === 'avatar' && <p className="field-hint">Загрузка фото…</p>}
            <div className="wizard__fields">
              <label className="field">
                <span>НИК</span>
                <input value={profile.nick} onChange={(e) => set({ nick: e.target.value })} placeholder="haze" maxLength={50} />
              </label>
              <label className="field">
                <span>ВОЗРАСТ <em>необяз.</em></span>
                <input value={profile.age} onChange={(e) => set({ age: e.target.value })} placeholder="19" inputMode="numeric" maxLength={3} />
              </label>
            </div>
          </div>

          <Label>ПОЛ</Label>
          <div className="segmented">
            <button type="button" className={profile.gender === 'М' ? 'is-active' : ''} onClick={() => set({ gender: 'М' })}>М</button>
            <button type="button" className={profile.gender === 'Ж' ? 'is-active' : ''} onClick={() => set({ gender: 'Ж' })}>Ж</button>
          </div>

          <Label hint="подбор по рейтингу">РАНГ</Label>
          <div className="chips">
            {RANKS.map((r) => <Chip key={r} active={profile.rank === r} onClick={() => set({ rank: r })}>{r}</Chip>)}
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <Label hint="мультироль ускоряет подбор">РОЛИ (МОЖНО НЕСКОЛЬКО)</Label>
          <div className="chips">
            {ROLES.map((r) => <Chip key={r} active={profile.roles.includes(r)} onClick={() => toggle('roles', r)}>{r}</Chip>)}
          </div>

          <div className="info-strip">
            <Server size={16} /> Выбор сервера — главное отличие: играй там, где лучший пинг
          </div>

          <Label hint="низкий пинг">РЕГИОН (МОЖНО НЕСКОЛЬКО)</Label>
          <div className="chips">
            {REGIONS.map((r) => <Chip key={r} active={profile.regions.includes(r)} onClick={() => toggle('regions', r)}>{r}</Chip>)}
          </div>

          <Label>О СЕБЕ</Label>
          <p className="field-hint">Добавьте описание профиля.</p>
          <textarea
            className="textarea"
            rows={4}
            maxLength={1000}
            value={profile.bio}
            onChange={(e) => set({ bio: e.target.value })}
            placeholder="Расскажите о себе"
          />
        </>
      )}

      {step === 3 && (
        <>
          <Label hint={`${profile.heroes.length}/6`}>ЛЮБИМЫЕ ГЕРОИ (МАКС. 6)</Label>
          <div className="chips">
            {HEROES.map((h) => <Chip key={h} active={profile.heroes.includes(h)} onClick={() => toggle('heroes', h, 6)}>{h}</Chip>)}
          </div>

          <Label>КЛАССЫ ГЕРОЕВ (МАКС. 6)</Label>
          <div className="chips">
            {HERO_CLASSES.map((h) => <Chip key={h} active={profile.heroClasses.includes(h)} onClick={() => toggle('heroClasses', h, 6)}>{h}</Chip>)}
          </div>

          <Label hint={`${shots.length}/4`}>СКРИНШОТЫ СТАТИСТИКИ</Label>
          {shots.length > 0 && (
            <div className="shots-grid">
              {shots.map((shot) => (
                <div key={shot.slice(-32)} className="shot-thumb">
                  <img src={shot} alt="Скриншот статистики" />
                  <button type="button" className="shot-thumb__remove" onClick={() => removeShot(shot)} aria-label="Удалить скриншот">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="upload-zone" onClick={() => shotRef.current?.click()} disabled={uploading === 'shots' || shots.length >= 4}>
            <Upload size={20} />
            <span>{uploading === 'shots' ? 'Загрузка…' : shots.length >= 4 ? 'Максимум 4 скриншота' : 'Загрузить скриншот профиля MLBB'}</span>
          </button>
          <input ref={shotRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={onShots} />
          <div className="bot-note">
            <Bot size={15} />
            {canUpload
              ? 'Скриншоты сохраняются в твоём профиле и видны другим игрокам'
              : 'Войди по почте на экране входа — иначе загрузки останутся только на этом устройстве'}
          </div>
        </>
      )}

      {toast && <div className="toast toast--fixed">{toast}</div>}
      {saveError && <p role="alert" className="field-hint">{saveError}</p>}
      <div className="wizard__bottom">
        <PrimaryButton onClick={next} disabled={saving}>
          {saving ? 'СОХРАНЕНИЕ…' : step === 3 ? 'СОХРАНИТЬ ПРОФИЛЬ' : 'ДАЛЕЕ'}
        </PrimaryButton>
        <button
          type="button"
          className="link-btn wizard__reset"
          disabled={saving}
          onClick={async () => { const ok = await onReset(); if (ok) { setStep(1); setToast('Анкета очищена — заполни заново'); } }}
        >
          Очистить анкету
        </button>
      </div>
    </div>
  )
}

/* ================================================================ HOME ==== */
export function AdBanner({ compact }) {
  return (
    <div className={`ad-banner ${compact ? 'ad-banner--compact' : ''}`}>
      <span className="ad-banner__tag">ПАРТНЁР</span>
      <div className="ad-banner__body">
        <strong>GGSL — алмазы дешевле</strong>
        <small>Техподдержка · ставки · бонусы</small>
      </div>
      <ArrowRight size={17} />
    </div>
  )
}

export function StatsGrid({ profile, onAddSlot, onEdit }) {
  const real = (profile.screenshots || []).slice(0, 4)
  const extras = profile.extraSlots || 0
  const hasAny = real.length > 0 || extras > 0
  return (
    <>
      <div className="section-head"><span>СКРИНШОТЫ СТАТИСТИКИ</span><b>{real.length}/4</b></div>
      {!hasAny ? (
        <div className="empty-block">
          <p>Скриншотов пока нет. Загрузи статистику из MLBB в анкете — другие игроки увидят её здесь.</p>
          <button type="button" className="btn btn--ghost" onClick={onEdit}>
            Открыть анкету <ArrowRight size={15} />
          </button>
        </div>
      ) : (
        <div className="stats-grid">
          {real.map((src, i) => (
            <div key={`shot-${i}`} className="stat-tile stat-tile--img">
              <img src={src} alt="" />
              <span>Скриншот {i + 1}</span>
            </div>
          ))}
          {Array.from({ length: extras }, (_, i) => (
            <div key={`extra-${i}`} className="stat-tile stat-tile--extra"><Plus size={20} /><span>Доп. слот</span></div>
          ))}
        </div>
      )}
      <button type="button" className="slot-btn" onClick={onAddSlot}>
        <Lock size={16} /> Доп. слот (150 ₽)
      </button>
    </>
  )
}

const SOCIAL_ORDER = ['telegram', 'vk', 'google']
const SOCIAL_NAMES = { telegram: 'Telegram', vk: 'VK', google: 'Google' }

export function SocialRow({ profile, onAddSocial }) {
  const [toast, setToast] = useState('')
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const bound = profile.socials || []
  return (
    <div className="social-block">
      <div className="section-head"><span>СОЦСЕТИ</span><b>{bound.length}/3</b></div>
      {bound.length === 0 && (
        <p className="social-hint">Ничего не привязано. Нажми +, чтобы добавить (демо: 30 ₽).</p>
      )}
      <div className="social-row">
        {bound.map((x) => (
          <button key={x} type="button" className="social-circle" title={SOCIAL_NAMES[x]} onClick={() => setToast(`Демо: ${SOCIAL_NAMES[x]} привязана`)}>
            <BrandMark type={x} />
          </button>
        ))}
        {bound.length < SOCIAL_ORDER.length && (
          <button type="button" className="social-circle social-circle--add" onClick={() => { onAddSocial(); setToast('Соцсеть привязана — 30 ₽ (демо)'); }} title="Привязать соцсеть — 30 ₽">
            <Plus size={18} />
          </button>
        )}
      </div>
      {toast && <div className="toast toast--fixed">{toast}</div>}
    </div>
  )
}

export function HomeScreen({ profile, actions, gameId, onEdit }) {
  const [toast, setToast] = useState('')
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const hasBadges = profile.elo != null || (profile.roles || []).length > 0

  return (
    <div className="screen home">
      {gameId ? (
        <div className="home__header">
          <span className="home__id">Game ID • {gameId}</span>
        </div>
      ) : null}

      <div className="home__hero">
        <Avatar src={profile.avatarUrl || profile.avatar || null} initials={(profile.nick?.[0] || '?').toUpperCase()} level={profile.level} size={104} />
        <h1>{profile.nick || 'Новый игрок'}</h1>
        {hasBadges && (
          <div className="home__badges">
            {profile.elo != null && <StatBadge tone="elo"><Zap size={14} /> {profile.elo} ELO</StatBadge>}
            {(profile.roles || []).length > 0 && <StatBadge tone="dark"><UserRound size={14} /> {profile.roles[0]}</StatBadge>}
          </div>
        )}
        {profile.bio ? <p className="home__bio">{profile.bio}</p> : null}
      </div>

      {profile.nick ? <VerificationCard /> : null}

      <StatsGrid profile={profile} onAddSlot={() => { actions.addSlot(); setToast('Доп. слот куплен за 150 ₽ (демо)'); }} onEdit={onEdit} />

      <AdBanner compact />

      <SocialRow profile={profile} onAddSocial={actions.addSocial} />

      <div className="home__actions">
        {profile.nick
          ? <PrimaryButton icon={Gamepad2} onClick={actions.goDraft}>НАЙТИ МАТЧ</PrimaryButton>
          : <PrimaryButton icon={UserRound} onClick={onEdit}>ЗАПОЛНИТЬ ПРОФИЛЬ</PrimaryButton>}
        <button type="button" className="btn btn--ghost" onClick={actions.goLeaderboard}>
          <Trophy size={17} /> ТАБЛИЦА ЛИДЕРОВ
        </button>
      </div>
      {toast && <div className="toast toast--fixed">{toast}</div>}
    </div>
  )
}

/* ============================================================= PROFILE ==== */
export function ProfileScreen({ profile, actions, gameId, onBack, onEdit }) {
  const [toast, setToast] = useState('')
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const hasBadges = profile.elo != null || (profile.roles || []).length > 0

  return (
    <div className="screen profile">
      <div className="profile__head">
        <h1 className="screen-title">Профиль игрока</h1>
        <button type="button" className="icon-btn" onClick={onEdit} aria-label="Настройки"><Settings size={20} /></button>
      </div>

      <div className="profile__center">
        <Avatar src={profile.avatarUrl || profile.avatar || null} initials={(profile.nick?.[0] || '?').toUpperCase()} level={profile.level} size={128} />
        <h1>{profile.nick || 'Новый игрок'}</h1>
        {gameId ? <p className="profile__gameid">Game ID • {gameId}</p> : null}
        {hasBadges && (
          <div className="home__badges">
            {profile.elo != null && <StatBadge tone="elo"><Zap size={14} /> {profile.elo} ELO</StatBadge>}
            {(profile.roles || []).length > 0 && <StatBadge tone="dark"><UserRound size={14} /> {profile.roles[0]}</StatBadge>}
          </div>
        )}
        {profile.bio ? <p className="home__bio">{profile.bio}</p> : null}
      </div>

      {profile.nick ? <VerificationCard /> : null}
      <StatsGrid profile={profile} onAddSlot={() => { actions.addSlot(); setToast('Доп. слот куплен за 150 ₽ (демо)'); }} onEdit={onEdit} />
      <SocialRow profile={profile} onAddSocial={actions.addSocial} />
      {toast && <div className="toast toast--fixed">{toast}</div>}
      <button type="button" className="btn btn--ghost profile__back" onClick={onBack}>На главную</button>
    </div>
  )
}

/* =============================================================== DRAFT ==== */
function PlayerPeek({ player, onClose, onPick }) {
  if (!player) return null
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal__close" onClick={onClose}><CloseIcon /></button>
        <div className="modal__avatar">{player.id}</div>
        <h3>{player.nick}</h3>
        <p className="modal__role">{player.role} · {player.elo} ELO</p>
        <div className="modal__stats">
          <div><b>{player.winrate}%</b><span>Винрейт</span></div>
          <div><b>{player.kda}</b><span>KDA</span></div>
          <div><b>{player.elo}</b><span>MMR</span></div>
        </div>
        <PrimaryButton glow={false} onClick={() => { onPick(); onClose() }}>ВЫБРАТЬ В КОМАНДУ</PrimaryButton>
      </div>
    </div>
  )
}

export function DraftScreen({ onReady, onBack }) {
  const [teamA, setTeamA] = useState([])
  const [teamB, setTeamB] = useState([])
  const [turn, setTurn] = useState('A')
  const [timer, setTimer] = useState(30)
  const [filter, setFilter] = useState('ВСЕ')
  const [peek, setPeek] = useState(null)
  const [coin, setCoin] = useState(null)
  const [toast, setToast] = useState('')

  const pickedIds = useMemo(() => [...teamA, ...teamB].map((p) => p.id), [teamA, teamB])
  const pool = DRAFT_POOL.filter((p) => !pickedIds.includes(p.id))
  const full = teamA.length === 4 && teamB.length === 4

  useEffect(() => {
    const side = Math.random() > 0.5 ? 'A' : 'B'
    setCoin(side)
    setTurn(side)
  }, [])

  useEffect(() => {
    if (full) return
    const t = setInterval(() => setTimer((v) => (v > 0 ? v - 1 : 30)), 1000)
    return () => clearInterval(t)
  }, [full])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const pick = (player) => {
    if (full) return
    if (turn === 'A' && teamA.length < 4) {
      setTeamA((a) => [...a, player]); setTurn('B')
    } else if (turn === 'B' && teamB.length < 4) {
      setTeamB((b) => [...b, player]); setTurn('A')
    }
    setTimer(30)
  }

  const autoPick = () => {
    const candidates = pool.filter((p) => filter === 'ВСЕ' || p.role.toUpperCase().includes(filter))
    const p = (candidates.length ? candidates : pool)[0]
    if (p) { pick(p); setToast('Таймер вышел — игрок выбран автоматически') }
  }

  useEffect(() => {
    if (timer === 0 && !full) autoPick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer])

  const reset = () => {
    setTeamA([]); setTeamB([]); setTimer(30); setFilter('ВСЕ')
    const side = Math.random() > 0.5 ? 'A' : 'B'
    setCoin(side); setTurn(side)
  }

  const visible = pool.filter((p) => filter === 'ВСЕ' || p.role.toUpperCase().includes(filter))
  const TeamCard = ({ side, players }) => {
    const cap = CAPTAINS[side]
    return (
      <div className={`team-card team-card--${side.toLowerCase()} ${turn === side && !full ? 'is-active' : ''}`}>
        <div className="team-card__head"><span>TEAM {side}</span><b>{cap.mmr} MMR</b></div>
        <div className="team-card__captain">
          <span className="team-card__avatar" style={{ borderColor: cap.color }}>{cap.id}</span>
          <div><strong><CrownIcon /> {cap.nick}</strong><small>Капитан</small></div>
        </div>
        <div className="team-card__slots">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className={players[i] ? 'is-filled' : ''}>
              {players[i] ? players[i].id : <Plus size={16} />}
            </span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="screen draft">
      <div className="draft__head">
        <div>
          <h1>CAPTAIN'S DRAFT</h1>
          <p>Формат 5v5 • Выбор игроков в ростер <DemoTag /></p>
        </div>
        <div className="draft__timer"><Clock3 size={16} /> 00:{String(timer).padStart(2, '0')}</div>
        <button type="button" className="icon-btn" onClick={reset} title="Сбросить драфт"><RotateCcw size={18} /></button>
      </div>

      <div className="draft__turn">
        <span>Очередь:</span>
        <b>{full ? 'РОСТЕРЫ УКОМПЛЕКТОВАНЫ' : `КОМАНДА ${turn}`}</b>
        {coin && !full && <em>Монетка: первый ход — TEAM {coin}</em>}
      </div>

      <div className="draft__teams">
        <TeamCard side="A" players={teamA} />
        <div className="draft__vs">VS</div>
        <TeamCard side="B" players={teamB} />
      </div>

      <div className="chips chips--scroll">
        {DRAFT_FILTERS.map((f) => <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>{f}</Chip>)}
      </div>

      <div className="section-head draft__poolhead">
        <span>ПУЛ ДОСТУПНЫХ ИГРОКОВ</span><b>{pool.length} свободно</b>
      </div>

      <div className="pool">
        {visible.map((p) => (
          <div key={p.id} className="pool-row">
            <button type="button" className="pool-row__info" onClick={() => setPeek(p)}>
              <span className="pool-row__avatar">{p.id}</span>
              <span className="pool-row__text">
                <strong>{p.nick} <em>{p.elo}</em></strong>
                <small>{p.role} · <i>{p.winrate}%</i> · {p.kda} KDA</small>
              </span>
            </button>
            <button type="button" className="pick-btn" disabled={full} onClick={() => pick(p)}>
              <UserRound size={15} /> ВЫБРАТЬ В КОМАНДУ
            </button>
          </div>
        ))}
        {visible.length === 0 && <div className="empty">Игроков с такой ролью не осталось</div>}
      </div>

      <div className="draft__bottom">
        {full
          ? <PrimaryButton onClick={onReady}>МАТЧ ГОТОВ — ОТКРЫТЬ ЛОББИ</PrimaryButton>
          : <button type="button" className="btn btn--ghost" onClick={onBack}>Отменить поиск</button>}
      </div>

      {peek && <PlayerPeek player={peek} onClose={() => setPeek(null)} onPick={() => pick(peek)} />}
      {toast && <div className="toast toast--fixed">{toast}</div>}
    </div>
  )
}

/* =============================================================== MATCH ==== */
export function MatchScreen({ onBack, onLeaderboard }) {
  const [copied, setCopied] = useState(false)
  const [micOn, setMicOn] = useState(true)
  const [muted, setMuted] = useState({})
  const [speaking, setSpeaking] = useState(['G', 'H'])
  const lobbyId = '8435943'

  useEffect(() => {
    const t = setInterval(() => {
      setSpeaking(Object.keys({ ...muted }).length ? ['G', 'H'] : ['G', 'K', 'H'])
    }, 2600)
    return () => clearInterval(t)
  }, [muted])

  const copy = () => {
    navigator.clipboard?.writeText(lobbyId).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="screen match">
      <div className="match__badges"><span className="match__badge"><i /> Матч найден</span> <DemoTag text="демо-симуляция" /></div>
      <h1 className="match__title">Матч готов</h1>
      <p className="match__sub"><Bot size={16} /> Бот создал лобби в игре</p>

      <div className="lobby-card">
        <span className="lobby-card__label">ID ЛОББИ</span>
        <strong>{lobbyId}</strong>
        <button type="button" className="btn btn--primary btn--glow" onClick={copy}>
          {copied ? <Check size={18} /> : <Copy size={18} />}
          {copied ? 'Скопировано!' : 'Скопировать'}
        </button>
      </div>

      <div className="voice-card">
        <div className="voice-card__head">
          <span><Headphones size={17} /> Голосовой чат · Team A</span>
          <b>5/5</b>
        </div>
        {MATCH_TEAM.map((m) => (
          <div key={m.id} className="voice-row">
            <span className={`voice-row__avatar ${speaking.includes(m.id) ? 'is-speaking' : ''}`}>{m.id}</span>
            <div><strong>{m.nick}</strong><small>{m.role}</small></div>
            <button
              type="button"
              className={`voice-row__mic ${muted[m.id] ? 'is-muted' : ''}`}
              onClick={() => setMuted((x) => ({ ...x, [m.id]: !x[m.id] }))}
              title={muted[m.id] ? 'Включить' : 'Заглушить'}
            >
              {muted[m.id] ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
          </div>
        ))}
        <div className="voice-card__foot">
          <button type="button" className={`btn btn--small ${micOn ? '' : 'is-off'}`} onClick={() => setMicOn(!micOn)}>
            {micOn ? <Mic size={16} /> : <MicOff size={16} />} Микрофон
          </button>
          <button type="button" className="btn btn--small btn--danger" onClick={onBack}><LogOut size={16} /> Выйти</button>
        </div>
      </div>

      <div className="parse-note">
        <span><ImageIcon size={17} /> Авто-парсинг скриншота после игры</span>
        <i />
      </div>
      <p className="match__hint">Бот сам посчитает статистику и начислит PTS.</p>
      <button type="button" className="link-btn" onClick={onLeaderboard}>Смотреть таблицу лидеров <ArrowRight size={15} /></button>
    </div>
  )
}

/* ========================================================= LEADERBOARD ==== */
export function LeaderboardScreen() {
  const [tab, setTab] = useState('Сезон')
  const [league, setLeague] = useState('Обычная лига')
  const rows = LEADERBOARDS[tab]

  return (
    <div className="screen leaderboard">
      <div className="leaderboard__head">
        <h1 className="screen-title">Таблица лидеров</h1>
        <Trophy size={22} color="#ff5722" />
      </div>

      <div className="tabs">
        {Object.keys(LEADERBOARDS).map((t) => (
          <button key={t} type="button" className={tab === t ? 'is-active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <p className="leaderboard__note">Призы топ-3 выплачиваются ежемесячно · <DemoTag /></p>

      <div className="league-switch">
        <button type="button" className={league === 'Обычная лига' ? 'is-active' : ''} onClick={() => setLeague('Обычная лига')}>Обычная лига · до 4000</button>
        <button type="button" className={league === 'Про лига' ? 'is-active' : ''} onClick={() => setLeague('Про лига')}>Про лига · 4000+</button>
      </div>

      <div className="rank-list">
        {(league === 'Про лига'
          ? rows.slice(0, 5).map((r) => ({ ...r, elo: r.elo + 900 }))
          : rows
        ).map((r, i) => (
          <div key={`${r.nick}-${i}`} className={`rank-row ${i === 0 ? 'rank-row--first' : ''} ${r.me ? 'rank-row--me' : ''}`}>
            <span className="rank-row__num">#{i + 1}</span>
            <span className="rank-row__avatar">{r.nick[0]}</span>
            <div className="rank-row__info">
              <strong>{r.nick}{r.pro && <CrownIcon />}</strong>
              {r.prize && <span className="prize">{r.prize}</span>}
            </div>
            <div className="rank-row__elo"><b>{r.elo}</b><span>ELO</span></div>
          </div>
        ))}
      </div>

      <div className="prize-note">
        <Coins size={17} /> 1 место — 20 000 ₽ · 2 место — 15 000 ₽ · 3 место — 10 000 ₽
      </div>
      <AdBanner compact />
    </div>
  )
}
