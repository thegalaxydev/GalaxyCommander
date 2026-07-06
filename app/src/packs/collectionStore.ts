import type { ScryCard } from '../types'
import { cardImage, cardPrice } from '../scryfall'
import { isLegendaryCreature } from './setPool'
import type { CardMeta, OpenedCard } from './types'

const COLLECTION_KEY = 'gc-pack-collection'
const CARDMETA_KEY = 'gc-pack-cardmeta'

export interface Collection {
  v: number
  cards: Record<string, { q: number; fq: number }>
}

export function loadCollection(): Collection {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLECTION_KEY) ?? '') as Partial<Collection>
    if (parsed && typeof parsed.cards === 'object' && parsed.cards) {
      return { v: 1, cards: parsed.cards as Collection['cards'] }
    }
  } catch {
    /* fall through to default */
  }
  return { v: 1, cards: {} }
}

export function loadCardMeta(): Record<string, CardMeta> {
  try {
    const parsed = JSON.parse(localStorage.getItem(CARDMETA_KEY) ?? '')
    if (parsed && typeof parsed === 'object') return parsed as Record<string, CardMeta>
  } catch {
    /* fall through to default */
  }
  return {}
}

export function toCardMeta(card: ScryCard): CardMeta {
  const meta: CardMeta = {
    n: card.name,
    s: card.set ?? '',
    r: card.rarity ?? 'common',
    c: (card.color_identity ?? []).join(''),
    t: card.type_line ?? '',
  }
  const img = cardImage(card, 'small')
  if (img) meta.i = img
  const price = cardPrice(card)
  if (price) meta.p = price
  if (isLegendaryCreature(card)) meta.leg = true
  return meta
}

function persist(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/** Merge opened cards into the collection + metadata cache. Returns false on quota failure. */
export function addToCollection(opened: OpenedCard[]): boolean {
  const collection = loadCollection()
  const meta = loadCardMeta()
  for (const { card, foil } of opened) {
    const entry = (collection.cards[card.id] ??= { q: 0, fq: 0 })
    if (foil) entry.fq++
    else entry.q++
    if (!meta[card.id]) meta[card.id] = toCardMeta(card)
  }
  const ok = persist(COLLECTION_KEY, collection)
  return persist(CARDMETA_KEY, meta) && ok
}

export function collectionSize(collection: Collection): number {
  return Object.values(collection.cards).reduce((n, e) => n + e.q + e.fq, 0)
}

export function uniqueOwned(collection: Collection): number {
  return Object.keys(collection.cards).length
}

/** Unique cards owned per set, for completion percentages. */
export function ownedBySet(collection: Collection, meta: Record<string, CardMeta>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id of Object.keys(collection.cards)) {
    const set = meta[id]?.s
    if (set) out[set] = (out[set] ?? 0) + 1
  }
  return out
}

export function resetCollection(): void {
  localStorage.removeItem(COLLECTION_KEY)
  localStorage.removeItem(CARDMETA_KEY)
}
