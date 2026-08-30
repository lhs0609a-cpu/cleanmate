/**
 * 랜딩이 앱에 없는 걸 팔고 있지 않은가
 *
 * ★ 왜 필요한가 (실제로 그랬다)
 *   보관함(격리)을 없애고 "곧바로 지운다"로 바꾼 지 한참 지났는데, 랜딩은
 *   여전히 "무료 · 30일 되돌리기"를 히어로에 걸고, 통계 블록에 "30일 유예 기간"을
 *   세우고, 기능 카드 하나를 통째로 그 설명에 쓰고 있었다. OG 이미지에도
 *   'FREE · 30 DAY UNDO'가 박혀 있었다.
 *
 *   앱 화면은 이미 정직했다 — "지운 것은 되돌릴 수 없어요"라고 쓰고 있었다.
 *   **랜딩만 옛 약속에 멈춰 있었던 것이다.** 신뢰를 파는 제품에서 랜딩이 앱보다
 *   후한 약속을 하는 건, 방향만 반대일 뿐 같은 병이다.
 *
 *   코드가 바뀌어도 마케팅 문구는 아무도 안 고친다. 그래서 여기서 잠근다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

test('랜딩이 30일 되돌리기를 약속하지 않는다', () => {
  const html = read('web/index.html')

  // 이 앱은 보관하지 않는다. 되돌릴 수 있는 건 '지우지 않은 것'뿐이다.
  assert.doesNotMatch(html, /30일\s*되돌리기/, '히어로·비교표에 옛 약속이 남아 있다')
  assert.doesNotMatch(html, /격리함/, '없어진 격리함 탭을 목업이 아직 보여준다')
  assert.doesNotMatch(html, /유예\s*기간/, '통계 블록에 옛 유예 기간이 남아 있다')
})

test('OG 이미지도 없는 기능을 광고하지 않는다', () => {
  const brand = read('scripts/make-brand.mjs')

  /* ★ 파일 전체를 훑으면 안 된다 — "왜 뺐는지" 적어둔 주석에도 옛 문구가 나온다.
     그림에 실제로 박히는 건 layoutText에 넘긴 글자뿐이니, 거기만 본다. */
  const drawn = [...brand.matchAll(/layoutText\('([^']*)'/g)].map((m) => m[1])
  assert.ok(drawn.length > 0, 'OG 이미지에 글자가 하나도 없다')

  // 링크 미리보기는 랜딩보다 멀리 퍼진다 — 여기 박힌 문구가 제일 오래 남는다.
  const undo = drawn.filter((t) => /UNDO/i.test(t))
  assert.deepEqual(undo, [], `OG 이미지가 아직 되돌리기를 적는다: ${undo.join(' / ')}`)
})

test('앱과 랜딩이 같은 말을 한다 — 지운 건 되돌릴 수 없다', () => {
  const app = read('web/app.html')
  const html = read('web/index.html')

  // 앱은 이미 이렇게 말하고 있다. 랜딩도 그 위에 서야 한다.
  assert.match(app, /지운 것은 되돌릴 수 없어요/, '앱의 정직한 문장이 사라졌다')
  assert.match(html, /되돌릴 수 없/, '랜딩이 그 사실을 한 번도 말하지 않는다')
})

test('안전장치를 "되돌리기"가 아니라 "지우기 전에"로 설명한다', () => {
  const html = read('web/index.html')
  // 지금 실제로 하는 일이 그것이다 — 목록과 이유를 먼저 보여주고, 애매한 건 묻는다.
  assert.match(html, /지우기 전에/, '무엇이 안전장치인지 랜딩이 말하지 않는다')
})

/* ── 목업이 앱이 낼 수 없는 화면을 그리지 않는가 ─────────────────
   ★ 이건 실제로 두 번 일어났다.
     한 번은 2026-08-03에 잡아 고쳤고(docs/다음-작업.md §2),
     이번 랜딩 개편에서 **같은 숫자(존 A 34.9GB)가 그대로 되돌아왔다.**
     그림이라서 아무 테스트도 안 걸렸고, 빌드도 통과했다.

   랜딩의 앱 창은 HTML/CSS 재현물이다. 그래서 손으로 고칠 수 있고, 손으로
   고치면 엔진이 못 내는 상태가 태연히 그려진다. 목업이 파는 건 "이 앱은 이렇게
   보여줍니다"라는 약속이므로, 그 약속이 거짓이면 나머지 문장도 못 믿는다.

   엔진이 지키는 불변식은 셋이다(src/cli.ts · src/classify.ts):
     · 3-존은 스캔한 것을 남김없이 나눈다 → 존 합 = 스캔 합계 (용량도 개수도)
     · 막대는 zoneTotal 기준이다 → 폭 셋을 더하면 100%
     · 존 A는 규칙이 확증한 것만이다(isAutoEligible) → 존 A = '지금 즉시' 지울 양
   셋 중 하나라도 어긋난 화면은 앱에서 나올 수 없다. */
test('★ 히어로 목업의 숫자가 앱이 실제로 낼 수 있는 값이다', () => {
  const html = read('web/index.html')
  const hero = html.slice(html.indexOf('<section class="hero">'), html.indexOf('<!-- 스탯 밴드'))
  assert.ok(hero.length > 500, '히어로 목업을 못 찾았다')

  const status = hero.match(/class="s-status">([\d,]+)개 · ([\d.]+)GB/)
  assert.ok(status, '스캔 합계 줄을 못 찾았다')
  const scannedCount = Number(status![1].replace(/,/g, ''))
  const scannedGb = Number(status![2])

  const zones = [...hero.matchAll(/--w:([\d.]+)%[\s\S]{0,120}?s-zval">([\d.]+)GB · ([\d,]+)개/g)]
    .map((m) => ({ w: Number(m[1]), gb: Number(m[2]), n: Number(m[3].replace(/,/g, '')) }))
  assert.equal(zones.length, 3, `3-존 막대가 3개가 아니다: ${zones.length}개`)

  const near = (a: number, b: number, tol: number, why: string) =>
    assert.ok(Math.abs(a - b) <= tol, `${why} — ${a} vs ${b}`)

  const zoneGb = zones.reduce((s, z) => s + z.gb, 0)
  near(zoneGb, scannedGb, 0.3,
    `존 셋을 더하면 스캔 합계(${scannedGb}GB)가 나와야 한다. 3-존은 스캔한 것을 남김없이 나눈다`)

  const zoneN = zones.reduce((s, z) => s + z.n, 0)
  assert.equal(zoneN, scannedCount, '존별 개수를 더하면 스캔한 개수가 나와야 한다')

  near(zones.reduce((s, z) => s + z.w, 0), 100, 0.5,
    '막대 폭은 zoneTotal 기준이라 셋을 더하면 100%다. 폭만 옛 값으로 남으면 막대가 창을 넘는다')

  for (const z of zones) {
    near(z.w, (z.gb / scannedGb) * 100, 0.4, `막대 폭이 제 용량(${z.gb}GB)과 안 맞는다`)
  }

  /* 존 A = '지금 즉시'. 존 A는 규칙이 확증한 것만으로 만들어지므로(isAutoEligible)
     "존 A는 34.9GB인데 즉시 지울 건 2.1GB"인 화면은 앱에서 나오지 않는다.
     추론이 존 A를 만들 수 있게 되는 날에만 이 둘이 갈라진다. */
  const cap = hero.match(/지금 즉시 ([\d.]+)GB \+ 물어보면 ([\d.]+)GB/)
  assert.ok(cap, "'지금 즉시 / 물어보면' 안내를 못 찾았다")
  const [auto, ask] = [Number(cap![1]), Number(cap![2])]
  near(zones[0].gb, auto, 0.05,
    `존 A(${zones[0].gb}GB)와 '지금 즉시'(${auto}GB)가 다르다 — 앱은 이 상태를 만들 수 없다`)
  near(zones[1].gb, ask, 0.05, `존 B와 '물어보면'이 다르다`)

  const big = hero.match(/class="s-big">([\d.]+)GB/)
  assert.ok(big, '정리 가능 큰 숫자를 못 찾았다')
  near(Number(big![1]), auto + ask, 0.05, "'정리 가능'이 즉시 + 물어보면의 합이 아니다")

  // 낭독기로 듣는 사람에게 다른 숫자를 읽어주면 그것도 거짓이다.
  const alt = hero.match(/aria-label="테라클린 앱 홈 화면:([^"]*)"/)
  assert.ok(alt, '히어로 목업에 대체 설명이 없다')
  for (const n of [big![1], String(auto), String(ask), ...zones.map((z) => String(z.gb))]) {
    assert.ok(alt![1].includes(n), `대체 설명이 화면과 다른 숫자를 읽어준다: ${n}GB가 없다`)
  }
})
