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
console.log('')
let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`)
}
if (bristly) console.log(`\n  Bristly Bill classifies as: ${categorize(bristly)}`)
console.log(`\n${failed === 0 ? 'ALL OK' : `${failed} FAILURE(S)`}`)
process.exit(failed === 0 ? 0 : 1)
