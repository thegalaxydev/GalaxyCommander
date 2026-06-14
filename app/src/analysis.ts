import type { Category, Deck, DeckCard } from './types'
import { cardPrice, cardOracle } from './scryfall'

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

export function deckHealth(deck: Deck): HealthItem[] {
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
  push(
    lands < 33,
    `Thin mana base (${lands} lands)`,
    `Stable mana base (${lands} lands)`,
    'Fewer than 33 lands risks missing land drops in the early turns.'
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
