import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
const origin = process.argv[2]
assert.ok(origin?.startsWith('https://'), 'Provide production URL')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const response = await page.goto(origin, { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200)
    for (const selector of ['.hero-portrait img', '.service-art', '.contact-art']) {
      for (const img of await page.locator(selector).all()) {
        await img.scrollIntoViewIfNeeded()
        await img.evaluate(el => el.decode())
        assert.ok(await img.evaluate(el => el.naturalWidth > 0 && el.currentSrc.includes('/images/')))
      }
    }
    assert.equal(await page.locator('.hero-portrait img').count(), 1)
    assert.equal(await page.locator('.service-art').count(), 3)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: `output/homepage-images/live-${width}.png` })
    console.log(`PASS ${origin}: ${width}px model, service and contact photos loaded; no overflow`)
  }
} finally { await browser.close() }
