import { SCRY_BASE } from '../scryfall'
import type { ScryCard } from '../types'
import type { CardMeta, GeneratedPack, PackSession, ProductType } from './types'

const SESSIONS_KEY = 'gc-pack-sessions'
const MAX_SESSIONS = 100

export function loadSessions(): PackSession[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? '')
    if (parsed && Array.isArray(parsed.sessions)) return parsed.sessions as PackSession[]
  } catch {
    /* fall through to default */
  }
  return []
}

function persistSessions(sessions: PackSession[]): void {
  let list = sessions.slice(0, MAX_SESSIONS)
  // On quota pressure, drop oldest sessions until the write fits.
  for (;;) {
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify({ v: 1, sessions: list }))
      return
    } catch {
      if (list.length <= 1) return
      list = list.slice(0, Math.floor(list.length / 2))
    }
  }
}

export function recordSession(
  setCode: string,
  setName: string,
  product: ProductType,
  packs: GeneratedPack[]
): PackSession {
  const session: PackSession = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    setCode,
    setName,
    product,
    packs: packs.map((p) => ({ c: p.cards.map(({ card, foil }) => [card.id, foil ? 1 : 0]) })),
  }
  persistSessions([session, ...loadSessions()])
  return session
}

export function deleteSession(id: string): PackSession[] {
  const next = loadSessions().filter((s) => s.id !== id)
  persistSessions(next)
  return next
}

export function sessionCardCount(session: PackSession): number {
  return session.packs.reduce((n, p) => n + p.c.length, 0)
}

/** Resolve a session's card ids back to displayable cards: cached metadata
 *  first, Scryfall /cards/collection for anything missing. */
export async function resolveSession(
  session: PackSession,
  meta: Record<string, CardMeta>
): Promise<Map<string, ScryCard>> {
  const ids = [...new Set(session.packs.flatMap((p) => p.c.map(([id]) => id)))]
  const out = new Map<string, ScryCard>()
  const missing = ids.filter((id) => !meta[id])
  for (let i = 0; i < missing.length; i += 75) {
    const chunk = missing.slice(i, i + 75)
    try {
      const res = await fetch(`${SCRY_BASE}/cards/collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: chunk.map((id) => ({ id })) }),
      })
      if (!res.ok) continue
      const data = await res.json()
      for (const card of (data.data ?? []) as ScryCard[]) out.set(card.id, card)
    } catch {
      /* leave unresolved; UI falls back to metadata name */
    }
  }
  return out
}

export function sessionToText(session: PackSession, meta: Record<string, CardMeta>): string {
  const lines: string[] = [
    `${session.setName} — ${session.packs.length} pack${session.packs.length === 1 ? '' : 's'} (${new Date(session.ts).toLocaleString()})`,
  ]
  session.packs.forEach((pack, i) => {
    lines.push('', `Pack ${i + 1}:`)
    for (const [id, foil] of pack.c) {
      const m = meta[id]
      lines.push(`1 ${m?.n ?? id}${foil ? ' *F*' : ''}`)
    }
  })
  return lines.join('\n') + '\n'
}

export function sessionToJson(session: PackSession, meta: Record<string, CardMeta>): string {
  return JSON.stringify(
    {
      set: session.setCode,
      setName: session.setName,
      product: session.product,
      opened: new Date(session.ts).toISOString(),
      packs: session.packs.map((pack) =>
        pack.c.map(([id, foil]) => ({ id, name: meta[id]?.n, foil: foil === 1 }))
      ),
    },
    null,
    2
  )
}

export function downloadTextFile(filename: string, contents: string, mime = 'text/plain'): void {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  window.setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 500)
}

export function clearSessions(): void {
  localStorage.removeItem(SESSIONS_KEY)
}
