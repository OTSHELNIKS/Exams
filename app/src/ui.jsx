import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronLeft, Gamepad2, Camera, Plus,
  ShieldCheck, Check, X, Copy, Mic, MicOff, RotateCcw, Crown, Users, Trophy, Search,
} from 'lucide-react'
import { GoogleIcon, TelegramIcon, TikTokIcon, VkIcon, FacebookIcon, BRAND_TINT } from './brand-icons.jsx'
import { HERO_BY_NAME } from './data.js'

/* ------------------------------------------------------------------ logo */
export function Logo({ size = 'md', light = false }) {
  return (
    <div className={`logo logo--${size} ${light ? 'logo--light' : ''}`}>
      <span className="logo__mark"><i /><i /><i /><i /><i /></span>
      <span className="logo__text">NAME</span>
    </div>
  )
}

/* -------------------------------------------------------------- brand btn */
/* Настоящие логотипы сервисов (см. brand-icons.jsx): узнаваемый знак в своём
   цвете вместо буквы-заглушки. MLBB — официального логотипа в проекте нет,
   поэтому геймпад на золотой подложке остаётся. */
export function BrandMark({ type }) {
  const icons = {
    google: <GoogleIcon />,
    telegram: <TelegramIcon />,
    tiktok: <TikTokIcon />,
    vk: <VkIcon />,
    facebook: <FacebookIcon />,
  }
  if (icons[type]) {
    return (
      <span className={`brand brand--logo ${type}`} style={BRAND_TINT[type]} aria-hidden="true">
        {icons[type]}
      </span>
    )
  }
  // MLBB — настоящий логотип игры (эмблема «M»), файл лежит в app/public.
  if (type === 'mlbb') {
    return (
      <span className="brand mlbb">
        <img src={`${(import.meta.env && import.meta.env.BASE_URL) || '/'}mlbb-logo.png`} alt="" aria-hidden="true" />
      </span>
    )
  }
  return null
}

/* ------------------------------------------------------------- app frame */
/* Нейтральная колонка приложения без фальшивой шторки телефона:
   на реальном устройстве статус-бар рисует сама ОС, а раскладка
   адаптируется под ширину экрана через CSS (см. .appframe). */
export function AppFrame({ children, className = '' }) {
  return (
    <div className={`appframe ${className}`}>
      <div className="appframe__screen">
        <div className="appframe__content">{children}</div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ modal */
/* Оверлей поверх всего окна: карточка всегда по центру экрана, независимо от
   прокрутки списка под ней. Раньше .modal был absolute внутри ленты и уезжал
   вверх — приходилось долистывать. */
// Пока карточка открыта, прокрутка заморожена у всех контейнеров приложения
// (на ПК листается .app-main, на телефоне — .appframe__content, лендинг — body).
const SCROLLERS = '.app-shell, .app-main, .appframe, .appframe__content, .rail, .landing, .modal'

export function Modal({ open, onClose, children, className = '', labelledBy }) {
  const cardRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const nodes = [document.documentElement, document.body,
      ...Array.from(document.querySelectorAll(SCROLLERS))]
    const saved = nodes.map((n) => ({
      node: n,
      overflow: n.style.overflow,
      scrollTop: n.scrollTop,
      scrollLeft: n.scrollLeft,
    }))
    const pageY = window.scrollY
    const pageX = window.scrollX

    nodes.forEach((n) => { n.style.overflow = 'hidden' })
    document.documentElement.classList.add('is-modal-open')

    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    cardRef.current?.focus?.({ preventScroll: true })

    return () => {
      window.removeEventListener('keydown', onKey)
      document.documentElement.classList.remove('is-modal-open')
      saved.forEach(({ node, overflow, scrollTop, scrollLeft }) => {
        node.style.overflow = overflow
        if (node.scrollTop !== scrollTop && node !== document.documentElement && node !== document.body) {
          node.scrollTop = scrollTop
          node.scrollLeft = scrollLeft
        }
      })
      // окно могло «дёрнуться» от смены overflow — возвращаем позицию как была
      if (window.scrollY !== pageY || window.scrollX !== pageX) window.scrollTo(pageX, pageY)
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} onClick={onClose}>
      <div
        ref={cardRef}
        className={`modal__card ${className}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <button type="button" className="modal__close" onClick={onClose} aria-label="Закрыть"><CloseIcon /></button>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------ hero icons */
/* Иконки лежат в app/public/heroes/<id>.webp -> /heroes/<id>.webp на сайте. */
const HERO_BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')

export function heroIcon(id) {
  return `${HERO_BASE}/heroes/${id}.webp`
}

export function HeroIcon({ hero, size = 44, className = '' }) {
  return (
    <img
      className={`hero-icon ${className}`.trim()}
      src={heroIcon(hero.id)}
      alt={hero.name}
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
    />
  )
}

/* ------------------------------------------------------------ hero picker */
/* Выбор любимых героев из полного ростера: фильтр по ролям, поиск, лимит.
   Используется в анкете; в профиле — компактный HeroStrip. */
export function HeroPicker({ heroes, selected, onToggle, limit = 6, roleFilters, query, onQuery, role, onRole }) {
  const selectedSet = new Set(selected || [])
  const filtered = heroes.filter((h) => (role === 'all' || h.roles.includes(role)))
  const q = (query || '').trim().toLowerCase()
  const shown = q ? filtered.filter((h) => h.name.toLowerCase().includes(q)) : filtered
  const full = (selected || []).length >= limit

  return (
    <div className="hero-picker">
      <div className="hero-picker__bar">
        <div className="hero-picker__roles">
          {roleFilters.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`hero-pill ${role === r.id ? 'is-active' : ''}`}
              onClick={() => onRole(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <label className="hero-search">
          <Search size={15} />
          <input
            value={query || ''}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Поиск героя"
            aria-label="Поиск героя"
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="field-hint">Героев не нашлось — попробуй другое имя или роль.</p>
      ) : (
        <div className="hero-grid">
          {shown.map((h) => {
            const on = selectedSet.has(h.name)
            return (
              <button
                key={h.id}
                type="button"
                className={`hero-tile ${on ? 'is-on' : ''} ${!on && full ? 'is-locked' : ''}`}
                onClick={() => onToggle(h)}
                title={h.name}
                aria-pressed={on}
              >
                <span className="hero-tile__pic">
                  <HeroIcon hero={h} size={52} />
                  {on && <span className="hero-tile__check"><Check size={12} /></span>}
                </span>
                <span className="hero-tile__name">{h.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* Компактная полоска выбранных героев (профиль, карточка игрока). */
export function HeroStrip({ names, size = 40, empty = 'Герои не выбраны' }) {
  const list = names || []
  if (list.length === 0) return <p className="field-hint">{empty}</p>
  return (
    <div className="hero-strip">
      {list.map((name) => {
        const hero = HERO_BY_NAME[name] || { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name }
        return (
          <span key={name} className="hero-strip__item" title={name}>
            <HeroIcon hero={hero} size={size} />
            <span>{name}</span>
          </span>
        )
      })}
    </div>
  )
}

/* ----------------------------------------------------------------- pieces */
export function Chip({ active, children, onClick, className = '' }) {
  return (
    <button type="button" onClick={onClick} className={`chip ${active ? 'chip--active' : ''} ${className}`}>
      {children}
    </button>
  )
}

export function Label({ children, hint }) {
  return (
    <div className="label-row">
      <span className="label">{children}</span>
      {hint && <span className="label-hint">{hint}</span>}
    </div>
  )
}

export function PrimaryButton({ children, onClick, disabled, icon: Icon, glow = true, className = '' }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`btn btn--primary ${glow ? 'btn--glow' : ''} ${className}`}
    >
      {Icon && <Icon size={18} strokeWidth={2.4} />}
      <span>{children}</span>
    </button>
  )
}

export function BackHeader({ title, onBack, right, progress }) {
  return (
    <div className="backheader">
      <div className="backheader__row">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Назад">
          <ChevronLeft size={22} />
        </button>
        {progress && (
          <div className="progress">
            <span className="progress__on" /><span /><span />
          </div>
        )}
        {right && <div className="backheader__right">{right}</div>}
      </div>
      {title && <h1 className="screen-title">{title}</h1>}
    </div>
  )
}

export function Steps({ current = 1, total = 3 }) {
  return (
    <div className="steps">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`steps__item ${i + 1 === current ? 'is-active' : ''} ${i + 1 < current ? 'is-done' : ''}`} />
      ))}
    </div>
  )
}

export function Avatar({ src, initials = '?', size = 96, ring = true, level = null }) {
  return (
    <div className={`avatar ${ring ? 'avatar--ring' : ''}`} style={{ width: size, height: size }}>
      {src
        ? <img src={src} alt="avatar" />
        : <span className="avatar__initials">{initials}</span>}
      {level != null && <span className="avatar__level">LVL<br /><b>{level}</b></span>}
    </div>
  )
}

export function StatBadge({ children, tone = 'orange' }) {
  return <span className={`stat-badge stat-badge--${tone}`}>{children}</span>
}

const REVIEW_KIND_NAMES = { nick: 'ник', avatar: 'фото', screenshot: 'скриншоты' }

/** Real moderation status of the current user's profile, from moderation_reviews. */
export function VerificationCard({ supabase, userId }) {
  const [reviews, setReviews] = useState(null)
  useEffect(() => {
    let alive = true
    const load = async () => {
      if (!supabase || !userId) { if (alive) setReviews([]); return }
      const { data, error } = await supabase.from('moderation_reviews').select('kind,status').eq('user_id', userId)
      if (alive) setReviews(error ? [] : (data || []))
    }
    load()
    return () => { alive = false }
  }, [supabase, userId])

  if (!reviews || reviews.length === 0) return null
  const kinds = (rows) => [...new Set(rows.map((r) => REVIEW_KIND_NAMES[r.kind] || r.kind))].join(', ')
  const pending = reviews.filter((r) => r.status === 'pending')
  const rejected = reviews.filter((r) => r.status === 'rejected')

  if (pending.length > 0) {
    return (
      <div className="verify-card">
        <div className="verify-card__icon"><RotateCcw size={22} /></div>
        <div>
          <strong>На проверке у модератора: {kinds(pending)}</strong>
          <p>Решение придёт в Telegram, если он привязан в профиле</p>
        </div>
      </div>
    )
  }
  if (rejected.length > 0) {
    return (
      <div className="verify-card verify-card--bad">
        <div className="verify-card__icon"><X size={22} /></div>
        <div>
          <strong>Модератор отклонил: {kinds(rejected)}</strong>
          <p>Исправь в анкете и сохрани — вернём на перепроверку</p>
        </div>
      </div>
    )
  }
  // Fully approved (or nothing left to show) — the notice hides itself.
  return null
}

export function GameIdIcon() {
  return <span className="gameid-icon"><Gamepad2 size={20} /></span>
}

export function SuccessCheck() {
  return <span className="success-check"><Check size={18} strokeWidth={3} /></span>
}

export function CrownIcon() {
  return <Crown size={16} fill="#ffc83d" color="#ffc83d" />
}

export function UsersIcon() { return <Users size={16} /> }
export function TrophyIcon() { return <Trophy size={18} /> }
export function ShieldIcon() { return <ShieldCheck size={16} /> }
export function CameraIcon() { return <Camera size={22} /> }
export function PlusIcon() { return <Plus size={20} /> }
export function CopyIcon() { return <Copy size={18} /> }
export function MicIcon({ off }) { return off ? <MicOff size={18} /> : <Mic size={18} /> }
export function CloseIcon() { return <X size={18} /> }
