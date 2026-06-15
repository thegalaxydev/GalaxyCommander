import type { Deck } from './types'

export interface CodEntry {
  name: string
  qty: number
}

export interface CodDeck {
  name: string
  side: CodEntry[]
  main: CodEntry[]
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function codTimestamp(): string {
  const d = new Date()
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getFullYear()}`
}

export function deckToCod(deck: CodDeck): string {
  const zone = (name: string, cards: CodEntry[]) =>
    cards.length
      ? `    <zone name="${name}">\n${cards
          .map((c) => `        <card number="${c.qty}" name="${esc(c.name)}"/>`)
          .join('\n')}\n    </zone>`
      : `    <zone name="${name}"/>`
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<cockatrice_deck version="1">',
    `    <lastLoadedTimestamp>${codTimestamp()}</lastLoadedTimestamp>`,
    `    <deckname>${esc(deck.name)}</deckname>`,
    '    <bannerCard providerId=""></bannerCard>',
    '    <comments></comments>',
    '    <tags/>',
    zone('side', deck.side),
    zone('main', deck.main),
    '</cockatrice_deck>',
    '',
  ].join('\n')
}

export function parseCod(xml: string): CodDeck {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.querySelector('parsererror')) throw new Error('Not a valid .cod file')
  const read = (zoneName: string): CodEntry[] =>
    [...doc.querySelectorAll(`zone[name="${zoneName}"] card`)]
      .map((el) => ({
        name: el.getAttribute('name') ?? '',
        qty: parseInt(el.getAttribute('number') ?? '1', 10) || 1,
      }))
      .filter((c) => c.name)
  return {
    name: doc.querySelector('deckname')?.textContent ?? '',
    side: read('side'),
    main: read('main'),
  }
}

export function generatedDeckToCod(deck: Deck): CodDeck {
  const side = deck.cards
    .filter((d) => d.category === 'Commander')
    .map((d) => ({ name: d.card.name.split(' //')[0], qty: d.qty }))
  const main = deck.cards
    .filter((d) => d.category !== 'Commander')
    .map((d) => ({ name: d.card.name.split(' //')[0], qty: d.qty }))
  const lead = deck.commander.name.split(',')[0]
  const themes = deck.settings.themes.join(' ')
  return { name: themes ? `${lead} ${themes}` : lead, side, main }
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*]/g, '')
    .split('')
    .filter((ch) => {
      const code = ch.charCodeAt(0)
      return code >= 32
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return cleaned || 'deck'
}

export async function downloadCod(filename: string, xml: string) {
  const safe = sanitizeFilename(filename)
  const fullName = /\.cod$/i.test(safe) ? safe : `${safe}.cod`

  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { invoke } = await import('@tauri-apps/api/core')
    const path = await save({
      defaultPath: fullName,
      filters: [{ name: 'Cockatrice Deck', extensions: ['cod'] }],
    })
    if (!path) return
    try {
      await invoke('write_text_file', { path, contents: xml })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to save deck file: ${message}`)
    }
    return
  }

  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fullName
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  window.setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 500)
}

export interface SavedDeck {
  id: string
  name: string
  cod: string
  cards: number
  updated: number
}

const STORE_KEY = 'gc-saved-decks'

export function loadSavedDecks(): SavedDeck[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as SavedDeck[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function upsertSavedDeck(deck: { id?: string; name: string; cod: CodDeck }): SavedDeck {
  const decks = loadSavedDecks()
  const entry: SavedDeck = {
    id: deck.id ?? crypto.randomUUID(),
    name: deck.name,
    cod: deckToCod(deck.cod),
    cards: [...deck.cod.side, ...deck.cod.main].reduce((n, c) => n + c.qty, 0),
    updated: Date.now(),
  }
  const idx = decks.findIndex((d) => d.id === entry.id)
  if (idx >= 0) decks[idx] = entry
  else decks.unshift(entry)
  localStorage.setItem(STORE_KEY, JSON.stringify(decks))
  return entry
}

export function deleteSavedDeck(id: string): SavedDeck[] {
  const decks = loadSavedDecks().filter((d) => d.id !== id)
  localStorage.setItem(STORE_KEY, JSON.stringify(decks))
  return decks
}

export function clearSavedDecks(): void {
  localStorage.removeItem(STORE_KEY)
}

export function exportSavedDecksJson(): string {
  return JSON.stringify(loadSavedDecks(), null, 2)
}

export function downloadSavedDecksExport() {
  const json = exportSavedDecksJson()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'galaxy-commander-decks.json'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  window.setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 500)
}
