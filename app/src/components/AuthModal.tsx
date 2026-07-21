import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { validateEmail, validatePassword, validateUsername } from '../auth/validation'
import { PasswordStrengthBar } from './PasswordStrengthBar'
import { TurnstileField } from './TurnstileField'

type Mode = 'signin' | 'signup' | 'forgot'

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signIn, signUp, forgotPassword } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [usernameHint, setUsernameHint] = useState<string | null>(null)
  const [usernameOk, setUsernameOk] = useState<boolean | null>(null)
  const [emailHint, setEmailHint] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaRequired, setCaptchaRequired] = useState(false)
  const [captchaKey, setCaptchaKey] = useState(0)

  useEffect(() => {
    if (!open || !email.trim()) {
      setEmailHint(null)
      return
    }
    setEmailHint(validateEmail(email))
  }, [email, open])

  useEffect(() => {
    if (mode !== 'signup' || !open) return
    const trimmed = username.trim()
    const formatErr = validateUsername(trimmed)
    if (formatErr) {
      setUsernameHint(formatErr)
      setUsernameOk(null)
      return
    }
    setUsernameHint(null)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/auth/is-username-available', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: trimmed }),
        })
        const data = (await res.json()) as { available?: boolean }
        if (data.available) {
          setUsernameOk(true)
          setUsernameHint('Username is available.')
        } else {
          setUsernameOk(false)
          setUsernameHint('That username is already taken.')
        }
      } catch {
        setUsernameOk(null)
        setUsernameHint(null)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [username, mode, open])

  if (!open) return null

  const resetForm = () => {
    setError(null)
    setMessage(null)
    setUsernameHint(null)
    setUsernameOk(null)
    setEmailHint(null)
    setCaptchaToken(null)
    setCaptchaKey((k) => k + 1)
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const emailErr = validateEmail(email)
      if (emailErr) throw new Error(emailErr)

      if (mode === 'signin') {
        await signIn(email.trim(), password)
        onClose()
      } else if (mode === 'signup') {
        const userErr = validateUsername(username)
        if (userErr) throw new Error(userErr)
        if (usernameOk === false) throw new Error('That username is already taken.')
        const passErr = validatePassword(password)
        if (passErr) throw new Error(passErr)
        if (captchaRequired && !captchaToken) throw new Error('Please complete the captcha.')
        await signUp(username.trim(), email.trim(), password, captchaToken)
        onClose()
      } else {
        await forgotPassword(email.trim())
        setMessage('If that email exists, a reset link was sent.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      if (mode === 'signup') {
        setCaptchaToken(null)
        setCaptchaKey((k) => k + 1)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal auth-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Reset password' : 'Sign in'}</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="auth-form">
          {mode === 'signup' && (
            <label className="settings-field">
              <span>Username</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
                autoComplete="username"
                spellCheck={false}
              />
              {usernameHint && (
                <small className={usernameOk ? 'auth-field-ok' : usernameOk === false ? 'auth-field-bad' : 'auth-field-hint'}>
                  {usernameHint}
                </small>
              )}
            </label>
          )}
          <label className="settings-field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            {emailHint && <small className="auth-field-bad">{emailHint}</small>}
          </label>
          {mode !== 'forgot' && (
            <label className="settings-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
              {mode === 'signup' && <PasswordStrengthBar password={password} />}
              {mode === 'signup' && !password && (
                <small className="auth-field-hint">
                  At least 8 characters, one capital letter, and one number.
                </small>
              )}
            </label>
          )}
          {mode === 'signup' && (
            <TurnstileField
              key={captchaKey}
              onReady={setCaptchaRequired}
              onToken={setCaptchaToken}
            />
          )}
          {error && <p className="auth-error">{error}</p>}
          {message && <p className="auth-message">{message}</p>}
          <button type="button" className="generate-btn auth-submit" disabled={busy} onClick={submit}>
            {busy ? 'Please wait…' : mode === 'signup' ? 'Sign up' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
          </button>
          <div className="auth-links">
            {mode === 'signin' && (
              <>
                <button type="button" className="link-btn" onClick={() => { setMode('signup'); resetForm() }}>
                  Create account
                </button>
                <button type="button" className="link-btn" onClick={() => { setMode('forgot'); resetForm() }}>
                  Forgot password?
                </button>
              </>
            )}
            {mode !== 'signin' && (
              <button type="button" className="link-btn" onClick={() => { setMode('signin'); resetForm() }}>
                Back to sign in
              </button>
            )}
          </div>
          <p className="hint auth-hint">
            Signed-in decks, pack collection, stats, and achievements sync to your account. Logged out, data stays in this browser only.
          </p>
        </div>
      </div>
    </div>
  )
}
