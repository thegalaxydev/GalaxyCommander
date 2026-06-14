import type { Deck, DeckCard } from './types'
import { cardOracle, cardPrice } from './scryfall'

export interface CardInsight {
  name: string
  category: string
  reason: string
  bullets: string[]
  price: number
}

export function buildCardInsight(deck: Deck, d: DeckCard): CardInsight {
  const bullets: string[] = []
  const reason = d.reason
  const rank = d.card.edhrec_rank

  if (/Pinned by you/.test(reason)) {
    bullets.push('Pinned as a must-include in your card rules.')
  }
  if (/Meta answer|combo-heavy|aggro-heavy|midrange-heavy|stax-heavy/.test(reason)) {
    bullets.push('Packed as meta tech for your expected table.')
  }
  if (/power profile|resiliency setting|Combo enabler|Tutor density/.test(reason)) {
    bullets.push('Matches your power profile sliders.')
  }
  if (/Played in \d+%/.test(reason)) {
    const m = reason.match(/Played in (\d+)%/)
    if (m) bullets.push(`${m[1]}% inclusion on EDHREC for this commander.`)
    const syn = reason.match(/\+(\d+)% synergy/)
    if (syn) bullets.push(`+${syn[1]}% synergy score on EDHREC.`)
  }
  if (/EDHREC/.test(reason) && !/Played in/.test(reason)) {
    bullets.push('Recommended from EDHREC data for this commander.')
  }
  if (/theme|synergy/i.test(reason) && deck.settings.themes.length) {
    bullets.push(`Supports your ${deck.settings.themes.join(' + ')} theme.`)
  }
  if (/Basic land/.test(reason)) {
    bullets.push('Basic land slotted for consistent mana by color pip demand.')
  }

  const text = cardOracle(d.card)
  const themes = deck.settings.themes.map((t) => t.toLowerCase())
  const hits = themes.filter((t) => text.toLowerCase().includes(t))
  if (hits.length) {
    bullets.push(`Oracle text ties into ${hits.join(' and ')}.`)
  }

  if (rank && rank < 5000) {
    bullets.push(`Top-tier staple (EDHREC rank #${rank.toLocaleString()}).`)
  } else if (rank && rank < 15000) {
    bullets.push(`Solid Commander staple (EDHREC rank #${rank.toLocaleString()}).`)
  }

  const profile = deck.settings.powerProfile
  if (profile) {
    if (d.category === 'Ramp' && profile.ramp >= 60) bullets.push('Fits your high ramp priority.')
    if (d.category === 'Card Draw' && profile.draw >= 60) bullets.push('Fits your high draw priority.')
    if ((d.category === 'Removal' || d.category === 'Board Wipes') && profile.interaction >= 60) {
      bullets.push('Boosts interaction density from your profile.')
    }
  }

  if (!bullets.length) bullets.push(reason || `Fills the ${d.category} slot for this list.`)

  return {
    name: d.card.name.split(' //')[0],
    category: d.category,
    reason,
    bullets: [...new Set(bullets)],
    price: cardPrice(d.card),
  }
}
