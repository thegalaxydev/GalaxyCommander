import { passwordStrength } from '../auth/validation'

export function PasswordStrengthBar({ password }: { password: string }) {
  const strength = passwordStrength(password)
  if (!password) return null

  return (
    <div className="pw-strength" aria-live="polite">
      <div className="pw-strength-track">
        <div
          className={`pw-strength-fill s${strength.score}`}
          style={{ width: `${strength.percent}%` }}
        />
      </div>
      <span className={`pw-strength-label s${strength.score}`}>{strength.label}</span>
    </div>
  )
}
