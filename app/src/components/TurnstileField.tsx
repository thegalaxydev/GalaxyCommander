import { useEffect, useRef, useState } from 'react'
import { fetchCaptchaConfig, mountTurnstile } from '../auth/captcha'

export function TurnstileField({
  onToken,
  onReady,
}: {
  onToken: (token: string | null) => void
  onReady?: (enabled: boolean) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(onToken)
  const onReadyRef = useRef(onReady)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    onTokenRef.current = onToken
    onReadyRef.current = onReady
  })

  useEffect(() => {
    let cleanup: (() => void) | undefined
    let cancelled = false

    void (async () => {
      try {
        const config = await fetchCaptchaConfig()
        if (cancelled) return
        onReadyRef.current?.(config.enabled)
        if (!config.enabled || !config.siteKey || !containerRef.current) {
          onTokenRef.current(null)
          setLoading(false)
          return
        }
        cleanup = await mountTurnstile(containerRef.current, config.siteKey, (token) => {
          onTokenRef.current(token)
        })
      } catch {
        if (!cancelled) {
          onReadyRef.current?.(false)
          onTokenRef.current(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])

  return (
    <div className="turnstile-field">
      <div ref={containerRef} />
      {loading && <small className="auth-field-hint">Loading captcha…</small>}
    </div>
  )
}
