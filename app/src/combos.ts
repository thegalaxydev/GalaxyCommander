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
  bracketTag?: string
  manaValueNeeded?: number
}

function mapVariant(v: SpellbookVariant): ComboInfo {
  return {
    cards: (v.uses ?? []).map((u) => u.card?.name ?? '').filter(Boolean),
    produces: (v.produces ?? []).map((p) => p.feature?.name ?? '').filter(Boolean),
    description: v.description ?? '',
    bracketTag: v.bracketTag,
    executeMana: typeof v.manaValueNeeded === 'number' ? v.manaValueNeeded : undefined,
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
    const res = await fetch('/spellbook-api/find-my-combos', {
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
    const potential = almost
      .map((v) => {
        const combo = mapVariant(v)
        combo.missing = combo.cards.filter((c) => !inDeck.has(c))
        return combo
      })
      .filter((c) => c.missing && c.missing.length >= 1 && c.missing.length <= 2)
      .sort((a, b) => (a.missing?.length ?? 0) - (b.missing?.length ?? 0))
      .slice(0, 16)
    return {
      included: included.slice(0, 20).map(mapVariant),
      almost: potential,
    }
  } catch {
    return { included: [], almost: [] }
  }
}
