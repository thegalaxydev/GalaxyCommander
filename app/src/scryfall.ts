import type { ScryCard } from './types'

const API = 'https://api.scryfall.com'

let lastCall = 0
async function throttledFetch(url: string): Promise<Response> {
  const wait = Math.max(0, lastCall + 90 - Date.now())
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()
  return fetch(url)
}

export async function searchCards(
  query: string,
  opts: { order?: string; dir?: string; max?: number } = {}
): Promise<ScryCard[]> {
  const max = opts.max ?? 175
  const params = new URLSearchParams({
    q: query,
    order: opts.order ?? 'edhrec',
    unique: 'cards',
  })
  if (opts.dir) params.set('dir', opts.dir)
  let url = `${API}/cards/search?${params.toString()}`
  const out: ScryCard[] = []
  while (url && out.length < max) {
    const res = await throttledFetch(url)
    if (!res.ok) return out
    const data = await res.json()
    out.push(...(data.data ?? []))
    url = data.has_more ? data.next_page : ''
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

export async function searchCommanders(
  text: string,
  baseFilter = 'is:commander'
): Promise<ScryCard[]> {
  const clean = text.trim().replace(/"/g, '')
  if (clean.length < 2) return []
  const q = `${baseFilter} ${legalOrUpcoming()} name:"${clean}"`
  try {
    return await searchCards(q, { order: 'edhrec', max: 12 })
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
    const res = await fetch(`${API}/cards/random?q=${encodeURIComponent(q)}`)
    if (!res.ok) return null
    return (await res.json()) as ScryCard
  } catch {
    return null
  }
}

export async function fetchNamedCard(name: string): Promise<ScryCard | null> {
  try {
    const res = await fetch(
      `${API}/cards/named?exact=${encodeURIComponent(name)}`
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
