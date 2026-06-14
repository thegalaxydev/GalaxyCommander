import type { Deck, DeckCard, ScryCard } from './types'
import { cardOracle } from './scryfall'

export interface SimResult {
  iterations: number
  avgLands: number
  avgRamp: number
  avgDraw: number
  mulliganRate: number
  commanderCmc: number
  commanderByTurn: { turn: number; probability: number }[]
  avgCommanderTurn: number
}

interface SimCard {
  name: string
  isLand: boolean
  isRock: boolean
  rockCost: number
  isDraw: boolean
}

function expandLibrary(deck: Deck): SimCard[] {
  const library: SimCard[] = []
  for (const d of deck.cards) {
    if (d.category === 'Commander') continue
    const oracle = cardOracle(d.card)
    const isLand = d.category === 'Lands'
    const isRock =
      !isLand && d.category === 'Ramp' && /{T}: Add|adds? (one|two) mana/i.test(oracle)
    for (let i = 0; i < d.qty; i++) {
      library.push({
        name: d.card.name,
        isLand,
        isRock,
        rockCost: Math.round(d.card.cmc),
        isDraw: d.category === 'Card Draw',
      })
    }
  }
  return library
}

function shuffle(cards: SimCard[]): SimCard[] {
  const arr = [...cards]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function keepable(hand: SimCard[]): boolean {
  const lands = hand.filter((c) => c.isLand).length
  return lands >= 2 && lands <= 5
}

export function simulateHands(deck: Deck, iterations = 1000): SimResult {
  const base = expandLibrary(deck)
  const commanderCmc = Math.max(1, Math.round(deck.commander.cmc))
  const maxTurn = 10

  let totalLands = 0
  let totalRamp = 0
  let totalDraw = 0
  let mulligans = 0
  let totalCastTurn = 0
  const castByTurn = new Array(maxTurn + 1).fill(0)

  for (let i = 0; i < iterations; i++) {
    const library = shuffle(base)
    const hand = library.slice(0, 7)

    totalLands += hand.filter((c) => c.isLand).length
    totalRamp += hand.filter((c) => c.isRock).length
    totalDraw += hand.filter((c) => c.isDraw).length
    if (!keepable(hand)) mulligans++

    let landsInPlay = 0
    let rockMana = 0
    let drawIndex = 7
    const current = [...hand]
    let castTurn = maxTurn + 1
    for (let turn = 1; turn <= maxTurn; turn++) {
      if (turn > 1 && drawIndex < library.length) {
        current.push(library[drawIndex++])
      }
      const landIdx = current.findIndex((c) => c.isLand)
      if (landIdx >= 0) {
        landsInPlay++
        current.splice(landIdx, 1)
      }
      let mana = landsInPlay + rockMana
      const affordable = current
        .filter((c) => c.isRock && c.rockCost <= mana - rockMana)
        .sort((a, b) => a.rockCost - b.rockCost)
      for (const rock of affordable) {
        if (rock.rockCost > mana) break
        mana -= rock.rockCost
        rockMana++
        current.splice(current.indexOf(rock), 1)
      }
      if (landsInPlay + rockMana >= commanderCmc) {
        castTurn = turn
        break
      }
    }
    totalCastTurn += Math.min(castTurn, maxTurn + 1)
    if (castTurn <= maxTurn) {
      for (let t = castTurn; t <= maxTurn; t++) castByTurn[t]++
    }
  }

  const start = Math.max(1, commanderCmc - 1)
  const commanderByTurn: { turn: number; probability: number }[] = []
  for (let t = start; t <= Math.min(maxTurn, start + 4); t++) {
    commanderByTurn.push({ turn: t, probability: castByTurn[t] / iterations })
  }

  return {
    iterations,
    avgLands: totalLands / iterations,
    avgRamp: totalRamp / iterations,
    avgDraw: totalDraw / iterations,
    mulliganRate: mulligans / iterations,
    commanderCmc,
    commanderByTurn,
    avgCommanderTurn: totalCastTurn / iterations,
  }
}

export interface SampleHand {
  cards: ScryCard[]
  lands: number
  keepable: boolean
}

export function drawSampleHand(deck: Deck): SampleHand {
  const pool: { card: ScryCard; deckCard: DeckCard }[] = []
  for (const d of deck.cards) {
    if (d.category === 'Commander') continue
    for (let i = 0; i < d.qty; i++) pool.push({ card: d.card, deckCard: d })
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const hand = pool.slice(0, 7)
  const lands = hand.filter((h) => h.deckCard.category === 'Lands').length
  return { cards: hand.map((h) => h.card), lands, keepable: lands >= 2 && lands <= 5 }
}
