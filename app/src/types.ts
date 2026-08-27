export interface ScryImageUris {
  small?: string
  normal?: string
  large?: string
  art_crop?: string
}

export interface ScryCardFace {
  name: string
  mana_cost?: string
  type_line?: string
  oracle_text?: string
  image_uris?: ScryImageUris
  colors?: string[]
  color_indicator?: string[]
  power?: string
  toughness?: string
  loyalty?: string
  defense?: string
  flavor_text?: string
  artist?: string
  watermark?: string
  layout?: string
}

export interface ScryCard {
  id: string
  oracle_id: string
  name: string
  layout?: string
  mana_cost?: string
  cmc: number
  type_line: string
  oracle_text?: string
  colors?: string[]
  color_identity: string[]
  keywords?: string[]
  power?: string
  toughness?: string
  image_uris?: ScryImageUris
  card_faces?: ScryCardFace[]
  prices: {
    usd: string | null
    usd_foil?: string | null
    usd_etched?: string | null
    eur?: string | null
    eur_foil?: string | null
    tix?: string | null
  }
  edhrec_rank?: number
  game_changer?: boolean
  produced_mana?: string[]
  legalities: Record<string, string>
  released_at?: string
  rarity?: string
  set?: string
  set_name?: string
  collector_number?: string
  finishes?: string[]
  booster?: boolean
  promo_types?: string[]
  frame_effects?: string[]
  // Everything below backs the Scryfall-syntax Card Rules filter (deckRules.ts).
  color_indicator?: string[]
  loyalty?: string
  defense?: string
  hand_modifier?: string
  life_modifier?: string
  reserved?: boolean
  penny_rank?: number
  set_type?: string
  artist?: string
  artist_ids?: string[]
  flavor_text?: string
  watermark?: string
  border_color?: string
  frame?: string
  full_art?: boolean
  textless?: boolean
  promo?: boolean
  digital?: boolean
  games?: string[]
  foil?: boolean
  nonfoil?: boolean
  oversized?: boolean
  story_spotlight?: boolean
  variation?: boolean
  reprint?: boolean
  highres_image?: boolean
  image_status?: string
  lang?: string
  security_stamp?: string
  content_warning?: boolean
  attraction_lights?: number[]
  all_parts?: { component?: string; name?: string; type_line?: string }[]
}

export type Category =
  | 'Commander'
  | 'Lands'
  | 'Ramp'
  | 'Card Draw'
  | 'Tutors'
  | 'Removal'
  | 'Counterspells'
  | 'Board Wipes'
  | 'Graveyard Hate'
  | 'Recursion'
  | 'Protection'
  | 'Tokens'
  | 'Stax'
  | 'Synergy'
  | 'Finishers'

export const CATEGORY_ORDER: Category[] = [
  'Commander',
  'Ramp',
  'Card Draw',
  'Tutors',
  'Removal',
  'Counterspells',
  'Board Wipes',
  'Graveyard Hate',
  'Recursion',
  'Protection',
  'Tokens',
  'Stax',
  'Synergy',
  'Finishers',
  'Lands',
]

export interface DeckCard {
  card: ScryCard
  category: Category
  qty: number
  reason: string
}

export type BudgetTier = 'any' | 'low' | 'mid' | 'high'

export interface BudgetCaps {
  low: number
  mid: number
  high: number
}

export const DEFAULT_BUDGET_CAPS: BudgetCaps = { low: 5, mid: 20, high: 50 }

export type DeckPersonality = 'custom' | 'value' | 'combo' | 'control' | 'aggro' | 'synergy'

export interface AdvancedOptions {
  includeStaples: boolean
  prioritizeSynergy: boolean
  avoidCombos: boolean
  avoidTutors: boolean
  latestSets: boolean
  noSpoilers: boolean
  allowUnsetCards: boolean
  snowBasics: boolean
}

export interface PowerProfile {
  ramp: number
  interaction: number
  draw: number
  combo: number
  tutors: number
  resiliency: number
}

export const DEFAULT_PROFILE: PowerProfile = {
  ramp: 50,
  interaction: 50,
  draw: 50,
  combo: 50,
  tutors: 50,
  resiliency: 50,
}

export const META_OPTIONS = [
  'Aggro-heavy',
  'Midrange-heavy',
  'Combo-heavy',
  'Battlecruiser',
  'Stax-heavy',
] as const

/**
 * A card pinned into the deck by the user, and how many copies to run. Anything
 * above one copy is only legal for basics and "any number of cards named…"
 * cards, but the generator honours whatever the deckbuilder asked for.
 */
export interface MustIncludeCard {
  card: ScryCard
  qty: number
}

/** Cards a deck may legally run more than one copy of. */
export function allowsMultiples(card: ScryCard): boolean {
  if (card.type_line?.includes('Basic')) return true
  const text = card.oracle_text ?? (card.card_faces ?? []).map((f) => f.oracle_text ?? '').join('\n')
  return /any number of cards named/i.test(text)
}

export interface BuildSettings {
  commander: ScryCard
  partner?: ScryCard | null
  bracket: 1 | 2 | 3 | 4 | 5
  budget: BudgetTier
  budgetCaps?: BudgetCaps
  themes: string[]
  themeSlugs?: string[]
  tags: string[]
  options: AdvancedOptions
  powerProfile?: PowerProfile
  personality?: DeckPersonality
  meta?: string[]
  mustInclude?: MustIncludeCard[]
  neverInclude?: string[]
  // Rulebreaker: the extra color chosen for a "one color of your choice" clause
  // (Tolabow, Loch Rascal). Ignored unless the commander grants one.
  splashColor?: string | null
  // Rulebreaker: which colors the "any color identity" exceptions may pull from.
  // Undefined or all five means unrestricted, as printed.
  rulebreakerColors?: string[] | null
  // Total cards including the commander(s). Only ever anything but 100 when a
  // Rulebreaker commander lifts the maximum deck size (Whtz, the Bibliophile).
  deckSize?: number
  // Scryfall-style filter fragments (e.g. `t:Legendary -t:Land`) applied to every
  // auto-added card. See deckRules.ts.
  rules?: string
  // Set codes, highest priority first. Once the list is built, every card is
  // re-printed from the first of these sets that has it. Purely cosmetic — it
  // changes which art you get, never which cards are chosen.
  preferredSets?: string[]
}

export interface Deck {
  commander: ScryCard
  cards: DeckCard[]
  settings: BuildSettings
  power: number
  description: string
  attractions?: DeckCard[]
}

/**
 * A slot in a combo that any qualifying card can fill, e.g. "Permanent that can
 * be cast using {C}". Spellbook lists these separately from the named cards, so
 * they still count toward the combo's real size.
 */
export interface ComboTemplate {
  name: string
  quantity: number
}

export interface ComboInfo {
  /** Commander Spellbook variant id, e.g. `3875-5702--143`. */
  id?: string
  cards: string[]
  /** Unnamed slots the combo also needs. See ComboTemplate. */
  requires?: ComboTemplate[]
  produces: string[]
  description: string
  missing?: string[]
  bracketTag?: string
  executeMana?: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface GenStep {
  label: string
  status: 'pending' | 'active' | 'done'
}

export interface UpgradeSwap {
  outName: string
  outPrice: number
  in: ScryCard
  inPrice: number
  powerGain: number
  note: string
}

export interface UpgradeTier {
  maxPrice: number
  label: string
  swaps: UpgradeSwap[]
}
