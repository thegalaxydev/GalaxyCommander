import { generateDeck, GEN_STEPS } from './src/generator'
import type { BuildSettings, ScryCard } from './src/types'
import { deckPrice, totalCards, curveBuckets, typeCounts } from './src/analysis'

const realFetch = globalThis.fetch
const HEADERS = { 'User-Agent': 'GalaxyCommander/0.1 (smoke test)', Accept: 'application/json' }
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  let url = typeof input === 'string' ? input : input.toString()
  if (url.startsWith('/edhrec-api')) url = url.replace('/edhrec-api', 'https://json.edhrec.com')
  return realFetch(url, { ...init, headers: { ...HEADERS, ...(init?.headers ?? {}) } })
}) as typeof fetch

const commanderName = process.argv[2] ?? "Atraxa, Praetors' Voice"
const themes =
  process.argv[3] && process.argv[3] !== '-'
    ? process.argv[3].split(',').filter(Boolean)
    : process.argv[3] === '-'
      ? []
      : ['Infect', 'Proliferate']
const arg = (i: number) => (process.argv[i] && process.argv[i] !== '-' ? process.argv[i] : undefined)
const partnerName = arg(4)
const res = await fetch(
  `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(commanderName)}`
)
console.log('commander fetch status:', res.status)
const commander = (await res.json()) as ScryCard
console.log('commander:', commander.name, '| identity:', commander.color_identity.join('') || 'colorless')
let partner: ScryCard | null = null
if (partnerName) {
  const pres = await fetch(
    `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(partnerName)}`
  )
  partner = (await pres.json()) as ScryCard
  console.log('partner:', partner.name, '| identity:', partner.color_identity.join(''))
}

const mustName = arg(5)
const neverName = arg(6)
let mustInclude: ScryCard[] = []
if (mustName) {
  const mres = await fetch(
    `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(mustName)}`
  )
  mustInclude = [(await mres.json()) as ScryCard]
  console.log('must include:', mustInclude[0].name)
}

const settings: BuildSettings = {
  commander,
  partner,
  bracket: 3,
  budget: 'mid',
  themes,
  themeSlugs: themes.map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
  tags: [],
  options: {
    includeStaples: true,
    prioritizeSynergy: true,
    avoidCombos: false,
    avoidTutors: false,
    latestSets: true,
  },
  powerProfile: { ramp: 70, interaction: 70, draw: 50, combo: 40, tutors: 50, resiliency: 65 },
  meta: ['Aggro-heavy', 'Combo-heavy'],
  mustInclude,
  neverInclude: neverName ? [neverName] : [],
}

const deck = await generateDeck(settings, (step) => {
  console.log('STEP:', GEN_STEPS[step])
})

console.log('total cards:', totalCards(deck.cards))
console.log('unique entries:', deck.cards.length)
console.log('price: $' + deckPrice(deck.cards).toFixed(0))
console.log('power:', deck.power)
console.log('curve:', curveBuckets(deck.cards))
for (const t of typeCounts(deck.cards)) console.log(`  ${t.category}: ${t.count}`)
console.log('desc:', deck.description)
const names = new Set<string>()
const dupes: string[] = []
for (const d of deck.cards) {
  if (names.has(d.card.name)) dupes.push(`${d.card.name} [${d.category}]`)
  names.add(d.card.name)
}
console.log('duplicate names:', dupes)
const overCap = deck.cards.filter(
  (d) => d.category !== 'Commander' && parseFloat(d.card.prices?.usd ?? '0') > 8
)
console.log('cards over $8 cap:', overCap.map((d) => d.card.name))
console.log(
  'sample synergy reasons:',
  deck.cards.filter((d) => d.category === 'Synergy').slice(0, 3).map((d) => `${d.card.name}: ${d.reason}`)
)
console.log(
  'must-include present:',
  mustInclude.map((c) => deck.cards.some((d) => d.card.name === c.name))
)
if (neverName) {
  console.log(
    'never-include leaked:',
    deck.cards.some((d) => d.card.name.toLowerCase() === neverName.toLowerCase())
  )
}
console.log(
  'meta tech samples:',
  deck.cards
    .filter((d) => /tables\./.test(d.reason))
    .slice(0, 5)
    .map((d) => `${d.card.name} (${d.reason.split(' ').slice(0, 6).join(' ')}...)`)
)

const { deckHealth } = await import('./src/analysis')
console.log('health:')
for (const h of deckHealth(deck)) console.log(`  ${h.level === 'warn' ? '!' : 'ok'} ${h.message}`)

const { simulateHands } = await import('./src/simulator')
const sim = simulateHands(deck, 1000)
console.log(
  `sim: avgLands=${sim.avgLands.toFixed(2)} avgRamp=${sim.avgRamp.toFixed(2)} mull=${(sim.mulliganRate * 100).toFixed(1)}% avgCmdTurn=${sim.avgCommanderTurn.toFixed(2)}`
)
console.log('cmd cast prob:', sim.commanderByTurn.map((b) => `T${b.turn}=${(b.probability * 100).toFixed(0)}%`).join(' '))
