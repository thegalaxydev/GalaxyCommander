const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export function captchaEnabled(): boolean {
  return !!(process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY)
}

export function captchaSiteKey(): string | null {
  return process.env.TURNSTILE_SITE_KEY ?? null
}

export async function verifyCaptchaToken(token: string, remoteIp?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true

  if (!token) return false

  const res = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret,
      response: token,
      remoteip: remoteIp || undefined,
    }),
  })

  if (!res.ok) return false

  const data = (await res.json()) as { success?: boolean }
  return data.success === true
}
