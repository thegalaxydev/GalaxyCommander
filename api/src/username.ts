import { hasProfanity } from './profanity.js'

export const RESERVED_USERNAMES = new Set([
  'admin',
  'api',
  'login',
  'register',
  'users',
  'me',
  'settings',
  'support',
])

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

export function isSameUsername(a: string, b: string): boolean {
  return normalizeUsername(a) === normalizeUsername(b)
}

export const USERNAME_CHANGE_COOLDOWN_DAYS = 30
export const USERNAME_CHANGE_COOLDOWN_MS = USERNAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000

export function validateUsername(username: string): string | null {
  const trimmed = username.trim()
  if (trimmed.length < 3) return 'Username must be at least 3 characters.'
  if (trimmed.length > 24) return 'Username must be 24 characters or fewer.'
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return 'Username can only use letters, numbers, and underscores.'
  }
  if (RESERVED_USERNAMES.has(normalizeUsername(trimmed))) {
    return 'That username is reserved.'
  }
  if (hasProfanity(trimmed)) {
    return "That username isn't allowed."
  }
  return null
}
