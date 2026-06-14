import type { AdvancedOptions, BudgetTier, DeckPersonality, PowerProfile } from './types'
import { DEFAULT_PROFILE } from './types'
import { applyPreset } from './personality'
import type { AccentMode, UiPreset } from './themes'

export type LlmProvider = 'openai' | 'anthropic' | 'openrouter'

export interface SavedGeneratorDefaults {
  bracket: 1 | 2 | 3 | 4 | 5
  budget: BudgetTier
  personality: DeckPersonality
  profile: PowerProfile
  meta: string[]
  tags: string[]
  options: AdvancedOptions
}

export interface AppSettings {
  llmEnabled: boolean
  llmProvider: LlmProvider
  llmApiKey: string
  llmModel: string
  llmCustomModel: boolean
  llmBaseUrl: string
  rememberDefaults: boolean
  generatorDefaults: SavedGeneratorDefaults
  simIterations: number
  disableCardPreviews: boolean
  uiPreset: UiPreset
  accentMode: AccentMode
  showStarfield: boolean
  reducedMotion: boolean
}

const STORAGE_KEY = 'galaxy-commander-settings'

export const DEFAULT_OPTIONS: AdvancedOptions = {
  includeStaples: true,
  prioritizeSynergy: true,
  avoidCombos: false,
  avoidTutors: false,
  latestSets: true,
}

export function defaultGeneratorDefaults(): SavedGeneratorDefaults {
  return {
    bracket: 3,
    budget: 'mid',
    personality: 'value',
    profile: applyPreset('value', DEFAULT_OPTIONS).profile,
    meta: [],
    tags: [],
    options: { ...DEFAULT_OPTIONS },
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  llmEnabled: false,
  llmProvider: 'openai',
  llmApiKey: '',
  llmModel: 'gpt-5.5',
  llmCustomModel: false,
  llmBaseUrl: '',
  rememberDefaults: true,
  generatorDefaults: defaultGeneratorDefaults(),
  simIterations: 1000,
  disableCardPreviews: false,
  uiPreset: 'galaxy',
  accentMode: 'commander',
  showStarfield: true,
  reducedMotion: false,
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS, generatorDefaults: defaultGeneratorDefaults() }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      generatorDefaults: {
        ...defaultGeneratorDefaults(),
        ...parsed.generatorDefaults,
        profile: {
          ...DEFAULT_PROFILE,
          ...parsed.generatorDefaults?.profile,
        },
        options: {
          ...DEFAULT_OPTIONS,
          ...parsed.generatorDefaults?.options,
        },
      },
    }
  } catch {
    return { ...DEFAULT_SETTINGS, generatorDefaults: defaultGeneratorDefaults() }
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export const PROVIDER_MODELS: Record<LlmProvider, string[]> = {
  openai: ['gpt-5.5', 'gpt-5.4', 'gpt-5.3', 'o3'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-latest'],
  openrouter: ['openai/gpt-5.5', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash-preview'],
}

export const SIM_ITERATION_OPTIONS = [500, 1000, 2500, 5000] as const

export function clearAllLocalData(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem('gc-saved-decks')
}
