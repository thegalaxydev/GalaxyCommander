import type { ScryCard } from './types'

export interface EdhrecRec {
  name: string
  synergy: number
  inclusion: number
  header: string
}

export interface EdhrecTheme {
  name: string
  slug: string
  count: number
}

export interface EdhrecPage {
  recs: EdhrecRec[]
  themes: EdhrecTheme[]
}

export interface EdhrecPairStats {
  deckCount: number
  avgPrice: number
  header: string
}

export function commanderSlug(name: string): string {
  return name
    .split('//')[0]
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['",.!?:()]/g, '')
    .replace(/[+]/g, 'plus-')
    .replace(/\s+/g, '-')
}

interface RawCardview {
  name?: string
  synergy?: number
  num_decks?: number
  potential_decks?: number
}

interface RawCardlist {
  header?: string
  cardviews?: RawCardview[]
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function edhrecFetch(path: string): Promise<Response> {
  if (isTauri()) {
    const { fetch: nativeFetch } = await import('@tauri-apps/plugin-http')
    return nativeFetch(`https://json.edhrec.com${path}`)
  }
  return fetch(`/edhrec-api${path}`)
}

export async function fetchEdhrecPage(
  commanderName: string,
  themeSlug?: string
): Promise<EdhrecPage | null> {
  return fetchEdhrecPageBySlug(commanderSlug(commanderName), themeSlug)
}

export async function fetchEdhrecPageBySlug(
  slug: string,
  themeSlug?: string
): Promise<EdhrecPage | null> {
  const path = themeSlug
    ? `/pages/commanders/${slug}/${themeSlug}.json`
    : `/pages/commanders/${slug}.json`
  try {
    const res = await edhrecFetch(path)
    if (!res.ok) return null
    const data = await res.json()
    const dict = data?.container?.json_dict
    const cardlists: RawCardlist[] = dict?.cardlists ?? []
    const recs: EdhrecRec[] = []
    const seen = new Set<string>()
    for (const list of cardlists) {
      const header = list.header ?? ''
      for (const cv of list.cardviews ?? []) {
        if (!cv.name || seen.has(cv.name)) continue
        seen.add(cv.name)
        recs.push({
          name: cv.name,
          synergy: cv.synergy ?? 0,
          inclusion:
            cv.num_decks && cv.potential_decks
              ? cv.num_decks / cv.potential_decks
              : 0,
          header,
        })
      }
    }
    const taglinks = data?.panels?.taglinks ?? []
    const themes: EdhrecTheme[] = taglinks
      .map((t: { value?: string; slug?: string; count?: number }) => ({
        name: t.value ?? '',
        slug: t.slug ?? '',
        count: t.count ?? 0,
      }))
      .filter((t: EdhrecTheme) => t.name && t.slug)
    return { recs, themes }
  } catch {
    return null
  }
}

export async function fetchEdhrecPairStats(
  slugA: string,
  slugB: string
): Promise<EdhrecPairStats | null> {
  for (const slug of [`${slugA}-${slugB}`, `${slugB}-${slugA}`]) {
    try {
      const res = await edhrecFetch(`/pages/commanders/${slug}.json`)
      if (!res.ok) continue
      const data = await res.json()
      const deckCount = data?.num_decks_avg ?? data?.total_card_count ?? 0
      if (!deckCount) continue
      return {
        deckCount,
        avgPrice: data?.avg_price ?? 0,
        header: data?.header ?? '',
      }
    } catch {
      continue
    }
  }
  return null
}

export async function resolveCards(names: string[]): Promise<Map<string, ScryCard>> {
  const out = new Map<string, ScryCard>()
  for (let i = 0; i < names.length; i += 75) {
    const chunk = names.slice(i, i + 75)
    try {
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
      })
      if (!res.ok) continue
      const data = await res.json()
      for (const card of data.data ?? []) {
        out.set(card.name, card)
      }
    } catch {
      continue
    }
  }
  return out
}
