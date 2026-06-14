import type { Category } from './types'

export const CATEGORY_ICONS: Record<Category, string> = {
  Commander: 'planeswalker',
  Lands: 'land',
  Ramp: 'c',
  'Card Draw': 'ability-investigate',
  Removal: 'ability-deathtouch',
  'Board Wipes': 'chaos',
  Synergy: 'ability-constellation',
  Finishers: 'power',
}

export interface IdentityInfo {
  name: string
  icon: string | null
}

const IDENTITY_MAP: Record<string, IdentityInfo> = {
  '': { name: 'Colorless', icon: 'c' },
  W: { name: 'Mono-White', icon: 'w' },
  U: { name: 'Mono-Blue', icon: 'u' },
  B: { name: 'Mono-Black', icon: 'b' },
  R: { name: 'Mono-Red', icon: 'r' },
  G: { name: 'Mono-Green', icon: 'g' },
  UW: { name: 'Azorius', icon: 'guild-azorius' },
  BU: { name: 'Dimir', icon: 'guild-dimir' },
  BR: { name: 'Rakdos', icon: 'guild-rakdos' },
  GR: { name: 'Gruul', icon: 'guild-gruul' },
  GW: { name: 'Selesnya', icon: 'guild-selesnya' },
  BW: { name: 'Orzhov', icon: 'guild-orzhov' },
  RU: { name: 'Izzet', icon: 'guild-izzet' },
  BG: { name: 'Golgari', icon: 'guild-golgari' },
  RW: { name: 'Boros', icon: 'guild-boros' },
  GU: { name: 'Simic', icon: 'guild-simic' },
  GUW: { name: 'Bant', icon: null },
  BUW: { name: 'Esper', icon: null },
  BRU: { name: 'Grixis', icon: null },
  BGR: { name: 'Jund', icon: null },
  GRW: { name: 'Naya', icon: null },
  BGW: { name: 'Abzan', icon: 'clan-abzan' },
  RUW: { name: 'Jeskai', icon: 'clan-jeskai' },
  BGU: { name: 'Sultai', icon: 'clan-sultai' },
  BRW: { name: 'Mardu', icon: 'clan-mardu' },
  GRU: { name: 'Temur', icon: 'clan-temur' },
  BGRU: { name: 'Glint-Eye', icon: null },
  BGRW: { name: 'Dune-Brood', icon: null },
  GRUW: { name: 'Ink-Treader', icon: null },
  BGUW: { name: 'Witch-Maw', icon: null },
  BRUW: { name: 'Yore-Tiller', icon: null },
  BGRUW: { name: 'Five-Color', icon: 'multiple' },
}

export function identityInfo(identity: string[]): IdentityInfo {
  const key = [...identity].sort().join('')
  return IDENTITY_MAP[key] ?? { name: 'Multicolor', icon: 'multiple' }
}
