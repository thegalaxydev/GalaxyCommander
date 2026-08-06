import { useEffect, useRef, useState } from 'react'
import type { ScryCard } from '../types'
import { searchCards, cardImage, legalOrUpcoming } from '../scryfall'
import {
  identityClause,
  type RulebreakerChoices,
  type RulebreakerMode,
} from '../rulebreaker'

interface Props {
  placeholder: string
  identity?: string[]
  /** Rulebreaker clauses that widen `identity`, if the commander has any. */
  rulebreaker?: RulebreakerMode | null
  rulebreakerChoices?: RulebreakerChoices | null
  exclude: string[]
  onPick: (card: ScryCard) => void
}

export function CardPicker({
  placeholder,
  identity,
  rulebreaker,
  rulebreakerChoices,
  exclude,
  onPick,
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ScryCard[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(async () => {
      const clean = query.trim().replace(/"/g, '')
      if (clean.length < 2) {
        setResults([])
        setLoading(false)
        return
      }
      setLoading(true)
      const idFilter = identity?.length
        ? ` ${identityClause(identity, rulebreaker, rulebreakerChoices)}`
        : ''
      const cards = await searchCards(`${legalOrUpcoming()}${idFilter} name:"${clean}"`, {
        order: 'edhrec',
        max: 8,
      }).catch(() => [] as ScryCard[])
      setResults(cards)
      setLoading(false)
      setOpen(true)
    }, 300)
    return () => clearTimeout(t)
  }, [query, identity, rulebreaker, rulebreakerChoices])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const visible = results.filter((c) => !exclude.includes(c.name) && c.type_line)

  return (
    <div className="commander-search card-picker" ref={boxRef}>
      <input
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => visible.length && setOpen(true)}
      />
      {open && (visible.length > 0 || loading) && (
        <div className="search-dropdown">
          {loading && <div className="search-loading">Searching...</div>}
          {visible.map((card) => (
            <div
              key={card.id}
              className="search-result"
              onClick={() => {
                onPick(card)
                setOpen(false)
                setQuery('')
                setResults([])
              }}
            >
              <img src={cardImage(card, 'art_crop')} alt="" />
              <div>
                <span>{(card.name ?? '').split(' //')[0]}</span>
                <small>{(card.type_line ?? '').split(' //')[0]}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
