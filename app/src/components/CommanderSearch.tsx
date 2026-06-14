import { useEffect, useRef, useState } from 'react'
import type { ScryCard } from '../types'
import { searchCommanders, searchCards, cardImage } from '../scryfall'
import { ColorPips } from './ManaCost'

const defaultsCache = new Map<string, ScryCard[]>()

interface Props {
  commander: ScryCard | null
  onSelect: (card: ScryCard) => void
  baseFilter?: string
  placeholder?: string
}

export function CommanderSearch({ commander, onSelect, baseFilter, placeholder }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ScryCard[]>([])
  const [defaults, setDefaults] = useState<ScryCard[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const filterKey = baseFilter ?? 'is:commander'
  const loadDefaults = async () => {
    setOpen(true)
    const cached = defaultsCache.get(filterKey)
    if (cached) {
      setDefaults(cached)
      return
    }
    setLoading(true)
    const cards = await searchCards(`${filterKey} legal:commander`, {
      order: 'edhrec',
      max: 10,
    }).catch(() => [] as ScryCard[])
    defaultsCache.set(filterKey, cards)
    setDefaults(cards)
    setLoading(false)
  }

  useEffect(() => {
    const t = setTimeout(async () => {
      if (query.trim().length < 2) {
        setResults([])
        setLoading(false)
        return
      }
      setLoading(true)
      const cards = await searchCommanders(query, baseFilter)
      setResults(cards)
      setLoading(false)
      setOpen(true)
    }, 300)
    return () => clearTimeout(t)
  }, [query, baseFilter])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div className="commander-search" ref={boxRef}>
      {commander ? (
        <div className="commander-chip" onClick={() => onSelect(commander)}>
          <img src={cardImage(commander, 'art_crop')} alt="" />
          <div>
            <strong>{commander.name.split(' //')[0]}</strong>
            <ColorPips identity={commander.color_identity} />
          </div>
          <button
            className="chip-clear"
            onClick={(e) => {
              e.stopPropagation()
              setQuery('')
              onSelect(null as unknown as ScryCard)
            }}
          >
            ×
          </button>
        </div>
      ) : (
        <input
          type="text"
          placeholder={placeholder ?? 'Search commander...'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => (query.trim().length < 2 ? loadDefaults() : results.length && setOpen(true))}
        />
      )}
      {open && !commander && (results.length > 0 || defaults.length > 0 || loading) && (
        <div className="search-dropdown">
          {loading && <div className="search-loading">Searching...</div>}
          {query.trim().length < 2 && defaults.length > 0 && !loading && (
            <div className="search-section">Popular right now</div>
          )}
          {(query.trim().length < 2 ? defaults : results).map((card) => (
            <div
              key={card.id}
              className="search-result"
              onClick={() => {
                onSelect(card)
                setOpen(false)
                setQuery('')
              }}
            >
              <img src={cardImage(card, 'art_crop')} alt="" />
              <div>
                <span>{card.name.split(' //')[0]}</span>
                <small>{card.type_line.split(' //')[0]}</small>
              </div>
              <ColorPips identity={card.color_identity} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
