export const SUGGESTED_THEMES = [
  'Tokens',
  'Aristocrats',
  'Reanimator',
  'Counters',
  'Spellslinger',
  'Lifegain',
  'Artifacts',
  'Enchantress',
  'Landfall',
  'Mill',
  'Voltron',
  'Stax',
] as const

export const TAGS = ['Topdeck', 'Aggro', 'Control', 'Tribal'] as const

export const THEME_QUERIES: Record<string, string> = {
  Tokens: '(o:"create" o:"token")',
  Aristocrats:
    '(o:"sacrifice a creature" or o:"whenever a creature you control dies" or (o:"dies" o:"each opponent"))',
  Reanimator:
    '(o:"from your graveyard to the battlefield" or o:"return target creature card from your graveyard")',
  Counters: '(o:proliferate or o:"+1/+1 counter")',
  Spellslinger:
    '(o:"whenever you cast an instant" or o:"instant and sorcery" or o:"instant or sorcery")',
  Lifegain: '(o:"you gain life" or o:"whenever you gain life" or o:lifelink)',
  Artifacts: '(o:"artifact you control" or o:"artifacts you control" or o:"whenever an artifact")',
  Enchantress: '(o:"enchantment" (o:"whenever you cast" or o:"enchantments you control"))',
  Landfall: '(o:landfall or o:"whenever a land you control enters" or o:"play an additional land")',
  Mill: '(o:mill or o:"puts the top" o:"graveyard")',
  Voltron: '(t:equipment or t:aura or o:"equipped creature" or o:"enchanted creature")',
  Stax: '(o:"can\'t untap" or o:"players can\'t" or o:"spells cost" o:"more to cast")',
  Poison: '(o:toxic or o:infect or o:"poison counter")',
  Proliferate: 'o:proliferate',
}

export const TAG_QUERIES: Record<string, string> = {
  Topdeck: '(o:"top of your library" or o:scry)',
  Aggro: '(t:creature (o:haste or o:"attacks" or pow>=3) mv<=4)',
  Control: '(o:"counter target" or o:"destroy all" or o:"return target")',
}

export const THEME_DESCRIPTIONS: Record<string, string> = {
  Tokens: 'Flood the board with creature tokens, then leverage them for damage, sacrifice fuel, or go wide.',
  Aristocrats: 'Sacrifice your own creatures for value, draining opponents with death triggers and recursion.',
  Reanimator: 'Cheat big creatures from the graveyard into play for a fraction of their mana cost.',
  Counters: 'Build up +1/+1 counters and proliferate them to grow an overwhelming board.',
  '+1/+1 Counters': 'Build up +1/+1 counters and proliferate them to grow an overwhelming board.',
  Spellslinger: 'Lean on instants and sorceries, with payoffs that trigger whenever you cast noncreature spells.',
  Lifegain: 'Gain life repeatedly and convert that life total into card draw, damage, or board presence.',
  Artifacts: 'Generate value from a dense artifact base — cost reduction, recursion, and artifact synergies.',
  Enchantress: 'Cast enchantments to draw cards and snowball passive value engines.',
  Enchantments: 'Cast enchantments to draw cards and snowball passive value engines.',
  Landfall: 'Trigger powerful effects each time a land enters, often with extra land drops and ramp.',
  Mill: "Grind opponents' libraries into the graveyard until they can't draw.",
  Voltron: 'Suit up a single creature with equipment and auras to win through commander damage.',
  Stax: 'Slow the game to a crawl with taxes and lock pieces while you operate above them.',
  Combo: 'Assemble specific card combinations that generate an immediate or inevitable win.',
  Sacrifice: 'Repeatedly sacrifice permanents for value and recursion loops.',
  Blink: 'Flicker creatures in and out to abuse enter-the-battlefield triggers.',
  Flicker: 'Flicker creatures in and out to abuse enter-the-battlefield triggers.',
  Superfriends: 'Deploy and protect a wall of planeswalkers, ticking up to ultimate advantage.',
  Planeswalkers: 'Deploy and protect a wall of planeswalkers, ticking up to ultimate advantage.',
  'Group Hug': 'Give everyone resources to steer the game and profit from the extra cards and mana.',
  Storm: 'Chain cheap spells in one turn to build a high storm count for an explosive payoff.',
  Treasure: 'Generate Treasure tokens for explosive ramp and artifact synergies.',
  Wheels: 'Force everyone to discard and redraw, refilling your hand while disrupting theirs.',
  Ramp: 'Accelerate your mana to cast threats well ahead of the table.',
  'Big Mana': 'Generate huge amounts of mana to power out expensive, game-ending spells.',
  Lands: 'Treat lands as the engine — recursion, extra drops, and lands-matter payoffs.',
  Graveyard: 'Use the graveyard as a resource, recurring and reanimating key cards.',
  Discard: "Strip opponents' hands and punish them for having few cards.",
  Theft: "Steal opponents' creatures and spells and turn them against the table.",
  Equipment: 'Lean on equipment to repeatedly buff and protect your creatures.',
  Auras: 'Enchant creatures with auras for efficient, snowballing threats.',
  Poison: 'Win through toxic and infect, dealing poison counters instead of damage.',
  Infect: 'Win through toxic and infect, dealing poison counters instead of damage.',
  Devotion: 'Pack colored pips to fuel devotion payoffs and big mana.',
  Vehicles: 'Crew powerful Vehicles for evasive, removal-resistant threats.',
  Politics: 'Bargain, threaten, and incentivize opponents to shape the game in your favor.',
  Pillowfort: 'Discourage attacks with deterrents and defenses while you build to a win.',
  Burn: 'Point direct damage at opponents to race them down.',
  Control: 'Counter and remove threats, win late once the board is locked up.',
  Aggro: 'Apply early pressure with cheap, aggressive creatures.',
}

export function describeTheme(theme: string, count?: number): string {
  const desc =
    THEME_DESCRIPTIONS[theme] ??
    (TRIBES.some((t) => t.toLowerCase() === theme.trim().toLowerCase())
      ? `A ${theme} typal deck — cards that care about ${theme}s and reward going wide on the tribe.`
      : `Pulls cards that support a ${theme} strategy.`)
  const popularity =
    typeof count === 'number' && count > 0
      ? ` Played in ${count.toLocaleString()} EDHREC decks for this commander.`
      : ''
  return desc + popularity
}

export function themeQuery(theme: string): string {
  if (THEME_QUERIES[theme]) return THEME_QUERIES[theme]
  const words = theme.trim().toLowerCase()
  if (/^[a-z][a-z' -]*$/.test(words) && words.length <= 20) {
    return `(o:"${words}" or t:"${words}")`
  }
  return `o:"${words.replace(/"/g, '')}"`
}

const TRIBES = [
  'Sliver', 'Elf', 'Goblin', 'Zombie', 'Dragon', 'Angel', 'Vampire', 'Merfolk',
  'Wizard', 'Dinosaur', 'Spirit', 'Soldier', 'Knight', 'Demon', 'Hydra', 'Beast',
  'Elemental', 'Faerie', 'Rogue', 'Warrior', 'Bird', 'Rat', 'Squirrel', 'Snake',
  'Cat', 'Dog', 'Human', 'Treefolk', 'Phyrexian', 'Eldrazi', 'Pirate', 'Ninja',
  'Samurai', 'Dwarf', 'Giant', 'Sphinx', 'Kithkin', 'Insect', 'Spider', 'Wolf',
]

export function detectTribe(typeLine: string, oracle: string, themes: string[]): string | null {
  for (const t of themes) {
    const match = TRIBES.find((tr) => tr.toLowerCase() === t.trim().toLowerCase())
    if (match) return match
  }
  const text = `${typeLine} ${oracle}`
  for (const tribe of TRIBES) {
    const re = new RegExp(`\\b${tribe}s?\\b`)
    if (re.test(text)) return tribe
  }
  return null
}

const COLOR_HEX: Record<string, [string, string]> = {
  W: ['#e8dcb8', '#b8a86a'],
  U: ['#4f9bd4', '#1d5e96'],
  B: ['#9a6bb0', '#3d2b4f'],
  R: ['#e05a4e', '#8f2a20'],
  G: ['#5cb870', '#22663a'],
  C: ['#9aa3ad', '#5a626b'],
}

export function applyColorTheme(identity: string[]) {
  const root = document.documentElement
  const colors = identity.length ? identity : ['C']
  const a = COLOR_HEX[colors[0]] ?? COLOR_HEX.C
  const b = COLOR_HEX[colors[colors.length - 1]] ?? COLOR_HEX.C
  root.style.setProperty('--accent-a', a[0])
  root.style.setProperty('--accent-b', b[0])
  root.style.setProperty('--accent-a-deep', a[1])
  root.style.setProperty('--accent-b-deep', b[1])
  const stops = colors
    .map((c, i) => `${(COLOR_HEX[c] ?? COLOR_HEX.C)[0]} ${(i / Math.max(1, colors.length - 1)) * 100}%`)
    .join(', ')
  root.style.setProperty(
    '--accent-gradient',
    colors.length > 1 ? `linear-gradient(120deg, ${stops})` : `linear-gradient(120deg, ${a[0]}, ${a[1]})`
  )
}

const GALAXY = {
  '--accent-a': '#8b6fe8',
  '--accent-b': '#f0dfae',
  '--accent-a-deep': '#4a3ac0',
  '--accent-b-deep': '#b09a5a',
  '--accent-gradient': 'linear-gradient(120deg, #6a4fd8, #a88fe8, #f0dfae)',
}

export type UiPreset = 'galaxy' | 'obsidian' | 'midnight' | 'slate'
export type AccentMode = 'galaxy' | 'commander' | 'gold' | 'ocean' | 'ember'

type SurfaceTokens = Record<
  '--bg' | '--bg-raise' | '--bg-card' | '--border' | '--text' | '--text-dim' | '--nebula',
  string
>

export const UI_PRESET_LABELS: { id: UiPreset; label: string; hint: string }[] = [
  { id: 'galaxy', label: 'Galaxy', hint: 'Purple nebula — the default look.' },
  { id: 'obsidian', label: 'Obsidian', hint: 'Near-black panels with muted violet accents.' },
  { id: 'midnight', label: 'Midnight', hint: 'Deep blue blacks and cool highlights.' },
  { id: 'slate', label: 'Slate', hint: 'Neutral charcoal with soft lilac text.' },
]

export const ACCENT_MODE_LABELS: { id: AccentMode; label: string }[] = [
  { id: 'galaxy', label: 'Galaxy' },
  { id: 'commander', label: 'Match commander' },
  { id: 'gold', label: 'Gold' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'ember', label: 'Ember' },
]

const UI_SURFACES: Record<UiPreset, SurfaceTokens> = {
  galaxy: {
    '--bg': '#0a0818',
    '--bg-raise': '#120e28',
    '--bg-card': '#1a1438',
    '--border': '#2c2454',
    '--text': '#ece8f7',
    '--text-dim': '#9a91bd',
    '--nebula': '#241466',
  },
  obsidian: {
    '--bg': '#060608',
    '--bg-raise': '#0e0e12',
    '--bg-card': '#16161c',
    '--border': '#2a2a34',
    '--text': '#ececf0',
    '--text-dim': '#8a8a98',
    '--nebula': '#14141a',
  },
  midnight: {
    '--bg': '#040810',
    '--bg-raise': '#0a1220',
    '--bg-card': '#101c30',
    '--border': '#1e3454',
    '--text': '#e4eef8',
    '--text-dim': '#7a9ab8',
    '--nebula': '#0c2a55',
  },
  slate: {
    '--bg': '#0c0c10',
    '--bg-raise': '#14141a',
    '--bg-card': '#1c1c24',
    '--border': '#32323e',
    '--text': '#e8e6f0',
    '--text-dim': '#9490a8',
    '--nebula': '#26222e',
  },
}

const ACCENT_PRESETS: Record<Exclude<AccentMode, 'galaxy' | 'commander'>, typeof GALAXY> = {
  gold: {
    '--accent-a': '#e8c547',
    '--accent-b': '#f5e6a8',
    '--accent-a-deep': '#a88420',
    '--accent-b-deep': '#c4a84a',
    '--accent-gradient': 'linear-gradient(120deg, #c9a227, #e8c547, #f5e6a8)',
  },
  ocean: {
    '--accent-a': '#4ec4e0',
    '--accent-b': '#7ee8c8',
    '--accent-a-deep': '#1a8aa8',
    '--accent-b-deep': '#3aa888',
    '--accent-gradient': 'linear-gradient(120deg, #1a8aa8, #4ec4e0, #7ee8c8)',
  },
  ember: {
    '--accent-a': '#e8784e',
    '--accent-b': '#f0b878',
    '--accent-a-deep': '#a83820',
    '--accent-b-deep': '#c87838',
    '--accent-gradient': 'linear-gradient(120deg, #a83820, #e8784e, #f0b878)',
  },
}

function setAccentTokens(tokens: typeof GALAXY) {
  const root = document.documentElement
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value)
  }
}

export function applyAccentPreset(mode: AccentMode, identity?: string[] | null) {
  if (mode === 'commander') {
    if (identity?.length) applyColorTheme(identity)
    else setAccentTokens(GALAXY)
    return
  }
  if (mode === 'galaxy') {
    setAccentTokens(GALAXY)
    return
  }
  setAccentTokens(ACCENT_PRESETS[mode])
}

export interface AppearanceSettings {
  uiPreset: UiPreset
  accentMode: AccentMode
  showStarfield: boolean
  reducedMotion: boolean
}

export function applyAppAppearance(
  appearance: AppearanceSettings,
  commanderIdentity?: string[] | null
) {
  const root = document.documentElement
  const surfaces = UI_SURFACES[appearance.uiPreset]
  for (const [key, value] of Object.entries(surfaces)) {
    root.style.setProperty(key, value)
  }
  root.dataset.starfield = appearance.showStarfield ? 'on' : 'off'
  root.dataset.reducedMotion = appearance.reducedMotion ? 'on' : 'off'
  applyAccentPreset(appearance.accentMode, commanderIdentity)
}

export function resetColorTheme() {
  setAccentTokens(GALAXY)
}
