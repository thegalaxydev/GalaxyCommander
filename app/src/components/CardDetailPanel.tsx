import type { Deck, DeckCard } from '../types'
import { buildCardInsight } from '../cardInsight'
import { cardImage } from '../scryfall'
import { ManaCost } from './ManaCost'
import { SvgIcon } from './Icons'
import { CATEGORY_ICONS } from '../iconData'

export function CardDetailPanel({
  deck,
  card,
  onClose,
}: {
  deck: Deck
  card: DeckCard
  onClose: () => void
}) {
  const insight = buildCardInsight(deck, card)
  const img = cardImage(card.card, 'normal')

  return (
    <div className="card-detail-panel">
      <button type="button" className="card-detail-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      {img && <img className="card-detail-art" src={img} alt="" />}
      <h3>{insight.name}</h3>
      <p className="card-detail-meta">
        <SvgIcon name={CATEGORY_ICONS[card.category]} size={13} /> {insight.category}
        <ManaCost cost={card.card.mana_cost ?? card.card.card_faces?.[0]?.mana_cost ?? ''} />
        {insight.price > 0 && <span>${insight.price.toFixed(2)}</span>}
      </p>
      <h4>Why it&apos;s here</h4>
      <ul className="card-detail-bullets">
        {insight.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      {insight.reason && insight.reason !== insight.bullets[0] && (
        <p className="card-detail-reason">{insight.reason}</p>
      )}
    </div>
  )
}
