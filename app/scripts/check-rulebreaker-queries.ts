// Sends the identity clauses the generator builds to Scryfall, to confirm the
// syntax is valid and that the widened pool really does contain off-color cards.
// Run: node_modules/.bin/tsx scripts/check-rulebreaker-queries.ts
import type { ScryCard } from '../src/types'
import { combineRulebreakers, identityClause, splashOptions } from '../src/rulebreaker'

const HEADERS = { 'User-Agent': 'GalaxyCommander/1.0', Accept: 'application/json' }

async function scry(q: string): Promise<{ cards: ScryCard[]; total: number; error?: string }> {
  const res = await fetch(
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=cards`,
    { headers: HEADERS }
  )
  const body = (await res.json()) as {
    data?: ScryCard[]
    total_cards?: number
    details?: string
  }
  if (!body.data) return { cards: [], total: 0, error: body.details ?? `HTTP ${res.status}` }
  return { cards: body.data, total: body.total_cards ?? body.data.length }
}

const search = await fetch(
  `https://api.scryfall.com/cards/search?q=${encodeURIComponent('keyword:Rulebreaker')}&unique=cards`,
  { headers: HEADERS }
)
const commanders = ((await search.json()) as { data: ScryCard[] }).data.sort((a, b) =>
  a.name.localeCompare(b.name)
)

let failures = 0
for (const cmd of commanders) {
  const mode = combineRulebreakers(cmd)
  const identity = cmd.color_identity
  const splash = mode?.needsSplashColor ? splashOptions(identity)[0] : null
  const clause = identityClause(identity, mode, { splash })

  // The generator always appends more filters; -t:land keeps the sample readable.
  const q = `${clause} -t:land`
  const { cards, total, error } = await scry(q)
  console.log(`\n=== ${cmd.name} [${identity.join('') || 'C'}]${splash ? ` +${splash}` : ''}`)
  console.log(`  query : ${q}`)
  if (error) {
    console.log(`  !! SCRYFALL ERROR: ${error}`)
    failures++
    continue
  }
  const id = new Set(identity)
  const offColor = cards.filter((c) => !c.color_identity.every((x) => id.has(x)))
  console.log(`  hits  : ${total} (page of ${cards.length}, ${offColor.length} off-color)`)
  if (offColor.length) {
    console.log(
      `  e.g.  : ${offColor
        .slice(0, 3)
        .map((c) => `${c.name} [${c.color_identity.join('') || 'C'}]`)
        .join(', ')}`
    )
  }

  // A commander whose only clause is a deck-size rule should not widen anything.
  const widens = !!mode && (mode.grants.length > 0 || mode.anyLands || mode.anyBasicLands)
  if (widens && clause.startsWith('id<=')) {
    console.log('  !! expected a widened clause, got a plain identity filter')
    failures++
  }
  if (!widens && !clause.startsWith('id<=')) {
    console.log('  !! widened the pool for a commander with no color exception')
    failures++
  }
  // Whtz only changes deck size, so its pool must stay inside its own colors.
  if (!widens && offColor.length > 0) {
    console.log('  !! off-color cards leaked into a non-widening commander')
    failures++
  }
  // Narrowing the off-colors must tighten the clause, never widen it.
  const anyGrants = mode?.grants.filter((g) => g.scope === 'any') ?? []
  if (anyGrants.length) {
    const narrowed = identityClause(identity, mode, { splash, colors: identity })
    const narrowedRes = await scry(`${narrowed} -t:land`)
    if (narrowedRes.error) {
      console.log(`  !! narrowed clause invalid: ${narrowedRes.error}`)
      failures++
    } else {
      const narrowedOff = narrowedRes.cards.filter((c) => !c.color_identity.every((x) => id.has(x)))
      console.log(`  narrow: ${narrowed}`)
      console.log(`          ${narrowedRes.total} hits, ${narrowedOff.length} off-color`)
      if (narrowedOff.length > 0) {
        console.log('  !! narrowing to the commander\'s own colors still let off-color cards in')
        failures++
      }
      if (narrowedRes.total > total) {
        console.log('  !! narrowing widened the pool')
        failures++
      }
    }
    await new Promise((r) => setTimeout(r, 120))
  }
  await new Promise((r) => setTimeout(r, 120)) // Scryfall asks for ~10 req/s
}

console.log(`\n${failures === 0 ? 'ALL OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
