// NAME MLBB — рамки профиля.
//
// Рамка должна быть украшением, а не цветным кольцом: у каждой своя форма и
// свой характер, как в LoL и MLBB — крылья, рога, лавр, кристаллы, платы.
// Поэтому рамка = палитра (цвет достижения) + мотив (что нарисовано вокруг).
//
// Геометрия: обод жмётся к аватару (r ≈ 72 из 100), а орнамент живёт снаружи,
// в полосе 74…98. Внутрь круга ничего не заходит — иначе аватар его закроет.
//
// Всё вектором: чётко на любом экране, весит байты и не тянет в сборку
// десять PNG на каждый тир.
import React, { useId } from 'react'

// Палитры: блик, основной тон, тень, кромка. Меняются от «стали» до «алмаза».
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
}

// Какой мотив у какой рамки. Ключи — id рамок без префикса.
export const FRAME_ART = {
  default: 'classic',
  verified: 'wings',
  bronze: 'crest',
  silver: 'shield',
  ruby: 'horns',
  gold: 'laurel',
  emerald: 'flame',
  neon: 'circuit',
  diamond: 'crystal',
}

export const FRAME_MOTIFS = Object.values(FRAME_ART)

// Аватар занимает ровно этот квадрат: его радиус — 100 единиц. Поэтому обод
// стоит на 97 (чуть выступает за край картинки), а орнамент рисуется в системе
// «обод = 72» и потом масштабируется наружу — так формы остаются читаемыми,
// но становятся крупными, как в LoL.
// Система координат: центр круга — (0,0), радиус аватара — 100.
const RING_R = 97
const ART_R = 72
const ART_SCALE = (RING_R / ART_R) * 1.14
// Орнамент выходит примерно до 150 единиц, поэтому холст — 160 (а CSS растягивает
// его на 160% от аватара). Иначе рога и кристаллы обрезались бы по краю.
export const FRAME_VIEW = 160

// Угол 0 — верх, дальше по часовой стрелке.
const at = (deg, r) => {
  const a = (deg * Math.PI) / 180
  return [r * Math.sin(a), -r * Math.cos(a)]
}

/**
 * Поставить фигуру на окружность: локально +y смотрит наружу от центра.
 * Так орнамент всегда «растёт» из обода, а не висит рядом.
 */
function Place({ deg, r = ART_R, turn = 0, scale = 1, opacity = 1, children }) {
  const [x, y] = at(deg, r)
  return (
    <g transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(180 + deg + turn).toFixed(2)}) scale(${scale})`} opacity={opacity}>
      {children}
    </g>
  )
}

/** Симметрия: то же самое зеркально слева. */
function Both({ children }) {
  return (
    <>
      {children}
      <g transform="scale(-1 1)">{children}</g>
    </>
  )
}

function Paints({ uid, p }) {
  return (
    <defs>
      <linearGradient id={`${uid}-main`} x1="0.1" y1="0" x2="0.85" y2="1">
        <stop offset="0" stopColor={p.hi} />
        <stop offset="0.42" stopColor={p.mid} />
        <stop offset="1" stopColor={p.lo} />
      </linearGradient>
      <linearGradient id={`${uid}-lit`} x1="0" y1="0" x2="0.7" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.5" stopColor={p.hi} />
        <stop offset="1" stopColor={p.mid} />
      </linearGradient>
      <linearGradient id={`${uid}-gem`} x1="0" y1="0" x2="0.55" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.42" stopColor={p.accent} />
        <stop offset="1" stopColor={p.mid} />
      </linearGradient>
      <linearGradient id={`${uid}-deep`} x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0" stopColor={p.mid} />
        <stop offset="1" stopColor={p.edge} />
      </linearGradient>
      <filter id={`${uid}-soft`} x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="2.8" />
      </filter>
    </defs>
  )
}

/**
 * Рамка вокруг аватара. Размер задаётся родителем (`.avatar`), здесь только
 * рисунок в системе координат 200×200.
 */
export function ProfileFrame({ palette = 'steel', art = 'classic', glow = true }) {
  const raw = useId()
  const uid = 'pf' + raw.replace(/[^a-zA-Z0-9]/g, '')
  const p = FRAME_PALETTES[palette] || FRAME_PALETTES.steel
  const main = `url(#${uid}-main)`
  const lit = `url(#${uid}-lit)`
  const gem = `url(#${uid}-gem)`
  const deep = `url(#${uid}-deep)`
  const edge = p.edge
  // Числовой «уровень» из старых данных тоже понимаем: 1…4 → мотивы по возрастанию.
  const motif = typeof art === 'number'
    ? ['classic', 'crest', 'laurel', 'crystal'][Math.min(3, Math.max(0, art - 1))]
    : (FRAME_ART[art] || art || 'classic')

  const line = { stroke: edge, strokeWidth: 1.9, strokeLinejoin: 'round', strokeLinecap: 'round' }

  // Перо: растёт из обода наружу, слегка загибается вбок.
  const feather = (deg, len, bend = 0) => (
    <Place key={deg} deg={deg} r={ART_R - 1} turn={bend} scale={len}>
      <path d="M-7 0 Q-11 14 0 34 Q11 14 7 0 Z" fill={main} {...line} />
      <path d="M0 4 Q-4 14 0 27" fill="none" stroke={edge} strokeWidth="1.1" opacity=".4" />
    </Place>
  )

  // Лист лавра: овальный, с прожилкой.
  const leaf = (deg, len, turn = 18) => (
    <Place key={`${deg}-${turn}`} deg={deg} r={ART_R - 2} turn={turn} scale={len}>
      <path d="M0 0 Q-10 9 -8 24 Q0 33 8 24 Q10 9 0 0 Z" fill={main} {...line} />
      <path d="M0 3 Q0 12 0 24" fill="none" stroke={edge} strokeWidth="0.7" opacity=".5" />
    </Place>
  )

  const Motifs = {
    // Спокойный обод с камнем и малыми насечками — «Классика».
    classic: (
      <>
        <Place deg={0} r={ART_R - 3}>
          <path d="M-7 -6 L0 -16 L7 -6 L0 12 Z" fill={gem} {...line} />
          <path d="M-7 -6 L0 -16 L0 -6 Z" fill="#ffffff" opacity=".55" />
        </Place>
        <Place deg={180} r={ART_R - 3}>
          <path d="M-5 -4 L0 -10 L5 -4 L0 9 Z" fill={gem} {...line} />
        </Place>
        <Both>
          <Place deg={90} r={ART_R + 1}>
            <path d="M-3 -6 L3 0 L-3 6 L-5 0 Z" fill={main} {...line} />
          </Place>
        </Both>
      </>
    ),

    // Крылья вверх по бокам — «Проверенный».
    wings: (
      <>
        <Both>
          {feather(56, 0.85, 20)}
          {feather(76, 1.0, 15)}
          {feather(96, 1.05, 11)}
          {feather(116, 0.95, 7)}
          {feather(136, 0.8, 3)}
          <Place deg={44} r={ART_R + 4}>
            <path d="M-4 -6 L0 -12 L4 -6 L0 10 Z" fill={gem} {...line} />
          </Place>
        </Both>
        <Place deg={0} r={ART_R - 2} scale={1.1}>
          <path d="M-6 -8 L0 -20 L6 -8 L0 10 Z" fill={main} {...line} />
          <path d="M-6 -8 L0 -20 L0 -8 Z" fill={lit} opacity=".85" />
        </Place>
      </>
    ),

    // Корона сверху — «Бронза».
    crest: (
      <>
        <Both>
          <Place deg={22} r={ART_R - 3} turn={10}>
            <path d="M-7 -4 L-3 24 L3 8 L7 -4 Z" fill={main} {...line} />
            <path d="M-3 8 L-1 20" fill="none" stroke={lit} strokeWidth="1.2" opacity=".7" />
          </Place>
          <Place deg={44} r={ART_R - 3} turn={20} scale={0.85}>
            <path d="M-6 -4 L-2 20 L3 6 L6 -4 Z" fill={main} {...line} />
          </Place>
          <Place deg={150} r={ART_R - 2} turn={-6}>
            <path d="M-5 -4 L0 16 L5 -4 Z" fill={lit} {...line} />
          </Place>
        </Both>
        <Place deg={0} r={ART_R - 3}>
          <path d="M-9 -2 L-5 20 L0 10 L5 20 L9 -2 Z" fill={main} {...line} />
          <circle cx="0" cy="4" r="2.6" fill={gem} {...line} />
        </Place>
      </>
    ),

    // Угловатые пластины и шип снизу — «Серебро».
    shield: (
      <>
        <Both>
          <Place deg={52} r={ART_R - 5} turn={-14}>
            <path d="M-13 -6 L-6 20 L7 22 L13 2 L4 -8 Z" fill={main} {...line} />
            <path d="M-13 -6 L4 -8 L7 2 L-8 6 Z" fill={lit} opacity=".7" />
            <path d="M7 22 L2 6 L9 2 Z" fill={deep} opacity=".85" />
          </Place>
          <Place deg={124} r={ART_R - 5} turn={12} scale={0.8}>
            <path d="M-10 -4 L-4 16 L5 18 L10 2 L3 -6 Z" fill={main} {...line} />
          </Place>
        </Both>
        <Place deg={0} r={ART_R - 3}>
          <path d="M-8 -6 L0 -14 L8 -6 L0 8 Z" fill={gem} {...line} />
        </Place>
        <Place deg={180} r={ART_R - 2}>
          <path d="M-10 -4 L0 18 L10 -4 L0 2 Z" fill={main} {...line} />
        </Place>
      </>
    ),

    // Рога и клыки — «Рубин».
    horns: (
      <>
        <Both>
          <Place deg={34} r={ART_R - 4} turn={-8}>
            <path d="M-8 -2 Q-16 18 -6 34 Q2 18 2 2 Z" fill={main} {...line} />
            <path d="M-6 0 Q-12 16 -7 28" fill="none" stroke={lit} strokeWidth="1.1" opacity=".8" />
          </Place>
          <Place deg={154} r={ART_R - 2} turn={-10} scale={0.8}>
            <path d="M-6 -2 Q-2 14 0 22 Q4 12 5 -2 Z" fill={lit} {...line} />
          </Place>
        </Both>
        <Place deg={0} r={ART_R - 3} scale={1.05}>
          <path d="M0 -14 L6 -2 L0 18 L-6 -2 Z" fill={gem} {...line} />
          <path d="M0 -14 L6 -2 L0 -2 Z" fill="#ffffff" opacity=".5" />
        </Place>
        <Place deg={180} r={ART_R - 2}>
          <path d="M-8 -4 L0 14 L8 -4 L0 0 Z" fill={main} {...line} />
        </Place>
      </>
    ),

    // Полный лавр — «Золото».
    laurel: (
      <>
        <Both>
          {leaf(62, 0.9, -22)}
          {leaf(84, 1.0, -16)}
          {leaf(106, 1.05, -10)}
          {leaf(128, 1.0, -4)}
          {leaf(150, 0.9, 4)}
          <Place deg={42} r={ART_R + 3} scale={0.65}>
            <path d="M0 -2 Q-7 8 -6 18 Q0 24 6 18 Q7 8 0 -2 Z" fill={lit} {...line} />
          </Place>
        </Both>
        <Place deg={0} r={ART_R - 3} scale={1.15}>
          <path d="M-9 -2 L-4 16 L0 10 L4 16 L9 -2 Z" fill={main} {...line} />
          <circle cx="0" cy="4" r="2.4" fill={gem} {...line} />
        </Place>
        <Place deg={180} r={ART_R - 2}>
          <path d="M-6 -4 L0 10 L6 -4 Z" fill={main} {...line} />
        </Place>
      </>
    ),

    // Языки пламени по бокам — «Изумруд».
    flame: (
      <>
        <Both>
          <Place deg={40} r={ART_R - 4} turn={-10}>
            <path d="M-6 -2 Q-14 16 -4 34 Q0 20 3 22 Q10 14 6 -2 Z" fill={main} {...line} />
            <path d="M-2 2 Q-6 14 -2 26" fill="none" stroke={lit} strokeWidth="1.1" opacity=".85" />
          </Place>
          <Place deg={74} r={ART_R - 3} turn={-4} scale={0.9}>
            <path d="M-6 -2 Q-12 12 -2 28 Q8 12 6 -2 Z" fill={lit} {...line} opacity=".95" />
          </Place>
          <Place deg={132} r={ART_R - 3} turn={6} scale={0.8}>
            <path d="M-6 -2 Q-12 12 -2 26 Q9 10 6 -2 Z" fill={main} {...line} />
          </Place>
        </Both>
        <Place deg={180} r={ART_R - 2}>
          <path d="M-7 -4 L0 12 L7 -4 Z" fill={main} {...line} />
        </Place>
      </>
    ),

    // Техно-дуги с контактами — «Неон».
    circuit: (
      <>
        <Both>
          <path d={`M${at(238, 86).map((n) => n.toFixed(1)).join(' ')} A86 86 0 0 1 ${at(302, 86).map((n) => n.toFixed(1)).join(' ')}`} fill="none" stroke={p.mid} strokeWidth="3.4" strokeLinecap="round" opacity=".9" />
          <path d={`M${at(234, 94).map((n) => n.toFixed(1)).join(' ')} A94 94 0 0 1 ${at(306, 94).map((n) => n.toFixed(1)).join(' ')}`} fill="none" stroke={p.accent} strokeWidth="1.1" strokeLinecap="round" opacity=".7" />
          {[46, 90, 134].map((deg) => (
            <Place key={deg} deg={deg} r={ART_R + 7}>
              <rect x="-4" y="-4" width="8" height="8" rx="1.6" fill={gem} stroke={edge} strokeWidth="0.9" />
            </Place>
          ))}
          <Place deg={26} r={ART_R + 12} turn={-24}>
            <path d="M0 0 L-2 12" stroke={p.accent} strokeWidth="1.6" strokeLinecap="round" />
          </Place>
        </Both>
        <Place deg={0} r={ART_R - 3} scale={1.1}>
          <path d="M-7 -6 L0 -14 L7 -6 L0 10 Z" fill={gem} {...line} />
        </Place>
        <Place deg={180} r={ART_R - 3}>
          <path d="M-6 -4 L0 10 L6 -4 Z" fill={gem} {...line} />
        </Place>
      </>
    ),

    // Кристаллы — «Алмаз».
    crystal: (
      <>
        <Both>
          <Place deg={44} r={ART_R - 5} turn={-14}>
            <path d="M0 -16 L12 2 L7 24 L-7 22 L-13 2 Z" fill={main} {...line} />
            <path d="M0 -16 L12 2 L0 6 Z" fill={lit} opacity=".8" />
            <path d="M0 6 L7 24 L-7 22 Z" fill={deep} opacity=".5" />
            <circle cx="-2" cy="-4" r="1.8" fill="#ffffff" opacity=".8" />
          </Place>
          <Place deg={108} r={ART_R - 4} turn={8} scale={0.7}>
            <path d="M0 -12 L10 2 L4 18 L-7 16 L-10 2 Z" fill={main} {...line} />
          </Place>
        </Both>
        <Place deg={0} r={ART_R - 4} scale={1.2}>
          <path d="M0 -14 L8 0 L0 18 L-8 0 Z" fill={gem} {...line} />
          <path d="M0 -14 L8 0 L0 2 Z" fill="#ffffff" opacity=".6" />
        </Place>
        <Place deg={180} r={ART_R - 2}>
          <path d="M-7 -4 L0 12 L7 -4 L0 0 Z" fill={main} {...line} />
        </Place>
      </>
    ),
  }

  return (
    <svg
      className={`pframe pframe--${palette} pframe--${motif} ${glow ? 'pframe--glow' : ''}`}
      viewBox={`${-FRAME_VIEW} ${-FRAME_VIEW} ${FRAME_VIEW * 2} ${FRAME_VIEW * 2}`}
      aria-hidden="true"
      focusable="false"
    >
      <Paints uid={uid} p={p} />

      {/* Свечение вокруг обода: рамка светится, но не режет глаз. */}
      {glow && <circle cx="0" cy="0" r={RING_R + 2} fill="none" stroke={p.glow} strokeWidth="14" filter={`url(#${uid}-soft)`} />}

      {/* Мотив — до обода, чтобы обод всегда читался сверху. */}
      <g transform={`scale(${ART_SCALE.toFixed(3)})`}>
        {Motifs[motif] || Motifs.classic}
      </g>

      {/* Обод: толстое кольцо, внешняя фаска и тёмная внутренняя кромка. */}
      <circle cx="0" cy="0" r={RING_R} fill="none" stroke={main} strokeWidth="6.5" />
      <circle cx="0" cy="0" r={RING_R + 4} fill="none" stroke={p.hi} strokeWidth="1.4" opacity=".5" />
      <circle cx="0" cy="0" r={RING_R - 4} fill="none" stroke={edge} strokeWidth="1.4" opacity=".55" />
      {/* Блик по левой верхней четверти обода — объём. */}
      <path d={`M0 ${-RING_R} A${RING_R} ${RING_R} 0 0 0 ${-RING_R} 0`} fill="none" stroke="#ffffff" strokeWidth="1.6" opacity=".26" strokeLinecap="round" />
    </svg>
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
export function ProfileBanner({ css = '', url = '', height = 120, alt = '' }) {
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
