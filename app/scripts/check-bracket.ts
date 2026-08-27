// Bracket rules are enforced per-card during generation; this checks the
// finished deck actually obeys them. Mass land denial is disallowed at bracket
// 3 and below, and Scryfall's `otag:mass-land-denial` is the ground truth for
// what counts — far broader than the hand-maintained name list.
// Run: npm run check:bracket
import type { BuildSettings, ScryCard } from '../src/types'
import { DEFAULT_PROFILE } from '../src/types'
import { comboMinBracket, isMassLandDenial } from '../src/analysis'

const realFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  let url = typeof input === 'string' ? input : input.toString()
  if (url.startsWith('/scryfall-api')) url = `https://api.scryfall.com${url.slice(13)}`
  else if (url.startsWith('/edhrec-api')) url = `https://json.edhrec.com${url.slice(11)}`
  else if (url.startsWith('/spellbook-api'))
    url = `https://backend.commanderspellbook.com${url.slice(14)}`
  else if (url.startsWith('/')) return Promise.reject(new Error(`unproxied path: ${url}`))
  return realFetch(url, {
    ...init,
    headers: { 'User-Agent': 'GalaxyCommander/1.0', ...(init?.headers ?? {}) },
  })
}) as typeof fetch
;(globalThis as Record<string, unknown>).document = {
  documentElement: { style: { setProperty() {} } },
}

const { generateDeck } = await import('../src/generator')
const { findCombos } = await import('../src/combos')

const HEADERS = { 'User-Agent': 'GalaxyCommander/1.0', Accept: 'application/json' }

async function tagged(query: string): Promise<Set<string>> {
  const names = new Set<string>()
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards`
  while (url) {
    const res = await realFetch(url, { headers: HEADERS })
    const body = (await res.json()) as { data?: ScryCard[]; next_page?: string }
    if (!body.data) break
    for (const c of body.data) names.add(c.name.split(' //')[0].toLowerCase())
    url = body.next_page ?? ''
    await new Promise((r) => setTimeout(r, 120))
  }
  return names
}

console.log('fetching otag:mass-land-denial...')
const mldNames = await tagged('otag:mass-land-denial')
console.log(`  ${mldNames.size} cards tagged as mass land denial\n`)

// 1. The detector itself, measured against the tag.
const detectorMisses: string[] = []
const res = await realFetch(
  `https://api.scryfall.com/cards/search?q=${encodeURIComponent('otag:mass-land-denial legal:commander')}&unique=cards`,
  { headers: HEADERS }
)
const sample = ((await res.json()) as { data?: ScryCard[] }).data ?? []
for (const c of sample) {
  if (!isMassLandDenial(c)) detectorMisses.push(c.name)
}
console.log(
  `detector recall: ${sample.length - detectorMisses.length}/${sample.length} on the first page`
)
if (detectorMisses.length) {
  console.log(`  missed: ${detectorMisses.slice(0, 10).join(', ')}`)
}

// 1a. False positives: cards that talk about lands but are not land denial.
const fpRes = await realFetch(
  `https://api.scryfall.com/cards/search?q=${encodeURIComponent('-otag:mass-land-denial legal:commander o:land -t:land')}&unique=cards`,
  { headers: HEADERS }
)
const fpSample = ((await fpRes.json()) as { data?: ScryCard[] }).data ?? []
const falsePos = fpSample.filter((c) => isMassLandDenial(c))
console.log(
  `false positives : ${falsePos.length}/${fpSample.length} (${((falsePos.length / Math.max(1, fpSample.length)) * 100).toFixed(1)}%)`
)
if (falsePos.length) {
  for (const c of falsePos.slice(0, 8)) {
    console.log(`  !! ${c.name} — ${(c.oracle_text ?? '').split('\n')[0].slice(0, 70)}`)
  }
}

// 1b. The card that prompted this, plus wipes that must NOT be flagged.
const namedRes = await realFetch('https://api.scryfall.com/cards/collection', {
  method: 'POST',
  headers: { ...HEADERS, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    identifiers: [
      'Devastation',
      'Armageddon',
      'Boil',
      'Apocalypse',
      'Ruination',
      'Wrath of God',
      'Damnation',
      'Austere Command',
      'Blasphemous Act',
    ].map((name) => ({ name })),
  }),
})
const namedCards = ((await namedRes.json()) as { data?: ScryCard[] }).data ?? []
const byName = new Map(namedCards.map((c) => [c.name, c]))
const SHOULD_FLAG = ['Devastation', 'Armageddon', 'Boil', 'Apocalypse', 'Ruination']
const SHOULD_NOT = ['Wrath of God', 'Damnation', 'Austere Command', 'Blasphemous Act']
const wrongFlag = [
  ...SHOULD_FLAG.filter((n) => byName.has(n) && !isMassLandDenial(byName.get(n)!)),
  ...SHOULD_NOT.filter((n) => byName.has(n) && isMassLandDenial(byName.get(n)!)),
]
console.log(`\nnamed spot-check: ${wrongFlag.length ? 'WRONG -> ' + wrongFlag.join(', ') : 'all correct'}`)

// 2. Real builds must not contain any tagged MLD card at bracket 3.
const COMMANDERS = ['Grizzlegom, Hurloon Hero', 'Atraxa, Praetors\' Voice']
const leaks: string[] = []
const comboLeaks: string[] = []
for (const name of COMMANDERS) {
  const lookup = await realFetch(
    `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`,
    { headers: HEADERS }
  )
  const commander = (await lookup.json()) as ScryCard
  const settings: BuildSettings = {
    commander,
    bracket: 3,
    budget: 'mid',
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
    powerProfile: DEFAULT_PROFILE,
    personality: 'value',
  }
  console.log(`\nbuilding ${commander.name} at bracket 3...`)
  const deck = await generateDeck(settings, () => {})
  const found = deck.cards.filter(
    (d) => d.category !== 'Commander' && mldNames.has(d.card.name.split(' //')[0].toLowerCase())
  )
  console.log(`  ${deck.cards.reduce((n, d) => n + d.qty, 0)} cards, ${found.length} MLD`)
  for (const d of found) {
    console.log(`  !! ${d.card.name} — ${d.reason.slice(0, 70)}`)
    leaks.push(`${commander.name}: ${d.card.name}`)
  }

  // generateDeck runs pruneTwoCardCombos at bracket <= 3; verify nothing the
  // bracket disallows survived it.
  const { included } = await findCombos(deck)
  const overBracket = included.filter((c) => comboMinBracket(c, deck.cards) > 3)
  console.log(`  ${included.length} combos, ${overBracket.length} above bracket 3`)
  for (const c of overBracket) {
    console.log(`  !! ${c.cards.join(' + ')} -> bracket ${comboMinBracket(c, deck.cards)}`)
    comboLeaks.push(`${commander.name}: ${c.cards.join(' + ')}`)
  }
}

const checks: [string, boolean][] = [
  ['Devastation and friends flagged, wipes not', wrongFlag.length === 0],
  // The tag also covers long-tail mana-taxing and symmetrical-balancing effects
  // (Damping Sphere, Balancing Act, Equipoise) that the generator would never
  // surface anyway. The assertions that actually protect a deck are the named
  // spot-check and the no-MLD-in-a-real-build check below; this is a health
  // signal, set as a regression guard just under the measured rate.
  ['detector recall >= 60% on tagged MLD', detectorMisses.length / Math.max(1, sample.length) <= 0.4],
  ['detector false positives <= 5%', falsePos.length / Math.max(1, fpSample.length) <= 0.05],
  ['no MLD in any bracket-3 build', leaks.length === 0],
  ['no above-bracket combos survive the prune', comboLeaks.length === 0],
]
console.log('')
let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`)
}
console.log(`\n${failed === 0 ? 'ALL OK' : `${failed} FAILURE(S)`}`)
process.exit(failed === 0 ? 0 : 1)
