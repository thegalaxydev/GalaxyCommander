import type { Deck, DeckCard } from './types'
import { buildCardInsight } from './cardInsight'
import { cardPrice } from './scryfall'
import { analyzeDeck, avgCmc, deckPrice } from './analysis'

export type VariantKind = 'casual' | 'competitive' | 'budget' | 'thematic'

export type ChatAction =
  | { type: 'reply'; text: string }
  | { type: 'variant'; variant: VariantKind; text: string }
  | { type: 'budgetSwap'; maxPrice: number; text: string }

function findMentionedCard(deck: Deck, message: string): DeckCard | null {
  const lower = message.toLowerCase()
  let best: DeckCard | null = null
  let bestLen = 0
  for (const d of deck.cards) {
    const full = d.card.name.toLowerCase()
    const short = full.split(',')[0].split(' //')[0]
    for (const candidate of [full, short]) {
      if (candidate.length > bestLen && candidate.length >= 4 && lower.includes(candidate)) {
        best = d
        bestLen = candidate.length
      }
    }
  }
  return best
}

function explainCard(deck: Deck, d: DeckCard): string {
  const insight = buildCardInsight(deck, d)
  return `${insight.name} is in the ${insight.category} package. ${insight.bullets.join(' ')}`
}

export function handleChat(deck: Deck, message: string): ChatAction {
  const m = message.toLowerCase().trim()

  if (/(more|make( it| this)?) (competitive|powerful|stronger|cedh)/.test(m) || /power (it|this) up/.test(m)) {
    return { type: 'variant', variant: 'competitive', text: 'Rebuilding at a higher bracket with a stronger card pool...' }
  }
  if (/(more|make( it| this)?) (casual|chill|relaxed)|tone (it|this) down|less powerful/.test(m)) {
    return { type: 'variant', variant: 'casual', text: 'Rebuilding at a lower bracket for a more social table...' }
  }
  if (/(more|make( it| this)?) (budget|affordable|cheap(er)?)/.test(m)) {
    return { type: 'variant', variant: 'budget', text: 'Rebuilding with a tighter budget cap...' }
  }
  if (/(more|make( it| this)?) (thematic|flavorful|on.?theme)/.test(m)) {
    return { type: 'variant', variant: 'thematic', text: 'Rebuilding with synergy weighted over raw staples...' }
  }
  const swap = m.match(/replace (?:all )?cards? (?:over|above) \$?(\d+)/)
  if (swap) {
    return {
      type: 'budgetSwap',
      maxPrice: parseInt(swap[1], 10),
      text: `Swapping out everything over $${swap[1]} for cheaper alternatives...`,
    }
  }

  const mentioned = findMentionedCard(deck, m)
  if (mentioned && /why|what|explain|purpose|reason|how come/.test(m)) {
    return { type: 'reply', text: explainCard(deck, mentioned) }
  }

  if (/how (do|can|should) (i|you|we) win|win ?con|wincon|close out|finish/.test(m)) {
    const finishers = deck.cards.filter((d) => d.category === 'Finishers').map((d) => d.card.name)
    const text = finishers.length
      ? `Your main win conditions are ${finishers.join(', ')}. Build incremental advantage with your ${
          deck.settings.themes.join(' + ') || 'synergy'
        } engine, then deploy a finisher once you can protect it or the table is low on answers.`
      : 'This list wins through accumulated synergy and combat pressure rather than single finishers. Check the Combos tab for any compact win lines the generator found.'
    return { type: 'reply', text }
  }

  if (/curve|mana base|lands?|color fixing|fixing/.test(m)) {
    const lands = deck.cards.filter((d) => d.category === 'Lands').reduce((n, d) => n + d.qty, 0)
    return {
      type: 'reply',
      text: `The deck runs ${lands} lands with an average mana value of ${avgCmc(deck.cards).toFixed(
        2
      )}. The basics are weighted by colored pip counts in your nonland cards, so your color fixing should line up with what you actually need to cast.`,
    }
  }

  if (/strength|weakness|good at|bad against|matchup/.test(m)) {
    const a = analyzeDeck(deck)
    return {
      type: 'reply',
      text: `Strengths: ${a.strengths.join('; ')}. Weaknesses: ${a.weaknesses.join('; ')}.`,
    }
  }

  if (/price|cost|budget|expensive|how much/.test(m)) {
    const total = deckPrice(deck.cards)
    const priciest = [...deck.cards].sort((a, b) => cardPrice(b.card) - cardPrice(a.card)).slice(0, 3)
    return {
      type: 'reply',
      text: `The full list comes to about $${total.toFixed(0)}. The biggest tickets are ${priciest
        .map((d) => `${d.card.name} ($${cardPrice(d.card).toFixed(0)})`)
        .join(', ')}. Say "replace all cards over $20" and I'll swap them for cheaper options.`,
    }
  }

  if (mentioned) {
    return { type: 'reply', text: explainCard(deck, mentioned) }
  }

  return {
    type: 'reply',
    text: `${deck.description} Ask me why any card made the cut, how to win, about the mana base, or say things like "make this more competitive" or "replace all cards over $20".`,
  }
}
