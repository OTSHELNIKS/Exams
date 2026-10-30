// Геометрия обрезки аватарки — чистые функции без DOM, чтобы их можно было
// прогнать в node (см. tests/avatar.test.mjs).
//
// Модель: картинка натурального размера nat лежит в квадратном окне box,
// масштаб k = (box / min(nat.w, nat.h)) * zoom, центр картинки смещён на
// offset относительно центра окна. Окно показывает квадрат сторону box / k
// в координатах исходника.

export const CROP_OUTPUT_SIZE = 512
export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** Масштаб отображения: пиксели окна на пиксель исходника. */
export function displayScale(nat, box, zoom) {
  if (!nat || !nat.w || !nat.h || !box) return 1
  return (box / Math.min(nat.w, nat.h)) * zoom
}

/** Пределы сдвига, при которых окно полностью закрыто картинкой. */
export function offsetBounds(nat, box, zoom) {
  const k = displayScale(nat, box, zoom)
  const dispW = nat.w * k
  const dispH = nat.h * k
  return {
    maxX: Math.max(0, (dispW - box) / 2),
    maxY: Math.max(0, (dispH - box) / 2),
  }
}

export function clampOffset(offset, nat, box, zoom) {
  const { maxX, maxY } = offsetBounds(nat, box, zoom)
  return { x: clamp(offset.x, -maxX, maxX), y: clamp(offset.y, -maxY, maxY) }
}

/**
 * Прямоугольник исходника, который виден в окне.
 * Возвращает { sx, sy, side } — сторона квадрата в пикселях исходника.
 */
export function cropRect({ nat, box, zoom, offset }) {
  const k = displayScale(nat, box, zoom)
  const side = box / k
  const rawSx = (-box / 2 - offset.x) / k + nat.w / 2
  const rawSy = (-box / 2 - offset.y) / k + nat.h / 2
  return {
    sx: clamp(rawSx, 0, Math.max(0, nat.w - side)),
    sy: clamp(rawSy, 0, Math.max(0, nat.h - side)),
    side,
  }
}
