import type { ScryCard } from '../types'
import type {
  GeneratedPack,
  OpenedCard,
  PackConfiguration,
  ProductType,
  SetPool,
  SheetName,
  SlotSpec,
} from './types'

export const BOX_SIZE = 36
export const BUNDLE_SIZE = 9

// First set with foils was Urza's Legacy (Feb 1999)
const FOIL_ERA = '1999-02'

export const PRODUCT_CONFIGS: Record<Exclude<ProductType, 'commander' | 'bundle' | 'box'>, PackConfiguration> = {
  play: {
    label: 'Play Booster',
    slots: [
      { sheet: 'common', count: 7 },
      { sheet: 'uncommon', count: 3 },
      { sheet: 'any', count: [1, 2] },
      { sheet: 'rareMythic', count: 1, mythicChance: 1 / 7.4 },
      { sheet: 'any', count: 1, foil: 1 },
      { sheet: 'land', count: 1, foil: 0.2 },
    ],
  },
  collector: {
    label: 'Collector Booster',
    approximate: true,
    slots: [
      { sheet: 'common', count: 4, foil: 1 },
      { sheet: 'uncommon', count: 3, foil: 1 },
      { sheet: 'rareMythic', count: 2, mythicChance: 0.25 },
      { sheet: 'rareMythic', count: 2, mythicChance: 0.25, foil: 1 },
      { sheet: 'any', count: 3, foil: 0.5 },
      { sheet: 'land', count: 1, foil: 1 },
    ],
  },
  jumpstart: {
    label: 'Jumpstart Pack',
    approximate: true,
    slots: [
      { sheet: 'rareMythic', count: 1, mythicChance: 1 / 7.4 },
      { sheet: 'uncommon', count: 4 },
      { sheet: 'common', count: 7 },
      { sheet: 'land', count: 8 },
    ],
  },
}

// Wildcard slot rarity weights for the 'any' sheet
const ANY_WEIGHTS: [SheetName | 'mythic', number][] = [
  ['common', 58],
  ['uncommon', 29],
  ['rareMythic', 11],
  ['mythic', 2],
]

type Rng = () => number

function pick<T>(list: T[], rng: Rng): T {
  return list[Math.floor(rng() * list.length)]
}

/** Rarity sheets with fallbacks so tiny/odd sets (no mythics, no basics) never crash. */
function sheetCards(pool: SetPool, sheet: SheetName, mythic: boolean): ScryCard[] {
  if (sheet === 'land') {
    return pool.lands.length ? pool.lands : pool.commons.length ? pool.commons : pool.all
  }
  if (sheet === 'common') return pool.commons.length ? pool.commons : pool.all
  if (sheet === 'uncommon') {
    return pool.uncommons.length ? pool.uncommons : pool.commons.length ? pool.commons : pool.all
  }
  // rareMythic
  if (mythic && pool.mythics.length) return pool.mythics
  if (pool.rares.length) return pool.rares
  if (pool.mythics.length) return pool.mythics
  if (pool.uncommons.length) return pool.uncommons
  return pool.commons.length ? pool.commons : pool.all
}

function rollAnySheet(pool: SetPool, rng: Rng): ScryCard[] {
  const total = ANY_WEIGHTS.reduce((n, [, w]) => n + w, 0)
  let roll = rng() * total
  for (const [sheet, weight] of ANY_WEIGHTS) {
    roll -= weight
    if (roll <= 0) {
      if (sheet === 'mythic') return sheetCards(pool, 'rareMythic', true)
      return sheetCards(pool, sheet as SheetName, false)
    }
  }
  return sheetCards(pool, 'common', false)
}

function slotCount(count: SlotSpec['count'], rng: Rng): number {
  if (typeof count === 'number') return count
  const [min, max] = count
  return min + Math.floor(rng() * (max - min + 1))
}

export function generatePack(
  pool: SetPool,
  productType: ProductType,
  config: PackConfiguration,
  rng: Rng = Math.random
): GeneratedPack {
  const foilsExist = (pool.set.released_at ?? '9999') >= FOIL_ERA
  const cards: OpenedCard[] = []
  const seen = new Set<string>()
  for (const slot of config.slots) {
    const n = slotCount(slot.count, rng)
    for (let i = 0; i < n; i++) {
      const mythic = slot.sheet === 'rareMythic' && rng() < (slot.mythicChance ?? 0)
      const source =
        slot.sheet === 'any' ? rollAnySheet(pool, rng) : sheetCards(pool, slot.sheet, mythic)
      let card = pick(source, rng)
      // avoid duplicate printings within one pack (basics excepted)
      if (slot.sheet !== 'land' && source.length > 1) {
        for (let retry = 0; retry < 8 && seen.has(card.id); retry++) card = pick(source, rng)
      }
      seen.add(card.id)
      const foil = foilsExist && rng() < (slot.foil ?? 0)
      cards.push({ card, foil, sheet: slot.sheet })
    }
  }
  return { setCode: pool.set.code, productType, cards }
}

export function generateProduct(
  pool: SetPool,
  productType: ProductType,
  quantity: number,
  rng: Rng = Math.random
): GeneratedPack[] {
  let packs = quantity
  let base: Exclude<ProductType, 'commander' | 'bundle' | 'box'> = 'play'
  if (productType === 'bundle') packs = BUNDLE_SIZE * quantity
  else if (productType === 'box') packs = BOX_SIZE * quantity
  else if (productType !== 'commander') base = productType
  const config = PRODUCT_CONFIGS[base]
  return Array.from({ length: packs }, () => generatePack(pool, productType, config, rng))
}
