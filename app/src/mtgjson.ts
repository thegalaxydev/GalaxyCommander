import type { CodDeck, CodEntry } from './cod'

const API = 'https://mtgjson.com/api/v5'

export interface PreconSummary {
  fileName: string
  name: string
  code: string
  releaseDate: string
}

interface RawDeckListEntry {
  fileName?: string
  name?: string
  code?: string
  releaseDate?: string
  type?: string
}

interface RawDeckCard {
  name?: string
  count?: number
}

interface RawDeck {
  name?: string
  commander?: RawDeckCard[]
  mainBoard?: RawDeckCard[]
}

let listCache: PreconSummary[] | null = null

export async function fetchPreconList(): Promise<PreconSummary[]> {
  if (listCache) return listCache
  const res = await fetch(`${API}/DeckList.json`)
  if (!res.ok) throw new Error('Could not load the precon list from MTGJSON.')
  const data = await res.json()
  const raw: RawDeckListEntry[] = data?.data ?? []
  listCache = raw
    .filter(
      (d) =>
        d.type === 'Commander Deck' &&
        d.fileName &&
        d.name &&
        !/collector'?s edition/i.test(d.name)
    )
    .map((d) => ({
      fileName: d.fileName as string,
      name: d.name as string,
      code: d.code ?? '',
      releaseDate: d.releaseDate ?? '',
    }))
    .sort(
      (a, b) =>
        b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name)
    )
  return listCache
}

export async function fetchPrecon(fileName: string): Promise<CodDeck> {
  const res = await fetch(`${API}/decks/${encodeURIComponent(fileName)}.json`)
  if (!res.ok) throw new Error('Could not load that precon from MTGJSON.')
  const deck: RawDeck = (await res.json())?.data ?? {}
  const toEntry = (c: RawDeckCard): CodEntry => ({ name: c.name ?? '', qty: c.count ?? 1 })
  const valid = (e: CodEntry) => e.name.length > 0
  return {
    name: deck.name ?? 'Precon Deck',
    side: (deck.commander ?? []).map(toEntry).filter(valid),
    main: (deck.mainBoard ?? []).map(toEntry).filter(valid),
  }
}
