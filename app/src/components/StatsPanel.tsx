import type { DeckCard } from '../types'
import { curveBuckets, deckPrice, totalCards, typeCounts } from '../analysis'
import { SvgIcon } from './Icons'
import { CATEGORY_ICONS } from '../iconData'

const CURVE_ICONS = ['1', '2', '3', '4', '5', '6']

export function StatsPanel({ cards }: { cards: DeckCard[] }) {
  const total = totalCards(cards)
  const curve = curveBuckets(cards)
  const maxCurve = Math.max(1, ...curve)
  const types = typeCounts(cards).filter((t) => t.category !== 'Commander')
  const price = deckPrice(cards)

  return (
    <div className="stats-panel">
      <div className="stats-count">
        <strong>{total}</strong> / 100 Cards
        <div className="stats-count-bar">
          <div style={{ width: `${Math.min(100, total)}%` }} />
        </div>
      </div>

      <section>
        <h3>Mana Curve</h3>
        <div className="curve">
          {curve.map((n, i) => (
            <div key={i} className="curve-row">
              <span className="curve-label">
                <SvgIcon name={CURVE_ICONS[i]} size={13} />
                {i === 5 ? '+' : ''}
              </span>
              <div className="curve-bar">
                <div style={{ width: `${(n / maxCurve) * 100}%` }} />
              </div>
              <span className="curve-num">{n}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>Card Types</h3>
        <div className="type-list">
          {types.map((t) => (
            <div key={t.category} className="type-row">
              <span>
                <SvgIcon name={CATEGORY_ICONS[t.category]} size={13} className="type-icon" />
                {t.category}
              </span>
              <strong>{t.count}</strong>
            </div>
          ))}
          {!types.length && <p className="hint">Generate a deck to see the breakdown.</p>}
        </div>
      </section>

      <section>
        <h3>Estimated Budget</h3>
        <div className="stats-price">${price.toFixed(0)}</div>
      </section>
    </div>
  )
}
