// Public bot username can differ between production and isolated staging.
// Only accept Telegram username characters so it cannot alter a deep link.
export function telegramBotUsername(value) {
  const username = typeof value === 'string' ? value.trim().replace(/^@/, '') : ''
  return /^[A-Za-z0-9_]{5,32}$/.test(username) && /bot$/i.test(username)
    ? username
    : 'name_mlbb_bot'
}
