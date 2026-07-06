import { ACHIEVEMENTS, type UnlockedMap } from '../packs/achievements'
import type { PackStats } from '../packs/types'

interface Props {
  unlocked: UnlockedMap
  stats: PackStats
}

export function PackAchievements({ unlocked, stats }: Props) {
  return (
    <div className="pack-achievements">
      {ACHIEVEMENTS.map((def) => {
        const ts = unlocked.unlocked[def.id]
        const prog = !ts && def.progress ? def.progress(stats) : null
        return (
          <div key={def.id} className={`achievement-card${ts ? ' unlocked' : ''}`}>
            <span className="achievement-icon">{def.icon}</span>
            <div className="achievement-body">
              <strong>{def.name}</strong>
              <small>{def.desc}</small>
              {ts ? (
                <small className="achievement-date">
                  Unlocked {new Date(ts).toLocaleDateString()}
                </small>
              ) : prog ? (
                <div className="achievement-progress">
                  <div
                    style={{ width: `${Math.min(100, (prog.have / prog.need) * 100)}%` }}
                  />
                  <span>
                    {Math.min(prog.have, prog.need)}/{prog.need}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
