// Answers "where do the cards actually come from?" by running the real
// generator in Node and tallying each card's `reason`, which the generator
// already stamps with its provenance.
// Run: npm run explain -- "Atraxa, Praetors' Voice"
import type { BuildSettings, ScryCard } from '../src/types'
import { DEFAULT_PROFILE } from '../src/types'

// The app talks to Scryfall and EDHREC through same-origin proxy paths that
// only exist under Caddy/Vite. Point them at the real hosts.
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
// themes.ts touches document at import time only inside functions we never call,
// but the module graph is shared, so give it a stub.
;(globalThis as Record<string, unknown>).document = { documentElement: { style: { setProperty() {} } } }

const { generateDeck } = await import('../src/generator')

const name = process.argv[2] ?? "Atraxa, Praetors' Voice"
const res = await realFetch(
  `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`,
  { headers: { 'User-Agent': 'GalaxyCommander/1.0' } }
)
const commander = (await res.json()) as ScryCard
if (!commander.name) throw new Error(`no such commander: ${name}`)

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

console.log(`building ${commander.name}...\n`)
const deck = await generateDeck(settings, () => {})

// Each generator path stamps a distinctive reason; map them back to a source.
const SOURCES: [RegExp, string][] = [
  [/on EDHREC/, 'EDHREC recommendations'],
  [/Your commander|Your partner commander/, 'Commander'],
  [/Pinned by you/, 'Your Card Rules (must-include)'],
  [/A Game Changer/, 'Scryfall is:gamechanger query'],
  [/premium original dual land/, 'Hardcoded dual-land list'],
  [/Basic land for consistent mana/, 'Mana base (computed from pips)'],
  [/widely played card in these colors|complete the deck/, 'Scryfall filler (last resort)'],
  [/Directly supports your chosen theme/, 'Scryfall theme query'],
  [/strong recent printing/, 'Scryfall latest-sets query'],
  [/strong land for this color identity/, 'Scryfall category query — Lands'],
  [/Mana acceleration/, 'Scryfall category query — Ramp'],
  [/Card advantage to keep your hand full/, 'Scryfall category query — Card Draw'],
  [/Interaction for opposing threats/, 'Scryfall category query — Removal'],
  [/reset button when the board/, 'Scryfall category query — Board Wipes'],
  [/Closes out the game/, 'Scryfall category query — Finishers'],
]

const tally = new Map<string, number>()
for (const d of deck.cards) {
  const hit = SOURCES.find(([re]) => re.test(d.reason))
  const label = hit ? hit[1] : `Other: ${d.reason.slice(0, 50)}`
  tally.set(label, (tally.get(label) ?? 0) + d.qty)
}

const total = deck.cards.reduce((n, d) => n + d.qty, 0)
const rows = [...tally.entries()].sort((a, b) => b[1] - a[1])
console.log(`${total} cards total\n`)
for (const [label, n] of rows) {
  const pct = ((n / total) * 100).toFixed(0).padStart(3)
  console.log(`  ${String(n).padStart(3)}  ${pct}%  ${label}`)
}

const edhrec = tally.get('EDHREC recommendations') ?? 0
console.log(`\nEDHREC-sourced: ${edhrec}/${total} (${((edhrec / total) * 100).toFixed(0)}%)`)
