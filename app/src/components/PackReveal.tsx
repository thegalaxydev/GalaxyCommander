import { useEffect, useRef, useState } from 'react'
import type { ScryCard } from '../types'
import { cardImage, cardPrice } from '../scryfall'
import { isLegendaryCreature } from '../packs/setPool'
import type { OpenedCard } from '../packs/types'

interface Props {
  cards: OpenedCard[]
  packNumber: number
  packCount: number
  onNext?: () => void
  onDone: () => void
  onBuildDeck?: (commander: ScryCard) => void
  autoFlip?: boolean
  disablePreviews?: boolean
}

function treatmentClass(card: ScryCard): string {
  const effects = card.frame_effects ?? []
  const promos = card.promo_types ?? []
  if (effects.includes('showcase') || effects.includes('extendedart') || promos.includes('boosterfun')) {
    return ' treatment-special'
  }
  return ''
}

export function PackReveal({
  cards,
  packNumber,
  packCount,
  onNext,
  onDone,
  onBuildDeck,
  autoFlip,
  disablePreviews,
}: Props) {
  // Parents remount this component (via key) for each new pack, so flip
  // state only needs to initialize once.
  const [flipped, setFlipped] = useState<boolean[]>(() => cards.map(() => !!autoFlip))
  const [hover, setHover] = useState<{ src: string; x: number; y: number } | null>(null)
  const timers = useRef<number[]>([])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((t) => window.clearTimeout(t))
  }, [])

  const allFlipped = flipped.every(Boolean)

  const flipOne = (i: number) =>
    setFlipped((f) => (f[i] ? f : f.map((v, j) => (j === i ? true : v))))

  const flipAll = () => {
    cards.forEach((_, i) => {
      const t = window.setTimeout(() => flipOne(i), i * 60)
      timers.current.push(t)
    })
  }

  const moveHover = (card: ScryCard, e: React.MouseEvent) => {
    if (disablePreviews) return
    const src = cardImage(card, 'normal')
    if (!src) return
    const x = Math.min(e.clientX + 18, window.innerWidth - 270)
    const y = Math.min(Math.max(e.clientY - 170, 8), window.innerHeight - 360)
    setHover({ src, x, y })
  }

  const rares = cards.filter((c) => c.card.rarity === 'rare' || c.card.rarity === 'mythic')
  const foils = cards.filter((c) => c.foil)
  const value = cards.reduce((n, c) => n + cardPrice(c.card), 0)
  const legendaries = allFlipped
    ? cards.filter((c, i) => isLegendaryCreature(c.card) && cards.findIndex((o) => o.card.id === c.card.id) === i)
    : []

  return (
    <div className="pack-reveal">
      <div className="pack-reveal-bar">
        <span className="pack-reveal-title">
          Pack {packNumber} of {packCount}
        </span>
        {!allFlipped && (
          <button type="button" className="new-build" onClick={flipAll}>
            Flip All
          </button>
        )}
        {allFlipped && onNext && (
          <button type="button" className="new-build" onClick={onNext}>
            Next Pack →
          </button>
        )}
        {allFlipped && !onNext && (
          <button type="button" className="new-build" onClick={onDone}>
            Done
          </button>
        )}
      </div>
      <div className="pack-grid">
        {cards.map(({ card, foil }, i) => {
          const rarity = card.rarity ?? 'common'
          const glow = flipped[i]
            ? rarity === 'mythic'
              ? ' glow-mythic'
              : rarity === 'rare'
                ? ' glow-rare'
                : ''
            : ''
          return (
            <div
              key={`${card.id}-${i}`}
              className={`pack-card${flipped[i] ? ' flipped' : ''}${glow}${flipped[i] ? treatmentClass(card) : ''}`}
              onClick={() => flipOne(i)}
              onMouseEnter={(e) => flipped[i] && moveHover(card, e)}
              onMouseMove={(e) => flipped[i] && moveHover(card, e)}
              onMouseLeave={() => setHover(null)}
            >
              <div className="pack-card-inner">
                <div className="pack-card-back">
                  <img src="/icon.png" alt="" />
                </div>
                <div className="pack-card-front">
                  <img src={cardImage(card, 'normal')} alt={card.name} loading="lazy" />
                  {foil && <div className="foil-shimmer" />}
                  {foil && <span className="foil-badge">✦</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {allFlipped && (
        <div className="pack-summary">
          <div className="pack-summary-stats">
            <span>
              <strong>{rares.length}</strong> rare{rares.length === 1 ? '' : 's'}+
            </span>
            <span>
              <strong>{foils.length}</strong> foil{foils.length === 1 ? '' : 's'}
            </span>
            <span>
              ~<strong>${value.toFixed(2)}</strong>
            </span>
          </div>
          {onBuildDeck && legendaries.length > 0 && (
            <div className="pack-summary-legends">
              {legendaries.map(({ card }) => (
                <button
                  key={card.id}
                  type="button"
                  className="legend-build-btn"
                  onClick={() => onBuildDeck(card)}
                  title={`Build a Commander deck around ${card.name}`}
                >
                  ★ Build Deck: {card.name.split(' //')[0]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {hover && <img className="card-preview" src={hover.src} style={{ left: hover.x, top: hover.y }} alt="" />}
    </div>
  )
}
