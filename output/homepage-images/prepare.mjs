import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import sharp from 'sharp'
const spec = JSON.parse(await readFile('output/homepage-images/prompts.json', 'utf8'))
await mkdir('web/public/images', { recursive: true })
for (const [name, source] of Object.entries(spec.sources)) {
  await copyFile(source, `output/homepage-images/${name}-original.png`)
  for (const width of name === 'hero' ? [480, 960] : [320, 640]) {
    await sharp(source).resize({ width }).webp({ quality: 84 }).toFile(`web/public/images/${name}-photo-v1-${width}.webp`)
  }
}
let html = await readFile('web/index.html', 'utf8')
if (html.includes('class="hero-intro"')) {
  console.log('Assets refreshed; homepage photography is already installed.')
  process.exit(0)
}
html = html.replace('    <span class="pill"><span class="d"', '    <div class="hero-intro">\n    <div class="hero-copy">\n    <span class="pill"><span class="d"')
html = html.replace('    <p class="osnote" id="os-note"></p>', `    <p class="osnote" id="os-note"></p>
    </div>
    <figure class="hero-portrait">
      <img src="/images/hero-photo-v1-960.webp" srcset="/images/hero-photo-v1-480.webp 480w, /images/hero-photo-v1-960.webp 960w" sizes="(max-width: 800px) calc(100vw - 48px), 440px" width="1122" height="1402" alt="밝고 정돈된 작업 공간에서 노트북과 함께 미소 짓는 여성 모델" fetchpriority="high" decoding="async" />
      <figcaption><span>가벼워진 PC, 여유로운 일상.</span><small>AI 생성 모델 이미지</small></figcaption>
    </figure>
    </div>`)
for (const name of ['pc', 'home', 'storage']) {
  html = html.replaceAll(`/illustrations/${name}-640.webp`, `/images/${name}-photo-v1-640.webp`).replaceAll(`/illustrations/${name}-320.webp`, `/images/${name}-photo-v1-320.webp`)
}
html = html.replace('컴퓨터 속 폴더를 가지런히 정리한 모습', '노트북과 소품이 가지런히 놓인 밝은 작업 공간').replace('청소 도구와 깨끗하게 정돈된 거실', '햇살이 드는 깨끗하고 정돈된 거실')
html = html.replace('</style>', `
  /* Generated lifestyle photography, shared ivory and sage palette. */
  .hero{padding-top:64px}
  .hero-intro{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:48px;align-items:center;text-align:left}
  .hero-copy{min-width:0}
  .hero-copy h1{font-size:clamp(40px,5vw,64px)}
  .hero-copy .pill{font-size:12px;padding:8px 12px}
  .hero-copy .lede{margin-left:0}
  .hero-copy .cta{justify-content:flex-start;gap:10px}
  .hero-copy .btn-lg{padding:15px 18px;font-size:16px}
  .hero-portrait{position:relative;margin:0;overflow:hidden;border-radius:28px;border:1px solid var(--line-3);background:#dce5de;box-shadow:0 24px 80px -40px rgba(55,214,203,.3)}
  .hero-portrait img{display:block;width:100%;height:auto;aspect-ratio:4/5;object-fit:cover}
  .hero-portrait figcaption{position:absolute;inset:auto 0 0;padding:56px 24px 22px;background:linear-gradient(transparent,rgba(5,15,16,.8));color:#fff}
  .hero-portrait figcaption span{display:block;font-size:20px;font-weight:700;letter-spacing:-.03em}
  .hero-portrait small{display:block;margin-top:4px;font-size:11px;color:#d6e2df}
  .service-art{aspect-ratio:4/3;object-fit:cover}
  .contact-art{width:100%;max-width:360px;aspect-ratio:16/9;object-fit:cover}
  @media(max-width:800px){
    .hero{padding-top:40px}
    .hero-intro{grid-template-columns:1fr;gap:32px;text-align:center}
    .hero-copy .lede{margin-inline:auto}
    .hero-copy .cta{justify-content:center}
    .hero-copy .pill{font-size:11px}
    .hero-portrait{width:100%;max-width:440px;margin-inline:auto;text-align:left}
    .hero-copy .btn-lg{font-size:15px;padding:14px 16px}
    .service-art{max-height:none;object-fit:cover}
  }
</style>`)
await writeFile('web/index.html', html)
console.log('Saved four original images, eight optimized WebP assets, and updated homepage.')
