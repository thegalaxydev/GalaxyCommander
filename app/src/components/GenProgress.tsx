import type { GenStep } from '../types'

export function GenProgress({ steps }: { steps: GenStep[] }) {
  return (
    <div className="gen-steps">
      {steps.map((step) => (
        <div key={step.label} className={`gen-step ${step.status}`}>
          <span className="gen-dot" />
          {step.label}
        </div>
      ))}
    </div>
  )
}
