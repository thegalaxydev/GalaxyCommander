// Measures categorize() against Scryfall's community oracle tags, which are a
// far better ground truth than the regexes themselves. Tags are used only here,
// at test time — classification stays offline and synchronous at runtime.
// Run: npm run check:categorize
import type { ScryCard } from '../src/types'
import { categorize } from '../src/generator'

const HEADERS = { 'User-Agent': 'GalaxyCommander/1.0', Accept: 'application/json' }

async function sample(query: string, pages = 2): Promise<ScryCard[]> {
  const out: ScryCard[] = []
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards`
  for (let i = 0; i < pages && url; i++) {
    const res = await fetch(url, { headers: HEADERS })
    const body = (await res.json()) as {
      data?: ScryCard[]
      next_page?: string
      details?: string
    }
    if (!body.data) {
      if (i === 0) console.log(`  (no results for ${query}: ${body.details ?? res.status})`)
      break
    }
    out.push(...body.data)
    url = body.next_page ?? ''
    await new Promise((r) => setTimeout(r, 120))
  }
  return out
}

// Scryfall tags any card that *contains* a mass-removal effect; categorize()
// assigns a card's primary deckbuilding role. Those only coincide for instants
// and sorceries, where the spell is its effect — Archangel Avacyn contains a
// wipe but is correctly a Finisher. So recall is measured on spells only, while
// false positives are measured across every card type.
const BOARD_WIPE = 'otag:board-wipe legal:commander (t:instant or t:sorcery)'
const NOT_BOARD_WIPE =
  '-otag:board-wipe legal:commander (o:"each creature" or o:"all creatures") -t:land'

console.log('sampling Scryfall oracle tags...')
const [wipes, notWipes] = await Promise.all([sample(BOARD_WIPE), sample(NOT_BOARD_WIPE)])
console.log(`  ${wipes.length} tagged wipe spells, ${notWipes.length} mass-effect non-wipes\n`)

const truePos = wipes.filter((c) => categorize(c) === 'Board Wipes')
const falseNeg = wipes.filter((c) => categorize(c) !== 'Board Wipes')
const falsePos = notWipes.filter((c) => categorize(c) === 'Board Wipes')

const recall = wipes.length ? truePos.length / wipes.length : 0
const fpRate = notWipes.length ? falsePos.length / notWipes.length : 0

console.log(`recall on wipe spells  : ${(recall * 100).toFixed(1)}% (${truePos.length}/${wipes.length})`)
console.log(`false positives        : ${(fpRate * 100).toFixed(1)}% (${falsePos.length}/${notWipes.length})`)

if (falsePos.length) {
  console.log('\nmisfiled as Board Wipes:')
  for (const c of falsePos.slice(0, 12)) {
    console.log(`  ${c.name} — ${(c.oracle_text ?? '').split('\n')[0].slice(0, 90)}`)
  }
}
if (falseNeg.length) {
  console.log('\nmissed wipes (fall through to another category):')
  for (const c of falseNeg.slice(0, 12)) {
    console.log(`  ${c.name} [${categorize(c)}] — ${(c.oracle_text ?? '').split('\n')[0].slice(0, 80)}`)
  }
}

// The card that started this: a counter-doubler, definitively not a wipe.
const named = await sample('!"Bristly Bill, Spine Sower"', 1)
const bristly = named[0]
const checks: [string, boolean][] = [
  ['Bristly Bill resolved', !!bristly],
  ['Bristly Bill is not a Board Wipe', !!bristly && categorize(bristly) !== 'Board Wipes'],
  // Regression guards set just below the measured rates, not aspirations. The
  // ~14% of wipe spells still missed use irregular templating (modal "Choose
  // one —", cascade, "airbend all other creatures"); matching them costs more
  // in false positives than the recall is worth.
  ['recall >= 85% on tagged wipe spells', recall >= 0.85],
  ['false positives <= 3%', fpRate <= 0.03],
]
// ---------------------------------------------------------------------------
// Category recall against community oracle tags. A tag marks any card that
// *contains* the effect while categorize() picks a primary role, so each tag
// accepts a set of categories (a land tutor is Ramp, Bojuka Bog is a Land).
// Thresholds are regression guards set just below the measured rates.
// ---------------------------------------------------------------------------

const TAG_SUITES: { tag: string; query: string; accept: string[]; floor: number }[] = [
  {
    tag: 'ramp',
    query: 'otag:ramp legal:commander',
    accept: ['Ramp', 'Lands'],
    floor: 0.7,
  },
  {
    tag: 'counterspell',
    query: 'otag:counterspell legal:commander (t:instant or t:sorcery)',
    accept: ['Counterspells'],
    floor: 0.8,
  },
  {
    tag: 'removal',
    query: 'otag:removal legal:commander (t:instant or t:sorcery)',
    accept: ['Removal', 'Board Wipes', 'Counterspells'],
    floor: 0.8,
  },
  {
    tag: 'tutor',
    query: 'otag:tutor legal:commander (t:instant or t:sorcery)',
    accept: ['Tutors', 'Ramp', 'Lands'],
    floor: 0.72,
  },
  // graveyard-hate is informational only (floor 0): the tag marks any card
  // with incidental graveyard interaction — removal riders, value creatures —
  // far broader than a primary Graveyard Hate role.
  {
    tag: 'graveyard-hate',
    query: 'otag:graveyard-hate legal:commander',
    accept: ['Graveyard Hate', 'Lands'],
    floor: 0,
  },
]

console.log('\nmeasuring recall against oracle tags...')
for (const suite of TAG_SUITES) {
  const cards = await sample(suite.query)
  if (!cards.length) continue
  const hit = cards.filter((c) => suite.accept.includes(categorize(c)))
  const rate = hit.length / cards.length
  console.log(
    `  ${suite.tag.padEnd(15)} ${(rate * 100).toFixed(1)}% of ${cards.length} land in ${suite.accept.join('/')}`
  )
  const missed = cards.filter((c) => !suite.accept.includes(categorize(c)))
  for (const c of missed.slice(0, 6)) {
    console.log(`      miss: ${c.name} [${categorize(c)}] — ${(c.oracle_text ?? '').split('\n')[0].slice(0, 70)}`)
  }
  checks.push([`${suite.tag} recall >= ${suite.floor * 100}%`, rate >= suite.floor])
}

// ---------------------------------------------------------------------------
// Named-card expectations: the primary role a player would file each card
// under. These are the regression suite for the full taxonomy — every category
// has a handful of canonical members plus known near-miss traps.
// ---------------------------------------------------------------------------

const EXPECTATIONS: [string, string][] = [
  // Ramp — including the "search for a Plains/Forest card" templating that the
  // old classifier missed (the Farseek bug).
  ['Farseek', 'Ramp'],
  ["Nature's Lore", 'Ramp'],
  ['Three Visits', 'Ramp'],
  ['Cultivate', 'Ramp'],
  ["Kodama's Reach", 'Ramp'],
  ['Rampant Growth', 'Ramp'],
  ['Sol Ring', 'Ramp'],
  ['Arcane Signet', 'Ramp'],
  ['Llanowar Elves', 'Ramp'],
  ['Birds of Paradise', 'Ramp'],
  ['Solemn Simulacrum', 'Ramp'],
  ['Smothering Tithe', 'Ramp'],
  ['Dockside Extortionist', 'Ramp'],
  ['Exploration', 'Ramp'],
  ['Dark Ritual', 'Ramp'],
  // Card draw — engines above the old cmc<=5 cutoff included.
  ['Rhystic Study', 'Card Draw'],
  ['Mystic Remora', 'Card Draw'],
  ['Esper Sentinel', 'Card Draw'],
  ['Phyrexian Arena', 'Card Draw'],
  ['Sylvan Library', 'Card Draw'],
  ['Consecrated Sphinx', 'Card Draw'],
  ['Mulldrifter', 'Card Draw'],
  ['Brainstorm', 'Card Draw'],
  ["Night's Whisper", 'Card Draw'],
  ['Windfall', 'Card Draw'],
  ['Necropotence', 'Card Draw'],
  // Tutors
  ['Demonic Tutor', 'Tutors'],
  ['Vampiric Tutor', 'Tutors'],
  ['Mystical Tutor', 'Tutors'],
  ['Worldly Tutor', 'Tutors'],
  ['Enlightened Tutor', 'Tutors'],
  ['Chord of Calling', 'Tutors'],
  ["Green Sun's Zenith", 'Tutors'],
  // Counterspells
  ['Counterspell', 'Counterspells'],
  ['Swan Song', 'Counterspells'],
  ['Negate', 'Counterspells'],
  ["Dovin's Veto", 'Counterspells'],
  ['Fierce Guardianship', 'Counterspells'],
  ['Arcane Denial', 'Counterspells'],
  // Removal
  ['Swords to Plowshares', 'Removal'],
  ['Path to Exile', 'Removal'],
  ['Beast Within', 'Removal'],
  ['Generous Gift', 'Removal'],
  ['Chaos Warp', 'Removal'],
  ['Terminate', 'Removal'],
  ['Anguished Unmaking', 'Removal'],
  ['Grave Pact', 'Removal'],
  ['Pongify', 'Removal'],
  // Board wipes
  ['Wrath of God', 'Board Wipes'],
  ['Damnation', 'Board Wipes'],
  ['Blasphemous Act', 'Board Wipes'],
  ['Cyclonic Rift', 'Board Wipes'],
  ['Toxic Deluge', 'Board Wipes'],
  ['Farewell', 'Board Wipes'],
  // Graveyard hate
  ['Rest in Peace', 'Graveyard Hate'],
  ["Tormod's Crypt", 'Graveyard Hate'],
  ['Soul-Guide Lantern', 'Graveyard Hate'],
  ['Relic of Progenitus', 'Graveyard Hate'],
  ['Bojuka Bog', 'Lands'], // graveyard hate, but a land first
  // Recursion
  ['Animate Dead', 'Recursion'],
  ['Reanimate', 'Recursion'],
  ['Eternal Witness', 'Recursion'],
  ['Regrowth', 'Recursion'],
  // Protection
  ["Teferi's Protection", 'Protection'],
  ['Heroic Intervention', 'Protection'],
  ['Lightning Greaves', 'Protection'],
  ['Swiftfoot Boots', 'Protection'],
  ['Flawless Maneuver', 'Protection'],
  // Tokens
  ['Anointed Procession', 'Tokens'],
  ['Doubling Season', 'Tokens'],
  ['Bitterblossom', 'Tokens'],
  ['Secure the Wastes', 'Tokens'],
  ['Avenger of Zendikar', 'Tokens'],
  // Stax
  ['Winter Orb', 'Stax'],
  ['Rule of Law', 'Stax'],
  ['Sphere of Resistance', 'Stax'],
  ['Thalia, Guardian of Thraben', 'Stax'],
  ['Drannith Magistrate', 'Stax'],
  // Finishers
  ['Craterhoof Behemoth', 'Finishers'],
  ['Overwhelming Stampede', 'Finishers'],
  ['Approach of the Second Sun', 'Finishers'],
  ['Blightsteel Colossus', 'Finishers'],
  ['Expropriate', 'Finishers'],
  ['Ulamog, the Ceaseless Hunger', 'Finishers'],
  // Synergy — anthem/counters cards that every trap above must not swallow.
  ['Bristly Bill, Spine Sower', 'Synergy'],
  ['Coat of Arms', 'Synergy'],
  ['Conjurer\'s Closet', 'Synergy'], // self-blink, not removal
]

async function fetchCollection(names: string[]): Promise<Map<string, ScryCard>> {
  const out = new Map<string, ScryCard>()
  for (let i = 0; i < names.length; i += 75) {
    const chunk = names.slice(i, i + 75)
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
    })
    const body = (await res.json()) as { data?: ScryCard[]; not_found?: unknown[] }
    for (const card of body.data ?? []) out.set(card.name, card)
    if (body.not_found?.length) console.log('  not found:', JSON.stringify(body.not_found))
    await new Promise((r) => setTimeout(r, 120))
  }
  return out
}

console.log('\nchecking named-card expectations...')
const collection = await fetchCollection(EXPECTATIONS.map(([n]) => n))
let misses = 0
for (const [name, want] of EXPECTATIONS) {
  const card = collection.get(name)
  if (!card) {
    console.log(`  FAIL  ${name} — did not resolve`)
    misses++
    continue
  }
  const got = categorize(card)
  if (got !== want) {
    console.log(`  FAIL  ${name} — expected ${want}, got ${got}`)
    console.log(`        ${(card.oracle_text ?? card.card_faces?.[0]?.oracle_text ?? '').split('\n')[0].slice(0, 100)}`)
    misses++
  }
}
console.log(`  ${EXPECTATIONS.length - misses}/${EXPECTATIONS.length} named cards categorized as expected`)
checks.push(['all named-card expectations hold', misses === 0])

console.log('')
let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`)
}
if (bristly) console.log(`\n  Bristly Bill classifies as: ${categorize(bristly)}`)
console.log(`\n${failed === 0 ? 'ALL OK' : `${failed} FAILURE(S)`}`)
process.exit(failed === 0 ? 0 : 1)
