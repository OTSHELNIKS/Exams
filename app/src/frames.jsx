// NAME MLBB — рамки профиля.
//
// Рамка — это не цветное кольцо, а настоящее украшение вокруг аватара:
// обод с фаской, гребень сверху, крылья снизу и камни по бокам. Чем выше
// достижение, тем богаче орнамент (art 1…4), но форма всегда узнаваемая —
// своя, угловатая, в фирменном оранжевом.
//
// Рисуем вектором, а не картинкой: чётко на любом экране, весит байты и
// перекрашивается в цвет достижения без десяти PNG на каждый тир.
import React, { useId } from 'react'

// Палитры: блик, основной тон, тень. Меняются от «стали» до «алмаза».
export const FRAME_PALETTES = {
  steel: { hi: '#f4f8fd', mid: '#9aa6b6', lo: '#4d5563', edge: '#1d222a', glow: 'rgba(180,200,230,.30)' },
  azure: { hi: '#dcefff', mid: '#4a9cf0', lo: '#15406f', edge: '#08203a', glow: 'rgba(74,156,240,.45)' },
  bronze: { hi: '#f9dcbc', mid: '#b07a4a', lo: '#5c3a1e', edge: '#2c1a0e', glow: 'rgba(176,122,74,.38)' },
  silver: { hi: '#ffffff', mid: '#c3c8d4', lo: '#6d7482', edge: '#2b303a', glow: 'rgba(195,200,212,.42)' },
  ruby: { hi: '#ffcfd6', mid: '#f0334f', lo: '#7d0b1d', edge: '#3a030d', glow: 'rgba(240,51,79,.5)' },
  gold: { hi: '#fff8cd', mid: '#ffc83d', lo: '#9b5a00', edge: '#442600', glow: 'rgba(255,200,61,.55)' },
  emerald: { hi: '#ddffee', mid: '#3fcb7b', lo: '#0f5731', edge: '#032616', glow: 'rgba(63,203,123,.48)' },
  neon: { hi: '#effeff', mid: '#39f0ff', lo: '#075c69', edge: '#02191d', glow: 'rgba(57,240,255,.6)' },
  diamond: { hi: '#ffffff', mid: '#d6f1ff', lo: '#79b4ff', edge: '#1d2b40', glow: 'rgba(200,235,255,.62)' },
}

// Уровень орнамента: 1 — обод и камень, 2 — гребень и малые крылья,
// 3 — полные крылья и вставки по бокам, 4 — лавр и самоцветы.
export const FRAME_ART = { default: 1, verified: 2, bronze: 2, silver: 2, ruby: 3, gold: 3, emerald: 3, neon: 4, diamond: 4 }

// Точка на окружности вокруг центра (100,100). Угол в градусах, 90° — низ.
const pt = (deg, r) => {
  const a = (deg * Math.PI) / 180
  return `${(100 + r * Math.cos(a)).toFixed(1)} ${(100 + r * Math.sin(a)).toFixed(1)}`
}

// Перо крыла: основание лежит по ободу, острие уходит наружу. Так крылья
// обнимают круг, а не висят отдельным веером под ним.
const featherPath = (a1, a2, tipDeg, tipR = 104, baseR = 84) =>
  `M${pt(a1, baseR)} A${baseR} ${baseR} 0 0 1 ${pt(a2, baseR)} L${pt(tipDeg, tipR)} Z`

const feather = (d, fill, edge, opacity = 1) => (
  <path d={d} fill={fill} stroke={edge} strokeWidth="1" strokeLinejoin="round" opacity={opacity} />
)

/**
 * Рамка вокруг аватара. Позиционируется по размеру родителя (`.avatar`),
 * поэтому размер задаётся CSS, а не пропсом.
 */
export function ProfileFrame({ palette = 'steel', art = 1, glow = true }) {
  const raw = useId()
  const uid = 'pf' + raw.replace(/[^a-zA-Z0-9]/g, '')
  const p = FRAME_PALETTES[palette] || FRAME_PALETTES.steel
  const main = `url(#${uid}-main)`
  const lit = `url(#${uid}-lit)`
  const edge = p.edge
  const gem = `url(#${uid}-gem)`

  // Крыло: три пера, которые поднимаются от нижней точки к бокам обода.
  const wing = (
    <g>
      {feather('M100 166 Q66 140 26 134 Q56 162 100 180 Z', main, edge)}
      {feather('M100 178 Q58 166 14 164 Q52 180 100 190 Z', lit, edge, 0.98)}
      {feather('M100 186 Q70 178 34 186 Q62 188 100 194 Z', main, edge, 0.96)}
      {feather('M100 192 Q76 190 52 194 Q74 199 100 197 Z', lit, edge, 0.92)}
    </g>
  )

  return (
    <svg className={`pframe pframe--${palette} ${glow ? 'pframe--glow' : ''}`} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${uid}-main`} x1="0.1" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor={p.hi} />
          <stop offset="0.42" stopColor={p.mid} />
          <stop offset="1" stopColor={p.lo} />
        </linearGradient>
        <linearGradient id={`${uid}-lit`} x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor={p.hi} />
          <stop offset="1" stopColor={p.mid} />
        </linearGradient>
        <linearGradient id={`${uid}-gem`} x1="0" y1="0" x2="0.55" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor={p.hi} />
          <stop offset="1" stopColor={p.mid} />
        </linearGradient>
        <filter id={`${uid}-soft`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>
      </defs>

      {/* Свечение под ободом: рамка «светится», но не режет глаз. */}
      {glow && <circle cx="100" cy="100" r="80" fill="none" stroke={p.glow} strokeWidth="10" filter={`url(#${uid}-soft)`} />}

      {/* Обод: толстое кольцо, внешняя фаска и тёмная внутренняя кромка. */}
      <circle cx="100" cy="100" r="78" fill="none" stroke={main} strokeWidth="7" />
      <circle cx="100" cy="100" r="83.5" fill="none" stroke={main} strokeWidth="1.8" opacity=".8" />
      <circle cx="100" cy="100" r="72" fill="none" stroke={edge} strokeWidth="1.4" opacity=".5" />

      {/* Верхний гребень: шпиль и два «крыла»-завитка. */}
      <path d="M100 4 L107 24 L100 42 L93 24 Z" fill={main} stroke={edge} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M100 4 L107 24 L100 24 Z" fill="#ffffff" opacity=".5" />
      {art >= 2 && (
        <>
          <path d="M76 30 Q86 12 100 30 Q88 26 80 36 Z" fill={main} stroke={edge} strokeWidth="1" />
          <path d="M124 30 Q114 12 100 30 Q112 26 120 36 Z" fill={main} stroke={edge} strokeWidth="1" />
          <path d="M78 40 Q100 20 122 40 L118 47 Q100 31 82 47 Z" fill={main} stroke={edge} strokeWidth="1" />
        </>
      )}

      {/* Нижние крылья: пара, растущая от центра к бокам обода. */}
      {art >= 2 && (
        <g>
          {wing}
          <g transform="translate(200 0) scale(-1 1)">{wing}</g>
          <circle cx="100" cy="192" r="3.6" fill={gem} stroke={edge} strokeWidth="1" />
        </g>
      )}

      {/* art ≥ 3: вставки в обод по бокам (ромбы на 3 и 9 часах). */}
      {art >= 3 && (
        <>
          <path d="M22 100 L31 91 L40 100 L31 109 Z" fill={main} stroke={edge} strokeWidth="1" />
          <path d="M178 100 L169 91 L160 100 L169 109 Z" fill={main} stroke={edge} strokeWidth="1" />
          <path d="M100 42 L107 52 L100 62 L93 52 Z" fill={gem} stroke={edge} strokeWidth="1" opacity=".95" />
        </>
      )}

      {/* art 4: лавр по бокам и самоцветы — только коллекционные рамки. */}
      {art >= 4 && (
        <>
          <g opacity=".95">
            <path d="M26 70 Q36 54 54 44 L60 55 Q44 64 34 78 Z" fill={main} stroke={edge} strokeWidth=".9" />
            <path d="M19 92 Q25 74 38 63 L45 73 Q34 83 28 97 Z" fill={main} stroke={edge} strokeWidth=".9" />
            <path d="M15 116 Q18 99 28 87 L36 96 Q27 106 24 120 Z" fill={main} stroke={edge} strokeWidth=".9" />
            <g transform="translate(200 0) scale(-1 1)">
              <path d="M26 70 Q36 54 54 44 L60 55 Q44 64 34 78 Z" fill={main} stroke={edge} strokeWidth=".9" />
              <path d="M19 92 Q25 74 38 63 L45 73 Q34 83 28 97 Z" fill={main} stroke={edge} strokeWidth=".9" />
              <path d="M15 116 Q18 99 28 87 L36 96 Q27 106 24 120 Z" fill={main} stroke={edge} strokeWidth=".9" />
            </g>
          </g>
          <circle cx="62" cy="38" r="3.8" fill={gem} stroke={edge} strokeWidth="1" />
          <circle cx="138" cy="38" r="3.8" fill={gem} stroke={edge} strokeWidth="1" />
        </>
      )}
    </svg>
  )
}

/** Шапка профиля (баннер) — как в Discord: полоса во всю ширину карточки. */
export function ProfileBanner({ css = '', style = null, height = 120 }) {
  return (
    <div className={`pbanner ${css}`} style={{ height, ...(style || {}) }} aria-hidden="true">
      <span className="pbanner__sheen" />
    </div>
  )
}
