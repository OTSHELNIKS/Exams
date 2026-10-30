// Справочные данные приложения — соответствуют макету из видео-презентации заказчика.

export const RANKS = [
  'Warrior', 'Elite', 'Master', 'Grandmaster', 'Epic', 'Legend', 'Mythic', 'Mythical Glory',
]

export const ROLES = ['Лесник', 'Маг', 'Стрелок', 'Боец', 'Танк', 'Поддержка']

export const REGIONS = [
  'Москва', 'Европа', 'Краснодар', 'Новосибирск', 'Беларусь', 'Казахстан', 'Узбекистан',
]

export const HERO_CLASSES = ['Танк', 'Боец', 'Убийца', 'Маг', 'Стрелок', 'Саппорт']

// Иконки героев: app/public/heroes/<id>.webp (96×96, в стиле HD-иконок MLBB).
// Список и роли — полный ростер MLBB (133 героя), источник — открытая база
// героев MLBB; иконки режутся из публичных HD-портретов.
export const HEROES = [
  { id: 'aamon', name: "Aamon", roles: ['assassin'] },
  { id: 'akai', name: "Akai", roles: ['tank'] },
  { id: 'aldous', name: "Aldous", roles: ['fighter'] },
  { id: 'alice', name: "Alice", roles: ['tank', 'mage'] },
  { id: 'alpha', name: "Alpha", roles: ['fighter'] },
  { id: 'alucard', name: "Alucard", roles: ['fighter', 'assassin'] },
  { id: 'angela', name: "Angela", roles: ['support'] },
  { id: 'argus', name: "Argus", roles: ['fighter'] },
  { id: 'arlott', name: "Arlott", roles: ['fighter', 'assassin'] },
  { id: 'atlas', name: "Atlas", roles: ['tank'] },
  { id: 'aulus', name: "Aulus", roles: ['fighter'] },
  { id: 'aurora', name: "Aurora", roles: ['mage'] },
  { id: 'badang', name: "Badang", roles: ['fighter'] },
  { id: 'balmond', name: "Balmond", roles: ['fighter'] },
  { id: 'bane', name: "Bane", roles: ['fighter', 'mage'] },
  { id: 'barats', name: "Barats", roles: ['tank', 'fighter'] },
  { id: 'baxia', name: "Baxia", roles: ['tank'] },
  { id: 'beatrix', name: "Beatrix", roles: ['marksman'] },
  { id: 'belerick', name: "Belerick", roles: ['tank'] },
  { id: 'benedetta', name: "Benedetta", roles: ['fighter', 'assassin'] },
  { id: 'brody', name: "Brody", roles: ['marksman'] },
  { id: 'bruno', name: "Bruno", roles: ['marksman'] },
  { id: 'carmilla', name: "Carmilla", roles: ['tank', 'support'] },
  { id: 'cecilion', name: "Cecilion", roles: ['mage'] },
  { id: 'change', name: "Chang'e", roles: ['mage'] },
  { id: 'chip', name: "Chip", roles: ['tank', 'support'] },
  { id: 'chou', name: "Chou", roles: ['fighter'] },
  { id: 'cici', name: "Cici", roles: ['fighter'] },
  { id: 'claude', name: "Claude", roles: ['marksman'] },
  { id: 'clint', name: "Clint", roles: ['marksman'] },
  { id: 'cyclops', name: "Cyclops", roles: ['mage'] },
  { id: 'diggie', name: "Diggie", roles: ['support'] },
  { id: 'dyrroth', name: "Dyrroth", roles: ['fighter'] },
  { id: 'edith', name: "Edith", roles: ['tank', 'marksman'] },
  { id: 'esmeralda', name: "Esmeralda", roles: ['tank', 'mage'] },
  { id: 'estes', name: "Estes", roles: ['support'] },
  { id: 'eudora', name: "Eudora", roles: ['mage'] },
  { id: 'fanny', name: "Fanny", roles: ['assassin'] },
  { id: 'faramis', name: "Faramis", roles: ['mage', 'support'] },
  { id: 'floryn', name: "Floryn", roles: ['support'] },
  { id: 'franco', name: "Franco", roles: ['tank'] },
  { id: 'fredrinn', name: "Fredrinn", roles: ['tank', 'fighter'] },
  { id: 'freya', name: "Freya", roles: ['fighter'] },
  { id: 'gatotkaca', name: "Gatotkaca", roles: ['tank', 'fighter'] },
  { id: 'gloo', name: "Gloo", roles: ['tank'] },
  { id: 'gord', name: "Gord", roles: ['mage'] },
  { id: 'granger', name: "Granger", roles: ['marksman'] },
  { id: 'grock', name: "Grock", roles: ['tank', 'fighter'] },
  { id: 'guinevere', name: "Guinevere", roles: ['fighter'] },
  { id: 'gusion', name: "Gusion", roles: ['assassin'] },
  { id: 'hanabi', name: "Hanabi", roles: ['marksman'] },
  { id: 'hanzo', name: "Hanzo", roles: ['assassin'] },
  { id: 'harith', name: "Harith", roles: ['mage'] },
  { id: 'harley', name: "Harley", roles: ['assassin', 'mage'] },
  { id: 'hayabusa', name: "Hayabusa", roles: ['assassin'] },
  { id: 'helcurt', name: "Helcurt", roles: ['assassin'] },
  { id: 'hilda', name: "Hilda", roles: ['tank', 'fighter'] },
  { id: 'hirara', name: "Hirara", roles: ['assassin'] },
  { id: 'hylos', name: "Hylos", roles: ['tank'] },
  { id: 'irithel', name: "Irithel", roles: ['marksman'] },
  { id: 'ixia', name: "Ixia", roles: ['marksman'] },
  { id: 'jawhead', name: "Jawhead", roles: ['fighter'] },
  { id: 'johnson', name: "Johnson", roles: ['tank', 'support'] },
  { id: 'joy', name: "Joy", roles: ['assassin'] },
  { id: 'julian', name: "Julian", roles: ['fighter', 'assassin'] },
  { id: 'kadita', name: "Kadita", roles: ['assassin', 'mage'] },
  { id: 'kagura', name: "Kagura", roles: ['mage'] },
  { id: 'kaja', name: "Kaja", roles: ['fighter', 'support'] },
  { id: 'kalea', name: "Kalea", roles: ['fighter', 'support'] },
  { id: 'karina', name: "Karina", roles: ['assassin'] },
  { id: 'karrie', name: "Karrie", roles: ['marksman'] },
  { id: 'khaleed', name: "Khaleed", roles: ['fighter'] },
  { id: 'khufra', name: "Khufra", roles: ['tank'] },
  { id: 'kimmy', name: "Kimmy", roles: ['mage', 'marksman'] },
  { id: 'lancelot', name: "Lancelot", roles: ['assassin'] },
  { id: 'lapu-lapu', name: "Lapu-Lapu", roles: ['fighter'] },
  { id: 'layla', name: "Layla", roles: ['marksman'] },
  { id: 'leomord', name: "Leomord", roles: ['fighter'] },
  { id: 'lesley', name: "Lesley", roles: ['assassin', 'marksman'] },
  { id: 'ling', name: "Ling", roles: ['assassin'] },
  { id: 'lolita', name: "Lolita", roles: ['tank', 'support'] },
  { id: 'lukas', name: "Lukas", roles: ['fighter'] },
  { id: 'lunox', name: "Lunox", roles: ['mage'] },
  { id: 'luo-yi', name: "Luo Yi", roles: ['mage'] },
  { id: 'lylia', name: "Lylia", roles: ['mage'] },
  { id: 'marcel', name: "Marcel", roles: ['support'] },
  { id: 'martis', name: "Martis", roles: ['fighter'] },
  { id: 'masha', name: "Masha", roles: ['tank', 'fighter'] },
  { id: 'mathilda', name: "Mathilda", roles: ['assassin', 'support'] },
  { id: 'melissa', name: "Melissa", roles: ['marksman'] },
  { id: 'minotaur', name: "Minotaur", roles: ['tank', 'support'] },
  { id: 'minsitthar', name: "Minsitthar", roles: ['fighter'] },
  { id: 'miya', name: "Miya", roles: ['marksman'] },
  { id: 'moskov', name: "Moskov", roles: ['marksman'] },
  { id: 'nana', name: "Nana", roles: ['mage'] },
  { id: 'natalia', name: "Natalia", roles: ['assassin'] },
  { id: 'natan', name: "Natan", roles: ['marksman'] },
  { id: 'nolan', name: "Nolan", roles: ['assassin'] },
  { id: 'novaria', name: "Novaria", roles: ['mage'] },
  { id: 'obsidia', name: "Obsidia", roles: ['marksman'] },
  { id: 'odette', name: "Odette", roles: ['mage'] },
  { id: 'paquito', name: "Paquito", roles: ['fighter', 'assassin'] },
  { id: 'pharsa', name: "Pharsa", roles: ['mage'] },
  { id: 'phoveus', name: "Phoveus", roles: ['fighter'] },
  { id: 'popol-and-kupa', name: "Popol and Kupa", roles: ['marksman'] },
  { id: 'rafaela', name: "Rafaela", roles: ['support'] },
  { id: 'roger', name: "Roger", roles: ['fighter', 'marksman'] },
  { id: 'ruby', name: "Ruby", roles: ['fighter'] },
  { id: 'saber', name: "Saber", roles: ['assassin'] },
  { id: 'selena', name: "Selena", roles: ['assassin', 'mage'] },
  { id: 'silvanna', name: "Silvanna", roles: ['fighter'] },
  { id: 'sora', name: "Sora", roles: ['fighter', 'assassin'] },
  { id: 'sun', name: "Sun", roles: ['fighter'] },
  { id: 'suyou', name: "Suyou", roles: ['fighter', 'assassin'] },
  { id: 'terizla', name: "Terizla", roles: ['tank', 'fighter'] },
  { id: 'thamuz', name: "Thamuz", roles: ['fighter'] },
  { id: 'tigreal', name: "Tigreal", roles: ['tank'] },
  { id: 'uranus', name: "Uranus", roles: ['tank'] },
  { id: 'vale', name: "Vale", roles: ['mage'] },
  { id: 'valentina', name: "Valentina", roles: ['mage'] },
  { id: 'valir', name: "Valir", roles: ['mage'] },
  { id: 'vexana', name: "Vexana", roles: ['mage'] },
  { id: 'wanwan', name: "Wanwan", roles: ['marksman'] },
  { id: 'x-borg', name: "X.Borg", roles: ['fighter'] },
  { id: 'xavier', name: "Xavier", roles: ['mage'] },
  { id: 'yi-sun-shin', name: "Yi Sun-shin", roles: ['assassin', 'marksman'] },
  { id: 'yin', name: "Yin", roles: ['fighter', 'assassin'] },
  { id: 'yu-zhong', name: "Yu Zhong", roles: ['fighter'] },
  { id: 'yve', name: "Yve", roles: ['mage'] },
  { id: 'zetian', name: "Zetian", roles: ['mage'] },
  { id: 'zhask', name: "Zhask", roles: ['mage'] },
  { id: 'zhuxin', name: "Zhuxin", roles: ['mage'] },
  { id: 'zilong', name: "Zilong", roles: ['fighter', 'assassin'] },
]

// Соцсети профиля: в базе это text[] вида "vk:@nick" (провайдер + ник через
// двоеточие). Старые записи без ника — просто "vk" — читаются как привязанные,
// но без ника: их просим перепривязать в профиле.
export const SOCIAL_PROVIDERS = [
  { id: 'telegram', label: 'Telegram', placeholder: '@nickname', hint: 'Ник в Telegram, начинается с @' },
  { id: 'vk', label: 'VK', placeholder: 'vk.com/id123456', hint: 'Ссылка на страницу или короткое имя' },
  { id: 'google', label: 'Google', placeholder: 'name@gmail.com', hint: 'Почта Google-аккаунта' },
]

export const SOCIAL_IDS = SOCIAL_PROVIDERS.map((p) => p.id)

export const socialLabel = (id) => (SOCIAL_PROVIDERS.find((p) => p.id === id) || {}).label || id

// "vk:@durov" -> { provider: 'vk', handle: '@durov' }
export function parseSocial(entry) {
  const raw = String(entry || '').trim()
  const idx = raw.indexOf(':')
  if (idx === -1) return { provider: raw.toLowerCase(), handle: '' }
  return { provider: raw.slice(0, idx).trim().toLowerCase(), handle: raw.slice(idx + 1).trim() }
}

export function formatSocial(provider, handle) {
  const id = String(provider || '').trim().toLowerCase()
  const nick = String(handle || '').trim()
  return nick ? `${id}:${nick}` : id
}

// Человеческая подпись: "Telegram · @nick" (без ника — "Telegram, ник не указан").
export function socialCaption(entry) {
  const { provider, handle } = parseSocial(entry)
  return handle ? `${socialLabel(provider)} · ${handle}` : `${socialLabel(provider)}, ник не указан`
}

export const boundSocials = (socials) => (socials || []).map(parseSocial)

// Фильтр героев по ролям (значения ролей — как в базе MLBB).
export const HERO_ROLE_FILTERS = [
  { id: 'all', label: 'Все', short: 'Все' },
  { id: 'tank', label: 'Танк', short: 'Танк' },
  { id: 'fighter', label: 'Боец', short: 'Боец' },
  { id: 'assassin', label: 'Убийца', short: 'Убийца' },
  { id: 'mage', label: 'Маг', short: 'Маг' },
  { id: 'marksman', label: 'Стрелок', short: 'Стрелок' },
  { id: 'support', label: 'Саппорт', short: 'Саппорт' },
]

export const HERO_BY_NAME = Object.fromEntries(HEROES.map((h) => [h.name, h]))
export const HERO_ROLE_LABEL = Object.fromEntries(HERO_ROLE_FILTERS.map((r) => [r.id, r.label]))

// ------------------------------------------------------------------ game id
// В MLBB аккаунт = ID + сервер (зона). Раньше их писали одной строкой
// «123456789 (1234)», теперь это два отдельных поля — и в базе тоже.
export const GAME_ID_MAX = 12
export const GAME_SERVER_MAX = 6

export function normalizeGameId(value) {
  return String(value || '').replace(/[^0-9]/g, '').slice(0, GAME_ID_MAX)
}

export function normalizeServerId(value) {
  return String(value || '').replace(/[^0-9]/g, '').slice(0, GAME_SERVER_MAX)
}

// Разбирает составную строку из старых профилей: «123456789 (1234)».
export function splitCombinedGameId(value) {
  const raw = String(value || '').trim()
  const m = raw.match(/^([0-9]+)\s*[\(\s]\s*([0-9]{1,6})\)?$/)
  if (!m) return { gameId: normalizeGameId(raw), server: '' }
  return { gameId: normalizeGameId(m[1]), server: normalizeServerId(m[2]) }
}

// Как это видит игрок в самой игре и в боте.
export function formatGameId(gameId, server) {
  const id = String(gameId || '').trim()
  const zone = String(server || '').trim()
  if (!id) return ''
  if (!zone) return id
  return `${id} (${zone})`
}

export const DRAFT_FILTERS = ['ВСЕ', 'МИД', 'ЛЕС', 'РОУМ', 'БОЕЦ', 'СТРЕЛОК', 'ТАНК']

export const FEATURES = [
  {
    icon: 'swords',
    title: 'Честный драфт игроков',
    text: 'Два капитана с максимальным MMR по очереди собирают команды из общего пула. Жаловаться на подбор больше не на кого — ты драфтишь команду сам.',
  },
  {
    icon: 'server',
    title: 'Выбор игрового сервера',
    text: 'В MLBB нет выбора хоста. У нас можно выбрать один или несколько серверов с комфортным пингом — Москва, Краснодар, Европа и другие.',
  },
  {
    icon: 'bot',
    title: 'Автоматические лобби',
    text: 'Бот сам создаёт лобби в игре и отдаёт ID команды. После матча он парсит статистику и автоматически начисляет или списывает PTS.',
  },
  {
    icon: 'mic',
    title: 'Свой голосовой чат',
    text: 'Встроенный войс без VPN: микрофоны, муты, репорты и система слоу-приоритета для нарушителей.',
  },
  {
    icon: 'shield',
    title: 'Верификация и античит',
    text: 'Каждый игрок привязывает Game ID, а бот проверяет скриншоты внутриигровой статистики до публикации профиля.',
  },
  {
    icon: 'trophy',
    title: 'Рейтинг и зарплата топ-10',
    text: 'Сезонная таблица лидеров, обычная и про-лига, призы за топ-3 каждый месяц и премиум-оформление профиля.',
  },
]

export const STEPS = [
  { n: '01', title: 'Привяжи Game ID', text: 'Вход по почте и привязка Telegram-бота для уведомлений.' },
  { n: '02', title: 'Заполни профиль', text: 'Ранг, роли, серверы и скриншоты статистики — подбор по рейтингу.' },
  { n: '03', title: 'Драфт и лобби', text: 'Капитаны собирают команды, бот создаёт лобби и даёт ID.' },
  { n: '04', title: 'Играй и побеждай', text: 'Бот парсит результат, начисляет PTS и двигает тебя вверх по таблице.' },
]

// Чистый профиль: никаких предзаполненных данных — всё вводит сам пользователь
// через анкету. ELO и уровень начисляются сервером, в прототипе их нет.
export const DEFAULT_PROFILE = {
  nick: '',
  age: '',
  gender: '',
  rank: '',
  roles: [],
  regions: [],
  bio: '',
  heroClasses: [],
  heroes: [],
  elo: null,
  level: null,
  gameId: '',
  gameServer: '',
  extraSlots: 0,
  socials: [],
  avatar: null,
  avatarUrl: '',
  screenshots: [],
}
