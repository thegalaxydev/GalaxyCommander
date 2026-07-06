import type { AchievementDef, PackStats } from './types'

const ACHIEVEMENTS_KEY = 'gc-pack-achievements'

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first-pack',
    name: 'First Pack',
    desc: 'Open your first booster.',
    icon: '📦',
    check: (s) => s.packsOpened >= 1,
  },
  {
    id: 'ten-packs',
    name: 'Getting Started',
    desc: 'Open 10 boosters.',
    icon: '🃏',
    check: (s) => s.packsOpened >= 10,
    progress: (s) => ({ have: s.packsOpened, need: 10 }),
  },
  {
    id: 'first-mythic',
    name: 'Orange Glow',
    desc: 'Open your first mythic rare.',
    icon: '🌟',
    check: (s) => s.mythics >= 1,
  },
  {
    id: 'first-box',
    name: 'Crack a Box',
    desc: 'Open a full booster box.',
    icon: '🎁',
    check: (s) => s.packsOpened >= 36,
    progress: (s) => ({ have: s.packsOpened, need: 36 }),
  },
  {
    id: 'five-sets',
    name: 'Set Sampler',
    desc: 'Open packs from 5 different sets.',
    icon: '🗺️',
    check: (s) => Object.keys(s.bySet).length >= 5,
    progress: (s) => ({ have: Object.keys(s.bySet).length, need: 5 }),
  },
  {
    id: 'mythic-hunter',
    name: 'Mythic Hunter',
    desc: 'Open 100 mythics.',
    icon: '🔥',
    check: (s) => s.mythics >= 100,
    progress: (s) => ({ have: s.mythics, need: 100 }),
  },
  {
    id: 'foil-collector',
    name: 'Foil Collector',
    desc: 'Open 500 foil cards.',
    icon: '✨',
    check: (s) => s.foils >= 500,
    progress: (s) => ({ have: s.foils, need: 500 }),
  },
  {
    id: 'legendary-hoarder',
    name: 'Legendary Hoarder',
    desc: 'Open 250 legendary creatures.',
    icon: '👑',
    check: (s) => s.legendaries >= 250,
    progress: (s) => ({ have: s.legendaries, need: 250 }),
  },
  {
    id: 'commander-addict',
    name: 'Commander Addict',
    desc: 'Build 25 decks from opened commanders.',
    icon: '⚔️',
    check: (s) => s.decksBuilt >= 25,
    progress: (s) => ({ have: s.decksBuilt, need: 25 }),
  },
]

export interface UnlockedMap {
  v: number
  unlocked: Record<string, number>
}

export function loadUnlocked(): UnlockedMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY) ?? '') as Partial<UnlockedMap>
    if (parsed && typeof parsed.unlocked === 'object' && parsed.unlocked) {
      return { v: 1, unlocked: parsed.unlocked as Record<string, number> }
    }
  } catch {
    /* fall through to default */
  }
  return { v: 1, unlocked: {} }
}

/** Check stats against all definitions; persist and return any newly unlocked. */
export function checkAchievements(stats: PackStats): AchievementDef[] {
  const state = loadUnlocked()
  const fresh: AchievementDef[] = []
  for (const def of ACHIEVEMENTS) {
    if (!state.unlocked[def.id] && def.check(stats)) {
      state.unlocked[def.id] = Date.now()
      fresh.push(def)
    }
  }
  if (fresh.length) {
    try {
      localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(state))
    } catch {
      /* best-effort */
    }
  }
  return fresh
}
