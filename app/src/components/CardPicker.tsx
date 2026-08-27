import { useEffect, useRef, useState } from 'react'
import type { ScryCard } from '../types'
import {
  searchCards,
  cardImage,
  legalOrUpcoming,
  isScrySyntax,
  sortByNameMatch,
} from '../scryfall'
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

/** How many results the dropdown shows — it scrolls past the first few. */
const LIMIT = 14

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
  const syntax = isScrySyntax(query.trim())

  useEffect(() => {
    const t = setTimeout(async () => {
      const raw = query.trim()
      const clean = raw.replace(/"/g, '')
      if (raw.length < 2) {
        setResults([])
        setLoading(false)
        return
      }
      setLoading(true)
      const idFilter = identity?.length
        ? ` ${identityClause(identity, rulebreaker, rulebreakerChoices)}`
        : ''
      const base = `${legalOrUpcoming()}${idFilter}`
      if (isScrySyntax(raw)) {
        // Scryfall syntax: hand the query straight through, only bounded by the
        // deck's legality/identity filters.
        const cards = await searchCards(`${base} (${raw})`, {
          order: 'edhrec',
          max: LIMIT,
        }).catch(() => [] as ScryCard[])
        setResults(cards)
      } else {
        // Plain text: a substring search plus an exact-name lookup, so a card
        // whose name is a common word ("Island") is always reachable even when
        // hundreds of longer names match and outrank it.
        const [matches, exact] = await Promise.all([
          searchCards(`${base} name:"${clean}"`, { order: 'edhrec', max: 60 }).catch(
            () => [] as ScryCard[]
          ),
          searchCards(`${base} !"${clean}"`, { order: 'edhrec', max: 1 }).catch(
            () => [] as ScryCard[]
          ),
        ])
        const merged = [...exact, ...matches]
        const seen = new Set<string>()
        const unique = merged.filter((c) => !seen.has(c.name) && seen.add(c.name))
        setResults(sortByNameMatch(unique, clean).slice(0, LIMIT))
      }
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
          {syntax && (
            <div className="search-syntax">Scryfall syntax search</div>
          )}
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
