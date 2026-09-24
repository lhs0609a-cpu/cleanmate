/**
 * 자료실 — HTML 만들기
 *
 * ══ 왜 서버에서 완성된 HTML을 내보내나 ═══════════════════════════
 *   검색 로봇과 AI 크롤러 상당수가 자바스크립트를 안 돌립니다. 특히 네이버가
 *   그렇습니다. 화면에서 그리면 사람에게는 보이는데 검색에는 빈 페이지입니다.
 *   그래서 요청이 오면 완성된 HTML을 그 자리에서 만들어 보냅니다.
 *
 * ══ 스타일을 인라인으로 두는 이유 ════════════════════════════════
 *   이 페이지들은 검색에서 곧장 들어오는 자리라 첫 화면 속도가 곧 이탈률입니다.
 *   외부 요청을 하나도 만들지 않습니다. /guide/ 와 같은 판을 씁니다.
 *
 * ══ 안쪽 링크를 촘촘히 까는 이유 ═════════════════════════════════
 *   문서가 34만 장입니다. 목차에서 한 번에 다 걸 수 없으니
 *   뿌리 → 분류 → 대상 → 의도 → 환경 순으로 계단을 만들어 둡니다.
 *   어느 페이지에서도 위아래 양쪽으로 갈 수 있어야 크롤러가 끝까지 갑니다.
 */

import { esc, jo } from './text.js'
import { CATS, SAFETY } from './schema.js'
import { TARGETS, TARGET_BY_ID, targetsByCat } from './targets.js'
import { INTENTS } from './intents.js'
import { intentsFor, envsFor, pageUrl } from './combos.js'

export const SITE = 'https://cleanmate-henna.vercel.app'
export const BRAND = '테라클린'
const TODAY = new Date().toISOString().slice(0, 10)
const DOWNLOAD = 'https://github.com/lhs0609a-cpu/teraclean-releases/releases/latest/download/TeraClean-Setup.exe'

const CSS = `
:root{
  --font:"Pretendard Variable","Pretendard","Apple SD Gothic Neo","Segoe UI Variable Text","Segoe UI","Malgun Gothic",system-ui,sans-serif;
  --mono:"Cascadia Mono","Consolas","D2Coding",ui-monospace,monospace;
  --bg:#F7F9FA;--surface:#fff;--surface-2:#F1F4F6;--ink:#0B1418;--ink-2:#38474F;
  --muted:#68787F;--line:#E4EAEC;--line-2:#CFD8DC;--accent:#0B6E72;--accent-soft:#E4F1F1;--accent-line:#B9DEDD;
  --ok:#137A52;--ok-soft:#E3F3EC;--warn:#8A5A00;--warn-soft:#FBF0DC;--bad:#A03028;--bad-soft:#FBE8E6;
}
@media(prefers-color-scheme:dark){:root{
  --bg:#080D10;--surface:#101820;--surface-2:#17212A;--ink:#E9F0F3;--ink-2:#B6C4CC;
  --muted:#7F929C;--line:#1F2C35;--line-2:#2B3B46;--accent:#3FD5CB;--accent-soft:#0E3238;--accent-line:#1C4A50;
  --ok:#54D3A0;--ok-soft:#0D2F24;--warn:#E3B45F;--warn-soft:#32260F;--bad:#F08A80;--bad-soft:#33110E;
}}
@font-face{font-family:"Pretendard Variable";src:url("/fonts/PretendardVariable.woff2") format("woff2");font-weight:45 920;font-display:swap}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);font-size:18px;
     line-height:1.7;letter-spacing:-.012em;word-break:keep-all;-webkit-font-smoothing:antialiased}
.wrap{max-width:740px;margin:0 auto;padding:24px 20px 96px}
.wrap.wide{max-width:1000px}
a{color:var(--accent)}
header.bar{border-bottom:1px solid var(--line);background:var(--surface)}
header.bar .in{max-width:1000px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
header.bar a.logo{color:var(--ink);text-decoration:none;font-weight:780;letter-spacing:-.02em}
header.bar nav{margin-left:auto;display:flex;gap:14px;font-size:15px;flex-wrap:wrap}
header.bar nav a{color:var(--muted);text-decoration:none}
nav.crumb{font-size:14px;color:var(--muted);margin:20px 0 10px;line-height:1.6}
nav.crumb a{color:var(--muted);text-decoration:none}
nav.crumb span{opacity:.5;margin:0 6px}
h1{font-size:clamp(26px,4.4vw,34px);line-height:1.28;letter-spacing:-.03em;font-weight:760;margin:0 0 8px;text-wrap:balance}
.meta{font-size:14px;color:var(--muted);margin:0 0 22px}
.answer{background:var(--accent-soft);border:1px solid var(--accent-line);border-radius:14px;
        padding:20px 22px;font-size:19px;line-height:1.68;margin:0 0 30px;color:var(--ink)}
h2{font-size:22px;line-height:1.42;letter-spacing:-.02em;font-weight:720;margin:38px 0 12px;text-wrap:balance}
p{margin:0 0 14px;color:var(--ink-2)}
ol,ul{margin:0 0 16px;padding-left:22px;color:var(--ink-2)}
li{margin:7px 0}
code,pre{font-family:var(--mono);font-size:14.5px}
pre{background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:14px 16px;
    overflow-x:auto;line-height:1.6;color:var(--ink);white-space:pre}
.tablewrap{overflow-x:auto;margin:0 0 18px}
table{border-collapse:collapse;width:100%;font-size:16px}
th,td{border-bottom:1px solid var(--line);padding:10px 12px;text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:620;white-space:nowrap;width:34%}
.badge{display:inline-block;font-size:14px;font-weight:660;padding:4px 12px;border-radius:999px;margin:0 0 10px}
.badge.safe{background:var(--ok-soft);color:var(--ok)}
.badge.care{background:var(--warn-soft);color:var(--warn)}
.badge.risky{background:var(--bad-soft);color:var(--bad)}
.faq{margin-top:44px;border-top:1px solid var(--line);padding-top:8px}
.faq details{border-bottom:1px solid var(--line);padding:14px 0}
.faq summary{cursor:pointer;font-weight:620;color:var(--ink);font-size:17px}
.faq p{margin:10px 0 0;font-size:17px}
.rel{margin-top:40px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px 22px}
.rel h2{margin:0 0 4px;font-size:17px}
.rel + .rel{margin-top:16px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.chips a{display:inline-block;background:var(--surface-2);border:1px solid var(--line);border-radius:999px;
         padding:6px 13px;font-size:14.5px;text-decoration:none;color:var(--ink-2)}
.chips a:hover{border-color:var(--accent-line);color:var(--accent)}
.cta{margin-top:40px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:22px}
.cta b{display:block;font-size:19px;margin-bottom:6px}
.cta p{font-size:16px;margin:0 0 14px}
.cta a.go{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;
       padding:11px 20px;border-radius:999px;font-weight:640;font-size:16px}
@media(prefers-color-scheme:dark){.cta a.go{color:#03252A}}
.cards{display:grid;gap:14px;margin-top:16px}
@media(min-width:680px){.cards{grid-template-columns:1fr 1fr}}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.card a{text-decoration:none;font-weight:660;font-size:17px;display:block;margin-bottom:6px}
.card p{font-size:15px;margin:0;color:var(--muted)}
form.q{display:flex;gap:8px;margin:18px 0 8px;flex-wrap:wrap}
form.q input{flex:1;min-width:220px;padding:11px 14px;font:inherit;font-size:16px;border:1px solid var(--line-2);
             border-radius:10px;background:var(--surface);color:var(--ink)}
form.q button{padding:11px 20px;font:inherit;font-size:16px;font-weight:640;border:0;border-radius:10px;
              background:var(--accent);color:#fff;cursor:pointer}
@media(prefers-color-scheme:dark){form.q button{color:#03252A}}
.lede{font-size:18px;color:var(--ink-2);margin:0 0 22px}
.grid-list{columns:2;column-gap:28px;padding-left:20px}
@media(max-width:640px){.grid-list{columns:1}}
.grid-list li{break-inside:avoid;margin:6px 0;font-size:16px}
.pager{display:flex;gap:10px;flex-wrap:wrap;margin-top:28px;font-size:15px}
.pager a,.pager span{padding:7px 13px;border:1px solid var(--line);border-radius:8px;text-decoration:none}
.pager span{color:var(--muted);opacity:.6}
footer{margin-top:64px;border-top:1px solid var(--line);padding-top:20px;font-size:14px;color:var(--muted)}
footer a{color:var(--muted)}
.notice{font-size:14px;color:var(--muted);margin-top:28px;padding-top:14px;border-top:1px dashed var(--line)}
`

function shell({ title, description, canonical, jsonld, body, robots = 'index, follow, max-snippet:-1, max-image-preview:large' }) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${canonical}" />
<meta name="robots" content="${robots}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="${BRAND}" />
<meta property="og:locale" content="ko_KR" />
<meta property="og:url" content="${canonical}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${SITE}/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon-32.png" sizes="32x32" />
<link rel="apple-touch-icon" href="/favicon-180.png" />
<link rel="preload" as="font" type="font/woff2" href="/fonts/PretendardVariable.woff2" crossorigin />
<style>${CSS}</style>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<header class="bar"><div class="in">
  <a class="logo" href="/">${BRAND}</a>
  <nav>
    <a href="/library/">자료실</a>
    <a href="/guide/">정리 가이드</a>
    <a href="/app.html">브라우저 체험</a>
    <a href="/#get">다운로드</a>
  </nav>
</div></header>
${body}
<footer><div class="wrap" style="padding-bottom:24px">
  <p style="margin:0 0 6px">${BRAND} — 지워도 되는 것만, 이유와 함께.</p>
  <p style="margin:0">
    <a href="/">홈</a> · <a href="/library/">자료실</a> · <a href="/guide/">정리 가이드</a> ·
    <a href="/community.html">커뮤니티</a> · <a href="/#contact">문의</a>
  </p>
</div></footer>
</body>
</html>`
}

const crumb = (items) =>
  `<nav class="crumb">` +
  items.map((it, i) => (it.href ? `<a href="${it.href}">${esc(it.label)}</a>` : esc(it.label)) + (i < items.length - 1 ? '<span>›</span>' : '')).join('') +
  `</nav>`

function breadcrumbLd(items) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem', position: i + 1, name: it.label,
      ...(it.href ? { item: SITE + it.href } : {}),
    })),
  }
}

/* ── 본문 블록 그리기 ─────────────────────────────────────────── */

function renderSection(s) {
  if (!s) return ''
  const out = [`<h2>${esc(s.h)}</h2>`]
  if (s.badge) out.push(`<span class="badge ${s.badge.tone}">${esc(s.badge.label)}</span>`)
  for (const p of s.p ?? []) if (p) out.push(`<p>${esc(p)}</p>`)
  if (s.steps?.length) out.push(`<ol>${s.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`)
  if (s.list?.length) out.push(`<ul>${s.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`)
  if (s.code) out.push(`<pre><code>${esc(s.code)}</code></pre>`)
  if (s.table) out.push(renderTable(s.table))
  return out.join('\n')
}

function renderTable(t) {
  return `<div class="tablewrap"><table>` +
    (t.head ? `<thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : '') +
    `<tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody>` +
    `</table></div>`
}

function chips(links) {
  return `<div class="chips">${links.map((l) => `<a href="${l.href}">${esc(l.label)}</a>`).join('')}</div>`
}

/* ── 문서 한 장 ───────────────────────────────────────────────── */

export function renderPage({ target, intent, env }) {
  const url = SITE + pageUrl(target, intent, env)
  const title = `${intent.title(target)}${env ? ` — ${env.label}` : ''} | ${BRAND}`
  const h1 = `${intent.title(target)}${env ? ` (${env.label})` : ''}`
  const desc = intent.desc(target, env).slice(0, 155)
  const answer = intent.answer(target, env)
  const sections = intent.sections(target, env).filter(Boolean)
  const faq = intent.faq(target, env).filter(Boolean)

  const crumbs = [
    { label: '홈', href: '/' },
    { label: '자료실', href: '/library/' },
    { label: CATS[target.cat].label, href: `/library/c/${target.cat}/` },
    { label: target.name, href: `/library/${target.id}/` },
    { label: intent.kw + (env ? ` · ${env.label}` : '') },
  ]

  // 요약 표 — 모든 페이지 공통 틀이지만 값은 전부 다르다.
  const facts = {
    head: ['항목', '내용'],
    rows: [
      ['무엇인가', target.full],
      ['분류', CATS[target.cat].label],
      ['전형적인 크기', target.size],
      ['안전도', SAFETY[target.safety].label],
      ['지운 뒤 다시 생기나', target.regen ? '생깁니다' : '생기지 않습니다'],
      ...(target.paths?.length ? [['첫 번째 자리', target.paths[0]]] : []),
      ...(env ? [['기준 환경', env.label]] : []),
    ],
  }

  const siblings = intentsFor(target).filter((i) => i.id !== intent.id)
  const envList = envsFor(target).filter((e) => e.id !== env?.id)
  const related = (target.related ?? []).map((id) => TARGET_BY_ID[id]).filter(Boolean)

  const body = `
<div class="wrap">
${crumb(crumbs)}
<h1>${esc(h1)}</h1>
<p class="meta">${esc(CATS[target.cat].label)} · ${esc(target.full)}${env ? ` · ${esc(env.label)} 기준` : ''} · ${TODAY} 기준</p>
<div class="answer">${esc(answer)}</div>
${renderTable(facts)}
${sections.map(renderSection).join('\n')}

<div class="cta">
  <b>지금 내 PC에서 얼마인지 보려면</b>
  <p>테라클린은 이 문서에서 다룬 자리를 찾아 크기와 함께 목록으로 보여주고, 지워도 되는 이유와 안 되는 이유를 항목마다 적습니다. 지우기 전에 목록을 먼저 봅니다. 파일은 기기를 떠나지 않습니다.</p>
  <a class="go" href="${DOWNLOAD}" rel="nofollow">Windows용 무료 다운로드</a>
  <span style="font-size:15px;margin-left:10px"><a href="/app.html">브라우저에서 체험 →</a></span>
</div>

${faq.length ? `<div class="faq"><h2>자주 묻는 질문</h2>
${faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n')}
</div>` : ''}

<div class="rel">
  <h2>${esc(target.name)}에 대한 다른 문서</h2>
  ${chips(siblings.slice(0, 24).map((i) => ({ href: pageUrl(target, i, env), label: i.title(target) })))}
  ${siblings.length > 24 ? `<p style="margin:12px 0 0;font-size:15px"><a href="/library/${target.id}/">${esc(target.name)} 문서 전체 보기 (${siblings.length + 1}편)</a></p>` : ''}
</div>

${envList.length ? `<div class="rel">
  <h2>환경별로 보기</h2>
  ${chips(envList.slice(0, 20).map((e) => ({ href: pageUrl(target, intent, e), label: `${e.label}에서` })))}
  ${env ? `<p style="margin:12px 0 0;font-size:15px"><a href="${pageUrl(target, intent, null)}">환경 구분 없이 보기</a></p>` : ''}
</div>` : ''}

${related.length ? `<div class="rel">
  <h2>같이 보면 좋은 것</h2>
  ${chips(related.map((t) => ({ href: `/library/${t.id}/`, label: t.name })))}
</div>` : ''}

<p class="notice">이 문서는 ${esc(target.full)}에 대한 ${esc(intent.kw)} 문서입니다${env ? `(${esc(env.label)} 기준)` : ''}.
경로와 명령어는 확인한 것만 적었고, 확인하지 못한 항목은 비워 두었습니다.
지우기 전에 반드시 크기를 먼저 재고, 되돌릴 수 없는 항목은 사본을 두세요.</p>
</div>`

  const jsonld = [
    {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: h1, description: desc, inLanguage: 'ko-KR',
      mainEntityOfPage: url, dateModified: TODAY,
      author: { '@type': 'Organization', name: BRAND, url: SITE },
      publisher: { '@type': 'Organization', name: BRAND, url: SITE },
      about: { '@type': 'Thing', name: target.full },
    },
    breadcrumbLd(crumbs),
    ...(faq.length ? [{
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({
        '@type': 'Question', name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    }] : []),
  ]

  return shell({ title, description: desc, canonical: url, jsonld, body })
}

/* ── 대상 한 개의 목차 ────────────────────────────────────────── */

export function renderTargetHub(target) {
  const url = `${SITE}/library/${target.id}/`
  const is = intentsFor(target)
  const es = envsFor(target)
  const title = `${target.full} — 문서 ${is.length}편 | ${BRAND} 자료실`
  const desc = `${target.full}에 대한 문서 모음. ${target.what}`.slice(0, 155)
  const crumbs = [
    { label: '홈', href: '/' },
    { label: '자료실', href: '/library/' },
    { label: CATS[target.cat].label, href: `/library/c/${target.cat}/` },
    { label: target.name },
  ]
  const related = (target.related ?? []).map((id) => TARGET_BY_ID[id]).filter(Boolean)

  const body = `
<div class="wrap wide">
${crumb(crumbs)}
<h1>${esc(target.full)}</h1>
<p class="lede">${esc(target.what)}</p>
${renderTable({
    head: ['항목', '내용'],
    rows: [
      ['전형적인 크기', target.size],
      ['안전도', `${SAFETY[target.safety].label} — ${target.safetyNote}`],
      ['왜 커지나', target.grow],
      ['지우면 잃는 것', target.loss],
      ...(target.paths?.length ? [['자리', target.paths.join('\n')]] : []),
    ],
  })}

<h2>무엇이 궁금한가요</h2>
<ul class="grid-list">
${is.map((i) => `<li><a href="${pageUrl(target, i, null)}">${esc(i.title(target))}</a></li>`).join('\n')}
</ul>

<h2>환경별 문서</h2>
<p>같은 내용이라도 운영체제와 저장장치에 따라 경로와 판단이 달라집니다. 내 환경을 고르면 그 기준으로 다시 정리해 보여줍니다.</p>
${chips(es.map((e) => ({ href: pageUrl(target, is[0], e), label: e.label })))}

${related.length ? `<div class="rel"><h2>같이 보면 좋은 것</h2>
${chips(related.map((t) => ({ href: `/library/${t.id}/`, label: t.name })))}</div>` : ''}

<div class="cta">
  <b>${esc(jo(target.name, '이'))} 지금 몇 GB인지 보려면</b>
  <p>${esc(target.find)}</p>
  <a class="go" href="${DOWNLOAD}" rel="nofollow">Windows용 무료 다운로드</a>
</div>
</div>`

  return shell({
    title, description: desc, canonical: url, body,
    jsonld: [
      breadcrumbLd(crumbs),
      {
        '@context': 'https://schema.org', '@type': 'CollectionPage',
        name: target.full, description: desc, inLanguage: 'ko-KR', url,
      },
    ],
  })
}

/* ── 분류 목차 ────────────────────────────────────────────────── */

export function renderCatHub(cat) {
  const c = CATS[cat]
  const list = targetsByCat(cat)
  const url = `${SITE}/library/c/${cat}/`
  const crumbs = [{ label: '홈', href: '/' }, { label: '자료실', href: '/library/' }, { label: c.label }]
  const body = `
<div class="wrap wide">
${crumb(crumbs)}
<h1>${esc(c.label)}</h1>
<p class="lede">${esc(c.blurb)} 이 분류에 ${list.length}가지 항목이 있습니다.</p>
<div class="cards">
${list.map((t) => `<div class="card">
  <a href="/library/${t.id}/">${esc(t.full)}</a>
  <p>${esc(t.what.slice(0, 90))}… · 보통 ${esc(t.size)} · ${esc(SAFETY[t.safety].label)}</p>
</div>`).join('\n')}
</div>
<div class="rel"><h2>다른 분류</h2>
${chips(Object.entries(CATS).filter(([k]) => k !== cat).map(([k, v]) => ({ href: `/library/c/${k}/`, label: v.label })))}
</div>
</div>`
  return shell({
    title: `${c.label} — ${BRAND} 자료실`,
    description: `${c.blurb} ${list.map((t) => t.name).slice(0, 8).join(', ')} 등 ${list.length}가지.`.slice(0, 155),
    canonical: url, body,
    jsonld: [breadcrumbLd(crumbs)],
  })
}

/* ── 자료실 첫 화면 ───────────────────────────────────────────── */

export function renderRoot(total) {
  const url = `${SITE}/library/`
  const crumbs = [{ label: '홈', href: '/' }, { label: '자료실' }]
  const body = `
<div class="wrap wide">
${crumb(crumbs)}
<h1>자료실</h1>
<p class="lede">디스크를 차지하는 것 ${TARGETS.length}가지를, 무엇이 궁금하냐에 따라 ${INTENTS.length}가지 각도로, 환경별로 나눠 정리했습니다.
지워도 되는 것과 안 되는 것을 이유와 함께 적습니다.</p>

<form class="q" action="/library/search" method="get" role="search">
  <input type="search" name="q" placeholder="찾는 것을 적으세요 — 예: hiberfil, 크롬 캐시, node_modules" aria-label="자료실 검색" />
  <button type="submit">찾기</button>
</form>

<h2>분류로 찾기</h2>
<div class="cards">
${Object.entries(CATS).map(([k, v]) => {
    const n = targetsByCat(k).length
    return `<div class="card"><a href="/library/c/${k}/">${esc(v.label)} (${n})</a><p>${esc(v.blurb)}</p></div>`
  }).join('\n')}
</div>

<h2>많이 찾는 것</h2>
<ul class="grid-list">
${['c-drive-full-proxy', 'hiberfil-sys', 'pagefile-sys', 'winsxs', 'windows-old', 'temp-files', 'chrome-cache', 'node-modules', 'docker-data', 'wsl-vhdx', 'steam-games', 'kakaotalk-files', 'outlook-ost', 'premiere-media-cache', 'ollama-models', 'downloads-folder', 'recycle-bin', 'system-restore']
    .map((id) => TARGET_BY_ID[id]).filter(Boolean)
    .map((t) => `<li><a href="/library/${t.id}/">${esc(t.full)}</a> — 보통 ${esc(t.size)}</li>`).join('\n')}
</ul>

<h2>전체 목록</h2>
<p>항목 ${TARGETS.length}가지, 문서 ${total.toLocaleString('ko-KR')}편. <a href="/library/all/1">전체 목록을 처음부터 보기 →</a></p>

<div class="rel">
  <h2>먼저 읽으면 좋은 글</h2>
  <p style="font-size:15px;margin:8px 0 0">깊이 있게 쓴 글은 <a href="/guide/">정리 가이드</a>에 있습니다. 자료실은 항목별로 빠르게 찾아보는 용도입니다.</p>
</div>
</div>`
  return shell({
    title: `자료실 — 디스크를 차지하는 것 ${TARGETS.length}가지 | ${BRAND}`,
    description: `hiberfil.sys부터 node_modules까지, 디스크를 차지하는 것 ${TARGETS.length}가지를 환경별로 정리했습니다. 지워도 되는 것과 안 되는 것을 이유와 함께.`,
    canonical: url, body,
    jsonld: [
      breadcrumbLd(crumbs),
      {
        '@context': 'https://schema.org', '@type': 'WebSite', name: `${BRAND} 자료실`, url,
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${SITE}/library/search?q={query}` },
          'query-input': 'required name=query',
        },
      },
    ],
  })
}

/* ── 전체 목록 (쪽 나눔) ──────────────────────────────────────── */

const PER_PAGE = 40

export function renderAll(page) {
  const pages = Math.ceil(TARGETS.length / PER_PAGE)
  const p = Math.min(Math.max(1, page), pages)
  const slice = TARGETS.slice((p - 1) * PER_PAGE, p * PER_PAGE)
  const url = `${SITE}/library/all/${p}`
  const crumbs = [{ label: '홈', href: '/' }, { label: '자료실', href: '/library/' }, { label: `전체 목록 ${p}/${pages}` }]
  const body = `
<div class="wrap wide">
${crumb(crumbs)}
<h1>전체 목록 (${p}/${pages})</h1>
<p class="lede">디스크를 차지하는 것 ${TARGETS.length}가지 전부. 이름·크기·안전도 순으로 적었습니다.</p>
<div class="tablewrap"><table>
<thead><tr><th style="width:auto">항목</th><th style="width:auto">분류</th><th style="width:auto">보통 크기</th><th style="width:auto">안전도</th></tr></thead>
<tbody>
${slice.map((t) => `<tr>
  <th style="width:auto"><a href="/library/${t.id}/">${esc(t.full)}</a></th>
  <td>${esc(CATS[t.cat].label)}</td><td>${esc(t.size)}</td><td>${esc(SAFETY[t.safety].label)}</td>
</tr>`).join('\n')}
</tbody></table></div>
<div class="pager">
  ${p > 1 ? `<a href="/library/all/${p - 1}">← 이전</a>` : `<span>← 이전</span>`}
  ${Array.from({ length: pages }, (_, i) => i + 1).map((n) =>
    n === p ? `<span>${n}</span>` : `<a href="/library/all/${n}">${n}</a>`).join('')}
  ${p < pages ? `<a href="/library/all/${p + 1}">다음 →</a>` : `<span>다음 →</span>`}
</div>
</div>`
  return shell({
    title: `자료실 전체 목록 ${p}/${pages} | ${BRAND}`,
    description: `디스크를 차지하는 것 ${TARGETS.length}가지 전체 목록 (${p}쪽).`,
    canonical: url, body,
    jsonld: [breadcrumbLd(crumbs)],
  })
}

/* ── 검색 결과 ────────────────────────────────────────────────── */

export function renderSearch(q, results) {
  const crumbs = [{ label: '홈', href: '/' }, { label: '자료실', href: '/library/' }, { label: '검색' }]
  const body = `
<div class="wrap wide">
${crumb(crumbs)}
<h1>${q ? `"${esc(q)}" 검색 결과` : '자료실 검색'}</h1>
<form class="q" action="/library/search" method="get" role="search">
  <input type="search" name="q" value="${esc(q ?? '')}" placeholder="찾는 것을 적으세요" aria-label="자료실 검색" />
  <button type="submit">찾기</button>
</form>
${q
    ? results.length
      ? `<p class="lede">${results.length}가지를 찾았습니다.</p>
<div class="cards">${results.map((t) => `<div class="card">
  <a href="/library/${t.id}/">${esc(t.full)}</a>
  <p>${esc(t.what.slice(0, 90))}… · 보통 ${esc(t.size)}</p>
</div>`).join('\n')}</div>`
      : `<p class="lede">찾는 항목이 없습니다. 프로그램 이름이나 폴더 이름으로 다시 찾아보세요.</p>
<div class="rel"><h2>분류로 찾기</h2>
${chips(Object.entries(CATS).map(([k, v]) => ({ href: `/library/c/${k}/`, label: v.label })))}</div>`
    : `<div class="rel"><h2>분류로 찾기</h2>
${chips(Object.entries(CATS).map(([k, v]) => ({ href: `/library/c/${k}/`, label: v.label })))}</div>`}
</div>`
  return shell({
    title: q ? `"${q}" 검색 — ${BRAND} 자료실` : `검색 — ${BRAND} 자료실`,
    description: q ? `"${q}" 에 대한 자료실 검색 결과.` : '자료실에서 찾기.',
    canonical: `${SITE}/library/search${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    body,
    robots: 'noindex, follow',
  })
}

export function renderNotFound() {
  const body = `
<div class="wrap">
${crumb([{ label: '홈', href: '/' }, { label: '자료실', href: '/library/' }, { label: '없는 문서' }])}
<h1>그런 문서는 없습니다</h1>
<p class="lede">주소가 잘못됐거나, 그 조합으로는 문서를 만들지 않았습니다. 확인하지 못한 사실로는 페이지를 만들지 않기 때문입니다.</p>
<form class="q" action="/library/search" method="get" role="search">
  <input type="search" name="q" placeholder="찾는 것을 적으세요" aria-label="자료실 검색" />
  <button type="submit">찾기</button>
</form>
<div class="rel"><h2>분류로 찾기</h2>
${chips(Object.entries(CATS).map(([k, v]) => ({ href: `/library/c/${k}/`, label: v.label })))}</div>
</div>`
  return shell({
    title: `없는 문서 — ${BRAND} 자료실`,
    description: '요청한 문서가 없습니다.',
    canonical: `${SITE}/library/`,
    body, robots: 'noindex, follow',
  })
}
