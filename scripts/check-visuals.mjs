/** Production-page visual smoke check; never scans or deletes user files. */
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const root = resolve('dist')
const output = resolve('output/design-review')
mkdirSync(output, { recursive: true })
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const server = createServer((req, res) => {
  let pathname = new URL(req.url, 'http://localhost').pathname
  if (pathname.endsWith('/')) pathname += 'index.html'
  const file = resolve(root, '.' + decodeURIComponent(pathname))
  if (!file.startsWith(root + sep) || !existsSync(file)) { res.writeHead(404); res.end(); return }
  res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream')
  res.end(readFileSync(file))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const errors = []
  const page = await browser.newPage()
  page.on('pageerror', e => errors.push(e.message))
  // Only public landing telemetry/release discovery is stubbed; app rendering is real.
  await page.route('**/api/public-stats', route => route.fulfill({ json: {} }))
  await page.route('https://api.github.com/**', route => route.fulfill({ status: 404, json: {} }))
  async function verifyImages() {
    for (const img of await page.locator('img').all()) {
      if (!await img.isVisible()) continue
      await img.scrollIntoViewIfNeeded()
      await img.evaluate(el => el.decode())
      assert.ok(await img.evaluate(el => el.naturalWidth > 0), 'Broken image')
    }
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 10).map(el => ({ tag: el.tagName, cls: el.className, right: el.getBoundingClientRect().right })) }))
    assert.ok(overflow.scroll <= overflow.width + 1, `Page overflows horizontally: ${JSON.stringify(overflow)}`)
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(origin, { waitUntil: 'networkidle' })
    await verifyImages()
    await page.evaluate(() => { document.querySelectorAll('.reveal').forEach(el => el.classList.add('in', 'visible')); scrollTo(0, 0) })
    await page.screenshot({ path: `${output}/homepage-${width}.png`, fullPage: true })
    await page.locator('#roadmap').screenshot({ path: `${output}/services-${width}.png`, style: 'header{visibility:hidden!important}' })
    await page.goto(`${origin}/app.html`, { waitUntil: 'networkidle' })
    await page.locator('[data-go="tidy"]').click()
    await page.locator('[data-place="home"], .coach-art').first().waitFor()
    if (await page.locator('[data-place="home"]').isVisible()) await page.locator('[data-place="home"]').click()
    await page.locator('.coach-art').waitFor()
    await verifyImages()
    await page.locator('#s-tidy').screenshot({ path: `${output}/tidy-${width}.png` })
    await page.locator('.coach.start').screenshot({ path: `${output}/coach-${width}.png` })
    await page.locator('[data-seg="room"]').click()
    await page.locator('.room-art').first().waitFor()
    assert.equal(await page.locator('.room-art').count(), await page.locator('.room-map [data-zone]').count())
    await page.locator('.room').screenshot({ path: `${output}/room-${width}.png`, style: '#toast,.toast{visibility:hidden!important}' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('.room').screenshot({ path: `${output}/room-dark-${width}.png`, style: '#toast,.toast{visibility:hidden!important}' })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.locator('.room-map [data-zone="desk"]').click()
    await page.locator('#coach-go').click()
    await page.locator('.pk-title, .pk-empty').first().waitFor()
    await page.goto(`${origin}/guide/`, { waitUntil: 'networkidle' })
    await verifyImages()
    assert.equal(await page.locator('.topic-art').count(), 4)
    await page.screenshot({ path: `${output}/guide-${width}.png`, fullPage: true })
    await page.locator('.card a').first().click()
    await verifyImages()
    const og = await page.locator('meta[property="og:image"]').getAttribute('content')
    assert.ok(existsSync(resolve(root, '.' + new URL(og).pathname)), 'Article social card missing')
  }
  assert.deepEqual(errors, [], 'Browser errors')
  console.log('PASS: desktop/mobile homepage, 3 service images, all visible room icons, coach navigation, guide images and article social card; no broken images or page overflow.')
} finally {
  await browser?.close()
  await new Promise(r => server.close(r))
}
