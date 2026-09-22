/** Rebuild project illustrations, vector assets and Korean social cards.
 * node --experimental-strip-types scripts/make-visuals.mjs
 * Raster originals are generated with the built-in image tool; see docs/visual-assets.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { chromium } from '@playwright/test'
import { markSvg } from './lib/brand-mark.mjs'
import { ARTICLES, TOPICS } from '../src/content/guide.ts'

const out = 'web/public'
for (const dir of ['brand', 'illustrations', 'social']) mkdirSync(`${out}/${dir}`, { recursive: true })
for (const name of ['pc', 'home', 'storage']) {
  for (const size of [320, 640]) {
    await sharp(`assets/illustrations/${name}.png`).resize(size, size).webp({ quality: 84 }).toFile(`${out}/illustrations/${name}-${size}.webp`)
  }
}
const m = markSvg()
const paths = `<g fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round"><path d="${m.bracketD}" stroke-width="${m.bracketWidth}"/><path d="${m.teeD}" stroke-width="${m.teeWidth}"/></g>`
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${m.tileRadius}" fill="#0b7d82"/>${paths}</svg>`
writeFileSync(`${out}/brand/mark.svg`, mark)
// Inno Setup reads uncompressed bottom-up 24-bit BMPs.
async function installerBitmap(name, width, height, svg) {
  const raw = await sharp(Buffer.from(svg)).resize(width, height).flatten({ background: '#e8f5f1' }).removeAlpha().raw().toBuffer()
  const stride = Math.ceil(width * 3 / 4) * 4
  const bmp = Buffer.alloc(54 + stride * height)
  bmp.write('BM'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10)
  bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(width, 18); bmp.writeInt32LE(height, 22)
  bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(stride * height, 34)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const src = (y * width + x) * 3, dst = 54 + (height - 1 - y) * stride + x * 3
    bmp[dst] = raw[src + 2]; bmp[dst + 1] = raw[src + 1]; bmp[dst + 2] = raw[src]
  }
  writeFileSync(`installer/${name}.bmp`, bmp)
}
await installerBitmap('wizard', 164, 314, `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314"><rect width="164" height="314" fill="#e8f5f1"/><circle cx="82" cy="165" r="66" fill="#d2ebe5"/>${mark.replace('<svg ', '<svg x="42" y="100" width="80" height="80" ')}<path d="M46 221h72M58 239h48" stroke="#147d80" stroke-width="5" stroke-linecap="round"/></svg>`)
await installerBitmap('wizard-small', 55, 55, mark)
for (const [variant, ink] of [['light', '#123238'], ['dark', '#f2f8f8']]) {
  for (const [lang, label] of [['ko', '테라클린'], ['en', 'TeraClean']]) {
    writeFileSync(`${out}/brand/wordmark-${lang}-${variant}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="330" height="64" viewBox="0 0 330 64" role="img" aria-label="${label}">${mark.replace('<svg ', '<svg width="64" height="64" ')}<text x="82" y="45" fill="${ink}" font-family="Pretendard,Malgun Gothic,sans-serif" font-size="39" font-weight="750">${label}</text></svg>`)
  }
}
const diagrams = {
  hidden: '<rect x="70" y="52" width="160" height="106" rx="12"/><path d="M100 83h100M100 105h70M100 127h45"/><rect x="160" y="115" width="115" height="70" rx="10" stroke-dasharray="6 6"/>',
  dev: '<path d="M57 75V53h73l22 22h112v105H57Z"/><path d="m128 107-21 20 21 20m66-40 21 20-21 20m-26-46-13 53"/>',
  clean: '<rect x="58" y="55" width="93" height="126" rx="12"/><path d="M80 82h47M80 105h35"/><circle cx="220" cy="129" r="48"/><path d="m197 130 16 16 30-34"/>',
  manage: '<rect x="37" y="75" width="92" height="89" rx="12"/><rect x="205" y="75" width="92" height="89" rx="12"/><path d="M147 119h39m-14-14 14 14-14 14M60 145h12m156 0h12"/>',
}
for (const [topic, body] of Object.entries(diagrams)) {
  writeFileSync(`${out}/illustrations/guide-${topic}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 334 230"><rect width="334" height="230" rx="20" fill="#e8f5f1"/><g fill="none" stroke="#147d80" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`)
}
const states = {
  done: '<circle cx="80" cy="60" r="32"/><path d="m65 60 10 10 22-23"/>',
  empty: '<path d="M37 48h86v42H37Z M37 48l18-24h50l18 24M37 62h27l7 10h18l7-10h27"/>',
  restore: '<path d="M52 47a32 32 0 1 1-4 32M52 27v23H29M80 43v20l13 9"/>',
}
for (const [name, body] of Object.entries(states)) writeFileSync(`${out}/illustrations/state-${name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect x="10" y="6" width="140" height="108" rx="42" fill="#e8f5f1"/><g fill="none" stroke="#147d80" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`)

// Browser typography preserves the bundled Korean font and long article titles.
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  const font = readFileSync(`${out}/fonts/PretendardVariable.woff2`).toString('base64')
  const pc = readFileSync(`${out}/illustrations/pc-640.webp`).toString('base64')
  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const cards = [{ slug: 'home', title: '지우기 전에,\n이유부터 보여드립니다.', label: '내 PC 안에서 안전하게', sub: '확실한 건 정리하고 · 애매한 건 물어보고 · 중요한 건 지킵니다' }, ...ARTICLES.map(a => ({ slug: a.slug, title: a.question, label: `정리 가이드 · ${TOPICS[a.topic].label}`, sub: a.summary }))]
  for (const card of cards) {
    await page.setContent(`<style>@font-face{font-family:Brand;src:url(data:font/woff2;base64,${font})}*{box-sizing:border-box}body{margin:0;background:#08191e;color:#f2f8f8;font-family:Brand}main{height:630px;padding:55px 60px;display:flex;gap:38px;align-items:center}.copy{flex:1;min-width:0}.brand{display:flex;gap:16px;align-items:center;font-size:28px;font-weight:750;margin-bottom:50px}.brand svg{width:48px;height:48px}.label{font-size:22px;color:#72ded0}h1{font-size:48px;line-height:1.28;letter-spacing:-2px;white-space:pre-line;margin:18px 0 24px;word-break:keep-all}p{font-size:21px;line-height:1.6;color:#b5cdcf;margin:0}.art{width:330px;height:390px;object-fit:cover;border-radius:34px}.footer{margin-top:30px;font-size:18px;color:#72ded0}</style><main><div class="copy"><div class="brand">${mark}테라클린</div><div class="label">${esc(card.label)}</div><h1>${esc(card.title)}</h1><p>${esc(card.sub)}</p><div class="footer">Windows용 무료 프로그램 · 파일은 이 기기 안에</div></div><img class="art" src="data:image/webp;base64,${pc}"/></main>`)
    await page.evaluate(() => document.fonts.ready)
    await page.locator('.art').evaluate(img => img.decode())
    await page.evaluate(() => {
      const copy = document.querySelector('.copy'), heading = document.querySelector('h1')
      let size = 48
      while (copy.getBoundingClientRect().height > 520 && size > 34) heading.style.fontSize = `${--size}px`
      if (copy.getBoundingClientRect().height > 520) throw new Error('Social card text exceeds canvas')
    })
    await page.screenshot({ path: `${out}/social/${card.slug}.png` })
  }
  writeFileSync(`${out}/og.png`, readFileSync(`${out}/social/home.png`))
  console.log(`Social cards: ${cards.length}; illustrations, logos and state graphics ready.`)
} finally { await browser.close() }
