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

interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

async function callLlm(
  messages: LlmMessage[],
  settings: AppSettings,
  maxTokens = 600,
  temperature = 0.6
): Promise<string> {
  if (!settings.llmEnabled || !settings.llmApiKey.trim()) {
    throw new Error('LLM not configured')
  }

  if (settings.llmProvider === 'anthropic') {
    const res = await fetch(anthropicUrl(settings), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.llmApiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: settings.llmModel,
        max_tokens: maxTokens,
        temperature,
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
      max_tokens: maxTokens,
      temperature,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err.slice(0, 200) || `LLM error ${res.status}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() ?? 'No response.'
}

export async function askLlm(
  deck: Deck,
  history: { role: 'user' | 'assistant'; text: string }[],
  message: string,
  settings: AppSettings
): Promise<string> {
  const system = `You are a helpful Magic: The Gathering Commander deck advisor. Answer concisely about the specific deck provided. Reference actual cards from the list when relevant. Do not invent cards not in the deck unless suggesting swaps.`

  const messages: LlmMessage[] = [
    { role: 'system', content: `${system}\n\n--- DECK ---\n${deckContext(deck)}` },
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.text })),
    { role: 'user', content: message },
  ]
  return callLlm(messages, settings, 600)
}

export async function generateOverview(deck: Deck, settings: AppSettings): Promise<string> {
  const system = `You are a Magic: The Gathering Commander deck expert writing a concise strategic overview for the exact deck provided. Write 2–3 short paragraphs (no headings, no bullet points) describing the deck's core game plan, key synergies, and how it wins. Reference specific cards from the list. Do not invent cards that are not in the deck. Plain prose only.`
  return callLlm(
    [
      { role: 'system', content: `${system}\n\n--- DECK ---\n${deckContext(deck)}` },
      { role: 'user', content: 'Write the strategic overview for this deck.' },
    ],
    settings,
    500
  )
}

export interface PlayGuideSections {
  early: string
  mid: string
  late: string
  threats: string
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

export async function generatePlayGuide(
  deck: Deck,
  settings: AppSettings
): Promise<PlayGuideSections> {
  const system = `You are a Magic: The Gathering Commander deck coach writing a piloting guide for the exact deck provided. Reference specific cards from the list and do not invent cards that are not in it. Respond with ONLY a JSON object (no markdown, no commentary) with exactly these string keys: "early" (Turns 1–3 plan and ideal openers/mulligan advice), "mid" (Turns 4–6 sequencing around the commander), "late" (Turn 7+ how to close the game and which finishers to use), and "threats" (what to interact with and how to deploy removal/board wipes). Each value is 1–2 sentences of plain prose.`
  const raw = await callLlm(
    [
      { role: 'system', content: `${system}\n\n--- DECK ---\n${deckContext(deck)}` },
      { role: 'user', content: 'Write the play guide JSON for this deck.' },
    ],
    settings,
    700
  )
  const obj = parseJsonObject(raw)
  if (!obj) throw new Error('Could not parse play guide response')
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const sections: PlayGuideSections = {
    early: str(obj.early),
    mid: str(obj.mid),
    late: str(obj.late),
    threats: str(obj.threats),
  }
  if (!sections.early && !sections.mid && !sections.late && !sections.threats) {
    throw new Error('Empty play guide response')
  }
  return sections
}

export function llmConfigured(settings: AppSettings): boolean {
  return settings.llmEnabled && settings.llmApiKey.trim().length > 0
}
