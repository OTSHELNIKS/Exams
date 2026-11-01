// NAME MLBB — рамки профиля.
//
// Набор собран по типам рамок из MLBB: дивизионы (Воин, Элита, Мастер, Легенда,
// Мифик, Мифическая слава, Бессмертный), коллекционные (корона, скипетр, крест
// рыцаря), событийные (дракон, бездна, тыква, мороз, лунный, звёздный свет) и
// технологичные серии (неон, змей).
//
// Важно: это НЕ скопированные картинки Moonton — чужие ассеты брать нельзя.
// Каждый силуэт нарисован заново в векторе: по типам и настроению, а не
// пиксель в пиксель. Зато он чёткий на любом экране, весит байты, и на нём
// можно включать анимацию блеска у коллекционных.
//
// Геометрия: обод жмётся к аватару (r = 97 из 100), орнамент живёт снаружи, в
// полосе 74…150. Внутрь круга ничего не заходит — иначе аватар его закроет.
import React, { useId } from 'react'

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

export const FRAME_MOTIFS = Object.values(FRAME_ART)

// Аватар занимает ровно квадрат, его радиус — 100 единиц. Обод стоит на 97
// (чуть выступает за край картинки), орнамент рисуется в системе «обод = 72» и
// потом масштабируется наружу — так формы остаются читаемыми, но крупными.
const RING_R = 92
const ART_R = 72
const ART_SCALE = (RING_R / ART_R) * 1.10
export const FRAME_VIEW = 190

// Угол 0 — верх, дальше по часовой стрелке.
const at = (deg, r) => {
  const a = (deg * Math.PI) / 180
  return [r * Math.sin(a), -r * Math.cos(a)]
}

/** Дуга по углам: удобно для нимбов, волн и поясов. */
const arc = (r, a0, a1) => {
  const [x0, y0] = at(a0, r)
  const [x1, y1] = at(a1, r)
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0
  const sweep = a1 > a0 ? 1 : 0
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(1)} ${y1.toFixed(1)}`
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

function Paints({ uid, p, shine = false }) {
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
      {shine && (
        <>
          {/* Блик: узкая белая полоса, которая едет по ободу. */}
          <linearGradient id={`${uid}-glint`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="0.55" stopColor={p.hi} stopOpacity="0.9" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          {/* Перелив: цветная волна вокруг рамки, вращается медленнее блика. */}
          <linearGradient id={`${uid}-shimmer`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={p.hi} stopOpacity="0.9" />
            <stop offset="0.33" stopColor="#ffffff" stopOpacity="0.15" />
            <stop offset="0.66" stopColor={p.accent} stopOpacity="0.85" />
            <stop offset="1" stopColor={p.hi} stopOpacity="0.9" />
            <animateTransform
              attributeName="gradientTransform"
              type="rotate"
              from="0 0.5 0.5"
              to="360 0.5 0.5"
              dur="9s"
              repeatCount="indefinite"
            />
          </linearGradient>
        </>
      )}
    </defs>
  )
}

// Точка на окружности обода: 0° — верх, дальше по часовой стрелке.
const onRing = (deg, r = RING_R) => at(deg, r).map((n) => n.toFixed(2)).join(' ')

/** Искра: четырёхлучевая звёздочка, мигает в своей фазе. */
function Spark({ deg, r, size = 1, delay = 0, dur = 3.4 }) {
  return (
    <Place deg={deg} r={r} scale={size}>
      <path d="M0 -9 L2 -2 L9 0 L2 2 L0 9 L-2 2 L-9 0 L-2 -2 Z" fill="#ffffff">
        <animate attributeName="opacity" values="0;1;0" dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" />
      </path>
    </Place>
  )
}

/**
 * Блеск коллекционной рамки: блик обходит обод по кругу, по ободу едет цветная
 * волна, в нескольких местах вспыхивают искры. Всё живёт внутри SVG, поэтому
 * масштабируется вместе с аватаром и не тянет ни одного лишнего файла.
 */
function Shine({ uid }) {
  return (
    <g className="pframe__shine" aria-hidden="true">
      <circle cx="0" cy="0" r={RING_R} fill="none" stroke={`url(#${uid}-shimmer)`} strokeWidth="3" opacity=".28" />
      <g transform="rotate(40)">
        <animateTransform attributeName="transform" type="rotate" from="40 0 0" to="400 0 0" dur="6.5s" repeatCount="indefinite" />
        {/* Блик собран из вложенных дуг: чем короче, тем ярче — получается
            мягкая «голова кометы», а не резкая белая полоса. */}
        {[[-42, 42, 13, 0.1], [-34, 34, 10, 0.18], [-25, 25, 8, 0.3], [-17, 17, 6, 0.5], [-9, 9, 4, 0.78], [-4, 4, 2.6, 1]].map(([a0, a1, w, o]) => (
          <path
            key={`g${a0}`}
            d={`M${onRing(a0)} A${RING_R} ${RING_R} 0 0 1 ${onRing(a1)}`}
            fill="none"
            stroke="#ffffff"
            strokeWidth={w}
            strokeLinecap="round"
            opacity={o}
          />
        ))}
        <circle cx={at(34, RING_R)[0]} cy={at(34, RING_R)[1]} r="5.2" fill="#ffffff" opacity="1" />
        <circle cx={at(34, RING_R)[0]} cy={at(34, RING_R)[1]} r="11" fill="#ffffff" opacity=".35" />
        
      </g>
      {/* Вторая, слабая искра с другой стороны: обод не выглядит «однобоким». */}
      <g transform="rotate(220)">
        <animateTransform attributeName="transform" type="rotate" from="220 0 0" to="580 0 0" dur="6.5s" repeatCount="indefinite" />
        <path
          d={`M${onRing(-16)} A${RING_R} ${RING_R} 0 0 1 ${onRing(16)}`}
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.6"
          strokeLinecap="round"
          opacity=".55"
        />
      </g>
      <Spark deg={28} r={RING_R + 6} size={0.9} delay={0} dur={3.8} />
      <Spark deg={142} r={RING_R + 9} size={0.7} delay={1.3} dur={4.2} />
      <Spark deg={228} r={RING_R + 4} size={1} delay={2.1} dur={3.4} />
      <Spark deg={310} r={RING_R + 8} size={0.8} delay={0.7} dur={4.6} />
    </g>
  )
}

/**
 * Орнаменты. Общие примитивы — шип, осколок, перо, клинок, звезда, камень,
 * дуга — из них собраны все двадцать рамок, поэтому формы получаются разными,
 * но код остаётся читаемым.
 */
function buildMotifs({ main, lit, gem, deep, edge, line, p }) {
  // Треугольный шип наружу.
  const spike = (deg, w = 8, h = 22, fill = main, key) => (
    <Place key={key || `sp${deg}`} deg={deg} r={ART_R - 6}>
      <path d={`M${-w} 0 L0 ${h} L${w} 0 Z`} fill={fill} {...line} />
    </Place>
  )

  // Гранёный кристалл (крупный, с бликом).
  const shard = (deg, s = 1, turn = 0, key) => (
    <Place key={key || `sh${deg}`} deg={deg} r={ART_R - 6} scale={s} turn={turn}>
      <path d="M0 -10 L10 2 L6 30 L-6 30 L-10 2 Z" fill={main} {...line} />
      <path d="M0 -10 L10 2 L0 6 Z" fill={lit} opacity=".8" />
      <path d="M0 6 L6 30 L-6 30 Z" fill={deep} opacity=".55" />
    </Place>
  )

  // Перо/лист — для крыльев и лавра.
  const feather = (deg, len = 1, turn = 0, key) => (
    <Place key={key || `ft${deg}`} deg={deg} r={ART_R - 4} turn={turn} scale={len}>
      <path d="M-7 0 Q-11 14 0 34 Q11 14 7 0 Z" fill={main} {...line} />
      <path d="M0 4 Q-4 14 0 27" fill="none" stroke={edge} strokeWidth="1.1" opacity=".4" />
    </Place>
  )

  // Клинок — узкий и длинный.
  const blade = (deg, len = 1, turn = 0, key) => (
    <Place key={key || `bl${deg}`} deg={deg} r={ART_R - 6} turn={turn} scale={len}>
      <path d="M-4 0 L0 40 L4 0 Z" fill={main} {...line} />
      <path d="M0 2 L0 36" stroke={lit} strokeWidth="1.1" opacity=".7" />
    </Place>
  )

  // Четырёхлучевая звезда.
  const star = (deg, s = 1, r = ART_R + 4, fill = gem, key) => (
    <Place key={key || `st${deg}`} deg={deg} r={r} scale={s}>
      <path d="M0 -11 L3 -3 L11 0 L3 3 L0 11 L-3 3 L-11 0 L-3 -3 Z" fill={fill} {...line} />
    </Place>
  )

  // Круглый камень-заклёпка.
  const stud = (deg, r = 3, rad = ART_R, fill = gem, key) => (
    <Place key={key || `sd${deg}`} deg={deg} r={rad}>
      <circle cx="0" cy="0" r={r} fill={fill} {...line} />
    </Place>
  )

  // Ромб-камень.
  const rhomb = (deg, w = 6, h = 12, fill = gem, rad = ART_R - 4, key) => (
    <Place key={key || `rh${deg}`} deg={deg} r={rad}>
      <path d={`M0 ${-h} L${w} 0 L0 ${h} L${-w} 0 Z`} fill={fill} {...line} />
    </Place>
  )

  // Пояс по ободу — толстая дуга.
  const band = (a0, a1, r = ART_R + 10, w = 4, fill = main, op = 1, key) => (
    <path
      key={key || `bd${a0}`}
      d={arc(r, a0, a1)}
      fill="none"
      stroke={fill}
      strokeWidth={w}
      strokeLinecap="round"
      opacity={op}
    />
  )

  return {
    // 1. Классика: камень сверху и снизу, заклёпки по бокам.
    default: (
      <>
        <rhomb deg={0} w={7} h={16} />
        <rhomb deg={180} w={5} h={11} rad={ART_R - 2} />
        <Both>
          {stud(92, 3, ART_R + 2)}
          {stud(136, 2, ART_R + 1)}
        </Both>
        <circle cx="0" cy="0" r={ART_R - 8} fill="none" stroke={edge} strokeWidth="1" opacity=".35" />
      </>
    ),

    // 2. Страж рассвета: солнечные лучи и три дуги-нимба.
    dawn: (
      <>
        {Array.from({ length: 12 }, (_, i) => {
          const deg = i * 30
          const long = i % 3 === 0
          return spike(deg, long ? 7 : 4.5, long ? 26 : 15, long ? main : lit, `dw${deg}`)
        })}
        <path d={arc(ART_R + 20, -60, 60)} fill="none" stroke={p.accent} strokeWidth="2.6" opacity=".85" strokeLinecap="round" />
        <path d={arc(ART_R + 30, -42, 42)} fill="none" stroke={lit} strokeWidth="1.6" opacity=".7" strokeLinecap="round" />
        <circle cx={at(0, ART_R + 6)[0]} cy={at(0, ART_R + 6)[1]} r="7" fill={gem} {...line} />
      </>
    ),

    // 3. Воин: шевроны по кругу и короткий клинок сверху.
    warrior: (
      <>
        <Both>
          <Place deg={54} r={ART_R - 2} turn={-18}>
            <path d="M-12 0 L0 18 L12 0" fill="none" stroke={main} strokeWidth="6" strokeLinecap="round" {...line} />
          </Place>
          <Place deg={122} r={ART_R - 2} turn={12}>
            <path d="M-10 0 L0 15 L10 0" fill="none" stroke={lit} strokeWidth="5" strokeLinecap="round" />
          </Place>
        </Both>
        {blade(0, 0.7)}
        <Place deg={180} r={ART_R - 2} scale={0.8}>
          <path d="M-9 0 L0 -14 L9 0 Z" fill={main} {...line} />
        </Place>
      </>
    ),

    // 4. Элита: гранёные пластины по диагоналям и двойной клин снизу.
    elite: (
      <>
        <Both>
          <Place deg={46} r={ART_R - 5} turn={-12}>
            <path d="M-14 -5 L-5 22 L8 20 L14 0 L3 -9 Z" fill={main} {...line} />
            <path d="M-14 -5 L3 -9 L6 2 L-9 5 Z" fill={lit} opacity=".7" />
          </Place>
          <Place deg={118} r={ART_R - 5} turn={10} scale={0.78}>
            <path d="M-11 -4 L-4 18 L6 16 L11 0 L2 -7 Z" fill={main} {...line} />
          </Place>
        </Both>
        <Place deg={180} r={ART_R - 3} scale={1.1}>
          <path d="M-12 0 L0 20 L12 0 L0 -8 Z" fill={main} {...line} />
          <path d="M-12 0 L0 -8 L0 4 Z" fill={lit} opacity=".65" />
        </Place>
        {stud(0, 4, ART_R + 2)}
      </>
    ),

    // 5. Мастер: восемь шипов вперемешку и звезда сверху.
    master: (
      <>
        {Array.from({ length: 8 }, (_, i) => {
          const deg = i * 45
          const long = i % 2 === 0
          return spike(deg, long ? 8 : 5, long ? 30 : 18, long ? main : deep, `ms${deg}`)
        })}
        <star deg={0} s={1.1} r={ART_R + 18} />
        {stud(90, 3, ART_R + 6)}
        {stud(270, 3, ART_R + 6)}
      </>
    ),

    // 6. Легенда: крылья по бокам и корона сверху.
    legend: (
      <>
        <Both>
          {feather(58, 0.85, 18)}
          {feather(80, 1.0, 13)}
          {feather(102, 1.05, 9)}
          {feather(124, 0.9, 5)}
        </Both>
        <Place deg={0} r={ART_R - 4} scale={1.15}>
          <path d="M-14 4 L-11 -10 L-4 0 L0 -16 L4 0 L11 -10 L14 4 Z" fill={main} {...line} />
          <circle cx="0" cy="0" r="2.6" fill={gem} {...line} />
        </Place>
        <Place deg={180} r={ART_R - 2}>
          <path d="M-8 0 L0 14 L8 0 Z" fill={main} {...line} />
        </Place>
      </>
    ),

    // 7. Мифик: два больших кристалла и дуги-крылья.
    mythic: (
      <>
        <Both>
          <path d={arc(ART_R + 22, 30, 88)} fill="none" stroke={main} strokeWidth="5" strokeLinecap="round" opacity=".9" />
          <path d={arc(ART_R + 30, 34, 84)} fill="none" stroke={p.accent} strokeWidth="1.5" strokeLinecap="round" opacity=".8" />
          {shard(48, 1.15, -8)}
          {shard(112, 0.7, 6)}
        </Both>
        <Place deg={0} r={ART_R - 4} scale={1.2}>
          <path d="M0 -16 L9 0 L0 18 L-9 0 Z" fill={gem} {...line} />
          <path d="M0 -16 L9 0 L0 2 Z" fill="#ffffff" opacity=".6" />
        </Place>
      </>
    ),

    // 8. Мифическая слава: тройной нимб и осколки по кругу.
    glory: (
      <>
        {[0, 60, 120, 180, 240, 300].map((deg) => shard(deg, 0.62, deg % 120 === 0 ? -6 : 6, `gl${deg}`))}
        <path d={arc(ART_R + 26, 0, 360)} fill="none" stroke={p.accent} strokeWidth="2" opacity=".55" />
        <path d={arc(ART_R + 34, -100, 100)} fill="none" stroke={lit} strokeWidth="3" strokeLinecap="round" opacity=".8" />
        <Place deg={0} r={ART_R + 14} scale={1.25}>
          <path d="M0 -14 L7 0 L0 14 L-7 0 Z" fill={gem} {...line} />
        </Place>
      </>
    ),

    // 9. Бессмертный: высокие шипы-тернии и орбита.
    immortal: (
      <>
        <Both>
          <Place deg={26} r={ART_R - 6} turn={-6}>
            <path d="M-6 0 Q-10 22 -2 44 Q4 22 5 0 Z" fill={main} {...line} />
          </Place>
          <Place deg={64} r={ART_R - 6} turn={-2} scale={0.8}>
            <path d="M-5 0 Q-9 18 -2 34 Q4 16 4 0 Z" fill={lit} {...line} />
          </Place>
          <Place deg={150} r={ART_R - 4} scale={0.72}>
            <path d="M-5 0 Q-8 16 -1 30 Q4 14 4 0 Z" fill={main} {...line} />
          </Place>
        </Both>
        <path d={arc(ART_R + 24, -46, 46)} fill="none" stroke={gem} strokeWidth="2.4" strokeLinecap="round" opacity=".85" />
        <Place deg={0} r={ART_R - 4} scale={1.1}>
          <path d="M-7 -8 L0 -20 L7 -8 L0 10 Z" fill={gem} {...line} />
        </Place>
      </>
    ),

    // 10. Звёздный свет: созвездие из пяти звёзд, соединённых линиями.
    starlight: (
      <>
        <path
          d={[0, 72, 144, 216, 288, 0]
            .map((deg, i) => {
              const [x, y] = at(deg, ART_R + 12)
              return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
            })
            .join(' ')}
          fill="none"
          stroke={p.accent}
          strokeWidth="1.4"
          opacity=".7"
          strokeDasharray="4 5"
        />
        {[0, 72, 144, 216, 288].map((deg, i) => star(deg, i % 2 === 0 ? 1.15 : 0.8, ART_R + 12, gem, `sl${deg}`))}
        <path d={arc(ART_R + 2, -70, 70)} fill="none" stroke={main} strokeWidth="3.4" strokeLinecap="round" opacity=".9" />
      </>
    ),

    // 11. Королевская корона: пять зубцов, камни и обод.
    crown: (
      <>
        <Place deg={0} r={ART_R - 6} scale={1.2}>
          <path d="M-20 8 L-17 -12 L-8 -2 L0 -20 L8 -2 L17 -12 L20 8 Z" fill={main} {...line} />
          <path d="M-20 8 L20 8 L18 15 L-18 15 Z" fill={deep} {...line} />
          <circle cx="-10" cy="11" r="2.2" fill={gem} {...line} />
          <circle cx="0" cy="11" r="2.6" fill={gem} {...line} />
          <circle cx="10" cy="11" r="2.2" fill={gem} {...line} />
          <circle cx="0" cy="-14" r="2.4" fill="#ffffff" opacity=".9" />
        </Place>
        <Both>
          <path d={arc(ART_R + 16, 18, 74)} fill="none" stroke={main} strokeWidth="4" strokeLinecap="round" opacity=".85" />
          {stud(46, 3, ART_R + 16)}
        </Both>
        <Place deg={180} r={ART_R - 2}>
          <path d="M-10 0 L0 16 L10 0 Z" fill={main} {...line} />
        </Place>
      </>
    ),

    // 12. Скипетр: два жезла по диагоналям и держава сверху.
    scepter: (
      <>
        <Both>
          <Place deg={44} r={ART_R - 8} turn={-30} scale={1.05}>
            <path d="M-3 0 L-2 46 L2 46 L3 0 Z" fill={main} {...line} />
            <circle cx="0" cy="-6" r="7" fill={gem} {...line} />
            <path d="M-9 44 L9 44" stroke={lit} strokeWidth="3" strokeLinecap="round" />
          </Place>
          {stud(96, 3.2, ART_R + 4)}
        </Both>
        <Place deg={0} r={ART_R - 2} scale={1.1}>
          <circle cx="0" cy="0" r="9" fill={gem} {...line} />
          <path d="M0 -14 L3 -3 L14 0 L3 3 L0 14 L-3 3 L-14 0 L-3 -3 Z" fill={lit} opacity=".9" />
        </Place>
      </>
    ),

    // 13. Крест рыцаря: крест сверху и щит-пластины.
    knight: (
      <>
        <Place deg={0} r={ART_R - 4} scale={1.05}>
          <path d="M-4 -22 L4 -22 L4 4 L20 4 L20 12 L4 12 L4 26 L-4 26 L-4 12 L-20 12 L-20 4 L-4 4 Z" fill={main} {...line} />
          <path d="M-4 -22 L0 -22 L0 26 L-4 26 Z" fill={lit} opacity=".6" />
        </Place>
        <Both>
          <Place deg={54} r={ART_R - 6} turn={-14}>
            <path d="M-11 -4 L-4 18 L7 16 L11 0 L1 -8 Z" fill={main} {...line} />
          </Place>
          <Place deg={130} r={ART_R - 2} turn={10} scale={0.7}>
            <path d="M-8 -3 L-3 14 L6 12 L8 0 L0 -6 Z" fill={lit} {...line} />
          </Place>
        </Both>
      </>
    ),

    // 14. Дракон: голова сверху, шипы-чешуя по кругу, хвост-дуга.
    dragon: (
      <>
        <Place deg={0} r={ART_R - 8} scale={1.25}>
          <path d="M-16 6 Q-12 -12 0 -14 Q12 -12 16 6 Q8 14 0 16 Q-8 14 -16 6 Z" fill={main} {...line} />
          <path d="M-8 -8 Q-14 -22 -4 -24 Q0 -16 -2 -10 Z" fill={deep} {...line} />
          <path d="M8 -8 Q14 -22 4 -24 Q0 -16 2 -10 Z" fill={deep} {...line} />
          <circle cx="-5" cy="0" r="2.4" fill={gem} />
          <circle cx="5" cy="0" r="2.4" fill={gem} />
          <path d="M-6 10 Q0 14 6 10" fill="none" stroke="#ffffff" strokeWidth="1.6" opacity=".8" />
        </Place>
        {[36, 62, 88, 114, 140, 166, 192, 218, 244, 270, 296, 322].map((deg) => spike(deg, 4, 12, deg % 72 === 0 ? lit : main, `dr${deg}`))}
        <path d={arc(ART_R + 24, 150, 250)} fill="none" stroke={main} strokeWidth="3.2" strokeLinecap="round" opacity=".8" />
      </>
    ),

    // 15. Бездна: щупальца снизу и светящиеся сферы.
    abyss: (
      <>
        <Both>
          <Place deg={132} r={ART_R - 6} turn={16}>
            <path d="M0 0 Q-14 16 -6 34 Q2 22 8 30 Q10 12 4 0 Z" fill={main} {...line} />
          </Place>
          <Place deg={158} r={ART_R - 4} turn={-10} scale={0.8}>
            <path d="M0 0 Q-10 14 -4 28 Q4 18 7 24 Q8 10 3 0 Z" fill={deep} {...line} />
          </Place>
          {stud(58, 3.4, ART_R + 6, gem)}
        </Both>
        <path d={arc(ART_R + 8, -30, 30)} fill="none" stroke={p.accent} strokeWidth="2.2" strokeLinecap="round" opacity=".8" />
        <Place deg={0} r={ART_R - 2}>
          <path d="M-9 -6 Q0 -14 9 -6 Q6 8 0 12 Q-6 8 -9 -6 Z" fill={gem} {...line} />
        </Place>
      </>
    ),

    // 16. Тыква: светильник Джека сверху и летучие мыши по бокам.
    pumpkin: (
      <>
        <Place deg={0} r={ART_R - 6} scale={1.15}>
          <path d="M-18 2 Q-18 -14 -6 -14 Q0 -18 6 -14 Q18 -14 18 2 Q18 16 0 18 Q-18 16 -18 2 Z" fill={main} {...line} />
          <path d="M-2 -14 L0 -22 L5 -14" fill="none" stroke={deep} strokeWidth="3" strokeLinecap="round" />
          <path d="M-10 -2 L-5 4 L-11 4 Z" fill={edge} />
          <path d="M10 -2 L5 4 L11 4 Z" fill={edge} />
          <path d="M-8 9 Q0 15 8 9 Q4 6 0 8 Q-4 6 -8 9 Z" fill={edge} />
          <path d="M-18 2 Q-12 6 -6 2" fill="none" stroke={deep} strokeWidth="1.4" opacity=".7" />
          <path d="M18 2 Q12 6 6 2" fill="none" stroke={deep} strokeWidth="1.4" opacity=".7" />
        </Place>
        <Both>
          <Place deg={52} r={ART_R + 16} turn={-14} scale={0.9}>
            <path d="M0 0 Q-10 -6 -16 0 Q-8 2 -10 8 Q-4 4 0 8 Q4 4 10 8 Q8 2 16 0 Q10 -6 0 0 Z" fill={main} {...line} />
          </Place>
          <Place deg={116} r={ART_R + 12} turn={10} scale={0.65}>
            <path d="M0 0 Q-8 -5 -13 0 Q-6 2 -8 6 Q-3 3 0 6 Q3 3 8 6 Q6 2 13 0 Q8 -5 0 0 Z" fill={lit} {...line} />
          </Place>
        </Both>
      </>
    ),

    // 17. Мороз: снежинка — шесть лучей с ответвлениями и кристаллы.
    frost: (
      <>
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <Place key={`fr${deg}`} deg={deg} r={ART_R - 8} turn={0}>
            <path d="M0 0 L0 40" stroke={main} strokeWidth="4" strokeLinecap="round" />
            <path d="M0 14 L-9 24 M0 14 L9 24 M0 26 L-7 34 M0 26 L7 34" stroke={lit} strokeWidth="2.6" strokeLinecap="round" />
            <circle cx="0" cy="40" r="2.8" fill={gem} {...line} />
          </Place>
        ))}
        <path d={arc(ART_R + 6, 0, 360)} fill="none" stroke={p.accent} strokeWidth="1.2" opacity=".45" />
        <Place deg={0} r={ART_R - 12} scale={0.8}>
          <path d="M0 -12 L7 0 L0 12 L-7 0 Z" fill={gem} {...line} />
        </Place>
      </>
    ),

    // 18. Лунный: месяц сверху, облака по бокам и фонарики.
    lunar: (
      <>
        <Place deg={0} r={ART_R - 4} scale={1.2}>
          <path d="M6 -18 A18 18 0 1 0 6 18 A14 14 0 1 1 6 -18 Z" fill={gem} {...line} />
          <circle cx="10" cy="-6" r="2" fill={lit} opacity=".9" />
        </Place>
        <Both>
          <path d={arc(ART_R + 18, 20, 76)} fill="none" stroke={main} strokeWidth="5" strokeLinecap="round" opacity=".9" />
          <Place deg={66} r={ART_R + 16} scale={0.85}>
            <path d="M-7 -8 L7 -8 L7 6 Q0 12 -7 6 Z" fill={main} {...line} />
            <path d="M-4 -12 L0 -8 L4 -12" fill="none" stroke={deep} strokeWidth="1.6" />
            <circle cx="0" cy="0" r="2.4" fill={gem} />
          </Place>
        </Both>
        <Place deg={180} r={ART_R - 2}>
          <path d="M-9 0 Q0 12 9 0 Q0 4 -9 0 Z" fill={main} {...line} />
        </Place>
      </>
    ),

    // 19. Неон: сегменты трубки с разрывами и контакты.
    bling: (
      <>
        {[[-160, -30], [-10, 50], [70, 130], [150, 200]].map(([a0, a1]) => (
          <path
            key={`bl${a0}`}
            d={arc(ART_R + 12, a0, a1)}
            fill="none"
            stroke={main}
            strokeWidth="6"
            strokeLinecap="round"
          />
        ))}
        {[[-160, -30], [-10, 50], [70, 130], [150, 200]].map(([a0, a1]) => (
          <path
            key={`bl2${a0}`}
            d={arc(ART_R + 12, a0 + 6, a1 - 6)}
            fill="none"
            stroke={p.hi}
            strokeWidth="2"
            strokeLinecap="round"
            opacity=".8"
          />
        ))}
        {[0, 90, 180, 270].map((deg) => (
          <Place key={`bc${deg}`} deg={deg} r={ART_R + 22}>
            <rect x="-4" y="-4" width="8" height="8" rx="1.6" fill={gem} stroke={edge} strokeWidth="0.9" />
          </Place>
        ))}
        <Place deg={0} r={ART_R - 4} scale={1.1}>
          <path d="M-7 -6 L0 -14 L7 -6 L0 10 Z" fill={gem} {...line} />
        </Place>
      </>
    ),

    // 20. Змей: тело-змея по ободу, голова с клыками.
    serpent: (
      <>
        <path
          d={`M${at(200, ART_R + 20).map((n) => n.toFixed(1)).join(' ')} C${at(260, ART_R + 44).map((n) => n.toFixed(1)).join(' ')} ${at(300, ART_R - 6).map((n) => n.toFixed(1)).join(' ')} ${at(340, ART_R + 26).map((n) => n.toFixed(1)).join(' ')}`}
          fill="none"
          stroke={main}
          strokeWidth="7"
          strokeLinecap="round"
          opacity=".95"
        />
        <path
          d={`M${at(20, ART_R + 26).map((n) => n.toFixed(1)).join(' ')} C${at(60, ART_R - 6).map((n) => n.toFixed(1)).join(' ')} ${at(100, ART_R + 44).map((n) => n.toFixed(1)).join(' ')} ${at(160, ART_R + 20).map((n) => n.toFixed(1)).join(' ')}`}
          fill="none"
          stroke={deep}
          strokeWidth="5"
          strokeLinecap="round"
          opacity=".9"
        />
        {[210, 252, 294, 336].map((deg) => stud(deg, 2, ART_R + 30, lit, `sv${deg}`))}
        <Place deg={0} r={ART_R - 6} scale={1.2}>
          <path d="M-13 8 Q-10 -10 0 -12 Q10 -10 13 8 Q0 16 -13 8 Z" fill={main} {...line} />
          <path d="M-6 6 L-8 16 L-3 8 Z" fill="#ffffff" {...line} />
          <path d="M6 6 L8 16 L3 8 Z" fill="#ffffff" {...line} />
          <circle cx="-5" cy="-2" r="2.2" fill={gem} />
          <circle cx="5" cy="-2" r="2.2" fill={gem} />
        </Place>
      </>
    ),
  }
}

/**
 * Рамка вокруг аватара. Размер задаётся родителем (`.avatar`), здесь только
 * рисунок в системе координат с центром (0,0). `shine` — анимированный блеск
 * для коллекционных рамок.
 */
export function ProfileFrame({ palette = 'steel', art = 'default', glow = true, shine = false }) {
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
    ? ['warrior', 'elite', 'master', 'legend'][Math.min(3, Math.max(0, art - 1))]
    : (FRAME_ART[art] || art || 'default')

  const line = { stroke: edge, strokeWidth: 1.9, strokeLinejoin: 'round', strokeLinecap: 'round' }
  const Motifs = buildMotifs({ main, lit, gem, deep, edge, line, p })

  return (
    <svg
      className={`pframe pframe--${palette} pframe--${motif} ${glow ? 'pframe--glow' : ''} ${shine ? 'pframe--shine' : ''}`}
      viewBox={`${-FRAME_VIEW} ${-FRAME_VIEW} ${FRAME_VIEW * 2} ${FRAME_VIEW * 2}`}
      aria-hidden="true"
      focusable="false"
    >
      <Paints uid={uid} p={p} shine={shine} />

      {/* Свечение вокруг обода: рамка светится, но не режет глаз. */}
      {glow && <circle cx="0" cy="0" r={RING_R + 2} fill="none" stroke={p.glow} strokeWidth="14" filter={`url(#${uid}-soft)`} />}

      {/* Мотив — до обода, чтобы обод всегда читался сверху. */}
      <g transform={`scale(${ART_SCALE.toFixed(3)})`}>
        {Motifs[motif] || Motifs.default}
      </g>

      {/* Обод: толстое кольцо, внешняя фаска и тёмная внутренняя кромка. */}
      <circle cx="0" cy="0" r={RING_R} fill="none" stroke={main} strokeWidth="6.5" />
      <circle cx="0" cy="0" r={RING_R + 4} fill="none" stroke={p.hi} strokeWidth="1.4" opacity=".5" />
      <circle cx="0" cy="0" r={RING_R - 4} fill="none" stroke={edge} strokeWidth="1.4" opacity=".55" />
      {/* Блик по левой верхней четверти обода — объём. */}
      <path d={`M0 ${-RING_R} A${RING_R} ${RING_R} 0 0 0 ${-RING_R} 0`} fill="none" stroke="#ffffff" strokeWidth="1.6" opacity=".26" strokeLinecap="round" />

      {shine && <Shine uid={uid} />}
    </svg>
  )
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
