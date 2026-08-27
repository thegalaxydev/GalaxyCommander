import type { ScryCard } from './types'

const API = 'https://api.scryfall.com'

// In the browser, route data requests through our caching proxy (/scryfall-api)
// so repeat lookups are fast and we can serve last-known-good results when
// Scryfall is having an outage. The Tauri desktop build hits Scryfall directly.
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
export const SCRY_BASE = isTauri() ? API : '/scryfall-api'

let lastCall = 0
async function throttledFetch(url: string): Promise<Response> {
  const wait = Math.max(0, lastCall + 90 - Date.now())
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()
  return fetch(url)
}

export async function searchCards(
  query: string,
  opts: { order?: string; dir?: string; max?: number; unique?: 'cards' | 'prints' } = {}
): Promise<ScryCard[]> {
  const max = opts.max ?? 175
  const params = new URLSearchParams({
    q: query,
    order: opts.order ?? 'edhrec',
    unique: opts.unique ?? 'cards',
  })
  if (opts.dir) params.set('dir', opts.dir)
  let url = `${SCRY_BASE}/cards/search?${params.toString()}`
  const out: ScryCard[] = []
  while (url && out.length < max) {
    const res = await throttledFetch(url)
    if (!res.ok) return out
    const data = await res.json()
    out.push(...(data.data ?? []))
    url = data.has_more ? String(data.next_page).replace(API, SCRY_BASE) : ''
  }
  return out.slice(0, max)
}

let allowUnsetCards = false
let noSpoilers = false

export function setAllowUnsetCards(allow: boolean): void {
  allowUnsetCards = allow
}

export function setNoSpoilers(on: boolean): void {
  noSpoilers = on
}

export function legalOrUpcoming(): string {
  if (noSpoilers) return 'legal:commander'
  if (allowUnsetCards) return ''
  return `(legal:commander or date>${new Date().toISOString().slice(0, 10)})`
}

/**
 * Scryfall search operators (`t:goblin`, `mv<=3`, `-is:land`, `!"Island"`, `o:draw`).
 * Used to tell a typed card name apart from a syntax query in the search boxes.
 */
const SCRY_SYNTAX = /(?:^|\s)-?(?:[a-z]+(?::|[<>]=?|!?=)|!)/i

export function isScrySyntax(text: string): boolean {
  return SCRY_SYNTAX.test(text)
}

/**
 * Rank name matches so an exact hit wins over the longer cards that merely
 * contain the word — searching "Island" has to be able to reach basic Island
 * past the hundred cards with "Island" somewhere in their name.
 */
export function rankNameMatch(card: ScryCard, needle: string): number {
  const lower = needle.trim().toLowerCase()
  const name = (card.name ?? '').toLowerCase()
  const front = name.split(' //')[0].trim()
  if (front === lower || name === lower) return 0
  if (front.startsWith(lower)) return 1
  if (new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(front)) return 2
  return 3
}

/** Sort by match quality, keeping the incoming (edhrec) order inside each tier. */
export function sortByNameMatch(cards: ScryCard[], needle: string): ScryCard[] {
  return cards
    .map((card, i) => ({ card, i, rank: rankNameMatch(card, needle) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((e) => e.card)
}

export async function searchCommanders(
  text: string,
  baseFilter = 'is:commander'
): Promise<ScryCard[]> {
  const clean = text.trim().replace(/"/g, '')
  if (clean.length < 2) return []
  const q = `${baseFilter} ${legalOrUpcoming()} name:"${clean}"`
  try {
    return sortByNameMatch(await searchCards(q, { order: 'edhrec', max: 12 }), clean)
  } catch {
    return []
  }
}

export async function fetchRandomCommander(colors: string[] = []): Promise<ScryCard | null> {
  const idPart = colors.includes('C')
    ? 'id=c'
    : colors.length
      ? `id=${colors.join('').toLowerCase()}`
      : ''
  const q = `is:commander ${idPart} ${legalOrUpcoming()}`.replace(/\s+/g, ' ').trim()
  try {
    const res = await fetch(`${SCRY_BASE}/cards/random?q=${encodeURIComponent(q)}`)
    if (!res.ok) return null
    return (await res.json()) as ScryCard
  } catch {
    return null
  }
}

export async function fetchNamedCard(name: string): Promise<ScryCard | null> {
  try {
    const res = await fetch(
      `${SCRY_BASE}/cards/named?exact=${encodeURIComponent(name)}`
    )
    if (!res.ok) return null
    return (await res.json()) as ScryCard
  } catch {
    return null
  }
}

export function cardImage(card: ScryCard, size: 'small' | 'normal' | 'art_crop' = 'normal'): string {
  const uris = card.image_uris ?? card.card_faces?.[0]?.image_uris
  return uris?.[size] ?? uris?.normal ?? ''
}

export function cardImageByName(name: string, version: 'small' | 'normal' = 'normal'): string {
  const exact = name.split(' //')[0]
  return `https://api.scryfall.com/cards/named?format=image&version=${version}&exact=${encodeURIComponent(exact)}`
}

/** Image for one specific printing, so a pinned art shows the art that was pinned. */
export function cardImageByPrinting(
  set: string,
  collectorNumber: string,
  version: 'small' | 'normal' = 'normal'
): string {
  return `https://api.scryfall.com/cards/${encodeURIComponent(set.toLowerCase())}/${encodeURIComponent(collectorNumber)}?format=image&version=${version}`
}

export function cardOracle(card: ScryCard): string {
  if (card.oracle_text) return card.oracle_text
  return (card.card_faces ?? []).map((f) => f.oracle_text ?? '').join('\n')
}

export function cardManaCost(card: ScryCard): string {
  return card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? ''
}

export function cardPrice(card: ScryCard): number {
  return card.prices?.usd ? parseFloat(card.prices.usd) : 0
}
