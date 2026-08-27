// Verifies the combo bracket badge renders as a working Commander Spellbook
// link. Builds the list by hand rather than generating, so the combo is
// deterministic — a generated deck may happen to contain none.
import { chromium } from 'playwright'

const COMMANDER = 'Omnath, Locus of Rage'
const CARDS = ['Springheart Nantuko', 'Lotus Cobra', 'Tireless Provisioner']

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('dialog', (d) => {
  errors.push(`dialog: ${d.message()}`)
  d.accept()
})
await page.goto(process.env.SMOKE_BASE ?? 'http://localhost:5173/', { waitUntil: 'networkidle' })
const dismiss = page.locator('.modal-backdrop button', { hasText: 'Maybe later' })
if (await dismiss.count()) await dismiss.first().click()

await page.locator('button', { hasText: 'Deck Builder' }).first().click()
await page.waitForTimeout(1200)

const search = page.locator('input[placeholder="Search any card to add..."]')
async function addCard(name) {
  await search.click()
  await search.fill('')
  await search.type(name, { delay: 25 })
  const option = page.locator('.search-result', { hasText: name }).first()
  await option.waitFor({ timeout: 20000 })
  await option.click()
  await page.waitForTimeout(600)
}

// Analyze refuses to run without a commander, so seat one first via its ★.
await addCard(COMMANDER)
await page
  .locator('.builder-row', { hasText: COMMANDER })
  .first()
  .locator('button[title="Set as commander"]')
  .click()
await page.waitForTimeout(500)

for (const name of CARDS) {
  await addCard(name)
}

await page.locator('button', { hasText: 'Analyze' }).first().click()
await page.locator('.deck-tabs').first().waitFor({ timeout: 60000 })
await page.locator('.deck-tabs button', { hasText: 'Combos' }).first().click()
// findCombos is async and fires after the deck renders.
await page.locator('.combo-bracket').first().waitFor({ timeout: 60000 })

const results = []
const all = page.locator('.combo-bracket')
const links = page.locator('a.combo-bracket')
const total = await all.count()
const linked = await links.count()
console.log(`combo badges: ${total} | as links: ${linked}`)
results.push(['combos found', total > 0])
results.push(['every badge is a link', linked === total])

const href = await links.first().getAttribute('href')
const target = await links.first().getAttribute('target')
const rel = await links.first().getAttribute('rel')
console.log(`href: ${href} | target: ${target} | rel: ${rel}`)
results.push([
  'href points at a Spellbook combo page',
  /^https:\/\/commanderspellbook\.com\/combo\/[\w-]+\/$/.test(href ?? ''),
])
results.push(['opens in a new tab', target === '_blank'])
results.push(['rel guards the opener', (rel ?? '').includes('noreferrer')])

const res = await page.request.get(href)
console.log(`link resolves: HTTP ${res.status()}`)
results.push(['link resolves', res.ok()])

// Distinct combos must point at distinct pages, i.e. ids are not shared.
const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute('href')))
results.push(['each combo links somewhere distinct', new Set(hrefs).size === hrefs.length])

await page.locator('.combo-badges').first().screenshot({ path: '/tmp/combo-badge.png' })
results.push(['no page errors', errors.length === 0])

let failed = 0
console.log('')
for (const [l, ok] of results) {
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}`)
}
if (errors.length) for (const e of [...new Set(errors)].slice(0, 5)) console.log('  err: ' + e.slice(0, 160))
console.log(`\n${failed === 0 ? 'ALL OK' : `${failed} FAILURE(S)`}`)
await browser.close()
process.exit(failed === 0 ? 0 : 1)
