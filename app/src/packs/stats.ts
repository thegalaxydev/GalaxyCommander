import { cardPrice } from '../scryfall'
import { isLegendaryCreature } from './setPool'
import type { GeneratedPack, PackStats } from './types'
import { scheduleUserDataSync } from '../auth/sync'

const STATS_KEY = 'gc-pack-stats'

export function defaultStats(): PackStats {
  return {
    v: 1,
    packsOpened: 0,
    cardsOpened: 0,
    commons: 0,
    uncommons: 0,
    rares: 0,
    mythics: 0,
    foils: 0,
    legendaries: 0,
    decksBuilt: 0,
    bySet: {},
    byColor: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, M: 0 },
  }
}

export function loadStats(): PackStats {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATS_KEY) ?? '') as Partial<PackStats>
    if (parsed && typeof parsed.packsOpened === 'number') {
      const base = defaultStats()
      return { ...base, ...parsed, byColor: { ...base.byColor, ...parsed.byColor }, bySet: parsed.bySet ?? {} }
    }
  } catch {
    /* fall through to default */
  }
  return defaultStats()
}

export function saveStats(stats: PackStats): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats))
    scheduleUserDataSync()
  } catch {
    /* stats are best-effort */
  }
}

export function recordPacks(stats: PackStats, packs: GeneratedPack[]): PackStats {
  const next: PackStats = {
    ...stats,
    bySet: { ...stats.bySet },
    byColor: { ...stats.byColor },
  }
  for (const pack of packs) {
    next.packsOpened++
    const bySet = (next.bySet[pack.setCode] ??= { packs: 0, cards: 0 })
    bySet.packs++
    for (const { card, foil } of pack.cards) {
      next.cardsOpened++
      bySet.cards++
      if (foil) next.foils++
      if (card.rarity === 'common') next.commons++
      else if (card.rarity === 'uncommon') next.uncommons++
      else if (card.rarity === 'mythic') next.mythics++
      else next.rares++
      if (isLegendaryCreature(card)) next.legendaries++
      const identity = card.color_identity ?? []
      if (identity.length === 0) next.byColor.C++
      else if (identity.length > 1) next.byColor.M++
      else next.byColor[identity[0]] = (next.byColor[identity[0]] ?? 0) + 1
      const price = cardPrice(card)
      if (price > (next.bestPull?.price ?? 0)) {
        next.bestPull = { id: card.id, name: card.name, price }
      }
    }
  }
  return next
}

export function favoriteSet(stats: PackStats): string | null {
  let best: string | null = null
  let packs = 0
  for (const [code, entry] of Object.entries(stats.bySet)) {
    if (entry.packs > packs) {
      best = code
      packs = entry.packs
    }
  }
  return best
}

export function mostOpenedColor(stats: PackStats): string | null {
  const names: Record<string, string> = {
    W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless', M: 'Multicolor',
  }
  let best: string | null = null
  let count = 0
  for (const [color, n] of Object.entries(stats.byColor)) {
    if (n > count) {
      best = names[color] ?? color
      count = n
    }
  }
  return best
}
