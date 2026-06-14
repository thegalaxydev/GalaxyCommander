import type { AdvancedOptions, DeckPersonality, PowerProfile } from './types'
import { DEFAULT_PROFILE } from './types'

export interface PersonalityPreset {
  id: Exclude<DeckPersonality, 'custom'>
  label: string
  hint: string
  profile: PowerProfile
  tags: string[]
  options: Partial<AdvancedOptions>
}

export const PERSONALITY_PRESETS: PersonalityPreset[] = [
  {
    id: 'value',
    label: 'Value',
    hint: 'Card advantage and resilient threats.',
    profile: { ramp: 55, interaction: 45, draw: 70, combo: 25, tutors: 35, resiliency: 55 },
    tags: [],
    options: { prioritizeSynergy: true, includeStaples: true },
  },
  {
    id: 'combo',
    label: 'Combo',
    hint: 'Enablers, tutors, and compact win lines.',
    profile: { ramp: 60, interaction: 35, draw: 55, combo: 90, tutors: 75, resiliency: 40 },
    tags: [],
    options: { prioritizeSynergy: true, avoidCombos: false, avoidTutors: false },
  },
  {
    id: 'control',
    label: 'Control',
    hint: 'Answer threats, then take over.',
    profile: { ramp: 45, interaction: 85, draw: 70, combo: 30, tutors: 40, resiliency: 50 },
    tags: ['Control'],
    options: { includeStaples: true },
  },
  {
    id: 'aggro',
    label: 'Aggro',
    hint: 'Fast mana and early pressure.',
    profile: { ramp: 70, interaction: 25, draw: 40, combo: 20, tutors: 25, resiliency: 45 },
    tags: ['Aggro'],
    options: { prioritizeSynergy: true },
  },
  {
    id: 'synergy',
    label: 'Synergy',
    hint: 'Commander and theme cohesion over staples.',
    profile: { ramp: 50, interaction: 40, draw: 55, combo: 55, tutors: 45, resiliency: 55 },
    tags: [],
    options: { prioritizeSynergy: true, includeStaples: false },
  },
]

export function presetById(id: Exclude<DeckPersonality, 'custom'>): PersonalityPreset {
  return PERSONALITY_PRESETS.find((p) => p.id === id)!
}

export function applyPreset(
  id: Exclude<DeckPersonality, 'custom'>,
  baseOptions: AdvancedOptions
): { profile: PowerProfile; tags: string[]; options: AdvancedOptions } {
  const preset = presetById(id)
  return {
    profile: { ...preset.profile },
    tags: [...preset.tags],
    options: { ...baseOptions, ...preset.options },
  }
}

export function profilesMatch(a: PowerProfile, b: PowerProfile): boolean {
  return (Object.keys(DEFAULT_PROFILE) as (keyof PowerProfile)[]).every((k) => a[k] === b[k])
}

export function detectPersonality(profile: PowerProfile, tags: string[]): DeckPersonality {
  for (const preset of PERSONALITY_PRESETS) {
    if (profilesMatch(profile, preset.profile)) {
      const tagOk =
        preset.tags.length === 0
          ? !tags.includes('Aggro') && !tags.includes('Control')
          : preset.tags.every((t) => tags.includes(t))
      if (tagOk) return preset.id
    }
  }
  return 'custom'
}
