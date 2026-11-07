// Fail closed: enable only for a tested, coordinated backend rollout.
// This client flag is not a security boundary; server permissions still apply.
export const TELEGRAM_SECURE_ENABLED = import.meta.env.VITE_TELEGRAM_SECURE_ENABLED === 'true'
