import LZString from 'lz-string'
import type { CodDeck, CodEntry } from './cod'

const { compressToEncodedURIComponent, decompressFromEncodedURIComponent } = LZString

interface SharePayload {
  v: number
  fmt: string
  cmd: [string, number][]
  cards: [string, number][]
  n?: string
}

const VERSION = 1

const toPairs = (entries: CodEntry[]): [string, number][] =>
  entries.filter((e) => e.name).map((e) => [e.name, e.qty || 1])

const fromPairs = (pairs: [string, number][] | undefined): CodEntry[] =>
  (pairs ?? [])
    .filter((p) => Array.isArray(p) && typeof p[0] === 'string')
    .map(([name, qty]) => ({ name, qty: typeof qty === 'number' && qty > 0 ? qty : 1 }))

export function encodeDeck(cod: CodDeck, fmt = 'commander'): string {
  const payload: SharePayload = {
    v: VERSION,
    fmt,
    cmd: toPairs(cod.side),
    cards: toPairs(cod.main),
  }
  const name = cod.name?.trim()
  if (name && name !== 'Untitled Deck' && name !== 'Imported Deck') payload.n = name
  return compressToEncodedURIComponent(JSON.stringify(payload))
}

export function decodeDeck(param: string): CodDeck | null {
  try {
    const json = decompressFromEncodedURIComponent(param)
    if (!json) return null
    const data = JSON.parse(json) as Partial<SharePayload>
    const side = fromPairs(data.cmd)
    const main = fromPairs(data.cards)
    if (!side.length && !main.length) return null
    return { name: data.n?.trim() || 'Shared Deck', side, main }
  } catch {
    return null
  }
}

export function buildShareUrl(cod: CodDeck, fmt = 'commander'): string {
  const base = `${window.location.origin}/deck`
  return `${base}?d=${encodeDeck(cod, fmt)}`
}

// Reads a shared deck from the current URL (?d=...) or a server-injected
// permalink payload (window.__SHARED_DECK__), if present.
export function readSharedDeckFromUrl(): CodDeck | null {
  try {
    const injected = (window as unknown as { __SHARED_DECK__?: string }).__SHARED_DECK__
    if (typeof injected === 'string' && injected.length) {
      const fromInjected = decodeDeck(injected)
      if (fromInjected) return fromInjected
    }
    const param = new URLSearchParams(window.location.search).get('d')
    if (!param) return null
    return decodeDeck(param)
  } catch {
    return null
  }
}

export function shareLinkExpired(): boolean {
  return !!(window as unknown as { __SHARE_MISSING__?: boolean }).__SHARE_MISSING__
}

// Creates a permanent /d/<id> link by storing the deck server-side.
export async function createPermalink(cod: CodDeck, fmt = 'commander'): Promise<string> {
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ d: encodeDeck(cod, fmt) }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.url) {
    throw new Error(data?.error ?? 'Could not create a permanent link.')
  }
  return data.url as string
}

// Removes the ?d= share parameter from the address bar without reloading,
// so app state changes don't re-trigger the import.
export function clearShareParam(): void {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('d')) return
    url.searchParams.delete('d')
    const path = url.pathname === '/deck' ? '/' : url.pathname
    window.history.replaceState({}, '', `${path}${url.search}${url.hash}`)
  } catch {
    /* ignore */
  }
}
