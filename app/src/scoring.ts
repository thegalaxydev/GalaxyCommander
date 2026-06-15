import type { AdvancedOptions, Category, DeckPersonality } from './types'

export interface ScoreWeights {
  synergy: number
  inclusion: number
  theme: number
  budget: number
  curve: number
  role: number
}

export interface ScoreInput {
  synergy: number
  inclusion: number
  isTheme: boolean
  price: number
  cap: number
  cmc: number
  category: Category
  personality: DeckPersonality
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

const BASE: ScoreWeights = {
  synergy: 3,
  inclusion: 1.2,
  theme: 1.2,
  budget: 0.6,
  curve: 0.5,
  role: 0.5,
}

export const PERSONALITY_WEIGHTS: Record<DeckPersonality, ScoreWeights> = {
  custom: { ...BASE },
  value: { synergy: 2.4, inclusion: 1.8, theme: 1.0, budget: 0.8, curve: 0.5, role: 0.6 },
  combo: { synergy: 3.4, inclusion: 1.0, theme: 1.3, budget: 0.4, curve: 0.6, role: 0.7 },
  control: { synergy: 2.6, inclusion: 1.4, theme: 0.9, budget: 0.5, curve: 0.5, role: 0.9 },
  aggro: { synergy: 2.6, inclusion: 1.1, theme: 1.1, budget: 0.6, curve: 0.9, role: 0.7 },
  synergy: { synergy: 3.8, inclusion: 0.9, theme: 1.5, budget: 0.4, curve: 0.5, role: 0.5 },
}

const ROLE_PRIORITY: Record<DeckPersonality, Partial<Record<Category, number>>> = {
  custom: { Ramp: 0.7, 'Card Draw': 0.8, Removal: 0.7, 'Board Wipes': 0.5, Synergy: 0.7, Finishers: 0.5 },
  value: { Ramp: 0.7, 'Card Draw': 0.85, Removal: 0.7, 'Board Wipes': 0.5, Synergy: 0.7, Finishers: 0.5 },
  combo: { Ramp: 0.7, 'Card Draw': 0.8, Removal: 0.5, 'Board Wipes': 0.3, Synergy: 0.95, Finishers: 0.4 },
  control: { Ramp: 0.5, 'Card Draw': 0.9, Removal: 1.0, 'Board Wipes': 0.9, Synergy: 0.6, Finishers: 0.4 },
  aggro: { Ramp: 0.6, 'Card Draw': 0.4, Removal: 0.5, 'Board Wipes': 0.2, Synergy: 0.8, Finishers: 1.0 },
  synergy: { Ramp: 0.6, 'Card Draw': 0.6, Removal: 0.5, 'Board Wipes': 0.4, Synergy: 1.0, Finishers: 0.6 },
}

export function resolveWeights(
  personality: DeckPersonality,
  options: AdvancedOptions
): ScoreWeights {
  const w = { ...(PERSONALITY_WEIGHTS[personality] ?? BASE) }
  if (!options.prioritizeSynergy) {
    w.synergy *= 0.55
    w.inclusion *= 1.25
  }
  if (!options.includeStaples) {
    w.inclusion *= 0.45
  }
  return w
}

export function rankInclusion(rank?: number): number {
  if (rank == null) return 0.15
  return clamp01((40000 - rank) / 40000)
}

function budgetComponent(price: number, cap: number): number {
  if (!Number.isFinite(cap) || cap <= 0) return 0.5
  return clamp01(1 - price / cap)
}

function curveComponent(cmc: number, category: Category): number {
  if (category === 'Finishers') return clamp01((cmc - 2) / 5)
  if (category === 'Lands') return 0.5
  return clamp01(1 - Math.max(0, cmc - 2) / 6)
}

function roleComponent(category: Category, personality: DeckPersonality): number {
  return ROLE_PRIORITY[personality]?.[category] ?? 0.5
}

export function finalScore(input: ScoreInput, w: ScoreWeights): number {
  return (
    clamp01(input.synergy) * w.synergy +
    clamp01(input.inclusion) * w.inclusion +
    (input.isTheme ? 1 : 0) * w.theme +
    budgetComponent(input.price, input.cap) * w.budget +
    curveComponent(input.cmc, input.category) * w.curve +
    roleComponent(input.category, input.personality) * w.role
  )
}
