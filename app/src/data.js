// Справочные данные приложения — соответствуют макету из видео-презентации заказчика.

export const RANKS = [
  'Warrior', 'Elite', 'Master', 'Grandmaster', 'Epic', 'Legend', 'Mythic', 'Mythical Glory',
]

export const ROLES = ['Лесник', 'Маг', 'Стрелок', 'Боец', 'Танк', 'Поддержка']

export const REGIONS = [
  'Москва', 'Европа', 'Краснодар', 'Новосибирск', 'Беларусь', 'Казахстан', 'Узбекистан',
]

export const HERO_CLASSES = ['Танк', 'Боец', 'Убийца', 'Маг', 'Стрелок', 'Саппорт']

export const HEROES = [
  'Miya', 'Balmond', 'Saber', 'Nana', 'Tigreal', 'Alucard', 'Karina', 'Akai',
  'Franco', 'Bane', 'Bruno', 'Clint', 'Rafaela', 'Eudora', 'Zilong', 'Fanny',
  'Layla', 'Chou', 'Gord', 'Kagura', 'Lancelot', 'Lesley', 'Ling', 'Wanwan',
]

export const CAPTAINS = {
  A: { id: 'SP', nick: 's1mple_pro', mmr: 2890, color: '#ff6a1a' },
  B: { id: 'MG', nick: 'mONESY_god', mmr: 2940, color: '#f0334f' },
}

export const DRAFT_POOL = [
  { id: 'NC', nick: 'NightStalker_CIS', elo: 2740, role: 'Мид', winrate: 64, kda: 4.8 },
  { id: 'VX', nick: 'Valkyrie_X', elo: 2715, role: 'Лес', winrate: 67, kda: 5.6 },
  { id: 'BO', nick: 'BlinkDagger_00', elo: 2680, role: 'Роум', winrate: 61, kda: 4.1 },
  { id: 'IM', nick: 'IceFrog_M', elo: 2640, role: 'Боец', winrate: 59, kda: 3.9 },
  { id: 'C9', nick: 'CyberNova', elo: 2630, role: 'Мид', winrate: 63, kda: 4.7 },
  { id: 'RR', nick: 'RektMachi...', elo: 2595, role: 'Боец', winrate: 60, kda: 3.7 },
  { id: 'BS', nick: 'BlackShark_08', elo: 2580, role: 'Танк', winrate: 58, kda: 3.5 },
  { id: 'CN', nick: 'CyberNinja', elo: 2560, role: 'Стрелок', winrate: 62, kda: 4.2 },
]

export const DRAFT_FILTERS = ['ВСЕ', 'МИД', 'ЛЕС', 'РОУМ', 'БОЕЦ', 'СТРЕЛОК', 'ТАНК']

export const MATCH_TEAM = [
  { id: 'G', nick: 'Geass', role: 'Лесник' },
  { id: 'K', nick: 'Kairo', role: 'Маг' },
  { id: 'H', nick: 'Holt', role: 'Танк' },
  { id: 'V', nick: 'Vexx', role: 'Стрелок' },
  { id: 'N', nick: 'Nyra', role: 'Поддержка' },
]

export const LEADERBOARDS = {
  Сезон: [
    { nick: 'Geass', elo: 3120, prize: '20 000 ₽ / мес', pro: true },
    { nick: 'Zenith', elo: 3045, prize: '12 000 ₽ / мес', pro: true },
    { nick: 'Kairo', elo: 2990, prize: '7 000 ₽ / мес', pro: true },
    { nick: 'Vexx', elo: 2930 }, { nick: 'Holt', elo: 2885 }, { nick: 'Nyra', elo: 2840 },
    { nick: 'Drako', elo: 2810 }, { nick: 'Lumen', elo: 2775 }, { nick: 'Sora', elo: 2740 },
    { nick: 'Riven', elo: 2715 }, { nick: 'Nova', elo: 2690 }, { nick: 'Blaze', elo: 2665 },
  ],
  Месяц: [
    { nick: 'Zenith', elo: 3180, prize: '20 000 ₽ / мес', pro: true },
    { nick: 'Geass', elo: 3105, prize: '12 000 ₽ / мес', pro: true },
    { nick: 'Sora', elo: 3010, prize: '7 000 ₽ / мес', pro: true },
    { nick: 'Kairo', elo: 2975 }, { nick: 'Nova', elo: 2910 }, { nick: 'Vexx', elo: 2870 },
    { nick: 'Blaze', elo: 2835 }, { nick: 'Holt', elo: 2800 }, { nick: 'Riven', elo: 2760 },
    { nick: 'Lumen', elo: 2720 },
  ],
  Друзья: [
    { nick: 'Geass', elo: 3120, prize: '20 000 ₽ / мес', pro: true, me: true },
    { nick: 'Holt', elo: 2885 }, { nick: 'Vexx', elo: 2930 }, { nick: 'Drako', elo: 2810 },
    { nick: 'Nova', elo: 2690 }, { nick: 'Lumen', elo: 2775 },
  ],
}

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
  { n: '01', title: 'Привяжи Game ID', text: 'Быстрый вход через Telegram, VK, Google или Facebook.' },
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
  extraSlots: 0,
  socials: [],
  avatar: null,
  avatarUrl: '',
  screenshots: [],
}
