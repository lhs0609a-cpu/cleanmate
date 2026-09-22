import { preview } from 'vite'
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
const live = process.argv[2]
const server = live ? null : await preview({ preview: { host: '127.0.0.1', port: 0 } })
const origin = live ?? server.resolvedUrls.local[0]
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const release = { tag_name: 'v9.8.7', published_at: '2026-09-22T00:00:00Z', assets: [
  { name: 'TeraClean-Setup.exe', browser_download_url: 'https://github.com/lhs0609a-cpu/teraclean-releases/releases/download/v9.8.7/TeraClean-Setup.exe' },
] }
try {
  const page = await browser.newPage()
  if (!live) await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { get: () => window.name === 'mac' ? 'MacIntel' : 'Win32' })
    Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: window.name === 'mac' ? 'macOS' : 'Windows' }) })
  })
  await page.route('**/api/public-stats', route => route.fulfill({ json: {} }))
  for (const scenario of live ? ['live'] : ['success', 'fallback', 'failure', 'mac']) {
    if (!live) {
      await page.route('**/api/latest-release', route => route.fulfill(scenario === 'success' || scenario === 'mac' ? { json: release } : { status: 503, json: {} }))
      await page.route('https://api.github.com/**', route => route.fulfill(scenario === 'fallback' ? { json: release } : { status: 503, json: {} }))
      await page.evaluate(scenario => { window.name = scenario }, scenario)
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(origin, { waitUntil: 'networkidle' })
      if (scenario === 'mac') {
        assert.equal(await page.locator('#hero-dl').innerText(), '브라우저에서 체험하기')
        assert.equal(await page.locator('#hero-dl').getAttribute('href'), '/app.html')
      } else {
        await page.waitForFunction(() => !document.querySelector('.download-version').textContent.includes('확인 중'))
        for (const id of ['hero-dl', 'nav-dl', 'final-dl']) {
          const label = await page.locator(`#${id} .download-version`).innerText()
          if (scenario === 'live') assert.match(label, /^최신 v\d/)
          else assert.equal(label, scenario === 'failure' ? '버전 확인 불가' : '최신 v9.8.7')
          assert.match(await page.locator(`#${id}`).getAttribute('href'), /github.com\/lhs0609a-cpu\/teraclean-releases\/releases\//)
        }
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow')
      console.log(`PASS ${scenario} ${width}px: ${await page.locator('#hero-dl').innerText()}`)
    }
  }
} finally {
  await browser.close()
  await new Promise(resolve => server ? server.httpServer.close(resolve) : resolve())
}
