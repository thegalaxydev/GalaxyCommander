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
  image_uris?: ScryImageUris
  card_faces?: ScryCardFace[]
  prices: { usd: string | null }
  edhrec_rank?: number
  game_changer?: boolean
  produced_mana?: string[]
  legalities: Record<string, string>
  released_at?: string
}

export type Category =
  | 'Commander'
  | 'Lands'
  | 'Ramp'
  | 'Card Draw'
  | 'Removal'
  | 'Board Wipes'
  | 'Synergy'
  | 'Finishers'

export const CATEGORY_ORDER: Category[] = [
  'Commander',
  'Ramp',
  'Card Draw',
  'Removal',
  'Board Wipes',
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

export type DeckPersonality = 'custom' | 'value' | 'combo' | 'control' | 'aggro' | 'synergy'

export interface AdvancedOptions {
  includeStaples: boolean
  prioritizeSynergy: boolean
  avoidCombos: boolean
  avoidTutors: boolean
  latestSets: boolean
  noSpoilers: boolean
  allowUnsetCards: boolean
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

export interface BuildSettings {
  commander: ScryCard
  partner?: ScryCard | null
  bracket: 1 | 2 | 3 | 4 | 5
  budget: BudgetTier
  themes: string[]
  themeSlugs?: string[]
  tags: string[]
  options: AdvancedOptions
  powerProfile?: PowerProfile
  personality?: DeckPersonality
  meta?: string[]
  mustInclude?: ScryCard[]
  neverInclude?: string[]
}

export interface Deck {
  commander: ScryCard
  cards: DeckCard[]
  settings: BuildSettings
  power: number
  description: string
  attractions?: DeckCard[]
}

export interface ComboInfo {
  cards: string[]
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
