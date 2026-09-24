/**
 * 자료실 점검 — 34만 장이 정말 만들어지는지, 어긋난 데가 없는지 본다.
 *
 *   node scripts/check-library.mjs          핵심 문서 전부 + 환경별 표본
 *   node scripts/check-library.mjs --full   환경별까지 전부 (몇 분 걸립니다)
 *
 * 보는 것
 *   · 렌더링 중에 터지는 페이지가 있는가
 *   · 본문이 너무 짧지 않은가 (틀만 있고 내용이 없는 페이지)
 *   · 제목·설명이 비었거나 지나치게 긴가
 *   · 주소가 겹치는가
 *   · 조사가 어긋난 자리가 남았는가 ("캐시을" 같은 것)
 */

import { TARGETS } from '../api/_lib/library/targets.js'
import { intentsFor, envsFor, pageUrl, counts } from '../api/_lib/library/combos.js'
import { renderPage, renderTargetHub, renderCatHub, renderRoot, renderAll } from '../api/_lib/library/render.js'
import { CATS } from '../api/_lib/library/schema.js'
import { hasJong } from '../api/_lib/library/text.js'

const full = process.argv.includes('--full')
const c = counts()

console.log(`대상 ${c.targets} · 의도 ${c.intents} · 환경 ${c.envs}`)
console.log(`핵심 ${c.core.toLocaleString()} + 환경별 ${c.env.toLocaleString()} + 목차 ${c.hubs} = ${c.total.toLocaleString()} 장\n`)

const problems = []
const seen = new Set()
let rendered = 0
let minBody = Infinity
let minBodyUrl = ''

/** 틀을 뺀 알맹이 길이. 본문이 실제로 얼마나 있는지 본다. */
function textLength(html) {
  const main = html.split('</header>')[1]?.split('<footer')[0] ?? html
  return main.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length
}

/**
 * 조사가 어긋난 자리를 찾는다.
 *
 * 아무 글자나 훑으면 "차이"·"효과" 같은 멀쩡한 단어를 조사로 잘못 읽는다.
 * 그래서 우리가 실제로 조사를 붙이는 말 — 대상 이름 — 뒤만 본다.
 */
const PAIRS = [['은', '는'], ['이', '가'], ['을', '를'], ['과', '와'], ['으로', '로']]
function josaProblems(text, names) {
  const out = []
  for (const name of names) {
    const wrongIdx = hasJong(name) ? 1 : 0
    for (const pair of PAIRS) {
      const wrong = name + pair[wrongIdx]
      // "…은(는)" 처럼 둘 다 적어 둔 표기는 어긋난 게 아니다.
      const re = new RegExp(escapeRe(wrong) + '(?!\\()', 'g')
      if (re.test(text)) out.push(wrong)
      if (out.length > 3) return out
    }
  }
  return out
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function check(url, html, min = 1200) {
  rendered++
  if (seen.has(url)) problems.push(`주소 중복: ${url}`)
  seen.add(url)

  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''
  const desc = html.match(/<meta name="description" content="([\s\S]*?)"/)?.[1] ?? ''
  if (!title.trim()) problems.push(`제목 없음: ${url}`)
  if (title.length > 120) problems.push(`제목 너무 김(${title.length}): ${url}`)
  if (!desc.trim()) problems.push(`설명 없음: ${url}`)
  if (html.includes('undefined')) problems.push(`undefined 가 본문에 있음: ${url}`)
  if (html.includes('[object Object]')) problems.push(`[object Object] 가 본문에 있음: ${url}`)

  const len = textLength(html)
  if (len < minBody) { minBody = len; minBodyUrl = url }
  if (len < min) problems.push(`본문이 너무 짧음(${len}자): ${url}`)
}

// 목차
check('/library/', renderRoot(c.total), 600)
for (const cat of Object.keys(CATS)) check(`/library/c/${cat}/`, renderCatHub(cat), 600)
for (let p = 1; p <= Math.ceil(TARGETS.length / 40); p++) check(`/library/all/${p}`, renderAll(p), 600)
for (const t of TARGETS) check(`/library/${t.id}/`, renderTargetHub(t), 600)

// 문서
let josaHits = 0
for (const t of TARGETS) {
  const is = intentsFor(t)
  const es = envsFor(t)
  for (const i of is) {
    let html
    try { html = renderPage({ target: t, intent: i, env: null }) }
    catch (e) { problems.push(`터짐 ${t.id}/${i.id}: ${e.message}`); continue }
    check(pageUrl(t, i, null), html)

    if (josaHits < 20) {
      const bad = josaProblems(html.replace(/<[^>]+>/g, ' '), [t.name, t.full, ...(t.aliases ?? [])])
      if (bad.length) { problems.push(`조사 어긋남 ${pageUrl(t, i, null)}: ${bad.join(', ')}`); josaHits++ }
    }

    const envs = full ? es : es.slice(0, 1)
    for (const e of envs) {
      try { check(pageUrl(t, i, e), renderPage({ target: t, intent: i, env: e })) }
      catch (err) { problems.push(`터짐 ${t.id}/${i.id}/${e.id}: ${err.message}`) }
    }
  }
}

console.log(`그려 본 문서 ${rendered.toLocaleString()} 장`)
console.log(`가장 짧은 본문 ${minBody}자 — ${minBodyUrl}`)

if (problems.length) {
  console.log(`\n문제 ${problems.length}건:`)
  for (const p of problems.slice(0, 40)) console.log('  · ' + p)
  if (problems.length > 40) console.log(`  … 그 밖에 ${problems.length - 40}건`)
  process.exit(1)
}
console.log('\n문제 없음.')
