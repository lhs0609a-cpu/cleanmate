/**
 * 정리 가이드 생성 — 글 하나당 정적 HTML 한 장 + 검색·AI가 읽는 파일들
 *
 * ══ 왜 정적 HTML인가 ═════════════════════════════════════════════
 *   검색 로봇과 AI 크롤러 상당수가 자바스크립트를 안 돌립니다. 특히 네이버가
 *   그렇습니다. 화면에서 그리면 사람에게는 보이는데 검색에는 빈 페이지입니다.
 *   그래서 빌드 때 완성된 HTML을 만들어 둡니다. 요청도 0입니다.
 *
 * ══ 무엇을 만드나 ════════════════════════════════════════════════
 *   /guide/                 목차 (주제 넷)
 *   /guide/<slug>.html      글 한 편
 *   /sitemap.xml            구글·네이버가 읽는 목록
 *   /robots.txt             크롤러 허용 규칙 + 사이트맵 위치
 *   /llms.txt               AI 에이전트용 목록
 *
 * ══ 각 글에 심는 것 ══════════════════════════════════════════════
 *   SEO — title / meta description / canonical / OG / 구조화 데이터
 *   AEO — 질문 모양 제목 + 맨 위 40~60단어 직답 + FAQPage 구조화 데이터
 *   GEO — 완결된 문단(잘라 인용해도 말이 되는), 일관된 개체 이름,
 *         날짜 표기, 근거를 문장 안에 넣기
 *
 * ★ FAQ 리치 결과는 2026년 5월 7일에 구글이 없앴습니다. 그래도 FAQPage를
 *   넣는 이유는 검색 결과 장식이 아니라, AI 답변이 질문·답 쌍을 그대로
 *   집어가기 때문입니다. 목적이 바뀌었을 뿐 값어치는 남아 있습니다.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARTICLES, TOPICS, byTopic } from '../src/content/guide.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'web/public/guide')

/** 정식 주소. 도메인이 바뀌면 여기 한 곳만 고친다. */
const SITE = 'https://cleanmate-henna.vercel.app'
const BRAND = '테라클린'
const TODAY = new Date().toISOString().slice(0, 10)

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/* ── 페이지 껍데기 ────────────────────────────────────────────────
   ★ 스타일을 인라인으로 넣는다. 이 페이지들은 검색에서 곧장 들어오는 자리라
     첫 화면이 뜨는 속도가 곧 이탈률이다. 요청을 하나도 안 만든다. */
const CSS = `
:root{
  --font:"Pretendard Variable","Pretendard","Apple SD Gothic Neo","Segoe UI Variable Text","Segoe UI","Malgun Gothic",system-ui,sans-serif;
  --bg:#F7F9FA;--surface:#fff;--surface-2:#F1F4F6;--ink:#0B1418;--ink-2:#38474F;
  --muted:#68787F;--line:#E4EAEC;--line-2:#CFD8DC;--accent:#0B6E72;--accent-soft:#E4F1F1;--accent-line:#B9DEDD;
}
@media(prefers-color-scheme:dark){:root{
  --bg:#080D10;--surface:#101820;--surface-2:#17212A;--ink:#E9F0F3;--ink-2:#B6C4CC;
  --muted:#7F929C;--line:#1F2C35;--line-2:#2B3B46;--accent:#3FD5CB;--accent-soft:#0E3238;--accent-line:#1C4A50;
}}
@font-face{font-family:"Pretendard Variable";src:url("/fonts/PretendardVariable.woff2") format("woff2");font-weight:45 920;font-display:swap}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);font-size:18px;
     line-height:1.7;letter-spacing:-.012em;word-break:keep-all;-webkit-font-smoothing:antialiased}
.wrap{max-width:720px;margin:0 auto;padding:24px 20px 96px}
a{color:var(--accent)}
header.bar{border-bottom:1px solid var(--line);background:var(--surface)}
header.bar .in{max-width:720px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:16px}
header.bar a.logo{color:var(--ink);text-decoration:none;font-weight:780;letter-spacing:-.02em}
header.bar nav{margin-left:auto;display:flex;gap:14px;font-size:15px}
header.bar nav a{color:var(--muted);text-decoration:none}
nav.crumb{font-size:14px;color:var(--muted);margin:20px 0 8px}
nav.crumb a{color:var(--muted);text-decoration:none}
h1{font-size:clamp(28px,5vw,36px);line-height:1.25;letter-spacing:-.03em;font-weight:760;margin:0 0 8px;text-wrap:balance}
.meta{font-size:14px;color:var(--muted);margin:0 0 24px}
/* 직답 — AI 답변이 인용하는 자리이자 사람이 제일 먼저 읽는 자리 */
.answer{background:var(--accent-soft);border:1px solid var(--accent-line);border-radius:14px;
        padding:20px 22px;font-size:19px;line-height:1.68;margin:0 0 32px;color:var(--ink)}
h2{font-size:23px;line-height:1.4;letter-spacing:-.02em;font-weight:720;margin:40px 0 12px;text-wrap:balance}
h3{font-size:19px;font-weight:680;margin:28px 0 8px}
p{margin:0 0 14px;color:var(--ink-2)}
.faq{margin-top:48px;border-top:1px solid var(--line);padding-top:8px}
.faq details{border-bottom:1px solid var(--line);padding:14px 0}
.faq summary{cursor:pointer;font-weight:620;color:var(--ink);font-size:17px}
.faq p{margin:10px 0 0;font-size:17px}
.rel{margin-top:48px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px 22px}
.rel h2{margin:0 0 10px;font-size:17px}
.rel ul{margin:0;padding-left:20px}
.rel li{margin:6px 0;font-size:16px}
.cta{margin-top:40px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:22px}
.cta b{display:block;font-size:19px;margin-bottom:6px}
.cta p{font-size:16px;margin:0 0 14px}
.cta a{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;
       padding:11px 20px;border-radius:999px;font-weight:640;font-size:16px}
@media(prefers-color-scheme:dark){.cta a{color:#03252A}}
.cards{display:grid;gap:14px;margin-top:16px}
@media(min-width:640px){.cards{grid-template-columns:1fr 1fr}}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.card a{text-decoration:none;font-weight:660;font-size:17px;display:block;margin-bottom:6px}
.card p{font-size:15px;margin:0;color:var(--muted)}
.topic{margin-top:48px}
.topic>p{color:var(--muted);font-size:16px}
footer{margin-top:64px;border-top:1px solid var(--line);padding-top:20px;font-size:14px;color:var(--muted)}
footer a{color:var(--muted)}
`

function shell({ title, description, canonical, jsonld, body, crumb, social = 'home' }) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${canonical}" />
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="${BRAND}" />
<meta property="og:locale" content="ko_KR" />
<meta property="og:url" content="${canonical}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${SITE}/social/${social}.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${esc(title)}" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="preload" href="/fonts/PretendardVariable.woff2" as="font" type="font/woff2" crossorigin />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<style>${CSS}
.bar a.logo{display:inline-flex;align-items:center;gap:10px}.bar .logo img{width:32px;height:32px}
.topic-art{display:block;width:168px;height:116px;border-radius:14px;margin:24px 0 12px}
</style>
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('\n')}
</head>
<body>
<header class="bar"><div class="in">
  <a class="logo" href="/"><img src="/brand/mark.svg" width="32" height="32" alt="" />${BRAND}</a>
  <nav><a href="/guide/">정리 가이드</a><a href="/#get">무료 다운로드</a></nav>
</div></header>
<div class="wrap">
${crumb}
${body}
<footer>
  <p>${BRAND} — 지워도 되는 것만, 이유와 함께. 파일은 기기를 떠나지 않습니다.</p>
  <p><a href="/">홈</a> · <a href="/guide/">정리 가이드</a> · <a href="/#contact">문의</a></p>
</footer>
</div>
</body>
</html>`
}

/* ── 구조화 데이터 ────────────────────────────────────────────────
   ★ 개체 이름을 사이트 전체에서 똑같이 쓴다. AI가 "테라클린"과
     "TeraClean"을 다른 것으로 보면 인용이 흩어진다. */
const PUBLISHER = {
  '@type': 'Organization',
  name: BRAND,
  url: SITE + '/',
  logo: { '@type': 'ImageObject', url: SITE + '/favicon-180.png' },
}

function articleJsonLd(a) {
  const url = `${SITE}/guide/${a.slug}.html`
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: a.question,
      name: a.title,
      description: a.summary,
      inLanguage: 'ko-KR',
      datePublished: a.updated,
      dateModified: a.updated,
      author: PUBLISHER,
      publisher: PUBLISHER,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      url,
      about: { '@type': 'Thing', name: TOPICS[a.topic].label },
      articleSection: TOPICS[a.topic].label,
      /* 맨 위 직답을 따로 표시한다. 발췌해 가는 쪽이 어디를 집으면 되는지 알려준다. */
      abstract: a.answer,
      keywords: [a.question, ...a.faq.map((f) => f.q)].join(', '),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '홈', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: '정리 가이드', item: SITE + '/guide/' },
        { '@type': 'ListItem', position: 3, name: TOPICS[a.topic].label, item: `${SITE}/guide/#${a.topic}` },
        { '@type': 'ListItem', position: 4, name: a.question, item: url },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        { '@type': 'Question', name: a.question, acceptedAnswer: { '@type': 'Answer', text: a.answer } },
        ...a.faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      ],
    },
  ]
}

function articlePage(a) {
  const url = `${SITE}/guide/${a.slug}.html`
  const rel = a.related.map((s) => ARTICLES.find((x) => x.slug === s)).filter(Boolean)
  const body = `
<h1>${esc(a.question)}</h1>
<p class="meta">${esc(TOPICS[a.topic].label)} · ${esc(a.updated)} 확인</p>
<div class="answer">${esc(a.answer)}</div>
<img class="topic-art" src="/illustrations/guide-${a.topic}.svg" width="168" height="116" alt="" />
${a.sections
  .map((s) => `<h2>${esc(s.h)}</h2>\n${s.p.map((p) => `<p>${esc(p)}</p>`).join('\n')}`)
  .join('\n')}
${a.faq.length
  ? `<div class="faq"><h2>자주 묻는 것</h2>
${a.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n')}
</div>`
  : ''}
<div class="cta">
  <b>이걸 직접 찾아드립니다</b>
  <p>${BRAND}은 이 글에 나온 것들을 실제로 재서, 지워도 되는 것만 이유와 함께 보여줍니다.
     파일은 기기를 떠나지 않고, 무료입니다.</p>
  <a href="/#get">무료로 받기</a>
</div>
${rel.length
  ? `<div class="rel"><h2>같이 보면 좋은 글</h2><ul>
${rel.map((r) => `<li><a href="/guide/${r.slug}.html">${esc(r.question)}</a></li>`).join('\n')}
</ul></div>`
  : ''}`

  return shell({
    title: `${a.title} | ${BRAND}`,
    social: a.slug,
    description: a.summary,
    canonical: url,
    jsonld: articleJsonLd(a),
    crumb: `<nav class="crumb" aria-label="위치"><a href="/">홈</a> › <a href="/guide/">정리 가이드</a> › ${esc(TOPICS[a.topic].label)}</nav>`,
    body,
  })
}

function indexPage() {
  const topics = Object.keys(TOPICS)
  const body = `
<h1>정리 가이드</h1>
<p class="meta">${ARTICLES.length}편 · ${TODAY} 기준</p>
<div class="answer">다 지웠는데도 용량이 안 주는 이유는, 정작 자리를 차지하는 것이 탐색기에 안 보이기 때문입니다.
이 가이드는 그 숨은 것들이 무엇이고, 지워도 되는지, 지우면 무엇을 잃는지를 항목마다 답합니다.
저희가 실제로 재서 확인한 것만 씁니다.</div>
${topics
  .map(
    (t) => `<section class="topic" id="${t}">
  <img class="topic-art" src="/illustrations/guide-${t}.svg" width="168" height="116" alt="" loading="lazy" />
  <h2>${esc(TOPICS[t].label)}</h2>
  <p>${esc(TOPICS[t].blurb)}</p>
  <div class="cards">
${byTopic(t)
  .map(
    (a) => `    <div class="card"><a href="/guide/${a.slug}.html">${esc(a.question)}</a><p>${esc(a.summary)}</p></div>`
  )
  .join('\n')}
  </div>
</section>`
  )
  .join('\n')}
<div class="cta">
  <b>글로 읽는 대신 직접 재보시겠어요?</b>
  <p>${BRAND}은 이 PC를 실제로 재서, 지워도 되는 것만 이유와 함께 보여줍니다. 무료 · 100% 온디바이스.</p>
  <a href="/#get">무료로 받기</a>
</div>`

  return shell({
    title: `정리 가이드 — 용량이 안 주는 이유부터 | ${BRAND}`,
    description: `C드라이브 용량 부족, hiberfil.sys, 가상 메모리, WSL 디스크, node_modules까지 — 실제로 재서 확인한 것만 정리한 ${ARTICLES.length}편의 가이드.`,
    canonical: `${SITE}/guide/`,
    jsonld: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: '정리 가이드',
        url: `${SITE}/guide/`,
        inLanguage: 'ko-KR',
        publisher: PUBLISHER,
        hasPart: ARTICLES.map((a) => ({
          '@type': 'TechArticle',
          headline: a.question,
          url: `${SITE}/guide/${a.slug}.html`,
          datePublished: a.updated,
        })),
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '홈', item: SITE + '/' },
          { '@type': 'ListItem', position: 2, name: '정리 가이드', item: `${SITE}/guide/` },
        ],
      },
    ],
    crumb: `<nav class="crumb" aria-label="위치"><a href="/">홈</a> › 정리 가이드</nav>`,
    body,
  })
}

/* ── 검색·AI가 읽는 파일들 ──────────────────────────────────────── */

function sitemap() {
  const urls = [
    { loc: SITE + '/', pri: '1.0', freq: 'weekly', mod: TODAY },
    { loc: `${SITE}/guide/`, pri: '0.9', freq: 'weekly', mod: TODAY },
    ...ARTICLES.map((a) => ({
      loc: `${SITE}/guide/${a.slug}.html`,
      pri: '0.8',
      freq: 'monthly',
      mod: a.updated,
    })),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${u.loc}</loc><lastmod>${u.mod}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`
  )
  .join('\n')}
</urlset>
`
}

/**
 * robots.txt
 *
 * ★ AI 크롤러를 막지 않는다. 2026년에 사이트가 AI 답변에 안 나오는 가장 흔한
 *   이유가 "자기도 모르게 막아둬서"다(클라우드플레어가 기본값을 차단으로 바꾼 뒤
 *   특히). 우리는 사람에게 보여주려고 쓴 글이니 AI가 읽고 인용하는 것도 환영이다.
 *   그래서 막는 대신 명시적으로 허용해 둔다.
 */
function robots() {
  return `# ${BRAND} — 지워도 되는 것만, 이유와 함께
User-agent: *
Allow: /
Disallow: /admin.html

# AI 크롤러 — 막지 않습니다. 사람 보라고 쓴 글이라 인용도 환영합니다.
User-agent: GPTBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-SearchBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot-Extended
Allow: /
User-agent: CCBot
Allow: /

# 네이버·다음
User-agent: Yeti
Allow: /
User-agent: Daum
Allow: /

Sitemap: ${SITE}/sitemap.xml
`
}

/**
 * llms.txt
 *
 * ★ 솔직히 적어두자면 — 구글은 2026년 6월 문서에서 이 파일이 검색 순위에도
 *   AI 개요에도 영향이 없다고 못 박았고, 한 조사에서는 llms.txt의 97%가
 *   한 달간 한 번도 요청받지 않았다. 그럼에도 두는 이유는 두 가지다:
 *     1) 만드는 비용이 사실상 0이다(이 함수 하나).
 *     2) 에이전트가 사이트를 훑을 때 표준화된 입구가 되는 쪽으로 가고 있다.
 *   "이걸 넣으면 노출된다"고 기대하지는 않는다. 그런 기대는 이 파일에 대해
 *   가장 흔한 오해다.
 */
function llmsTxt() {
  return `# ${BRAND}

> 윈도우 PC에서 용량을 차지하지만 탐색기에는 안 보이는 것들을 찾아, 지워도 되는 것만 이유와 함께 보여주는 무료 데스크톱 앱. 파일은 기기를 떠나지 않습니다(100% 온디바이스).

이 사이트의 글은 전부 실제로 잰 값과 확인된 사실에서만 나옵니다. 못 잰 것은 "못 쟀다"고 쓰고 0으로 채우지 않습니다.

## 정리 가이드
${ARTICLES.map((a) => `- [${a.question}](${SITE}/guide/${a.slug}.html): ${a.summary}`).join('\n')}

## 제품
- [홈](${SITE}/): 무엇을 하는 앱인지, 무엇을 안 하는지
- [브라우저 체험](${SITE}/app.html): 설치 없이 화면만 보기
`
}

/* ── 실행 ─────────────────────────────────────────────────────── */

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

writeFileSync(join(OUT, 'index.html'), indexPage())
for (const a of ARTICLES) writeFileSync(join(OUT, `${a.slug}.html`), articlePage(a))

const pub = join(root, 'web/public')
writeFileSync(join(pub, 'sitemap.xml'), sitemap())
writeFileSync(join(pub, 'robots.txt'), robots())
writeFileSync(join(pub, 'llms.txt'), llmsTxt())

console.log(`가이드 ${ARTICLES.length}편 + 목차 1장`)
console.log(`sitemap.xml · robots.txt · llms.txt`)
for (const t of Object.keys(TOPICS)) console.log(`  ${TOPICS[t].label}: ${byTopic(t).length}편`)
