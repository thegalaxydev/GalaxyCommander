import type { Deck, DeckCard, ScryCard } from './types'
import { cardOracle } from './scryfall'

export interface BattlefieldCard {
  card: ScryCard
  tapped: boolean
  isLand: boolean
  isRock: boolean
  rockCost: number
}

export interface GoldfishState {
  turn: number
  life: number
  hand: ScryCard[]
  battlefield: BattlefieldCard[]
  graveyard: ScryCard[]
  library: ScryCard[]
  commander: ScryCard
  commanderCast: boolean
  commanderTax: number
  landPlayedThisTurn: boolean
  log: string[]
  mulligans: number
  phase: 'opening' | 'main'
  gameOver: boolean
}

function deckCardCategory(deck: Deck, card: ScryCard): DeckCard['category'] | null {
  const row = deck.cards.find((d) => d.card.name === card.name)
  return row?.category ?? null
}

function isRockCard(deck: Deck, card: ScryCard): boolean {
  const cat = deckCardCategory(deck, card)
  if (cat !== 'Ramp') return false
  return /{T}: Add|adds? (one|two) mana/i.test(cardOracle(card))
}

function rockCost(card: ScryCard): number {
  return Math.max(0, Math.round(card.cmc))
}

function expandLibrary(deck: Deck): ScryCard[] {
  const library: ScryCard[] = []
  for (const d of deck.cards) {
    if (d.category === 'Commander') continue
    for (let i = 0; i < d.qty; i++) library.push(d.card)
  }
  return library
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function untapAll(state: GoldfishState): GoldfishState {
  return {
    ...state,
    battlefield: state.battlefield.map((p) => ({ ...p, tapped: false })),
  }
}

function availableMana(state: GoldfishState): number {
  const lands = state.battlefield.filter((p) => p.isLand && !p.tapped).length
  const rocks = state.battlefield.filter((p) => p.isRock && !p.tapped).length
  return lands + rocks
}

function spendMana(state: GoldfishState, cost: number): GoldfishState {
  let remaining = cost
  const bf = state.battlefield.map((p) => ({ ...p }))
  for (const p of bf) {
    if (remaining <= 0) break
    if (p.tapped) continue
    if (p.isLand) {
      p.tapped = true
      remaining--
    }
  }
  for (const p of bf) {
    if (remaining <= 0) break
    if (p.tapped || !p.isRock) continue
    if (p.rockCost <= remaining) {
      p.tapped = true
      remaining -= p.rockCost
    }
  }
  return { ...state, battlefield: bf }
}

export function createGoldfish(deck: Deck): GoldfishState {
  const library = shuffle(expandLibrary(deck))
  const hand = library.splice(0, 7)
  return {
    turn: 1,
    life: 40,
    hand,
    battlefield: [],
    graveyard: [],
    library,
    commander: deck.commander,
    commanderCast: false,
    commanderTax: 0,
    landPlayedThisTurn: false,
    log: ['Draw your opening hand of seven. Keep or mulligan.'],
    mulligans: 0,
    phase: 'opening',
    gameOver: false,
  }
}

export function goldfishKeep(state: GoldfishState): GoldfishState {
  if (state.phase !== 'opening') return state
  const lands = state.hand.filter((c) => /Land/.test(c.type_line)).length
  const keepable = lands >= 2 && lands <= 5
  if (!keepable) {
    return {
      ...state,
      log: [...state.log, `Kept a risky ${lands}-land hand — you can still mulligan.`],
      phase: 'main',
    }
  }
  return {
    ...state,
    log: [...state.log, `Kept a ${lands}-land hand. Turn 1 — play a land and develop.`],
    phase: 'main',
  }
}

export function goldfishMulligan(state: GoldfishState): GoldfishState {
  if (state.phase !== 'opening') return state
  const library = shuffle([...state.library, ...state.hand, ...state.graveyard])
  const hand = library.splice(0, 7)
  const mulligans = state.mulligans + 1
  if (mulligans >= 7 || library.length < 7) {
    return {
      ...state,
      hand,
      library,
      mulligans,
      log: [...state.log, 'No more mulligans — keeping this hand.'],
      phase: 'main',
    }
  }
  return {
    ...state,
    hand,
    library,
    graveyard: [],
    mulligans,
    log: [...state.log, `Mulliganed to ${7 - mulligans} (London: no redraw yet).`],
  }
}

export function goldfishPlayLand(state: GoldfishState, deck: Deck): GoldfishState {
  if (state.phase !== 'main' || state.landPlayedThisTurn) return state
  const idx = state.hand.findIndex((c) => deckCardCategory(deck, c) === 'Lands')
  if (idx < 0) {
    return { ...state, log: [...state.log, 'No land in hand to play.'] }
  }
  const card = state.hand[idx]
  const hand = state.hand.filter((_, i) => i !== idx)
  return {
    ...state,
    hand,
    landPlayedThisTurn: true,
    battlefield: [
      ...state.battlefield,
      { card, tapped: false, isLand: true, isRock: false, rockCost: 0 },
    ],
    log: [...state.log, `Turn ${state.turn}: Played ${card.name.split(' //')[0]}.`],
  }
}

export function goldfishCastRock(state: GoldfishState, deck: Deck): GoldfishState {
  if (state.phase !== 'main') return state
  const mana = availableMana(state)
  const idx = state.hand.findIndex((c) => {
    if (!isRockCard(deck, c)) return false
    return rockCost(c) <= mana
  })
  if (idx < 0) {
    return { ...state, log: [...state.log, 'No affordable mana rock in hand.'] }
  }
  const card = state.hand[idx]
  const cost = rockCost(card)
  let next = spendMana(state, cost)
  next = {
    ...next,
    hand: next.hand.filter((_, i) => i !== idx),
    battlefield: [
      ...next.battlefield,
      { card, tapped: false, isLand: false, isRock: true, rockCost: cost },
    ],
    log: [...next.log, `Cast ${card.name.split(' //')[0]} for ${cost} mana.`],
  }
  return next
}

export function goldfishCastCommander(state: GoldfishState): GoldfishState {
  if (state.phase !== 'main' || state.commanderCast) return state
  const cost = Math.max(0, Math.round(state.commander.cmc)) + state.commanderTax
  const mana = availableMana(state)
  if (mana < cost) {
    return {
      ...state,
      log: [...state.log, `Need ${cost} mana to cast ${state.commander.name.split(' //')[0]} (have ${mana}).`],
    }
  }
  let next = spendMana(state, cost)
  next = {
    ...next,
    commanderCast: true,
    log: [
      ...next.log,
      `Cast commander ${state.commander.name.split(' //')[0]} for ${cost} mana${state.commanderTax ? ` (+${state.commanderTax} tax)` : ''}.`,
    ],
  }
  return next
}

export function goldfishDrawCard(state: GoldfishState): GoldfishState {
  if (state.phase !== 'main' || state.library.length === 0) return state
  const [top, ...library] = state.library
  return {
    ...state,
    library,
    hand: [...state.hand, top],
    log: [...state.log, `Drew ${top.name.split(' //')[0]}.`],
  }
}

export function goldfishEndTurn(state: GoldfishState): GoldfishState {
  if (state.phase !== 'main') return state
  const nextTurn = state.turn + 1
  if (state.library.length === 0) {
    return {
      ...state,
      gameOver: true,
      log: [...state.log, 'Library empty — goldfish session ends.'],
    }
  }
  let next = untapAll(state)
  next = {
    ...next,
    turn: nextTurn,
    landPlayedThisTurn: false,
    log: [...next.log, `--- Turn ${nextTurn} ---`],
  }
  if (nextTurn > 1) {
    next = goldfishDrawCard(next)
  }
  return next
}

export function goldfishSummary(state: GoldfishState): string {
  const lands = state.battlefield.filter((p) => p.isLand).length
  const rocks = state.battlefield.filter((p) => p.isRock).length
  const mana = availableMana(state)
  return `Turn ${state.turn} · ${lands} lands · ${rocks} rocks · ${mana} mana open · ${state.library.length} in library`
}
