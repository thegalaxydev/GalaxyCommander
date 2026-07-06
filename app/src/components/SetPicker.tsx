import { useEffect, useRef, useState } from 'react'
import type { SetInfo } from '../packs/types'

interface Props {
  sets: SetInfo[]
  selected: SetInfo | null
  onSelect: (set: SetInfo) => void
  disabled?: boolean
}

export function SetPicker({ sets, selected, onSelect, disabled }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? sets.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
    : sets
  const shown = filtered.slice(0, 40)

  return (
    <div className="commander-search set-picker" ref={boxRef}>
      <input
        type="text"
        disabled={disabled}
        placeholder="Search sets..."
        value={open ? query : selected ? `${selected.name} (${selected.code.toUpperCase()})` : query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          setQuery('')
          setOpen(true)
        }}
      />
      {open && (
        <div className="search-dropdown">
          {!shown.length && <div className="search-loading">No matching sets.</div>}
          {shown.map((set) => (
            <div
              key={set.code}
              className="search-result set-result"
              onClick={() => {
                onSelect(set)
                setOpen(false)
                setQuery('')
              }}
            >
              {set.icon_svg_uri && <img className="set-icon" src={set.icon_svg_uri} alt="" />}
              <div>
                <span>{set.name}</span>
                <small>
                  {set.code.toUpperCase()} · {set.released_at?.slice(0, 4)} · {set.card_count} cards
                </small>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
