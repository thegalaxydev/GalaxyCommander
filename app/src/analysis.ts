import type { Category, ComboInfo, Deck, DeckCard } from './types'
import { cardPrice, cardOracle } from './scryfall'
import { unionIdentity } from './partner'

const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const

export interface ColorBalance {
  color: string
  sources: number
  pips: number
}

function countPips(cost: string, color: string): number {
  if (!cost) return 0
  const matches = cost.match(/\{[^}]+\}/g) ?? []
  return matches.filter((sym) => sym.includes(color)).length
}

function balanceForColors(cards: DeckCard[], colors: readonly string[]): ColorBalance[] {
  return colors.map((color) => {
    let pips = 0
    let sources = 0
    for (const d of cards) {
      if (d.category === 'Commander') continue
      if ((d.category === 'Lands' || d.category === 'Ramp') && (d.card.produced_mana ?? []).includes(color)) {
        sources += d.qty
      }
      if (d.category !== 'Lands') {
        const cost = d.card.mana_cost ?? d.card.card_faces?.[0]?.mana_cost ?? ''
        pips += countPips(cost, color) * d.qty
      }
    }
    return { color, sources, pips }
  })
}

export function colorBalance(deck: Deck): ColorBalance[] {
  const identity = new Set(unionIdentity(deck.commander, deck.settings.partner))
  return balanceForColors(deck.cards, WUBRG.filter((c) => identity.has(c)))
}

export function colorBalanceFromCards(cards: DeckCard[]): ColorBalance[] {
  return balanceForColors(cards, WUBRG).filter((b) => b.pips > 0 || b.sources > 0)
}

function recommendedSources(pips: number): number {
  return Math.max(9, Math.min(17, Math.round(pips * 0.45) + 7))
}

function isGameEnding(combo: ComboInfo): boolean {
  const text = `${combo.produces.join(' ')} ${combo.description}`.toLowerCase()
  return /infinite|win the game|each opponent loses|wins? the game/.test(text)
}

const BRACKET_LABELS: Record<number, string> = {
  1: 'Exhibition',
  2: 'Core',
  3: 'Upgraded',
  4: 'Optimized',
  5: 'cEDH',
}

const MLD_NAMES = new Set(
  [
    'Armageddon',
    'Ravages of War',
    'Catastrophe',
    'Decree of Annihilation',
    'Jokulhaups',
    'Obliterate',
    'Impending Disaster',
    'Cataclysm',
    'Winter Orb',
    'Static Orb',
    'Stasis',
    'Back to Basics',
  ].map((n) => n.toLowerCase())
)

export interface BracketEstimate {
  bracket: number
  label: string
  reasons: string[]
}

export function estimateBracketFromCards(
  cards: DeckCard[],
  combos?: { included: ComboInfo[] } | null
): BracketEstimate {
  const nonCommander = cards.filter((d) => d.category !== 'Commander')
  const sum = (list: DeckCard[]) => list.reduce((n, d) => n + d.qty, 0)

  const gameChangers = sum(cards.filter((d) => d.card.game_changer))
  const massLandDenial = sum(
    nonCommander.filter(
      (d) =>
        MLD_NAMES.has(d.card.name.split(' //')[0].toLowerCase()) ||
        /destroy all lands|each player sacrifices?[^.]*lands/i.test(cardOracle(d.card))
    )
  )
  const extraTurns = sum(
    nonCommander.filter((d) => /take an extra turn/i.test(cardOracle(d.card)))
  )
  const tutors = sum(
    nonCommander.filter((d) => {
      const o = cardOracle(d.card)
      return /search your library for (a|an|up to)/i.test(o) && !/basic land/i.test(o)
    })
  )
  const twoCardCombos = (combos?.included ?? []).filter(
    (c) => c.cards.length <= 2 && isGameEnding(c)
  ).length

  const reasons: string[] = []
  if (gameChangers) reasons.push(`${gameChangers} Game Changer${gameChangers > 1 ? 's' : ''}`)
  if (twoCardCombos) reasons.push(`${twoCardCombos} two-card win combo${twoCardCombos > 1 ? 's' : ''}`)
  if (massLandDenial) reasons.push(`${massLandDenial} mass land denial piece${massLandDenial > 1 ? 's' : ''}`)
  if (extraTurns) reasons.push(`${extraTurns} extra-turn spell${extraTurns > 1 ? 's' : ''}`)
  if (tutors) reasons.push(`${tutors} tutor${tutors > 1 ? 's' : ''}`)

  let bracket: number
  if (gameChangers >= 8 && twoCardCombos >= 2) {
    bracket = 5
  } else if (gameChangers > 3 || massLandDenial > 0 || twoCardCombos > 0 || extraTurns >= 2) {
    bracket = 4
  } else if (gameChangers >= 1 || tutors >= 3 || extraTurns >= 1) {
    bracket = 3
  } else {
    bracket = 2
  }

  if (!reasons.length) reasons.push('No Game Changers, mass land denial, or compact combos detected')

  return { bracket, label: BRACKET_LABELS[bracket], reasons }
}

export function estimateBracket(
  deck: Deck,
  combos?: { included: ComboInfo[] } | null
): BracketEstimate {
  return estimateBracketFromCards(deck.cards, combos)
}

export function curveBuckets(cards: DeckCard[]): number[] {
  const buckets = [0, 0, 0, 0, 0, 0]
  for (const d of cards) {
    if (d.category === 'Lands' || d.category === 'Commander') continue
    const slot = Math.min(5, Math.max(1, Math.round(d.card.cmc)) - 1)
    buckets[slot] += d.qty
  }
  return buckets
}

export function typeCounts(cards: DeckCard[]): { category: Category; count: number }[] {
  const map = new Map<Category, number>()
  for (const d of cards) {
    map.set(d.category, (map.get(d.category) ?? 0) + d.qty)
  }
  return [...map.entries()].map(([category, count]) => ({ category, count }))
}

export function deckPrice(cards: DeckCard[]): number {
  return cards.reduce((sum, d) => sum + cardPrice(d.card) * d.qty, 0)
}

export function totalCards(cards: DeckCard[]): number {
  return cards.reduce((n, d) => n + d.qty, 0)
}

export function avgCmc(cards: DeckCard[]): number {
  const nonLand = cards.filter((d) => d.category !== 'Lands' && d.category !== 'Commander')
  const total = nonLand.reduce((s, d) => s + d.card.cmc * d.qty, 0)
  const count = nonLand.reduce((n, d) => n + d.qty, 0)
  return count ? total / count : 0
}

export interface HealthItem {
  level: 'warn' | 'ok'
  message: string
  detail: string
}

export function deckHealth(
  deck: Deck,
  combos?: { included: ComboInfo[]; almost: ComboInfo[] } | null
): HealthItem[] {
  const items: HealthItem[] = []
  const cards = deck.cards
  const count = (cat: Category) =>
    cards.filter((d) => d.category === cat).reduce((n, d) => n + d.qty, 0)
  const oracleCount = (re: RegExp) =>
    cards.filter((d) => d.category !== 'Commander' && re.test(cardOracle(d.card))).length

  const draw = count('Card Draw')
  const ramp = count('Ramp')
  const removal = count('Removal')
  const wipes = count('Board Wipes')
  const lands = count('Lands')
  const curve = avgCmc(cards)
  const commanderCmc = deck.commander.cmc
  const creatures = cards.filter(
    (d) => d.category !== 'Commander' && /Creature/.test(d.card.type_line)
  ).length
  const recursion = oracleCount(/return .* from your graveyard/i)
  const graveHate = oracleCount(/exile .*(graveyard|graveyards)/i)
  const protection = oracleCount(/hexproof|indestructible|protection from|ward {|can't be countered/i)

  const push = (warn: boolean, message: string, okMessage: string, detail: string) =>
    items.push({ level: warn ? 'warn' : 'ok', message: warn ? message : okMessage, detail })

  push(
    draw < 8,
    `Low card draw (${draw} sources)`,
    `Healthy card draw (${draw} sources)`,
    'Aim for 8-12 dedicated draw effects so the deck does not run out of gas.'
  )
  push(
    removal + wipes < 8,
    `Light interaction (${removal} removal, ${wipes} wipes)`,
    `Solid interaction (${removal} removal, ${wipes} wipes)`,
    'Most tables expect 8+ pieces of interaction to answer threats and combos.'
  )
  push(
    ramp < 8,
    `Low ramp (${ramp} sources)`,
    `Good ramp density (${ramp} sources)`,
    '8-12 ramp pieces keeps you ahead of the table on mana.'
  )
  const recLands = Math.max(31, Math.min(40, Math.round(34 + (curve - 3) * 2 - ramp * 0.3)))
  push(
    lands < recLands - 1,
    `Thin mana base (${lands} lands, ~${recLands} recommended)`,
    `Stable mana base (${lands} lands)`,
    `With an average mana value of ${curve.toFixed(2)} and ${ramp} ramp sources, around ${recLands} lands keeps your early land drops consistent.`
  )
  push(
    curve > 3.6,
    `Top-heavy curve (avg ${curve.toFixed(2)})`,
    `Reasonable curve (avg ${curve.toFixed(2)})`,
    'An average mana value above 3.6 often means clunky opening hands.'
  )
  push(
    commanderCmc >= 6 && ramp < 10,
    `Commander is expensive (${commanderCmc} mana) with modest ramp`,
    `Commander cost (${commanderCmc} mana) is well supported`,
    'High-cost commanders want 10+ ramp sources to land on time.'
  )
  push(
    creatures >= 25 && recursion < 2,
    `Poor recovery after board wipes (${recursion} recursion pieces)`,
    'Can rebuild after a board wipe',
    'Creature-heavy decks want a couple of mass-recursion or rebuild effects.'
  )
  push(
    graveHate === 0,
    'No graveyard interaction',
    `Packs graveyard answers (${graveHate})`,
    'Even one or two grave-hate pieces helps against reanimator and combo tables.'
  )
  push(
    protection < 3,
    `Little commander protection (${protection} pieces)`,
    `Decent protection suite (${protection} pieces)`,
    'Hexproof, indestructible, and ward effects keep your key pieces alive.'
  )

  const balance = colorBalance(deck)
  if (balance.length > 1) {
    const weak = balance.filter((b) => b.pips >= 5 && b.sources < recommendedSources(b.pips))
    push(
      weak.length > 0,
      `Uneven color sources (${weak.map((w) => `${w.color} ${w.sources}/${recommendedSources(w.pips)}`).join(', ')})`,
      'Balanced color sources across the mana base',
      'Each heavily-used color generally wants 9–17 mana sources (per Frank Karsten\u2019s guidelines) to cast spells on curve. Add dual lands or fixing for the short colors.'
    )
  }

  if (combos && deck.settings.bracket <= 3) {
    const earlyCombos = combos.included.filter((c) => c.cards.length <= 2 && isGameEnding(c))
    if (earlyCombos.length > 0) {
      items.push({
        level: 'warn',
        message: `Two-card win combo${earlyCombos.length > 1 ? 's' : ''} in a Bracket ${deck.settings.bracket} deck (${earlyCombos.length})`,
        detail: `Brackets 1–3 are not meant to run compact two-card infinite/win combos (e.g. ${earlyCombos[0].cards.join(' + ')}). Cut a piece or move to Bracket 4+ to stay within the bracket's expectations.`,
      })
    }
  }

  const gameChangers = cards
    .filter((d) => d.card.game_changer)
    .reduce((n, d) => n + d.qty, 0)
  if (gameChangers > 0) {
    const bracket = deck.settings.bracket
    const limit = bracket <= 2 ? 0 : bracket === 3 ? 3 : Infinity
    const limitLabel = limit === Infinity ? 'unlimited' : limit
    push(
      gameChangers > limit,
      `Too many Game Changers (${gameChangers}/${limitLabel}) for Bracket ${bracket}`,
      `Game Changers within Bracket ${bracket} limit (${gameChangers}/${limitLabel})`,
      'Brackets 1–2 allow no Game Changers, Bracket 3 allows up to 3, and Bracket 4+ is unlimited. Cut Game Changers or raise the bracket to stay legal.'
    )
  }

  return items.sort((a, b) => (a.level === b.level ? 0 : a.level === 'warn' ? -1 : 1))
}

export function analyzeDeck(deck: Deck): { strengths: string[]; weaknesses: string[] } {
  const strengths: string[] = []
  const weaknesses: string[] = []
  const cards = deck.cards
  const curve = avgCmc(cards)
  const count = (cat: Category) =>
    cards.filter((d) => d.category === cat).reduce((n, d) => n + d.qty, 0)
  const draw = count('Card Draw')
  const ramp = count('Ramp')
  const removal = count('Removal')
  const wipes = count('Board Wipes')
  const creatures = cards.filter((d) => /Creature/.test(d.card.type_line)).length
  const protection = cards.filter((d) =>
    /hexproof|indestructible|protection from|ward|can't be countered/i.test(cardOracle(d.card))
  ).length

  if (curve <= 3.0) strengths.push('Low curve enables a fast, consistent clock')
  if (ramp >= 10) strengths.push('Heavy ramp package gets your commander down early')
  if (draw >= 10) strengths.push('Strong card advantage keeps the gas flowing')
  if (removal + wipes >= 12) strengths.push('Dense interaction suite answers most threats')
  if (protection >= 6) strengths.push('Resilient board that shrugs off targeted removal')
  if (deck.settings.themes.length) strengths.push(`Tight ${deck.settings.themes.join(' + ')} synergy core`)

  if (curve > 3.6) weaknesses.push('Top-heavy curve can lead to clunky early turns')
  if (creatures >= 30 && wipes <= 2) weaknesses.push('Vulnerable to board wipes')
  if (draw < 9) weaknesses.push('Can run out of cards in longer games')
  if (removal + wipes < 9) weaknesses.push('Light on interaction against fast combo decks')
  if (protection < 4) weaknesses.push('Commander-dependent without much protection')
  if (!weaknesses.length) weaknesses.push('Telegraphs its game plan to experienced tables')
  if (!strengths.length) strengths.push('Balanced construction with no glaring gaps')

  return { strengths: strengths.slice(0, 4), weaknesses: weaknesses.slice(0, 3) }
}
