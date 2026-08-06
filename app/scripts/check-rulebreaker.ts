// Verifies the Rulebreaker parser against every printed Rulebreaker card.
// Run: node_modules/.bin/tsx scripts/check-rulebreaker.ts
import type { ScryCard } from '../src/types'
import {
  combineRulebreakers,
  rulebreakerAllows,
  rulebreakerClauses,
  rulebreakerMode,
} from '../src/rulebreaker'

const HEADERS = { 'User-Agent': 'GalaxyCommander/1.0', Accept: 'application/json' }

const res = await fetch(
  'https://api.scryfall.com/cards/search?q=' +
    encodeURIComponent('keyword:Rulebreaker') +
    '&unique=cards',
  { headers: HEADERS }
)
const body = (await res.json()) as { data?: ScryCard[]; details?: string }
if (!body.data) throw new Error(`Scryfall search failed: ${body.details ?? res.status}`)
const data = body.data

let failures = 0
for (const card of data.sort((a, b) => a.name.localeCompare(b.name))) {
  const mode = rulebreakerMode(card)
  console.log(`\n=== ${card.name}  [${card.color_identity.join('') || 'C'}]`)
  if (!mode) {
    console.log('  !! NOT PARSED')
    failures++
    continue
  }
  console.log('  clause :', mode.text[0])
  for (const g of mode.grants) {
    console.log(`  grant  : "${g.label}" (${g.scope}) -> ${g.query}`)
  }
  const flags = [
    mode.anyLands && 'anyLands',
    mode.anyBasicLands && 'anyBasicLands',
    mode.noMaxDeckSize && 'noMaxDeckSize',
    mode.needsSplashColor && 'needsSplashColor',
  ].filter(Boolean)
  console.log('  flags  :', flags.join(', ') || '(none)')
  console.log(
    '  scry   :',
    rulebreakerClauses(mode, card.color_identity, 'R').join(' or ') || '(none)'
  )
  if (mode.grants.length === 0 && !mode.anyLands && !mode.noMaxDeckSize) {
    console.log('  !! no grants and no land/size rule extracted')
    failures++
  }
}

// Spot-check the local predicate against real cards the clauses should catch.
const probes: [string, string, boolean][] = [
  ['Valko Indorian', 'Elesh Norn, Grand Cenobite', true], // Phyrexian Praetor, white
  ['Valko Indorian', 'Gitaxian Probe', false], // Phyrexian *mana*, but not a Phyrexian card
  ['Valko Indorian', 'Llanowar Elves', false],
  ['Seluma, Light of Aysen', 'Sephara, Sky\'s Blade', true], // Angel, white-ish
  ['Seluma, Light of Aysen', 'Grave Titan', false],
  ['Maular, the Next Evolution', 'Blightsteel Colossus', true], // MV 12 creature
  ['Maular, the Next Evolution', 'Counterspell', false],
  ['Hadran, Naya Sunseeder', 'Grave Titan', true], // power 6
  ['Hadran, Naya Sunseeder', 'Birds of Paradise', false], // power 0
  ['The Everforger', 'Skysovereign, Consul Flagship', false], // artifact, not creature/equipment
  ['The Everforger', 'Batterskull', true], // Equipment
  ['The Unluckiest Planeswalker', 'Rancor', true], // Aura
  ['Arvad of the Weatherlight', 'Sol Ring', false],
  ['Arvad of the Weatherlight', 'Urza, Lord High Artificer', true], // legendary creature
  ['Daxiver, Izzet Electromancer', 'Cultivate', true], // sorcery
  ['Valko Indorian, Researcher', 'Rhystic Study', true], // enchantment
]

const names = [...new Set(probes.flatMap(([a, b]) => [a, b]))]
const collection = await fetch('https://api.scryfall.com/cards/collection', {
  method: 'POST',
  headers: { ...HEADERS, 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifiers: names.map((name) => ({ name })) }),
})
const looked = (await collection.json()) as { data: ScryCard[]; not_found?: unknown[] }
const byName = new Map(looked.data.map((c) => [c.name.toLowerCase(), c]))

console.log('\n\n=== predicate probes')
for (const [cmdName, cardName, expected] of probes) {
  const cmd = byName.get(cmdName.toLowerCase())
  const card = byName.get(cardName.toLowerCase())
  if (!cmd || !card) {
    console.log(`  ?? missing card data: ${cmdName} / ${cardName}`)
    failures++
    continue
  }
  const mode = combineRulebreakers(cmd)
  const got = rulebreakerAllows(mode, card, cmd.color_identity, null)
  const ok = got === expected
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${cmdName} + ${cardName} -> ${got} (want ${expected})`)
}

console.log(`\n${failures === 0 ? 'ALL OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
