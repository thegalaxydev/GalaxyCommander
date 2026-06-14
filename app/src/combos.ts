import type { ComboInfo, Deck } from './types'

interface SpellbookCardUse {
  card?: { name?: string }
}

interface SpellbookFeature {
  feature?: { name?: string }
}

interface SpellbookVariant {
  uses?: SpellbookCardUse[]
  produces?: SpellbookFeature[]
  description?: string
}

function mapVariant(v: SpellbookVariant): ComboInfo {
  return {
    cards: (v.uses ?? []).map((u) => u.card?.name ?? '').filter(Boolean),
    produces: (v.produces ?? []).map((p) => p.feature?.name ?? '').filter(Boolean),
    description: v.description ?? '',
  }
}

export async function findCombos(
  deck: Deck
): Promise<{ included: ComboInfo[]; almost: ComboInfo[] }> {
  const main = deck.cards
    .filter((d) => d.category !== 'Commander')
    .map((d) => ({ card: d.card.name, quantity: d.qty }))
  const commanders = deck.cards
    .filter((d) => d.category === 'Commander')
    .map((d) => ({ card: d.card.name, quantity: 1 }))
  try {
    const res = await fetch('https://backend.commanderspellbook.com/find-my-combos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ main, commanders }),
    })
    if (!res.ok) return { included: [], almost: [] }
    const data = await res.json()
    const results = data?.results ?? data
    const included: SpellbookVariant[] = results?.included ?? []
    const almost: SpellbookVariant[] = results?.almostIncluded ?? []
    const inDeck = new Set([deck.commander.name, ...deck.cards.map((d) => d.card.name)])
    return {
      included: included.slice(0, 12).map(mapVariant),
      almost: almost.slice(0, 8).map((v) => {
        const combo = mapVariant(v)
        combo.missing = combo.cards.filter((c) => !inDeck.has(c))
        return combo
      }),
    }
  } catch {
    return { included: [], almost: [] }
  }
}
