export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4
  label: string
  percent: number
}

export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: '', percent: 0 }

  const hasLength = password.length >= 8
  const hasUpper = /[A-Z]/.test(password)
  const hasNumber = /[0-9]/.test(password)
  const hasExtra = password.length >= 12 || /[^a-zA-Z0-9]/.test(password)

  const met = [hasLength, hasUpper, hasNumber].filter(Boolean).length

  if (met === 3 && hasExtra) return { score: 4, label: 'Strong', percent: 100 }
  if (met === 3) return { score: 3, label: 'Good', percent: 75 }
  if (met === 2) return { score: 2, label: 'Fair', percent: 50 }
  if (met >= 1 || password.length >= 4) return { score: 1, label: 'Weak', percent: 25 }
  return { score: 0, label: 'Too weak', percent: 8 }
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.'
  if (!/[A-Z]/.test(password)) return 'Password must include at least one capital letter.'
  if (!/[0-9]/.test(password)) return 'Password must include at least one number.'
  return null
}

export function validateEmail(email: string): string | null {
  const trimmed = email.trim()
  if (!trimmed) return 'Email is required.'
  if (trimmed.length > 254) return 'Email is too long.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'Enter a valid email address.'
  return null
}

export function isSameUsername(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export function validateUsername(username: string): string | null {
  const trimmed = username.trim()
  if (trimmed.length < 3) return 'Username must be at least 3 characters.'
  if (trimmed.length > 24) return 'Username must be 24 characters or fewer.'
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) return 'Username can only use letters, numbers, and underscores.'
  const lower = trimmed.toLowerCase()
  if (
    lower === 'admin' ||
    lower === 'api' ||
    lower === 'login' ||
    lower === 'register' ||
    lower === 'users' ||
    lower === 'me' ||
    lower === 'settings' ||
    lower === 'support'
  ) {
    return 'That username is reserved.'
  }
  return null
}
