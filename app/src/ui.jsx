import React, { useEffect, useState } from 'react'
import {
  ChevronLeft, Gamepad2, Send, Camera, Plus,
  ShieldCheck, Check, X, Copy, Mic, MicOff, RotateCcw, Crown, Users, Trophy,
} from 'lucide-react'

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
export function BrandMark({ type }) {
  if (type === 'vk') return <span className="brand vk">VK</span>
  if (type === 'google') return <span className="brand google">G</span>
  if (type === 'facebook') return <span className="brand facebook">f</span>
  if (type === 'telegram') return <span className="brand telegram"><Send size={18} strokeWidth={2.2} /></span>
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
        {right}
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
