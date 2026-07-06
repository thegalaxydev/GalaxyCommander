import type { PackStats, SetInfo } from '../packs/types'
import { favoriteSet, mostOpenedColor } from '../packs/stats'

const COLOR_LABELS: [string, string][] = [
  ['W', 'White'],
  ['U', 'Blue'],
  ['B', 'Black'],
  ['R', 'Red'],
  ['G', 'Green'],
  ['C', 'Colorless'],
  ['M', 'Multicolor'],
]

interface Props {
  stats: PackStats
  sets: SetInfo[]
}

export function PackStatsDash({ stats, sets }: Props) {
  const setName = (code: string) => sets.find((s) => s.code === code)?.name ?? code.toUpperCase()
  const fav = favoriteSet(stats)
  const maxColor = Math.max(1, ...Object.values(stats.byColor))
  const bySet = Object.entries(stats.bySet).sort((a, b) => b[1].packs - a[1].packs)

  const tiles: [string, string | number][] = [
    ['Packs opened', stats.packsOpened],
    ['Cards opened', stats.cardsOpened],
    ['Rares', stats.rares],
    ['Mythics', stats.mythics],
    ['Foils', stats.foils],
    ['Legendaries', stats.legendaries],
    ['Decks built', stats.decksBuilt],
    ['Favorite set', fav ? setName(fav) : '—'],
    ['Top color', mostOpenedColor(stats) ?? '—'],
  ]

  if (!stats.packsOpened) {
    return <p className="hint">Open some packs to see your statistics.</p>
  }

  return (
    <div className="pack-stats-dash">
      <div className="pack-stat-tiles">
        {tiles.map(([label, value]) => (
          <div key={label} className="pack-stat-tile">
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
        {stats.bestPull && (
          <div className="pack-stat-tile best-pull">
            <strong>${stats.bestPull.price.toFixed(2)}</strong>
            <span>Best pull · {stats.bestPull.name}</span>
          </div>
        )}
      </div>

      <section>
        <h3>By Color</h3>
        <div className="curve">
          {COLOR_LABELS.map(([code, label]) => {
            const n = stats.byColor[code] ?? 0
            return (
              <div key={code} className="curve-row">
                <span className="curve-label pack-color-label">
                  {code === 'M' || code === 'C' ? (
                    <small>{code}</small>
                  ) : (
                    <i className={`ms ms-${code.toLowerCase()} ms-cost`} />
                  )}
                </span>
                <div className="curve-bar">
                  <div style={{ width: `${(n / maxColor) * 100}%` }} title={label} />
                </div>
                <span className="curve-num">{n}</span>
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <h3>By Set</h3>
        <div className="type-list">
          {bySet.map(([code, entry]) => (
            <div key={code} className="type-row">
              <span>{setName(code)}</span>
              <strong>
                {entry.packs} pack{entry.packs === 1 ? '' : 's'}
              </strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
