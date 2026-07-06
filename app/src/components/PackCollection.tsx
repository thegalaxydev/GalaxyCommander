import { useMemo, useState } from 'react'
import type { Collection } from '../packs/collectionStore'
import { collectionSize, ownedBySet, uniqueOwned } from '../packs/collectionStore'
import type { CardMeta, SetInfo } from '../packs/types'

const PAGE_SIZE = 60
const RARITY_ORDER: Record<string, number> = { mythic: 0, rare: 1, uncommon: 2, common: 3 }

interface Props {
  collection: Collection
  meta: Record<string, CardMeta>
  sets: SetInfo[]
  onReset: () => void
}

export function PackCollection({ collection, meta, sets, onReset }: Props) {
  const [filter, setFilter] = useState('')
  const [setFilterCode, setSetFilterCode] = useState('')
  const [rarityFilter, setRarityFilter] = useState('')
  const [page, setPage] = useState(0)

  const entries = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return Object.entries(collection.cards)
      .map(([id, counts]) => ({ id, counts, m: meta[id] }))
      .filter(({ m }) => {
        if (!m) return !q && !setFilterCode && !rarityFilter
        if (q && !m.n.toLowerCase().includes(q)) return false
        if (setFilterCode && m.s !== setFilterCode) return false
        if (rarityFilter && m.r !== rarityFilter) return false
        return true
      })
      .sort((a, b) => {
        const ra = RARITY_ORDER[a.m?.r ?? ''] ?? 4
        const rb = RARITY_ORDER[b.m?.r ?? ''] ?? 4
        if (ra !== rb) return ra - rb
        return (a.m?.n ?? '').localeCompare(b.m?.n ?? '')
      })
  }, [collection, meta, filter, setFilterCode, rarityFilter])

  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const shown = entries.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)

  const owned = ownedBySet(collection, meta)
  const completion = sets
    .filter((s) => owned[s.code])
    .map((s) => ({ set: s, have: owned[s.code], pct: Math.min(100, (owned[s.code] / s.card_count) * 100) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8)

  const openedSets = new Set(Object.values(meta).map((m) => m.s))

  return (
    <div className="pack-collection">
      <div className="pack-collection-head">
        <div className="pack-collection-totals">
          <strong>{collectionSize(collection)}</strong> cards ·{' '}
          <strong>{uniqueOwned(collection)}</strong> unique
        </div>
        <div className="pack-collection-filters">
          <input
            type="text"
            placeholder="Filter by name..."
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value)
              setPage(0)
            }}
          />
          <select
            value={setFilterCode}
            onChange={(e) => {
              setSetFilterCode(e.target.value)
              setPage(0)
            }}
          >
            <option value="">All sets</option>
            {sets
              .filter((s) => openedSets.has(s.code))
              .map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
          </select>
          <select
            value={rarityFilter}
            onChange={(e) => {
              setRarityFilter(e.target.value)
              setPage(0)
            }}
          >
            <option value="">All rarities</option>
            <option value="mythic">Mythic</option>
            <option value="rare">Rare</option>
            <option value="uncommon">Uncommon</option>
            <option value="common">Common</option>
          </select>
          <button type="button" className="new-build" onClick={onReset}>
            Reset Collection
          </button>
        </div>
      </div>

      {completion.length > 0 && (
        <div className="pack-completion">
          {completion.map(({ set, have, pct }) => (
            <div key={set.code} className="pack-completion-row">
              <span className="pack-completion-name">{set.name}</span>
              <div className="pack-completion-bar">
                <div style={{ width: `${pct}%` }} />
              </div>
              <span className="pack-completion-num">
                {have}/{set.card_count}
              </span>
            </div>
          ))}
        </div>
      )}

      {!entries.length ? (
        <p className="hint">Open some packs to start your collection.</p>
      ) : (
        <>
          <div className="binder-grid">
            {shown.map(({ id, counts, m }) => (
              <div key={id} className={`binder-card rarity-${m?.r ?? 'common'}`} title={m?.n}>
                {m?.i ? <img src={m.i} alt={m.n} loading="lazy" /> : <div className="binder-noimg">{m?.n ?? '?'}</div>}
                <div className="binder-badges">
                  {counts.q > 0 && <span className="binder-qty">×{counts.q}</span>}
                  {counts.fq > 0 && <span className="binder-foil">✦{counts.fq}</span>}
                </div>
              </div>
            ))}
          </div>
          {pages > 1 && (
            <div className="binder-pager">
              <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
                ←
              </button>
              <span>
                Page {current + 1} / {pages}
              </span>
              <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
