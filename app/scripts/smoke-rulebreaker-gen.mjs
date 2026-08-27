// End-to-end generation checks for Rulebreaker commanders. Requires `npm run dev`.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:5173/'
console.log(`testing ${BASE}`)
await page.goto(BASE, { waitUntil: 'networkidle' })
const dismiss = page.locator('.modal-backdrop button', { hasText: 'Maybe later' })
if (await dismiss.count()) await dismiss.first().click()

async function generate(name) {
  const clear = page.locator('.commander-chip .chip-clear').first()
  if (await clear.count()) {
    await clear.click()
    await page.waitForTimeout(300)
  }
  const input = page.locator('.sidebar input').first()
  await input.click()
  await input.type(name, { delay: 25 })
  await page.locator('.search-result', { hasText: name }).first().click()
  await page.waitForTimeout(600)
}

async function runBuild() {
  await page.locator('button', { hasText: 'Generate Deck' }).first().click()
  await page.locator('.overview').first().waitFor({ timeout: 180000 })
  await page.waitForTimeout(2500)
  await page.locator('.deck-tabs button', { hasText: 'Decklist' }).first().click()
  await page.waitForTimeout(1200)
  return page.locator('.decklist').first().innerText()
}

function countCards(text) {
  let total = 0
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\d+)$/)
    if (m) total += Number(m[1])
  }
  return total
}

const checks = []

// 1. Valko Indorian — off-color Phyrexians, and basics that can cast them.
await generate('Valko Indorian')
const valko = await runBuild()
const basics = Object.fromEntries(
  ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map((b) => {
    const m = valko.match(new RegExp(`^(\\d+)\\n${b}$`, 'm'))
    return [b, m ? Number(m[1]) : 0]
  })
)
console.log('Valko basics:', basics)
console.log('Valko total :', countCards(valko))
checks.push(['Valko: 100 cards', countCards(valko) === 100])
checks.push(['Valko: Swamps dominate', basics.Swamp >= 8])
const offBasics = ['Plains', 'Island', 'Mountain', 'Forest'].filter((b) => basics[b] > 0)
checks.push(['Valko: off-color basics present', offBasics.length > 0])
checks.push([
  'Valko: no single off-color basic',
  offBasics.every((b) => basics[b] >= 2),
])
await page.locator('.deck-tabs button', { hasText: 'Overview' }).first().click()
await page.waitForTimeout(600)
checks.push(['Valko: Rulebreaker badge', await page.locator('.rulebreaker-badge').isVisible()])

// 1b. Valko again, narrowed to green only — no white/blue/red Phyrexians.
await page.locator('button', { hasText: 'New Build' }).first().click()
await page.waitForTimeout(800)
await generate('Valko Indorian')
const offGroup = page.locator('[aria-label="Rulebreaker off-colors"]')
for (const c of ['w', 'u', 'r']) {
  await offGroup.locator(`.color-pip:has(.ms-${c})`).click()
}
await page.waitForTimeout(300)
const narrowed = await runBuild()
const narrowedNames = [...new Set(narrowed.split('\n').map((l) => l.trim()).filter(Boolean))]
const res = await fetch('https://api.scryfall.com/cards/collection', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'User-Agent': 'GC/1.0' },
  body: JSON.stringify({ identifiers: narrowedNames.slice(0, 200).map((name) => ({ name })) }),
})
const resolved = ((await res.json()).data ?? []).filter((c) => !/Basic/.test(c.type_line))
const bad = resolved.filter((c) => c.color_identity.some((x) => ['W', 'U', 'R'].includes(x)))
console.log('narrowed off-limits cards:', bad.map((c) => `${c.name} [${c.color_identity.join('')}]`).slice(0, 8))
checks.push(['Valko narrowed: no W/U/R nonbasics', bad.length === 0])

// 2. Whtz, the Bibliophile — the deck-size cap is lifted.
await page.locator('button', { hasText: 'New Build' }).first().click()
await page.waitForTimeout(800)
await generate('Whtz')
await page.locator('section.rulebreaker input[type=range]').fill('160')
await page.waitForTimeout(300)
const whtz = await runBuild()
const whtzTotal = countCards(whtz)
console.log('Whtz total  :', whtzTotal)
checks.push(['Whtz: built 160 cards', whtzTotal === 160])

let failed = 0
console.log('')
for (const [label, ok] of checks) {
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`)
}
if (errors.length) for (const e of [...new Set(errors)].slice(0, 5)) console.log('  err: ' + e.slice(0, 200))
console.log(`\n${failed === 0 ? 'ALL OK' : `${failed} FAILURE(S)`}`)
await browser.close()
process.exit(failed === 0 ? 0 : 1)
