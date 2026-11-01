// Рамки из предоставленных пользователем прозрачных изображений.
import React from 'react'
import { FRAME_IMAGES, LEGACY_MOTIFS, FRAME_IMAGE_BY_MOTIF } from './frameAssets.js'

// Палитры: блик, основной тон, тень, кромка.
export const FRAME_PALETTES = {
  steel: { hi: '#f4f8fd', mid: '#9aa6b6', lo: '#4d5563', edge: '#1b2029', accent: '#8fb6d9', glow: 'rgba(180,200,230,.30)' },
  azure: { hi: '#eaf6ff', mid: '#4a9cf0', lo: '#123f6e', edge: '#071c33', accent: '#9fd4ff', glow: 'rgba(74,156,240,.45)' },
  bronze: { hi: '#ffe2c2', mid: '#b8804c', lo: '#5a3719', edge: '#2a1709', accent: '#e0a067', glow: 'rgba(176,122,74,.40)' },
  silver: { hi: '#ffffff', mid: '#c9d0dc', lo: '#6b7381', edge: '#262b34', accent: '#eef4ff', glow: 'rgba(195,205,225,.45)' },
  ruby: { hi: '#ffd2da', mid: '#f0334f', lo: '#71081a', edge: '#35020b', accent: '#ff8ea1', glow: 'rgba(240,51,79,.50)' },
  gold: { hi: '#fffbd6', mid: '#ffc83d', lo: '#8f5200', edge: '#3d2200', accent: '#ffe98a', glow: 'rgba(255,200,61,.55)' },
  emerald: { hi: '#e2fff0', mid: '#3fcb7b', lo: '#0d4f2d', edge: '#032114', accent: '#8affc4', glow: 'rgba(63,203,123,.48)' },
  neon: { hi: '#f2ffff', mid: '#39f0ff', lo: '#04515c', edge: '#01181c', accent: '#b6fbff', glow: 'rgba(57,240,255,.60)' },
  diamond: { hi: '#ffffff', mid: '#d6f1ff', lo: '#6fa8f0', edge: '#182639', accent: '#bfe6ff', glow: 'rgba(200,235,255,.62)' },
  violet: { hi: '#f0e6ff', mid: '#a877f0', lo: '#3d1f7a', edge: '#160a33', accent: '#d9bcff', glow: 'rgba(168,119,240,.55)' },
  royal: { hi: '#fff3c8', mid: '#e8b23c', lo: '#6b3bb5', edge: '#2a1150', accent: '#ffdf8a', glow: 'rgba(232,178,60,.50)' },
  frost: { hi: '#ffffff', mid: '#a9e4ff', lo: '#2f6ea8', edge: '#0b2338', accent: '#dcf6ff', glow: 'rgba(150,220,255,.55)' },
  abyss: { hi: '#e6fff6', mid: '#37d8b0', lo: '#1c1450', edge: '#0a0620', accent: '#8affd9', glow: 'rgba(55,216,176,.45)' },
  pumpkin: { hi: '#ffe0a8', mid: '#ff8a2b', lo: '#7a2a05', edge: '#2b0d02', accent: '#ffb86a', glow: 'rgba(255,138,43,.50)' },
  flare: { hi: '#fff6e6', mid: '#ffb066', lo: '#8c3d0f', edge: '#331303', accent: '#ffd9ab', glow: 'rgba(255,176,102,.50)' },
  platinum: { hi: '#ffffff', mid: '#dfe8f5', lo: '#7c8aa0', edge: '#1d242f', accent: '#f4f9ff', glow: 'rgba(223,232,245,.50)' },
  amethyst: { hi: '#f6ecff', mid: '#b98cf5', lo: '#40206e', edge: '#180a2b', accent: '#e6ceff', glow: 'rgba(185,140,245,.50)' },
  moon: { hi: '#ffffff', mid: '#cfd7ee', lo: '#4b5478', edge: '#12172b', accent: '#e8e2ff', glow: 'rgba(207,215,238,.45)' },
  cyber: { hi: '#ffe9fb', mid: '#ff5cd6', lo: '#5b0a4a', edge: '#22021b', accent: '#ffb0ea', glow: 'rgba(255,92,214,.55)' },
  venom: { hi: '#f2ffd8', mid: '#9be04a', lo: '#254d0c', edge: '#0a1c03', accent: '#c8ff7a', glow: 'rgba(155,224,74,.45)' },
}

// Какой орнамент у какой рамки. Ключи — id рамок без префикса.
export const FRAME_ART = {
  default: 'default',
  verified: 'dawn',
  bronze: 'warrior',
  silver: 'elite',
  ruby: 'master',
  gold: 'legend',
  emerald: 'mythic',
  neon: 'glory',
  diamond: 'immortal',
  starlight: 'starlight',
  crown: 'crown',
  scepter: 'scepter',
  knight: 'knight',
  dragon: 'dragon',
  abyss: 'abyss',
  pumpkin: 'pumpkin',
  frost: 'frost',
  lunar: 'lunar',
  bling: 'bling',
  serpent: 'serpent',
}

export const FRAME_MOTIFS = [...LEGACY_MOTIFS, ...FRAME_IMAGES.slice(20).map(image => `mlbb-${image}`)]

// The source sheets already have transparent backgrounds. Keep the entire
// artwork inside the avatar's layout box, so it cannot cover adjacent text.
function frameImage(art) {
  return FRAME_IMAGE_BY_MOTIF[typeof art === 'string' ? art : ''] || FRAME_IMAGE_BY_MOTIF.default
}

// CSS alpha mask shares the 128×128 canvas of the artwork; both layers scale
// together in profiles, previews and leaderboard rows (including native builds).
export function frameMask(art) {
  const base = import.meta.env?.BASE_URL || '/'
  return `url("${base}mlbb-frame-masks/${frameImage(art)}.png")`
}

export function ProfileFrame({ palette = 'steel', art = 'default', shine = false }) {
  const motif = typeof art === 'string' && FRAME_IMAGE_BY_MOTIF[art] ? art : 'default'
  const base = import.meta.env?.BASE_URL || '/'
  return <span
    className={`pframe pframe--${palette} pframe--${motif} ${shine ? 'pframe--shine' : ''}`}
    style={{ backgroundImage: `url("${base}mlbb-frames/${frameImage(motif)}.png")` }}
    aria-hidden="true"
  />
}

export function NickPlate({
  css = '',
  shine = false,
  frame = false,
  color = '',
  className = '',
  children,
}) {
  const classes = [
    'nick',
    frame && css ? `nick--plate ${css}` : '',
    !frame && css ? `nick--bare ${css}` : '',
    shine ? 'nick--shine' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <span className={classes} style={color ? { '--nick-color': color } : undefined}>
      {frame && <span className="nick__gem nick__gem--l" aria-hidden="true" />}
      <span className="nick__text">{children}</span>
      {frame && <span className="nick__gem nick__gem--r" aria-hidden="true" />}
      {frame && shine && <span className="nick__gleam" aria-hidden="true" />}
    </span>
  )
}

/**
 * Шапка профиля (баннер) — как в Discord: полоса во всю ширину карточки.
 *
 * Поддерживает три вида:
 *   • градиент (класс из styles.css);
 *   • картинку (JPG/PNG/WebP);
 *   • анимированный GIF/WebP — он же <img>, браузер сам проигрывает кадры.
 * Своя картинка и анимация — платный контент: сервер выдаёт право, без него
 * `url` не примется и останется градиент.
 */
export function ProfileBanner({ css = '', url = '', height = 150, alt = '' }) {
  const src = safeBannerUrl(url)
  return (
    <div className={`pbanner ${src ? 'pbanner--media' : css}`} style={{ height }}>
      {src
        ? <img src={src} alt={alt} loading="lazy" decoding="async" />
        : <span className="pbanner__sheen" />}
    </div>
  )
}

// Картинку баннера принимаем только из нашего хранилища: чужие адреса — это
// возможность вести трекинг на всех, кто открыл профиль.
const BANNER_HOST = '/storage/v1/object/public/banners/'

export function safeBannerUrl(url) {
  const value = String(url || '').trim()
  if (!value) return ''
  if (!value.includes(BANNER_HOST)) return ''
  if (!/^https?:\/\//i.test(value)) return ''
  return value
}
