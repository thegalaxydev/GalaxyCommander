import type { ComboInfo, ComboTemplate, Deck } from './types'

interface SpellbookCardUse {
  card?: { name?: string }
}

interface SpellbookFeature {
  feature?: { name?: string }
}

interface SpellbookTemplateUse {
  quantity?: number
  template?: { name?: string }
}

interface SpellbookVariant {
  id?: string
  uses?: SpellbookCardUse[]
  requires?: SpellbookTemplateUse[]
  produces?: SpellbookFeature[]
  description?: string
  bracketTag?: string
  manaValueNeeded?: number
}

// Spellbook returns one variant per template permutation, so the same combo
// comes back several times with different variant IDs but identical cards and
// results (Springheart Nantuko + Lotus Cobra arrives as both `-143` and
// `-131`). Collapse anything a reader could not tell apart.
function comboKey(c: ComboInfo): string {
  const templates = (c.requires ?? []).map((r) => `${r.quantity}x${r.name}`).sort()
  return `${[...c.cards, ...templates].sort().join('|')}>>${[...c.produces].sort().join('|')}`
}

function dedupe(combos: ComboInfo[]): ComboInfo[] {
  const seen = new Set<string>()
  return combos.filter((c) => {
    const key = comboKey(c)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function mapVariant(v: SpellbookVariant): ComboInfo {
  return {
    id: v.id,
    cards: (v.uses ?? []).map((u) => u.card?.name ?? '').filter(Boolean),
    requires: (v.requires ?? [])
      .map((r): ComboTemplate => ({ name: r.template?.name ?? '', quantity: r.quantity ?? 1 }))
      .filter((r) => r.name),
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
    const potential = dedupe(
      almost
        .map((v) => {
          const combo = mapVariant(v)
          combo.missing = combo.cards.filter((c) => !inDeck.has(c))
          return combo
        })
        .filter((c) => c.missing && c.missing.length >= 1 && c.missing.length <= 2)
    )
      .sort((a, b) => (a.missing?.length ?? 0) - (b.missing?.length ?? 0))
      .slice(0, 16)
    // Dedupe before slicing, or near-identical variants eat the display budget.
    return {
      included: dedupe(included.map(mapVariant)).slice(0, 20),
      almost: potential,
    }
  } catch {
    return { included: [], almost: [] }
  }
}
