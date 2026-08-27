// Commander Spellbook results need three corrections before they can be shown
// or used for bracket decisions:
//
//  1. `uses` lists only the *named* cards. Template slots live in `requires`,
//     so Hullbreaker Horror + Sol Ring — which also needs "Permanent that can
//     be cast using {C}" — is a three-card line, not a two-card one.
//  2. Variants sharing their named cards are NOT necessarily duplicates:
//     Springheart Nantuko + Lotus Cobra comes back twice, once requiring "Card
//     that Earthbends" and once "Man-Land that Enters Untapped". They must stay
//     distinct, and the template has to be visible or they look identical.
//  3. `bracketTag` rates a combo's spiciness, not bracket legality, so it is a
//     floor rather than the answer.
//
// Run: npm run check:combos
import type { ComboInfo, Deck, DeckCard, ScryCard } from '../src/types'
import { comboMinBracket, comboSize } from '../src/analysis'

const realFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  let url = typeof input === 'string' ? input : input.toString()
  if (url.startsWith('/spellbook-api'))
    url = `https://backend.commanderspellbook.com${url.slice(14)}`
  else if (url.startsWith('/scryfall-api')) url = `https://api.scryfall.com${url.slice(13)}`
  else if (url.startsWith('/edhrec-api')) url = `https://json.edhrec.com${url.slice(11)}`
  else if (url.startsWith('/')) return Promise.reject(new Error(`unproxied path: ${url}`))
  return realFetch(url, {
    ...init,
    headers: { 'User-Agent': 'GalaxyCommander/1.0', ...(init?.headers ?? {}) },
  })
}) as typeof fetch
;(globalThis as Record<string, unknown>).document = {
  documentElement: { style: { setProperty() {} } },
}

const { findCombos } = await import('../src/combos')

const HEADERS = { 'User-Agent': 'GalaxyCommander/1.0', Accept: 'application/json' }
const checks: [string, boolean][] = []

// Scryfall rate-limits bursts and answers with an HTML error page, which blows
// up JSON parsing; back off and retry rather than failing the whole run.
async function collection(names: string[]): Promise<ScryCard[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await realFetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: names.map((name) => ({ name })) }),
    })
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      return ((await res.json()) as { data?: ScryCard[] }).data ?? []
    }
    console.log(`  (scryfall returned ${res.status}, retrying in ${(attempt + 1) * 1000}ms)`)
    await new Promise((r) => setTimeout(r, (attempt + 1) * 1000))
  }
  throw new Error('Scryfall collection lookup failed after retries')
}

async function buildDeck(commanderName: string, cardNames: string[]): Promise<Deck> {
  const names = [commanderName, ...cardNames]
  const byName = new Map((await collection(names)).map((c) => [c.name, c]))
  const commander = byName.get(commanderName)!
  const cards: DeckCard[] = names
    .filter((n) => byName.has(n))
    .map((n) => ({
      card: byName.get(n)!,
      category: n === commanderName ? 'Commander' : 'Synergy',
      qty: 1,
      reason: '',
    }))
  return {
    commander,
    cards,
    settings: {
      commander,
      bracket: 3,
      budget: 'any',
      themes: [],
      tags: [],
      options: {
        includeStaples: true,
        prioritizeSynergy: true,
        avoidCombos: false,
        avoidTutors: false,
        latestSets: false,
        noSpoilers: false,
        allowUnsetCards: false,
        snowBasics: false,
      },
    },
    power: 0,
    description: '',
  }
}

function show(c: ComboInfo, cards: DeckCard[]): void {
  const reqs = (c.requires ?? []).map((r) => `${r.quantity}x ${r.name}`).join(', ')
  console.log(
    `  [${c.bracketTag ?? '-'}] size ${comboSize(c)} -> bracket ${comboMinBracket(c, cards)}+  ${c.cards.join(' + ')}`
  )
  if (reqs) console.log(`      requires: ${reqs}`)
}

// --- 1. Template slots count toward combo size -----------------------------
const tDeck = await buildDeck('Talrand, Sky Summoner', [
  'Hullbreaker Horror',
  'Sol Ring',
  "Accorder's Shield",
])
const { included: tCombos } = await findCombos(tDeck)
const hullbreaker = tCombos.find(
  (c) => c.cards.includes('Hullbreaker Horror') && c.cards.includes('Sol Ring')
)
console.log('template combo:')
if (hullbreaker) show(hullbreaker, tDeck.cards)
checks.push(['template combo found', !!hullbreaker])
checks.push(['template slot captured', (hullbreaker?.requires ?? []).length > 0])
checks.push(['size counts the template slot', !!hullbreaker && comboSize(hullbreaker) === 3])
checks.push([
  'template combo is not treated as a two-card infinite',
  !!hullbreaker && comboMinBracket(hullbreaker, tDeck.cards) <= 3,
])

// --- 2. Same named cards + different template = different combos -----------
const sDeck = await buildDeck('Omnath, Locus of Rage', [
  'Springheart Nantuko',
  'Lotus Cobra',
  'Tireless Provisioner',
])
const { included: sCombos } = await findCombos(sDeck)
console.log('\nspringheart combos:')
for (const c of sCombos) show(c, sDeck.cards)
const templateNames = new Set(sCombos.flatMap((c) => (c.requires ?? []).map((r) => r.name)))
checks.push(['all four springheart variants kept', sCombos.length === 4])
checks.push(['their differing templates are captured', templateNames.size === 2])
checks.push([
  'every springheart variant is a three-card line',
  sCombos.length > 0 && sCombos.every((c) => comboSize(c) === 3),
])
checks.push([
  'so none are promoted out of bracket 3',
  sCombos.length > 0 && sCombos.every((c) => comboMinBracket(c, sDeck.cards) <= 3),
])
const ids = sCombos.map((c) => c.id)
checks.push(['each carries a distinct Spellbook id', ids.every(Boolean) && new Set(ids).size === ids.length])

// --- 3. Genuine two-card infinites still rate bracket 4 --------------------
const iDeck = await buildDeck('Talrand, Sky Summoner', [
  "Thassa's Oracle",
  'Demonic Consultation',
  'Basalt Monolith',
  'Rings of Brighthearth',
])
const { included: iCombos } = await findCombos(iDeck)
const twoCard = iCombos.filter((c) => comboSize(c) === 2)
console.log('\ntrue two-card infinites:')
for (const c of twoCard) show(c, iDeck.cards)
checks.push(['two-card template-free combos found', twoCard.length >= 2])
checks.push(['they rate bracket 4', twoCard.every((c) => comboMinBracket(c, iDeck.cards) >= 4)])

// A low Spellbook tag must not drag a real two-card infinite below bracket 4;
// the tag is a floor, not the answer. No printed combo currently exercises this
// path, so it is asserted directly against the rule.
const synthetic: ComboInfo = {
  id: 'synthetic',
  cards: ['Card A', 'Card B'],
  requires: [],
  produces: ['Infinite mana', 'Win the game'],
  description: '',
  bracketTag: 'E',
}
checks.push([
  'a low tag cannot lower a real two-card infinite',
  comboMinBracket(synthetic, iDeck.cards) === 4,
])

// --- 4. Deep links ---------------------------------------------------------
const sample = [...tCombos, ...sCombos].filter((c) => c.id).slice(0, 3)
let urlsOk = sample.length > 0
console.log('')
for (const c of sample) {
  const url = `https://commanderspellbook.com/combo/${c.id}/`
  const r = await realFetch(url, { headers: HEADERS, redirect: 'follow' })
  console.log(`  ${url} -> HTTP ${r.status}`)
  if (!r.ok) urlsOk = false
}
checks.push(['Spellbook combo URLs resolve', urlsOk])

let failed = 0
console.log('')
for (const [label, ok] of checks) {
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`)
}
console.log(`\n${failed === 0 ? 'ALL OK' : `${failed} FAILURE(S)`}`)
process.exit(failed === 0 ? 0 : 1)
