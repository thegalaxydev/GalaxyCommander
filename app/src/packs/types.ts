import type { ScryCard } from '../types'

export type ProductType = 'play' | 'collector' | 'jumpstart' | 'commander' | 'bundle' | 'box'

export type SheetName = 'common' | 'uncommon' | 'rareMythic' | 'any' | 'land'

export interface SlotSpec {
  sheet: SheetName
  count: number | [number, number]
  /** Probability [0,1] that each card in this slot is foil. */
  foil?: number
  /** For rareMythic sheets: probability the slot upgrades to mythic. */
  mythicChance?: number
}

export interface PackConfiguration {
  label: string
  /** True when the collation is a rough approximation of the real product. */
  approximate?: boolean
  slots: SlotSpec[]
}

export interface OpenedCard {
  card: ScryCard
  foil: boolean
  sheet: SheetName
}

export interface GeneratedPack {
  setCode: string
  productType: ProductType
  cards: OpenedCard[]
}

export interface SetInfo {
  code: string
  name: string
  released_at: string
  card_count: number
  set_type: string
  icon_svg_uri?: string
}

export interface SetPool {
  set: SetInfo
  commons: ScryCard[]
  uncommons: ScryCard[]
  rares: ScryCard[]
  mythics: ScryCard[]
  lands: ScryCard[]
  all: ScryCard[]
}

/** Compact per-card metadata cached in localStorage so the binder,
 *  stats, and replay never need to refetch from Scryfall. */
export interface CardMeta {
  /** name */
  n: string
  /** set code */
  s: string
  /** rarity */
  r: string
  /** color identity, joined e.g. "WU"; '' = colorless */
  c: string
  /** type_line */
  t: string
  /** small image uri */
  i?: string
  /** usd price at time of opening */
  p?: number
  /** legendary creature (potential commander) */
  leg?: boolean
}

export interface PackStats {
  v: number
  packsOpened: number
  cardsOpened: number
  commons: number
  uncommons: number
  rares: number
  mythics: number
  foils: number
  legendaries: number
  decksBuilt: number
  bySet: Record<string, { packs: number; cards: number }>
  byColor: Record<string, number>
  bestPull?: { id: string; name: string; price: number }
}

/** One opened pack inside a session: [cardId, foilFlag] pairs. */
export interface SessionPack {
  c: [string, 0 | 1][]
}

export interface PackSession {
  id: string
  ts: number
  setCode: string
  setName: string
  product: ProductType
  packs: SessionPack[]
}

export interface AchievementDef {
  id: string
  name: string
  desc: string
  icon: string
  check: (stats: PackStats) => boolean
  progress?: (stats: PackStats) => { have: number; need: number }
}
