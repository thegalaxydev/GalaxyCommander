import type { CodDeck, CodEntry } from './cod'

export interface DeckUrlInfo {
  site: 'moxfield' | 'archidekt'
  id: string
}

export function detectDeckUrl(input: string): DeckUrlInfo | null {
  const text = input.trim()
  const mox = text.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i)
  if (mox) return { site: 'moxfield', id: mox[1] }
  const arch = text.match(/archidekt\.com\/decks\/(\d+)/i)
  if (arch) return { site: 'archidekt', id: arch[1] }
  return null
}

interface ArchidektCategory {
  name: string
  includedInDeck?: boolean
}

interface ArchidektCard {
  quantity?: number
  categories?: string[]
  companion?: boolean
  card?: { oracleCard?: { name?: string } }
}

interface ArchidektDeck {
  name?: string
  categories?: ArchidektCategory[]
  cards?: ArchidektCard[]
}

function archidektToCod(data: ArchidektDeck): CodDeck {
  const excluded = new Set(
    (data.categories ?? []).filter((c) => c.includedInDeck === false).map((c) => c.name)
  )
  const side: CodEntry[] = []
  const main: CodEntry[] = []
  for (const c of data.cards ?? []) {
    const name = c.card?.oracleCard?.name
    if (!name) continue
    const cats = c.categories ?? []
    if (cats.length && cats.every((cat) => excluded.has(cat))) continue
    const qty = c.quantity ?? 1
    if (cats.includes('Commander') || c.companion) side.push({ name, qty: 1 })
    else main.push({ name, qty })
  }
  return { name: data.name?.trim() || 'Archidekt Deck', side, main }
}

async function importArchidekt(id: string): Promise<CodDeck> {
  const res = await fetch(`/archidekt-api/api/decks/${id}/`)
  if (!res.ok) throw new Error(`Archidekt returned ${res.status}. Check that the deck is public.`)
  const data = (await res.json()) as ArchidektDeck
  const deck = archidektToCod(data)
  if (!deck.main.length && !deck.side.length) throw new Error('No cards found in that Archidekt deck.')
  return deck
}

interface MoxfieldCardEntry {
  quantity?: number
  card?: { name?: string }
}

interface MoxfieldBoard {
  cards?: Record<string, MoxfieldCardEntry>
}

interface MoxfieldDeck {
  name?: string
  boards?: Record<string, MoxfieldBoard>
}

function collectMoxfield(board: MoxfieldBoard | undefined): CodEntry[] {
  return Object.values(board?.cards ?? {})
    .map((e) => ({ name: e.card?.name ?? '', qty: e.quantity ?? 1 }))
    .filter((e) => e.name)
}

function moxfieldToCod(data: MoxfieldDeck): CodDeck {
  const boards = data.boards ?? {}
  const side = [...collectMoxfield(boards.commanders), ...collectMoxfield(boards.companions)]
  const main = collectMoxfield(boards.mainboard)
  return { name: data.name?.trim() || 'Moxfield Deck', side, main }
}

const MOXFIELD_BLOCKED =
  'Moxfield blocks automated imports. Open your deck on Moxfield, choose More (•••) → Export, then paste the decklist below or import the .txt file.'

async function importMoxfield(id: string): Promise<CodDeck> {
  let res: Response
  try {
    res = await fetch(`/moxfield-api/v3/decks/all/${id}`)
  } catch {
    throw new Error(MOXFIELD_BLOCKED)
  }
  if (res.status === 403 || res.status === 401 || res.status === 429) {
    throw new Error(MOXFIELD_BLOCKED)
  }
  if (!res.ok) throw new Error(`Moxfield returned ${res.status}. ${MOXFIELD_BLOCKED}`)
  const data = (await res.json()) as MoxfieldDeck
  const deck = moxfieldToCod(data)
  if (!deck.main.length && !deck.side.length) throw new Error('No cards found in that Moxfield deck.')
  return deck
}

export async function importDeckFromUrl(input: string): Promise<CodDeck> {
  const info = detectDeckUrl(input)
  if (!info) throw new Error('Unrecognized link. Paste a Moxfield or Archidekt deck URL.')
  return info.site === 'archidekt' ? importArchidekt(info.id) : importMoxfield(info.id)
}
