import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Gamepad2, Send, ChevronLeft, Camera, Settings, Clock3, Lock, Plus, Copy, Mic,
  MicOff, Headphones, LogOut, Crown, RotateCcw, Check, ShieldCheck, Zap, Bot,
  Trophy, Sparkles, ArrowRight, X, UserRound, Upload, Coins, Server, Image as ImageIcon,
  RefreshCw, Ban, LifeBuoy, MessageSquare,
} from 'lucide-react'
import {
  Logo, BrandMark, Chip, Label, PrimaryButton, BackHeader, Avatar, VerificationCard,
  StatBadge, Steps, GameIdIcon, CrownIcon, SuccessCheck, CloseIcon,
} from './ui.jsx'
import {
  RANKS, ROLES, REGIONS, HERO_CLASSES, HEROES, DRAFT_FILTERS,
} from './data.js'
import { AvatarCropModal } from './crop.jsx'
import {
  uploadAvatar, uploadScreenshot, deleteScreenshot, validateImage,
  TELEGRAM_BOT_USERNAME, createTelegramLinkCode, getTelegramLink,
  deleteTelegramLink, notifyLobbyToTelegram,
  createSupportTicket, fetchSupportTickets, announceSupportTicket,
} from './supabase.js'

/* ================================================================ AUTH ==== */
export function AuthScreen({ gameId, setGameId, onLogin, onPreview, supabase, session, onSignOut, authReady }) {
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
      const redirectTo = window.location.protocol.startsWith('http') ? window.location.origin : undefined
      const result = register
        ? await supabase.auth.signUp({ email, password, options: redirectTo ? { emailRedirectTo: redirectTo } : {} })
        : await supabase.auth.signInWithPassword({ email, password })
      if (result.error) throw result.error
      if (register && !result.data.session) setNotice('Проверьте почту и подтвердите регистрацию, затем войдите.')
    } catch (error) { setAuthError(error.message || 'Ошибка входа') }
    finally { setBusy(false) }
  }
  const [notice, setNotice] = useState('')
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
          <button type="button" className="social social--primary" disabled={authReady === false} onClick={onLogin}>{authReady === false ? 'Загрузка профиля…' : 'Открыть профиль'}</button>
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
      <div className="tg-auth">
        <Label>TELEGRAM-БОТ</Label>
        <p className="social-hint">Войди по почте, затем привяжи Telegram в Профиле — бот пришлёт ID лобби и уведомления о матчах.</p>
        <a className="social social--primary tg-auth__link" href={`https://t.me/${TELEGRAM_BOT_USERNAME}`} target="_blank" rel="noreferrer">
          <BrandMark type="telegram" /><span>Открыть @{TELEGRAM_BOT_USERNAME}</span>
        </a>
      </div>

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

  /* Выбор фото открывает обрезку: квадрат 512×512, сдвиг + масштаб. */
  const [cropSrc, setCropSrc] = useState(null)

  useEffect(() => () => { if (cropSrc) URL.revokeObjectURL(cropSrc) }, [cropSrc])

  const closeCropper = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc(null)
  }

  const onAvatar = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const err = validateImage(file)
    if (err) { setToast(err); return }
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc(URL.createObjectURL(file))
  }

  const applyAvatar = async (cropped) => {
    closeCropper()
    try {
      set({ avatar: await readAsDataUrl(cropped) })
    } catch { setToast('Не удалось прочитать файл'); return }
    if (!canUpload) { setToast('Войди по почте, чтобы фото сохранилось в профиле'); return }
    setUploading('avatar')
    try {
      const publicUrl = await uploadAvatar(cropped, userId)
      set({ avatarUrl: publicUrl })
      setToast('Фото обновлено')
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

      {cropSrc && (
        <AvatarCropModal
          src={cropSrc}
          onCancel={closeCropper}
          onApply={applyAvatar}
          busy={uploading === 'avatar'}
        />
      )}
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
        <p className="social-hint">Ничего не привязано. Нажми +, чтобы добавить.</p>
      )}
      <div className="social-row">
        {bound.map((x) => (
          <button key={x} type="button" className="social-circle" title={SOCIAL_NAMES[x]} onClick={() => setToast(`${SOCIAL_NAMES[x]} привязана`)}>
            <BrandMark type={x} />
          </button>
        ))}
        {bound.length < SOCIAL_ORDER.length && (
          <button type="button" className="social-circle social-circle--add" onClick={() => { onAddSocial(); setToast('Соцсеть привязана'); }} title="Привязать соцсеть">
            <Plus size={18} />
          </button>
        )}
      </div>
      {toast && <div className="toast toast--fixed">{toast}</div>}
    </div>
  )
}

export function HomeScreen({ profile, actions, gameId, onEdit, isAdmin, onAdmin, supabase, userId }) {
  const [toast, setToast] = useState('')
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const hasBadges = profile.elo != null || (profile.roles || []).length > 0

  return (
    <div className="screen home">
      {(gameId || isAdmin) ? (
        <div className="home__header">
          {gameId ? <span className="home__id">Game ID • {gameId}</span> : null}
          {isAdmin ? (
            <button type="button" className="home__admin" onClick={onAdmin}>
              <CrownIcon /> ADMIN
            </button>
          ) : null}
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

      {profile.nick ? <VerificationCard supabase={supabase} userId={userId} /> : null}

      <StatsGrid profile={profile} onAddSlot={() => { actions.addSlot(); setToast('Доп. слот добавлен'); }} onEdit={onEdit} />

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

/* ============================================================== BANNED ==== */
export function BannedScreen({ nick, reason, onSignOut }) {
  return (
    <div className="screen banned">
      <div className="banned__card">
        <span className="banned__icon"><Ban size={30} /></span>
        <h1>Аккаунт заблокирован</h1>
        {nick ? <p className="banned__nick">{nick}</p> : null}
        {reason ? (
          <p className="banned__reason">Причина: {reason}</p>
        ) : (
          <p className="social-hint">По вопросам разблокировки обратись к администратору.</p>
        )}
        <button type="button" className="btn btn--ghost" onClick={onSignOut}>
          <LogOut size={16} /> Выйти из аккаунта
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------- telegram link */
const TG_POLL_MS = 4000

function tgErrText(e) {
  if (e && e.message === 'timeout') return 'Сервер не ответил за 20 секунд — проверь интернет и нажми ещё раз.'
  if (e && e.message) return 'Не получилось: ' + e.message
  return 'Не получилось. Попробуй ещё раз.'
}

function TelegramLinkCard({ supabase, userId }) {
  const [link, setLink] = useState(undefined) // undefined=loading, null=none, obj=linked
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const refresh = async () => {
    if (!supabase || !userId) return null
    try {
      const row = await getTelegramLink(userId)
      setLink(row)
      return row
    } catch { setLink(null); return null }
  }

  const checkSent = async () => {
    setChecking(true); setErr('')
    const row = await refresh()
    setChecking(false)
    if (!row) setErr('Привязка пока не найдена — убедись, что нажал START у бота, и что коду меньше 10 минут.')
  }

  useEffect(() => {
    setLink(undefined); setCode('')
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    if (!code || link) return
    const t = setInterval(async () => {
      try {
        const row = await getTelegramLink(userId)
        if (row) { setLink(row); setCode(''); setToast('Telegram привязан!') }
      } catch { /* noop */ }
    }, TG_POLL_MS)
    return () => clearInterval(t)
  }, [code, link, userId, supabase])

  if (!supabase || !userId) {
    return (
      <div className="tg-card">
        <div className="section-head"><span>TELEGRAM-БОТ</span></div>
        <p className="social-hint">Войди по почте, чтобы привязать Telegram и получать ID лобби.</p>
      </div>
    )
  }

  const makeCode = async () => {
    setBusy(true); setErr('')
    try {
      setCode(await createTelegramLinkCode(userId))
    } catch (e) {
      setErr(tgErrText(e))
    } finally {
      setBusy(false)
    }
  }

  const unlink = async () => {
    setBusy(true); setErr('')
    try {
      await deleteTelegramLink(userId)
      setLink(null); setCode('')
      setToast('Telegram отвязан')
    } catch (e) {
      setErr(tgErrText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tg-card">
      <div className="section-head"><span>TELEGRAM-БОТ</span><b>{link ? 'привязан' : 'не привязан'}</b></div>
      {link === undefined && <p className="social-hint">Проверяем привязку…</p>}
      {link && (
        <div className="tg-row">
          <div className="tg-status">
            <BrandMark type="telegram" />
            <div><strong>@{link.tg_username || '—'}</strong><small>Уведомления включены</small></div>
          </div>
          <button type="button" className="btn btn--small" disabled={busy} onClick={unlink}>{busy ? 'Отвязка…' : 'Отвязать'}</button>
        </div>
      )}
      {link === null && !code && (
        <>
          <p className="social-hint">Бот пришлёт ID лобби и уведомления о матчах.</p>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={makeCode}>
            <Send size={16} /> {busy ? 'Создаём код…' : 'Привязать Telegram'}
          </button>
        </>
      )}
      {link === null && code && (
        <>
          <p className="social-hint">Отправь этот код боту — действителен 10 минут:</p>
          <div className="tg-code">{code.split('').join(' ')}</div>
          <a className="btn btn--primary btn--glow tg-open" href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}`} target="_blank" rel="noreferrer">
            <Send size={16} /> Открыть бота
          </a>
          <button type="button" className="link-btn" disabled={checking} onClick={checkSent}>{checking ? 'Проверяем…' : 'Я уже отправил — обновить'}</button>
        </>
      )}
      {err && <p className="tg-error">{err}</p>}
      {toast && <div className="toast toast--fixed">{toast}</div>}
    </div>
  )
}

/* ============================================================= PROFILE ==== */
export function ProfileScreen({ profile, actions, gameId, onBack, onEdit, supabase, userId }) {
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

      {profile.nick ? <VerificationCard supabase={supabase} userId={userId} /> : null}
      <StatsGrid profile={profile} onAddSlot={() => { actions.addSlot(); setToast('Доп. слот добавлен'); }} onEdit={onEdit} />
      <SocialRow profile={profile} onAddSocial={actions.addSocial} />
      <TelegramLinkCard supabase={supabase} userId={userId} />
      {toast && <div className="toast toast--fixed">{toast}</div>}
      <button type="button" className="btn btn--ghost profile__back" onClick={onBack}>На главную</button>
    </div>
  )
}

/* =============================================================== DRAFT ==== */
const DRAFT_ROLE_MAP = { 'МИД': ['Маг'], 'ЛЕС': ['Лесник'], 'РОУМ': ['Поддержка'], 'БОЕЦ': ['Боец'], 'СТРЕЛОК': ['Стрелок'], 'ТАНК': ['Танк'] }
function matchDraftRole(p, f) {
  if (f === 'ВСЕ') return true
  return (p.roles || []).some((r) => (DRAFT_ROLE_MAP[f] || []).includes(r))
}

function PlayerPeek({ player, onClose, onPick }) {
  if (!player) return null
  const roles = (player.roles || []).join(', ')
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal__close" onClick={onClose}><CloseIcon /></button>
        <div className="modal__avatar">{(player.nick?.[0] || '?').toUpperCase()}</div>
        <h3>{player.nick}</h3>
        <p className="modal__role">{roles || 'Роли не указаны'} · {player.pts ?? 0} PTS</p>
        <div className="modal__stats">
          <div><b>{player.pts ?? 0}</b><span>PTS</span></div>
          <div><b>{player.rank || '—'}</b><span>Ранг</span></div>
          <div><b>{(player.roles || []).length || '—'}</b><span>Роли</span></div>
        </div>
        <PrimaryButton glow={false} onClick={() => { onPick(); onClose() }}>ВЫБРАТЬ В КОМАНДУ</PrimaryButton>
      </div>
    </div>
  )
}

export function DraftScreen({ supabase, userId, onReady, onBack }) {
  const [teamA, setTeamA] = useState([])
  const [teamB, setTeamB] = useState([])
  const [turn, setTurn] = useState('A')
  const [timer, setTimer] = useState(30)
  const [filter, setFilter] = useState('ВСЕ')
  const [peek, setPeek] = useState(null)
  const [coin, setCoin] = useState(null)
  const [toast, setToast] = useState('')
  const [players, setPlayers] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const loadPlayers = async () => {
    if (!supabase) { setLoading(false); setLoadError('Нет подключения к серверу.'); return }
    setLoading(true); setLoadError('')
    try {
      const { data, error } = await supabase.from('leaderboard').select('*').order('pts', { ascending: false }).limit(100)
      if (error) throw error
      setPlayers(data || [])
    } catch (e) {
      setLoadError('Не удалось загрузить игроков: ' + (e.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPlayers() }, [])

  const ranked = useMemo(() => [...(players || [])].sort((a, b) => (b.pts || 0) - (a.pts || 0)), [players])
  const captains = ranked.slice(0, 2)
  const pickedIds = useMemo(() => [...teamA, ...teamB].map((p) => p.user_id), [teamA, teamB])
  const pool = ranked.slice(2).filter((p) => !pickedIds.includes(p.user_id))
  const total = ranked.length
  const short = total < 3
  const full = !short && pool.length === 0 && (teamA.length + teamB.length) > 0

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
    const candidates = pool.filter((p) => matchDraftRole(p, filter))
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

  const visible = pool.filter((p) => matchDraftRole(p, filter))
  const TeamCard = ({ side, roster }) => {
    const cap = side === 'A' ? captains[0] : captains[1]
    if (!cap) return null
    return (
      <div className={`team-card team-card--${side.toLowerCase()} ${turn === side && !full ? 'is-active' : ''}`}>
        <div className="team-card__head"><span>TEAM {side}</span><b>{cap.pts ?? 0} PTS</b></div>
        <div className="team-card__captain">
          <span className="team-card__avatar" style={{ borderColor: side === 'A' ? '#ff6a1a' : '#f0334f' }}>{(cap.nick?.[0] || '?').toUpperCase()}</span>
          <div><strong><CrownIcon /> {cap.nick}{cap.user_id === userId ? ' (вы)' : ''}</strong><small>Капитан</small></div>
        </div>
        <div className="team-card__slots">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className={roster[i] ? 'is-filled' : ''}>
              {roster[i] ? (roster[i].nick?.[0] || '?').toUpperCase() : <Plus size={16} />}
            </span>
          ))}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="screen draft">
        <div className="empty-block"><p>Загрузка игроков…</p></div>
      </div>
    )
  }
  if (loadError) {
    return (
      <div className="screen draft">
        <div className="empty-block">
          <p>{loadError}</p>
          <button type="button" className="btn btn--ghost" onClick={loadPlayers}>Повторить</button>
        </div>
      </div>
    )
  }
  if (short) {
    return (
      <div className="screen draft">
        <div className="draft__head">
          <div>
            <h1>CAPTAIN'S DRAFT</h1>
            <p>Формат 5v5 • Выбор игроков в ростер</p>
          </div>
        </div>
        <div className="empty-block">
          <p>Для драфта нужно минимум 3 игрока, сейчас зарегистрирован{total === 1 ? '' : 'о'}: {total}. Пригласи друзей — как только они заполнят анкеты, появятся здесь.</p>
          <button type="button" className="btn btn--ghost" onClick={onBack}>На главную</button>
        </div>
      </div>
    )
  }

  return (
    <div className="screen draft">
      <div className="draft__head">
        <div>
          <h1>CAPTAIN'S DRAFT</h1>
          <p>Формат 5v5 • Выбор игроков в ростер</p>
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
        <TeamCard side="A" roster={teamA} />
        <div className="draft__vs">VS</div>
        <TeamCard side="B" roster={teamB} />
      </div>

      <div className="chips chips--scroll">
        {DRAFT_FILTERS.map((f) => <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>{f}</Chip>)}
      </div>

      <div className="section-head draft__poolhead">
        <span>ПУЛ ДОСТУПНЫХ ИГРОКОВ</span><b>{pool.length} свободно</b>
      </div>

      <div className="pool">
        {visible.map((p) => (
          <div key={p.user_id} className="pool-row">
            <button type="button" className="pool-row__info" onClick={() => setPeek(p)}>
              <span className="pool-row__avatar">{(p.nick?.[0] || '?').toUpperCase()}</span>
              <span className="pool-row__text">
                <strong>{p.nick}{p.user_id === userId ? ' (вы)' : ''} <em>{p.pts ?? 0}</em></strong>
                <small>{(p.roles || []).join(', ') || 'Без ролей'}{p.rank ? ` · ${p.rank}` : ''}</small>
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
          ? <PrimaryButton onClick={() => onReady({ teamA: [captains[0], ...teamA].filter(Boolean), teamB: [captains[1], ...teamB].filter(Boolean) })}>МАТЧ ГОТОВ — ОТКРЫТЬ ЛОББИ</PrimaryButton>
          : <button type="button" className="btn btn--ghost" onClick={onBack}>Отменить поиск</button>}
      </div>

      {peek && <PlayerPeek player={peek} onClose={() => setPeek(null)} onPick={() => pick(peek)} />}
      {toast && <div className="toast toast--fixed">{toast}</div>}
    </div>
  )
}

/* =============================================================== MATCH ==== */
export function MatchScreen({ onBack, onLeaderboard, onProfile, supabase, teams, userId }) {
  const [copied, setCopied] = useState(false)
  const [micOn, setMicOn] = useState(true)
  const [muted, setMuted] = useState({})
  const [speaking, setSpeaking] = useState([])
  const [sending, setSending] = useState(false)
  const [needLink, setNeedLink] = useState(false)
  const [toast, setToast] = useState('')
  const teamA = (teams && teams.teamA) || []
  const teamB = (teams && teams.teamB) || []
  const inB = userId ? teamB.some((m) => m && m.user_id === userId) : false
  const myLabel = inB ? 'Team B' : 'Team A'
  const members = (inB ? teamB : teamA).filter((m) => m && m.nick)
  const lobbyId = useMemo(() => String(Math.floor(1000000 + Math.random() * 9000000)), [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const sendToTg = async () => {
    setSending(true); setNeedLink(false)
    try {
      await notifyLobbyToTelegram(lobbyId)
      setToast('ID лобби отправлен в Telegram')
    } catch (e) {
      if (e.message === 'no_session') setToast('Войди по почте, чтобы отправлять в Telegram')
      else if (e.message === 'not_linked') { setNeedLink(true); setToast('Сначала привяжи Telegram в профиле') }
      else if (e.message === 'timeout') setToast('Сервер не ответил за 20 секунд — проверь интернет')
      else setToast('Не получилось отправить')
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    const t = setInterval(() => {
      setSpeaking(members.filter((m) => !muted[m.user_id]).slice(0, 2).map((m) => m.user_id))
    }, 2600)
    return () => clearInterval(t)
  }, [muted])

  const copy = () => {
    navigator.clipboard?.writeText(lobbyId).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  if (members.length === 0) {
    return (
      <div className="screen match">
        <div className="empty-block">
          <p>Команды ещё не собраны. Вернись в драфт и выбери игроков.</p>
          <button type="button" className="btn btn--ghost" onClick={onBack}>К драфту</button>
        </div>
      </div>
    )
  }

  return (
    <div className="screen match">
      <div className="match__badges"><span className="match__badge"><i /> Матч найден</span></div>
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

      {supabase && (
        <button type="button" className="btn btn--ghost" disabled={sending} onClick={sendToTg}>
          <Send size={16} /> {sending ? 'Отправка…' : 'ID лобби в Telegram'}
        </button>
      )}
      {needLink && (
        <button type="button" className="link-btn" onClick={onProfile}>Привязать Telegram в профиле <ArrowRight size={15} /></button>
      )}

      <div className="voice-card">
        <div className="voice-card__head">
          <span><Headphones size={17} /> Голосовой чат · {myLabel}</span>
          <b>{members.length}/{members.length}</b>
        </div>
        {members.map((m) => (
          <div key={m.user_id} className="voice-row">
            <span className={`voice-row__avatar ${speaking.includes(m.user_id) ? 'is-speaking' : ''}`}>{(m.nick?.[0] || '?').toUpperCase()}</span>
            <div><strong>{m.nick}{m.user_id === userId ? ' (вы)' : ''}</strong><small>{(m.roles || []).join(', ') || m.rank || 'Игрок'}</small></div>
            <button
              type="button"
              className={`voice-row__mic ${muted[m.user_id] ? 'is-muted' : ''}`}
              onClick={() => setMuted((x) => ({ ...x, [m.user_id]: !x[m.user_id] }))}
              title={muted[m.user_id] ? 'Включить' : 'Заглушить'}
            >
              {muted[m.user_id] ? <MicOff size={18} /> : <Mic size={18} />}
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
      {toast && <div className="toast toast--fixed">{toast}</div>}
    </div>
  )
}

/* ========================================================= LEADERBOARD ==== */
const LEAGUE_PRIZES = ['20 000 ₽ / мес', '15 000 ₽ / мес', '10 000 ₽ / мес']

export function LeaderboardScreen({ supabase, userId }) {
  const [league, setLeague] = useState('Обычная лига')
  const [players, setPlayers] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    if (!supabase) { setLoading(false); setError('Нет подключения к серверу.'); return }
    setLoading(true); setError('')
    try {
      const { data, error } = await supabase.from('leaderboard').select('*').order('pts', { ascending: false }).limit(100)
      if (error) throw error
      setPlayers(data || [])
    } catch (e) {
      setError('Не удалось загрузить рейтинг: ' + (e.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const list = players || []
  const lowCount = list.filter((p) => (p.pts || 0) < 4000).length
  const proCount = list.length - lowCount
  const rows = league === 'Про лига' ? list.filter((p) => (p.pts || 0) >= 4000) : list.filter((p) => (p.pts || 0) < 4000)

  return (
    <div className="screen leaderboard">
      <div className="leaderboard__head">
        <h1 className="screen-title">Таблица лидеров</h1>
        <Trophy size={22} color="#ff5722" />
      </div>

      <p className="leaderboard__note">Призы топ-3 выплачиваются ежемесячно</p>

      <div className="league-switch">
        <button type="button" className={league === 'Обычная лига' ? 'is-active' : ''} onClick={() => setLeague('Обычная лига')}>Обычная лига · до 4000 ({lowCount})</button>
        <button type="button" className={league === 'Про лига' ? 'is-active' : ''} onClick={() => setLeague('Про лига')}>Про лига · 4000+ ({proCount})</button>
      </div>

      <div className="rank-list">
        {loading && <div className="empty">Загрузка рейтинга…</div>}
        {!loading && error && (
          <div className="empty-block">
            <p>{error}</p>
            <button type="button" className="btn btn--ghost" onClick={load}>Повторить</button>
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="empty">{league === 'Про лига' ? 'В про-лиге пока никого нет — набери 4000 PTS.' : 'Игроков пока нет — стань первым!'}</div>
        )}
        {rows.map((r, i) => (
          <div key={r.user_id} className={`rank-row ${i === 0 ? 'rank-row--first' : ''} ${r.user_id === userId ? 'rank-row--me' : ''}`}>
            <span className="rank-row__num">#{i + 1}</span>
            <span className="rank-row__avatar">{r.avatar_url ? <img src={r.avatar_url} alt="" /> : (r.nick?.[0] || '?').toUpperCase()}</span>
            <div className="rank-row__info">
              <strong>{r.nick}{r.user_id === userId ? ' (вы)' : ''}</strong>
              {i < 3 && <span className="prize">{LEAGUE_PRIZES[i]}</span>}
            </div>
            <div className="rank-row__elo"><b>{r.pts ?? 0}</b><span>PTS</span></div>
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

/* ============================================================== SUPPORT ==== */
const TICKET_STATUS = {
  open: { label: 'Открыта', cls: 'ticket__status--open' },
  answered: { label: 'Есть ответ', cls: 'ticket__status--answered' },
  closed: { label: 'Закрыта', cls: 'ticket__status--closed' },
}

function ticketDate(iso) {
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return '—' }
}

export function SupportScreen({ supabase, userId, onBack, onAuth }) {
  const [tickets, setTickets] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const load = async () => {
    if (!supabase || !userId) { setTickets([]); setLoading(false); return }
    setLoading(true); setError('')
    try { setTickets(await fetchSupportTickets(userId)) }
    catch (e) { setError('Не удалось загрузить заявки: ' + (e.message || e)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const clean = text.trim()
    if (clean.length < 5) { setError('Опиши проблему подробнее — хотя бы пару слов.'); return }
    if (clean.length > 2000) { setError('Слишком длинно — до 2000 символов.'); return }
    setSending(true); setError(''); setFlash('')
    try {
      const created = await createSupportTicket(userId, clean)
      setText('')
      setFlash('Заявка #' + created.num + ' отправлена админу в Telegram. Ответ придёт сюда и в бота.')
      void announceSupportTicket(created.id)
      await load()
    } catch (e) {
      setError('Не удалось отправить заявку: ' + (e.message || e))
    } finally { setSending(false) }
  }

  if (!supabase || !userId) {
    return (
      <div className="screen support">
        <BackHeader title="Поддержка" onBack={onBack} />
        <div className="empty-block">
          <p>{!supabase ? 'Нет подключения к серверу.' : 'Войди по почте, чтобы написать в поддержку — заявки привязаны к аккаунту.'}</p>
          {onAuth && supabase && <button type="button" className="btn btn--ghost" onClick={onAuth}>Войти</button>}
        </div>
      </div>
    )
  }

  const left = 2000 - text.length
  const list = tickets || []

  return (
    <div className="screen support">
      <BackHeader
        title="Поддержка"
        onBack={onBack}
        right={<button type="button" className="icon-btn" onClick={load} title="Обновить"><RefreshCw size={18} /></button>}
      />
      <p className="screen-subtitle">Заявка уходит админу в Telegram, ответ появится здесь</p>

      <div className="info-strip">
        <Bot size={15} /> Отвечаем в боте @{TELEGRAM_BOT_USERNAME} — там же можно смотреть статус: /support
      </div>

      <Label hint={`${text.length}/2000`}>Опиши проблему</Label>
      <textarea
        className="textarea"
        rows={5}
        maxLength={2000}
        value={text}
        onChange={(e) => { setText(e.target.value); setFlash('') }}
        placeholder="Например: не приходит ID лобби в Telegram, хотя аккаунт привязан"
      />
      <p className="field-hint">{left < 100 ? `Осталось символов: ${left}` : 'Чем точнее опишешь — тем быстрее решим.'}</p>

      <PrimaryButton onClick={submit} disabled={sending || text.trim().length < 5} icon={Send}>
        {sending ? 'Отправляем…' : 'Отправить заявку'}
      </PrimaryButton>

      {flash && <div className="support-flash"><Check size={16} /> <span>{flash}</span></div>}
      {error && <p role="alert" className="field-hint support-error">{error}</p>}

      <div className="support-list">
        <div className="label-row">
          <span className="label">Мои заявки</span>
          {list.length > 0 && <span className="label-hint">{list.length}</span>}
        </div>
        {loading && <div className="empty">Загрузка заявок…</div>}
        {!loading && list.length === 0 && (
          <div className="empty">Заявок пока нет. Опиши проблему выше — админ получит её в боте.</div>
        )}
        {list.map((t) => {
          const st = TICKET_STATUS[t.status] || { label: t.status, cls: '' }
          return (
            <div key={t.id} className={`ticket ticket--${t.status}`}>
              <div className="ticket__head">
                <span className="ticket__num"><MessageSquare size={14} /> #{t.num}</span>
                <span className={`ticket__status ${st.cls}`}>{st.label}</span>
                <span className="ticket__date">{ticketDate(t.created_at)}</span>
              </div>
              <p className="ticket__text">{t.message}</p>
              {t.admin_reply && (
                <div className="ticket__reply">
                  <strong>Ответ поддержки</strong>
                  <span>{t.admin_reply}</span>
                  {t.answered_at && <small>{ticketDate(t.answered_at)}</small>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="support-foot">
        <LifeBuoy size={15} /> Срочно? Напиши боту /support — заявка попадёт к тому же админу.
      </div>
    </div>
  )
}
