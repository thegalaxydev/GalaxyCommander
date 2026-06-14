import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors: string[] = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto('http://localhost:5173')
await page.waitForTimeout(800)
await page.screenshot({ path: 'shots/01-idle.png' })

await page.fill('input[placeholder="Search commander..."]', 'Atraxa')
await page.waitForSelector('.search-result', { timeout: 10000 })
await page.waitForTimeout(400)
await page.screenshot({ path: 'shots/02-search.png' })
await page.locator('.search-result', { hasText: "Atraxa, Praetors' Voice" }).first().click()
await page.waitForTimeout(2500)
await page.screenshot({ path: 'shots/03-commander.png' })

const infect = page.locator('.theme-row', { hasText: 'Infect' })
if (await infect.count()) await infect.first().click()
const prolif = page.locator('.theme-row', { hasText: 'Proliferate' })
if (await prolif.count()) await prolif.first().click()
await page.click('.generate-btn')
await page.waitForTimeout(4000)
await page.screenshot({ path: 'shots/04-generating.png' })

await page.waitForSelector('.deck-view', { timeout: 120000 })
await page.waitForTimeout(1500)
await page.screenshot({ path: 'shots/05-overview.png' })

await page.click('.deck-tabs button:has-text("Decklist")')
await page.waitForTimeout(600)
await page.screenshot({ path: 'shots/06-decklist.png' })

await page.click('.deck-tabs button:has-text("Combos")')
await page.waitForTimeout(4000)
await page.screenshot({ path: 'shots/07-combos.png' })

await page.click('.deck-tabs button:has-text("Play Guide")')
await page.waitForTimeout(400)
await page.screenshot({ path: 'shots/08-guide.png' })

await page.fill('.chat-input input', 'Why did you include Sol Ring?')
await page.click('.chat-input button')
await page.waitForTimeout(1200)
await page.screenshot({ path: 'shots/09-chat.png' })

console.log('page errors:', errors.length ? errors : 'none')
await browser.close()
