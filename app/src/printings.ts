import type { DeckCard, ScryCard } from './types'
import { SCRY_BASE, searchCards } from './scryfall'
import type { SetInfo } from './packs/types'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// Same routing as the rest of the Scryfall calls: the browser goes through our
// caching proxy, the Tauri build talks to Scryfall directly.
const COLLECTION_URL = isTauri()
  ? 'https://api.scryfall.com/cards/collection'
  : '/scryfall-api/cards/collection'

/** Human label for a printing, e.g. `TDM #287`. */
export function printingLabel(card: ScryCard): string {
  if (!card.set) return ''
  return `${card.set.toUpperCase()} #${card.collector_number ?? '?'}`
}

// ---------------------------------------------------------------------------
// Set list
// ---------------------------------------------------------------------------

let allSetsCache: Promise<SetInfo[]> | null = null

/**
 * Every paper set Scryfall knows about, newest first. Wider than the pack
 * simulator's `fetchSets`, which only keeps openable products — a preferred
 * printing can legitimately come from a Commander deck, a masterpiece series,
 * or a promo set.
 */
export function fetchAllSets(): Promise<SetInfo[]> {
  if (!allSetsCache) {
    allSetsCache = (async () => {
      const res = await fetch(`${SCRY_BASE}/sets`)
      if (!res.ok) throw new Error('Could not load the set list from Scryfall.')
      const data = await res.json()
      const sets = (data.data ?? []) as (SetInfo & { digital?: boolean })[]
      return sets
        // Digital-only sets have no printing Cockatrice could show.
        .filter((s) => !s.digital && s.card_count > 0)
        .sort((a, b) => (a.released_at < b.released_at ? 1 : -1))
    })().catch((err) => {
      allSetsCache = null
      throw err
    })
  }
  return allSetsCache
}

// ---------------------------------------------------------------------------
// Printings of a single card
// ---------------------------------------------------------------------------

const printingsCache = new Map<string, Promise<ScryCard[]>>()

/**
 * Every printing of a card, newest first. Keyed on oracle id so all the arts of
 * a card share one cache entry no matter which printing you started from.
 */
export function fetchPrintings(card: ScryCard): Promise<ScryCard[]> {
  const key = card.oracle_id || card.name
  const cached = printingsCache.get(key)
  if (cached) return cached
  const query = card.oracle_id
    ? `oracleid:${card.oracle_id}`
    : `!"${card.name.replace(/"/g, '')}"`
  const promise = searchCards(query, { unique: 'prints', order: 'released', dir: 'desc', max: 250 })
    .then((prints) => (prints.length ? prints : [card]))
    .catch((err) => {
      printingsCache.delete(key)
      throw err
    })
  printingsCache.set(key, promise)
  return promise
}

// ---------------------------------------------------------------------------
// Bulk lookups
// ---------------------------------------------------------------------------

type Identifier =
  | { name: string; set: string }
  | { set: string; collector_number: string }

async function collection(identifiers: Identifier[]): Promise<ScryCard[]> {
  const out: ScryCard[] = []
  for (let i = 0; i < identifiers.length; i += 75) {
    const chunk = identifiers.slice(i, i + 75)
    try {
      const res = await fetch(COLLECTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: chunk }),
      })
      if (!res.ok) continue
      const data = await res.json()
      out.push(...((data.data ?? []) as ScryCard[]))
    } catch {
      /* a missing chunk just means those cards keep their current printing */
    }
  }
  return out
}

/** A card whose printing a decklist has pinned. */
export interface PinnedCard {
  name: string
  set?: string
  collectorNumber?: string
}

/** Cache key for a pinned card: collector number when known, name otherwise. */
export function pinKey(pin: PinnedCard): string {
  if (!pin.set) return ''
  return `${pin.set.toUpperCase()}/${pin.collectorNumber || pin.name.toLowerCase()}`
}

/**
 * Resolve pinned printings in bulk. Entries with a collector number are looked
 * up exactly; entries with only a set code fall back to that set's copy of the
 * card. Returns a map keyed by `pinKey`, missing whatever Scryfall couldn't
 * find — callers keep their default printing for those.
 */
export async function fetchPinnedPrintings(pins: PinnedCard[]): Promise<Map<string, ScryCard>> {
  const byKey = new Map<string, PinnedCard>()
  for (const pin of pins) {
    const key = pinKey(pin)
    if (key && !byKey.has(key)) byKey.set(key, pin)
  }
  if (!byKey.size) return new Map()
  const keys = [...byKey.keys()]
  const identifiers: Identifier[] = keys.map((key) => {
    const pin = byKey.get(key)!
    return pin.collectorNumber
      ? { set: pin.set!.toLowerCase(), collector_number: pin.collectorNumber }
      : { name: pin.name, set: pin.set!.toLowerCase() }
  })
  const cards = await collection(identifiers)
  // Scryfall returns found cards in request order, skipping misses, so match
  // them back by set + collector number / name rather than by index.
  const out = new Map<string, ScryCard>()
  for (const card of cards) {
    const set = card.set?.toUpperCase()
    if (!set) continue
    if (card.collector_number) out.set(`${set}/${card.collector_number}`, card)
    for (const name of [card.name, card.name.split(' // ')[0]]) {
      const key = `${set}/${name.toLowerCase()}`
      if (byKey.has(key) && !out.has(key)) out.set(key, card)
    }
  }
  return out
}

/**
 * Re-print a list of cards using the first set in `preferred` that has them.
 * Sets are tried in order, so the list doubles as a priority ranking. Cards
 * with no printing in any preferred set keep the printing they came with.
 */
export async function toPreferredPrintings(
  cards: ScryCard[],
  preferred: string[]
): Promise<Map<string, ScryCard>> {
  const out = new Map<string, ScryCard>()
  const codes = preferred.map((c) => c.trim().toLowerCase()).filter(Boolean)
  if (!codes.length || !cards.length) return out
  let pending = [...new Map(cards.map((c) => [c.name, c])).values()]
  for (const code of codes) {
    // Anything already printed in this set is as good as a match.
    for (const card of pending) if (card.set?.toLowerCase() === code) out.set(card.name, card)
    pending = pending.filter((c) => c.set?.toLowerCase() !== code)
    if (!pending.length) break
    const found = await collection(pending.map((c) => ({ name: c.name, set: code })))
    const byName = new Map<string, ScryCard>()
    for (const card of found) {
      byName.set(card.name, card)
      byName.set(card.name.split(' // ')[0], card)
    }
    pending = pending.filter((card) => {
      const match = byName.get(card.name) ?? byName.get(card.name.split(' // ')[0])
      if (!match) return true
      out.set(card.name, match)
      return false
    })
    if (!pending.length) break
  }
  return out
}

/** Applies `toPreferredPrintings` across a deck, keeping category/qty/reason. */
export async function applyPreferredPrintings(
  cards: DeckCard[],
  preferred: string[]
): Promise<DeckCard[]> {
  if (!preferred?.length) return cards
  try {
    const swaps = await toPreferredPrintings(
      cards.map((d) => d.card),
      preferred
    )
    if (!swaps.size) return cards
    return cards.map((d) => {
      const next = swaps.get(d.card.name)
      return next && next.id !== d.card.id ? { ...d, card: next } : d
    })
  } catch {
    // A printing swap is cosmetic — never fail a build over it.
    return cards
  }
}
