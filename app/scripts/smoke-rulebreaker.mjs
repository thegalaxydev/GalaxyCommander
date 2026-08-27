// UI smoke test: pick a Rulebreaker commander and confirm the sidebar exposes
// its exception controls. Requires `npm run dev` on :5173.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:5173/'
console.log(`testing ${BASE}`)
await page.goto(BASE, { waitUntil: 'networkidle' })

// A "join the Discord" modal greets first-time visitors.
const dismiss = page.locator('.modal-backdrop button', { hasText: 'Maybe later' })
if (await dismiss.count()) await dismiss.first().click()
await page.locator('.modal-backdrop').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})

async function pickCommander(name) {
  // Once chosen, the search box is replaced by a chip; clear it to search again.
  const clear = page.locator('.commander-chip .chip-clear').first()
  if (await clear.count()) {
    await clear.click()
    await page.waitForTimeout(300)
  }
  const input = page.locator('.sidebar input').first()
  await input.click()
  await input.fill('')
  await input.type(name, { delay: 20 })
  const option = page.locator('.search-result', { hasText: name }).first()
  await option.waitFor({ timeout: 15000 })
  await option.click()
  await page.waitForTimeout(1200)
}

const results = []

// 1. Tolabow — should offer a splash-color picker.
await pickCommander('Tolabow')
const panel = page.locator('section.rulebreaker')
results.push(['Tolabow: panel visible', await panel.isVisible()])
results.push([
  'Tolabow: clause shown',
  (await panel.locator('.rulebreaker-text').first().innerText()).includes('one color of your choice'),
])
const pips = panel.locator('.color-pip')
results.push(['Tolabow: 4 splash pips (not blue)', (await pips.count()) === 4])
results.push(['Tolabow: no deck-size slider', (await panel.locator('.slider-row').count()) === 0])
await pips.first().click()
results.push(['Tolabow: pip selects', (await panel.locator('.color-pip.active').count()) === 1])
await page.screenshot({ path: '/tmp/rb-tolabow.png' })

// 1b. Valko Indorian — an "any color identity" grant offers an off-color picker.
await pickCommander('Valko Indorian')
const offGroup = panel.locator('[aria-label="Rulebreaker off-colors"]')
results.push(['Valko: off-color picker shown', await offGroup.isVisible()])
results.push(['Valko: 4 off-color pips (not black)', (await offGroup.locator('.color-pip').count()) === 4])
results.push([
  'Valko: all on by default',
  (await offGroup.locator('.color-pip.active').count()) === 4,
])
results.push([
  'Valko: default hint says "as printed"',
  (await panel.locator('.hint').last().innerText()).includes('as printed'),
])
await offGroup.locator('.color-pip').first().click()
results.push([
  'Valko: deselect narrows',
  (await offGroup.locator('.color-pip.active').count()) === 3 &&
    (await panel.locator('.hint').last().innerText()).includes('Only these colors'),
])
for (let i = 1; i < 4; i++) await offGroup.locator('.color-pip').nth(i).click()
results.push([
  'Valko: all off says switched off',
  (await panel.locator('.hint').last().innerText()).includes('switched off'),
])
results.push(['Valko: no splash picker', (await panel.locator('[aria-label="Rulebreaker splash color"]').count()) === 0])
await page.screenshot({ path: '/tmp/rb-valko.png' })

// 2. Whtz — should offer a deck-size input and no splash picker.
await pickCommander('Whtz')
results.push(['Whtz: panel visible', await panel.isVisible()])
const sizeInput = panel.locator('input[type=range]')
results.push(['Whtz: deck-size slider', (await sizeInput.count()) === 1])
results.push(['Whtz: default 100', (await sizeInput.inputValue()) === '100'])
results.push(['Whtz: no color pips at all', (await panel.locator('.color-pip').count()) === 0])
// Styled with the shared .slider-row, matching the Power Profile sliders.
results.push(['Whtz: uses shared slider style', (await panel.locator('.slider-row').count()) === 1])
results.push(['Whtz: no raw number box', (await panel.locator('input[type=number]').count()) === 0])
await sizeInput.fill('180')
results.push([
  'Whtz: slider value reflected in label',
  (await panel.locator('.slider-row em').innerText()) === '180',
])
await page.screenshot({ path: '/tmp/rb-whtz.png' })

// 3. A normal commander — panel must not appear at all.
await pickCommander('Atraxa, Praetors')
results.push(['Atraxa: no panel', (await page.locator('section.rulebreaker').count()) === 0])
await page.screenshot({ path: '/tmp/rb-atraxa.png' })

let failed = 0
for (const [label, ok] of results) {
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`)
}
if (errors.length) {
  console.log('\nconsole/page errors:')
  for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e.slice(0, 200))
}
console.log(`\n${failed === 0 ? 'ALL OK' : `${failed} FAILURE(S)`}`)
await browser.close()
process.exit(failed === 0 ? 0 : 1)
