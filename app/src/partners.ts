import type { ScryCard } from './types'
import { commanderSlug, fetchEdhrecPairStats } from './edhrec'
import { searchCards, legalOrUpcoming } from './scryfall'
import { partnerMode, partnerSearchFilter } from './partner'

export interface PartnerCandidate {
  card: ScryCard
  deckCount: number
  avgPrice: number
}

function fitsPartnerIdentity(commander: ScryCard, candidate: ScryCard): boolean {
  const ids = new Set(commander.color_identity)
  if (ids.size === 0) return true
  return candidate.color_identity.every((c) => ids.has(c))
}

export async function discoverPartners(
  commander: ScryCard,
  limit = 6
): Promise<PartnerCandidate[]> {
  const mode = partnerMode(commander)
  if (!mode) return []

  const filter = partnerSearchFilter(mode)
  const candidates = await searchCards(`${filter} ${legalOrUpcoming()}`, {
    order: 'edhrec',
    max: 28,
  })

  const eligible = candidates.filter(
    (c) => c.name !== commander.name && fitsPartnerIdentity(commander, c)
  )
  const slugA = commanderSlug(commander.name)
  const probe = eligible.slice(0, 14)

  const scored = await Promise.all(
    probe.map(async (card) => {
      const slugB = commanderSlug(card.name)
      const stats = await fetchEdhrecPairStats(slugA, slugB)
      return {
        card,
        deckCount: stats?.deckCount ?? 0,
        avgPrice: stats?.avgPrice ?? 0,
      }
    })
  )

  return scored
    .filter((s) => s.deckCount > 0)
    .sort((a, b) => b.deckCount - a.deckCount)
    .slice(0, limit)
}
