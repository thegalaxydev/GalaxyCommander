import type { Deck, ScryCard } from './types'
import { scheduleUserDataSync } from './auth/sync'

const FULL_NAME_LAYOUTS = new Set(['split', 'adventure', 'aftermath', 'prepare'])

export function codCardName(card: ScryCard): string {
  if (card.layout && FULL_NAME_LAYOUTS.has(card.layout)) return card.name
  return card.name.split(' // ')[0]
}

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
  const side = [
    ...deck.cards
      .filter((d) => d.category === 'Commander')
      .map((d) => ({ name: codCardName(d.card), qty: d.qty })),
    ...(deck.attractions ?? []).map((d) => ({ name: codCardName(d.card), qty: d.qty })),
  ]
  const main = deck.cards
    .filter((d) => d.category !== 'Commander')
    .map((d) => ({ name: codCardName(d.card), qty: d.qty }))
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

async function saveTextFile(
  filename: string,
  contents: string,
  ext: string,
  filterName: string,
  mime: string
) {
  const safe = sanitizeFilename(filename)
  const extRe = new RegExp(`\\.${ext}$`, 'i')
  const fullName = extRe.test(safe) ? safe : `${safe}.${ext}`

  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { invoke } = await import('@tauri-apps/api/core')
    const path = await save({
      defaultPath: fullName,
      filters: [{ name: filterName, extensions: [ext] }],
    })
    if (!path) return
    try {
      await invoke('write_text_file', { path, contents })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to save deck file: ${message}`)
    }
    return
  }

  const blob = new Blob([contents], { type: mime })
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

export async function downloadCod(filename: string, xml: string) {
  await saveTextFile(filename, xml, 'cod', 'Cockatrice Deck', 'application/xml;charset=utf-8')
}

export function deckToText(deck: Deck): string {
  const line = (d: Deck['cards'][number]) => `${d.qty} ${codCardName(d.card)}`
  const commanders = deck.cards.filter((d) => d.category === 'Commander')
  const main = deck.cards.filter((d) => d.category !== 'Commander')
  const out: string[] = []
  if (commanders.length) {
    out.push('Commander')
    out.push(...commanders.map(line))
    out.push('')
    out.push('Deck')
  }
  out.push(...main.map(line))
  if (deck.attractions?.length) {
    out.push('')
    out.push('Attractions')
    out.push(...deck.attractions.map(line))
  }
  return out.join('\n') + '\n'
}

export async function downloadText(filename: string, deck: Deck) {
  await saveTextFile(filename, deckToText(deck), 'txt', 'Decklist', 'text/plain;charset=utf-8')
}

function cleanImportedName(raw: string): string {
  let n = raw.trim()
  n = n.replace(/^SB:\s*/i, '')
  n = n.replace(/\s*\[[^\]]*\]\s*$/g, '')
  n = n.replace(/\s*\^[^^]*\^\s*$/g, '')
  n = n.replace(/\s*\*[^*]*\*\s*$/g, '')
  n = n.replace(/\s*#\S+\s*$/g, '')
  n = n.replace(/\s*\([A-Za-z0-9]{2,6}\)\s*[A-Za-z0-9★\u2605-]*\s*$/g, '')
  n = n.replace(/\s*<[^>]*>\s*$/g, '')
  return n.trim()
}

const SIDE_SECTION = /^(commanders?|companions?)\b/i
const SKIP_SECTION = /^(sideboard|side\s?board|maybe\s?board|maybe|considering|tokens?|stickers?|about|planes?|schemes?|attractions?)\b/i
const MAIN_SECTION = /^(deck|mainboard|main\s?board|main|library|cards)\b/i
const CATEGORY_HEADER = /^[A-Za-z][A-Za-z '/&-]*\s*\(\d+\)\s*$/

export function parseText(text: string): CodDeck {
  const lines = text.split(/\r?\n/)
  const side: CodEntry[] = []
  const main: CodEntry[] = []
  let zone: 'side' | 'main' | 'skip' = 'main'
  const push = (z: 'side' | 'main' | 'skip', name: string, qty: number) => {
    if (z === 'skip' || !name) return
    ;(z === 'side' ? side : main).push({ name, qty })
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('#')) continue
    const qtyMatch = line.match(/^(\d+)\s*[xX]?\s+(.+)$/)
    if (qtyMatch) {
      const qty = parseInt(qtyMatch[1], 10) || 1
      const name = cleanImportedName(qtyMatch[2])
      push(zone, name, qty)
      continue
    }
    if (SIDE_SECTION.test(line)) zone = 'side'
    else if (SKIP_SECTION.test(line)) zone = 'skip'
    else if (MAIN_SECTION.test(line)) zone = 'main'
    else if (CATEGORY_HEADER.test(line)) zone = 'main'
  }
  return { name: 'Imported Deck', side, main }
}

export function codToText(cod: CodDeck): string {
  const line = (c: CodEntry) => `${c.qty} ${c.name}`
  const out: string[] = []
  if (cod.side.length) {
    out.push('Commander')
    out.push(...cod.side.map(line))
    out.push('')
    out.push('Deck')
  }
  out.push(...cod.main.map(line))
  return out.join('\n') + '\n'
}

export async function downloadCodText(filename: string, cod: CodDeck) {
  await saveTextFile(filename, codToText(cod), 'txt', 'Decklist', 'text/plain;charset=utf-8')
}

export interface SavedDeck {
  id: string
  name: string
  cod: string
  cards: number
  updated: number
  public?: boolean
  commander?: string
  colorIdentity?: string[]
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

export function upsertSavedDeck(deck: {
  id?: string
  name: string
  cod: CodDeck
  commander?: string
  colorIdentity?: string[]
}): SavedDeck {
  const decks = loadSavedDecks()
  const existing = deck.id ? decks.find((d) => d.id === deck.id) : undefined
  const entry: SavedDeck = {
    id: deck.id ?? crypto.randomUUID(),
    name: deck.name,
    cod: deckToCod(deck.cod),
    cards: [...deck.cod.side, ...deck.cod.main].reduce((n, c) => n + c.qty, 0),
    updated: Date.now(),
  }
  // Preserve visibility across re-saves; carry commander/colors forward when
  // the caller doesn't supply them.
  if (existing?.public !== undefined) entry.public = existing.public
  const commander = deck.commander ?? existing?.commander
  if (commander) entry.commander = commander
  const colorIdentity = deck.colorIdentity ?? existing?.colorIdentity
  if (colorIdentity) entry.colorIdentity = colorIdentity
  const idx = decks.findIndex((d) => d.id === entry.id)
  if (idx >= 0) decks[idx] = entry
  else decks.unshift(entry)
  localStorage.setItem(STORE_KEY, JSON.stringify(decks))
  scheduleUserDataSync()
  return entry
}

export function deleteSavedDeck(id: string): SavedDeck[] {
  const decks = loadSavedDecks().filter((d) => d.id !== id)
  localStorage.setItem(STORE_KEY, JSON.stringify(decks))
  scheduleUserDataSync()
  return decks
}

export function renameSavedDeck(id: string, name: string): SavedDeck | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const decks = loadSavedDecks()
  const idx = decks.findIndex((d) => d.id === id)
  if (idx < 0) return null
  const deck = decks[idx]
  let cod = deck.cod
  try {
    const parsed = parseCod(deck.cod)
    parsed.name = trimmed
    cod = deckToCod(parsed)
  } catch {
    /* keep existing cod body */
  }
  const entry: SavedDeck = { ...deck, name: trimmed, cod, updated: Date.now() }
  decks[idx] = entry
  localStorage.setItem(STORE_KEY, JSON.stringify(decks))
  scheduleUserDataSync()
  return entry
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
