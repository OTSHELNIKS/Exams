// Стабильное соответствие: первые 20 рисунков заменяют прежние рамки, не
// меняя id и уже выданные права. Остальные имеют собственные id.
export const FRAME_IMAGES = [
  ...Array.from({ length: 59 }, (_, i) => `1-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 50 }, (_, i) => `2-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 50 }, (_, i) => `3-${String(i + 1).padStart(2, '0')}`),
]
export const LEGACY_MOTIFS = [
  'default', 'dawn', 'warrior', 'elite', 'master', 'legend', 'mythic', 'glory', 'immortal',
  'starlight', 'crown', 'scepter', 'knight', 'dragon', 'abyss', 'pumpkin', 'frost', 'lunar', 'bling', 'serpent',
]
export const FRAME_IMAGE_BY_MOTIF = Object.fromEntries(FRAME_IMAGES.map((image, i) => [
  LEGACY_MOTIFS[i] || `mlbb-${image}`, image,
]))
