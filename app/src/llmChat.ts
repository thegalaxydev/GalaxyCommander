import type { Deck } from './types'
import type { AppSettings } from './settings'
import { deckPrice, avgCmc, analyzeDeck } from './analysis'

function deckContext(deck: Deck): string {
  const { strengths, weaknesses } = analyzeDeck(deck)
  const cards = deck.cards
    .filter((d) => d.category !== 'Commander')
    .map((d) => `${d.qty}x ${d.card.name} (${d.category})`)
    .join('\n')
  return [
    `Commander: ${deck.commander.name}`,
    deck.settings.partner ? `Partner: ${deck.settings.partner.name}` : '',
    `Bracket: ${deck.settings.bracket}`,
    `Budget: ${deck.settings.budget}`,
    `Themes: ${deck.settings.themes.join(', ') || 'none'}`,
    `Power estimate: ${deck.power}/10`,
    `Avg CMC: ${avgCmc(deck.cards).toFixed(2)}`,
    `Deck price: $${deckPrice(deck.cards).toFixed(0)}`,
    `Strengths: ${strengths.join('; ')}`,
    `Weaknesses: ${weaknesses.join('; ')}`,
    'Full list:',
    cards,
  ]
    .filter(Boolean)
    .join('\n')
}

function openAiUrl(settings: AppSettings): string {
  const base = settings.llmBaseUrl.trim().replace(/\/$/, '')
  if (base) return `${base}/chat/completions`
  if (settings.llmProvider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions'
  return 'https://api.openai.com/v1/chat/completions'
}

function anthropicUrl(settings: AppSettings): string {
  const base = settings.llmBaseUrl.trim().replace(/\/$/, '')
  if (base) return `${base}/v1/messages`
  return 'https://api.anthropic.com/v1/messages'
}

export async function askLlm(
  deck: Deck,
  history: { role: 'user' | 'assistant'; text: string }[],
  message: string,
  settings: AppSettings
): Promise<string> {
  if (!settings.llmEnabled || !settings.llmApiKey.trim()) {
    throw new Error('LLM not configured')
  }

  const system = `You are a helpful Magic: The Gathering Commander deck advisor. Answer concisely about the specific deck provided. Reference actual cards from the list when relevant. Do not invent cards not in the deck unless suggesting swaps.`

  const messages = [
    { role: 'system', content: `${system}\n\n--- DECK ---\n${deckContext(deck)}` },
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.text })),
    { role: 'user', content: message },
  ]

  if (settings.llmProvider === 'anthropic') {
    const res = await fetch(anthropicUrl(settings), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.llmApiKey.trim(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: settings.llmModel,
        max_tokens: 600,
        system: messages.find((m) => m.role === 'system')?.content,
        messages: messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role, content: m.content })),
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(err.slice(0, 200) || `Anthropic error ${res.status}`)
    }
    const data = await res.json()
    return data.content?.[0]?.text?.trim() ?? 'No response.'
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.llmApiKey.trim()}`,
  }
  if (settings.llmProvider === 'openrouter' && !settings.llmBaseUrl.trim()) {
    headers['HTTP-Referer'] = 'https://galaxy-commander.local'
    headers['X-Title'] = 'Galaxy Commander'
  }

  const res = await fetch(openAiUrl(settings), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.llmModel,
      messages,
      max_tokens: 600,
      temperature: 0.6,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err.slice(0, 200) || `LLM error ${res.status}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() ?? 'No response.'
}

export function llmConfigured(settings: AppSettings): boolean {
  return settings.llmEnabled && settings.llmApiKey.trim().length > 0
}
