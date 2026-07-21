type TurnstileOptions = {
  sitekey: string
  callback?: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
  theme?: 'light' | 'dark' | 'auto'
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileOptions) => string
      remove: (widgetId: string) => void
      reset: (widgetId: string) => void
    }
  }
}

const SCRIPT_ID = 'cf-turnstile-script'
let scriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Could not load captcha.')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load captcha.'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

export type CaptchaConfig = {
  enabled: boolean
  siteKey: string | null
}

export async function fetchCaptchaConfig(): Promise<CaptchaConfig> {
  const res = await fetch('/api/auth/captcha-config')
  if (!res.ok) return { enabled: false, siteKey: null }
  return (await res.json()) as CaptchaConfig
}

export async function mountTurnstile(
  container: HTMLElement,
  siteKey: string,
  onToken: (token: string | null) => void
): Promise<() => void> {
  await loadTurnstileScript()
  if (!window.turnstile) throw new Error('Could not load captcha.')

  const widgetId = window.turnstile.render(container, {
    sitekey: siteKey,
    theme: 'auto',
    callback: (token) => onToken(token),
    'expired-callback': () => onToken(null),
    'error-callback': () => onToken(null),
  })

  return () => {
    window.turnstile?.remove(widgetId)
    container.replaceChildren()
  }
}

export function resetTurnstile(container: HTMLElement, siteKey: string, onToken: (token: string | null) => void) {
  void mountTurnstile(container, siteKey, onToken)
}
