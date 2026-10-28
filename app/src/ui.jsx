import React from 'react'
import {
  Wifi, BatteryFull, Signal, ChevronLeft, Gamepad2, Send, Camera, Plus,
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

/* ------------------------------------------------------------- status bar */
export function StatusBar({ time = '21:37' }) {
  return (
    <div className="statusbar">
      <span className="statusbar__time">{time}</span>
      <div className="statusbar__island" />
      <div className="statusbar__icons">
        <Signal size={15} strokeWidth={2.6} />
        <Wifi size={15} strokeWidth={2.6} />
        <BatteryFull size={19} strokeWidth={2.2} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ phone frame */
export function PhoneFrame({ children, className = '' }) {
  return (
    <div className={`phone ${className}`}>
      <div className="phone__screen">
        <StatusBar />
        <div className="phone__content">{children}</div>
        <div className="phone__home" />
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

export function Avatar({ src, initials = 'H', size = 96, ring = true }) {
  return (
    <div className={`avatar ${ring ? 'avatar--ring' : ''}`} style={{ width: size, height: size }}>
      {src
        ? <img src={src} alt="avatar" />
        : <span className="avatar__initials">{initials}</span>}
      <span className="avatar__level">LVL<br /><b>87</b></span>
    </div>
  )
}

export function StatBadge({ children, tone = 'orange' }) {
  return <span className={`stat-badge stat-badge--${tone}`}>{children}</span>
}

export function VerificationCard() {
  return (
    <div className="verify-card">
      <div className="verify-card__icon"><RotateCcw size={22} /></div>
      <div>
        <strong>Профиль проверяется модератором</strong>
        <p>Верификация завершится в ближайшее время</p>
      </div>
    </div>
  )
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
