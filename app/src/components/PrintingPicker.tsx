import { useEffect, useMemo, useState } from 'react'
import type { ScryCard } from '../types'
import { cardImage, cardPrice } from '../scryfall'
import { fetchPrintings } from '../printings'

interface Props {
  /** The printing currently in the deck — its art is highlighted in the grid. */
  card: ScryCard
  onPick: (printing: ScryCard) => void
  onClose: () => void
}

/** The treatments worth calling out when two printings share a set. */
const FRAME_NOTES: [string, string][] = [
  ['showcase', 'Showcase'],
  ['extendedart', 'Extended art'],
  ['etched', 'Etched'],
  ['inverted', 'Inverted'],
]

const PROMO_NOTES: [string, string][] = [
  ['borderless', 'Borderless'],
  ['fullart', 'Full art'],
  ['textured', 'Textured'],
  ['serialized', 'Serialized'],
  ['stepandcompleat', 'Step-and-compleat'],
]

function printingNote(card: ScryCard): string {
  const notes = [
    ...FRAME_NOTES.filter(([key]) => card.frame_effects?.includes(key)).map(([, label]) => label),
    ...PROMO_NOTES.filter(([key]) => card.promo_types?.includes(key)).map(([, label]) => label),
  ]
  return [...new Set(notes)].join(' · ')
}

export function PrintingPicker({ card, onPick, onClose }: Props) {
  const [prints, setPrints] = useState<ScryCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // Mounted fresh per card (call sites key on card.id), so the initial nulls
  // above are the loading state — nothing to reset here.
  useEffect(() => {
    let live = true
    fetchPrintings(card)
      .then((list) => {
        if (live) setPrints(list)
      })
      .catch(() => {
        if (live) setError('Could not load printings from Scryfall.')
      })
    return () => {
      live = false
    }
  }, [card])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !prints) return prints ?? []
    return prints.filter(
      (p) =>
        p.set_name?.toLowerCase().includes(q) ||
        p.set?.toLowerCase().includes(q) ||
        p.collector_number?.toLowerCase().includes(q)
    )
  }, [prints, query])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal printing-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Choose a printing — {card.name.split(' //')[0]}</h2>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <input
          className="deck-name-input printing-filter"
          placeholder="Filter by set name, code, or collector number..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {error && <p className="import-error">{error}</p>}
        {!prints && !error && <p className="hint pad">Loading printings…</p>}
        {prints && !shown.length && <p className="hint pad">No printings match that filter.</p>}
        <div className="printing-grid">
          {shown.map((p) => {
            const note = printingNote(p)
            const price = cardPrice(p)
            return (
              <button
                key={p.id}
                className={`printing-option ${p.id === card.id ? 'current' : ''}`}
                onClick={() => onPick(p)}
                title={`${p.set_name ?? p.set} #${p.collector_number}`}
              >
                <img src={cardImage(p, 'normal')} alt="" loading="lazy" />
                <span className="printing-set">
                  {p.set?.toUpperCase()} #{p.collector_number}
                </span>
                <small className="printing-name">{p.set_name}</small>
                {note && <small className="printing-note">{note}</small>}
                <small className="printing-price">{price > 0 ? `$${price.toFixed(2)}` : ''}</small>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
