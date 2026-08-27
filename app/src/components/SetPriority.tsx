import { useEffect, useRef, useState } from 'react'
import type { SetInfo } from '../packs/types'
import { fetchAllSets } from '../printings'

interface Props {
  /** Set codes, highest priority first. */
  value: string[]
  onChange: (codes: string[]) => void
  disabled?: boolean
}

export function SetPriority({ value, onChange, disabled }: Props) {
  const [sets, setSets] = useState<SetInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    fetchAllSets()
      .then((list) => live && setSets(list))
      .catch(() => live && setError('Could not load the set list from Scryfall.'))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const byCode = new Map(sets.map((s) => [s.code.toLowerCase(), s]))
  const chosen = new Set(value.map((c) => c.toLowerCase()))
  const q = query.trim().toLowerCase()
  const shown = sets
    .filter((s) => !chosen.has(s.code.toLowerCase()))
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
    .slice(0, 40)

  const add = (code: string) => {
    onChange([...value, code.toUpperCase()])
    setQuery('')
    setOpen(false)
  }

  const remove = (code: string) => onChange(value.filter((c) => c !== code))

  const move = (index: number, delta: number) => {
    const next = [...value]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <div className="set-priority">
      <div className="commander-search set-picker" ref={boxRef}>
        <input
          type="text"
          disabled={disabled}
          placeholder="Search a set to prefer..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
        />
        {open && (
          <div className="search-dropdown">
            {error && <div className="search-loading">{error}</div>}
            {!error && !sets.length && <div className="search-loading">Loading sets…</div>}
            {!error && sets.length > 0 && !shown.length && (
              <div className="search-loading">No matching sets.</div>
            )}
            {shown.map((set) => (
              <div
                key={set.code}
                className="search-result set-result"
                onClick={() => add(set.code)}
              >
                {set.icon_svg_uri && <img className="set-icon" src={set.icon_svg_uri} alt="" />}
                <div>
                  <span>{set.name}</span>
                  <small>
                    {set.code.toUpperCase()} · {set.released_at?.slice(0, 4)}
                  </small>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {value.length > 0 && (
        <ol className="set-priority-list">
          {value.map((code, i) => {
            const info = byCode.get(code.toLowerCase())
            return (
              <li key={code}>
                <span className="set-priority-rank">{i + 1}</span>
                {info?.icon_svg_uri && <img className="set-icon" src={info.icon_svg_uri} alt="" />}
                <span className="set-priority-name">{info?.name ?? code}</span>
                <span className="set-priority-code">{code}</span>
                <button
                  type="button"
                  title="Higher priority"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  title="Lower priority"
                  disabled={i === value.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button type="button" title="Remove" onClick={() => remove(code)}>
                  ×
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
