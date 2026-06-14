import type { ScryCard } from './types'
import { cardOracle } from './scryfall'

export type PartnerKind =
  | 'partner'
  | 'partner-with'
  | 'friends-forever'
  | 'background'
  | 'doctor'
  | 'companion'

export interface PartnerMode {
  kind: PartnerKind
  withName?: string
  label: string
}

export function partnerMode(card: ScryCard): PartnerMode | null {
  const keywords = (card.keywords ?? []).map((k) => k.toLowerCase())
  if (keywords.includes('partner with')) {
    const match = cardOracle(card).match(/Partner with ([^\n(]+?)(?:\s*\(|\n|$)/)
    const withName = match?.[1].trim()
    if (withName) return { kind: 'partner-with', withName, label: `Partner with ${withName}` }
  }
  if (keywords.includes('partner')) return { kind: 'partner', label: 'Partner' }
  if (keywords.includes('friends forever'))
    return { kind: 'friends-forever', label: 'Friends Forever' }
  if (keywords.includes('choose a background'))
    return { kind: 'background', label: 'Choose a Background' }
  if (keywords.includes("doctor's companion"))
    return { kind: 'companion', label: "Doctor's Companion" }
  if (/Time Lord Doctor/.test(card.type_line)) return { kind: 'doctor', label: 'The Doctor' }
  return null
}

export function partnerSearchFilter(mode: PartnerMode): string {
  switch (mode.kind) {
    case 'partner':
      return 'is:commander keyword:partner -keyword:"partner with"'
    case 'partner-with':
      return `!"${mode.withName}"`
    case 'friends-forever':
      return 'is:commander keyword:"friends forever"'
    case 'background':
      return 't:background'
    case 'doctor':
      return 'keyword:"doctor\'s companion"'
    case 'companion':
      return 't:"time lord" t:doctor'
  }
}

export function unionIdentity(commander: ScryCard, partner?: ScryCard | null): string[] {
  if (!partner) return commander.color_identity
  const order = ['W', 'U', 'B', 'R', 'G']
  const set = new Set([...commander.color_identity, ...partner.color_identity])
  return order.filter((c) => set.has(c))
}
