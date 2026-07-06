import type { ScryCard } from '../types'
import { SCRY_BASE, searchCards } from '../scryfall'
import type { SetInfo, SetPool } from './types'

const OPENABLE_SET_TYPES = new Set(['core', 'expansion', 'masters', 'draft_innovation'])

let setsCache: Promise<SetInfo[]> | null = null
// parent set code → codes of its commander/companion sets (e.g. blb → [blc])
const childSetCodes = new Map<string, string[]>()

export function fetchSets(): Promise<SetInfo[]> {
  if (!setsCache) {
    setsCache = (async () => {
      const res = await fetch(`${SCRY_BASE}/sets`)
      if (!res.ok) throw new Error('Could not load the set list from Scryfall.')
      const data = await res.json()
      const sets = (data.data ?? []) as (SetInfo & { digital?: boolean; parent_set_code?: string })[]
      childSetCodes.clear()
      for (const s of sets) {
        if (!s.parent_set_code) continue
        const parent = s.parent_set_code.toLowerCase()
        childSetCodes.set(parent, [...(childSetCodes.get(parent) ?? []), s.code.toLowerCase()])
      }
      return sets
        .filter((s) => !s.digital && s.card_count > 0 && OPENABLE_SET_TYPES.has(s.set_type))
        .sort((a, b) => (a.released_at < b.released_at ? 1 : -1))
    })().catch((err) => {
      setsCache = null
      throw err
    })
  }
  return setsCache
}

/** Codes of sets released alongside this one (commander decks, bonus sheets…). */
export async function relatedSetCodes(code: string): Promise<string[]> {
  await fetchSets()
  return childSetCodes.get(code.toLowerCase()) ?? []
}

const poolCache = new Map<string, Promise<SetPool>>()

function isBasicLand(card: ScryCard): boolean {
  return card.type_line?.startsWith('Basic Land') ?? false
}

export function isLegendaryCreature(card: ScryCard): boolean {
  const front = (card.type_line ?? '').split(' // ')[0]
  return front.includes('Legendary') && front.includes('Creature')
}

async function buildPool(set: SetInfo): Promise<SetPool> {
  let cards = await searchCards(`e:${set.code} is:booster -is:digital`, {
    unique: 'prints',
    order: 'set',
    max: 1000,
  })
  if (!cards.length) {
    cards = await searchCards(`e:${set.code} -is:digital`, {
      unique: 'prints',
      order: 'set',
      max: 1000,
    })
  }
  if (!cards.length) throw new Error(`No cards found for set "${set.name}".`)
  const pool: SetPool = {
    set,
    commons: [],
    uncommons: [],
    rares: [],
    mythics: [],
    lands: [],
    all: cards,
  }
  for (const card of cards) {
    if (isBasicLand(card)) {
      pool.lands.push(card)
      continue
    }
    switch (card.rarity) {
      case 'common':
        pool.commons.push(card)
        break
      case 'uncommon':
        pool.uncommons.push(card)
        break
      case 'rare':
        pool.rares.push(card)
        break
      case 'mythic':
        pool.mythics.push(card)
        break
      default:
        // special/bonus rarities join the rare sheet so they stay openable
        pool.rares.push(card)
    }
  }
  return pool
}

export function fetchSetPool(set: SetInfo): Promise<SetPool> {
  let pool = poolCache.get(set.code)
  if (!pool) {
    pool = buildPool(set).catch((err) => {
      poolCache.delete(set.code)
      throw err
    })
    poolCache.set(set.code, pool)
  }
  return pool
}
