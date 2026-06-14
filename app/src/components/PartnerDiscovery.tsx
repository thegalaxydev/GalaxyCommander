import { useEffect, useState } from 'react'
import type { ScryCard } from '../types'
import { cardImage } from '../scryfall'
import { discoverPartners, type PartnerCandidate } from '../partners'

export function PartnerDiscovery({
  commander,
  partner,
  onSelect,
  disabled,
}: {
  commander: ScryCard
  partner: ScryCard | null
  onSelect: (card: ScryCard) => void
  disabled: boolean
}) {
  if (partner) return null

  return (
    <PartnerDiscoveryList
      key={commander.id}
      commander={commander}
      onSelect={onSelect}
      disabled={disabled}
    />
  )
}

function PartnerDiscoveryList({
  commander,
  onSelect,
  disabled,
}: {
  commander: ScryCard
  onSelect: (card: ScryCard) => void
  disabled: boolean
}) {
  const [loading, setLoading] = useState(true)
  const [candidates, setCandidates] = useState<PartnerCandidate[]>([])

  useEffect(() => {
    let cancelled = false
    discoverPartners(commander)
      .then((list) => {
        if (!cancelled) {
          setCandidates(list)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [commander])

  return (
    <section className="partner-discovery">
      <h3 className="partner-subhead">Popular on EDHREC</h3>
      {loading && <p className="hint">Loading EDHREC pair data...</p>}
      {!loading && candidates.length === 0 && (
        <p className="hint">No EDHREC pair stats found yet. Search manually above.</p>
      )}
      <div className="partner-grid">
        {candidates.map(({ card, deckCount, avgPrice }) => (
          <button
            key={card.name}
            type="button"
            className="partner-chip"
            disabled={disabled}
            onClick={() => onSelect(card)}
          >
            {cardImage(card, 'art_crop') && (
              <img src={cardImage(card, 'art_crop')} alt="" />
            )}
            <span className="partner-chip-body">
              <strong>{card.name.split(' //')[0]}</strong>
              <small>{deckCount.toLocaleString()} EDHREC decks</small>
              {avgPrice > 0 && <small>${Math.round(avgPrice)} avg</small>}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
