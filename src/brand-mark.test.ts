/**
 * 로고 — 한 곳에서만 정의되고, 모든 자리에 그게 나가는가
 *
 * ★ 왜 필요한가 (실제로 겪은 일)
 *   로고 시안을 새로 잡아놓고 자산에는 하나도 안 넣었다. 앱 아이콘도 트레이도
 *   파비콘도 랜딩 헤더도 전부 옛 체크마크 그대로였다. 이유는 단순하다 —
 *   **마크가 다섯 군데에 따로 그려져 있었다.** 그중 트레이는 손으로 만들어
 *   커밋된 파일이라, 생성 스크립트를 고쳐도 영원히 안 바뀌는 자산이었다.
 *
 *   자동으로 만들어지지 않는 자산은 반드시 언젠가 뒤처진다. 그래서 도형을
 *   scripts/lib/brand-mark.mjs 하나로 모으고, 여기서 그 약속을 잠근다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { markSvg, markAt, SIMPLE_BELOW } from '../scripts/lib/brand-mark.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

test('HTML에 박힌 SVG가 공용 정의에서 나온 그것과 같다', () => {
  const s = markSvg()
  // 손으로 그린 SVG를 붙여넣는 순간 정의가 둘이 되고, 둘은 반드시 어긋난다.
  for (const file of ['web/index.html', 'web/app.html']) {
    const html = read(file)
    assert.ok(html.includes(s.bracketD), `${file}의 대괄호 경로가 공용 정의와 다르다`)
    assert.ok(html.includes(s.teeD), `${file}의 T 경로가 공용 정의와 다르다`)
    assert.ok(
      html.includes(`stroke-width="${s.teeWidth}"`),
      `${file}의 T 굵기가 공용 정의와 다르다`
    )
  }
})

test('옛 체크마크가 로고 자리에 남아 있지 않다', () => {
  const idx = read('web/index.html')
  const app = read('web/app.html')

  // 로고 자리의 ✓ — 목록 행(krow)의 ✓는 뜻이 있는 기호라 그대로 둔다.
  assert.doesNotMatch(idx, /<a class="logo"[^>]*>\s*<span class="mk"[^>]*>✓/, '헤더 로고가 아직 ✓다')
  assert.doesNotMatch(idx, /class="ic">✓/, '목업 창 아이콘이 아직 ✓다')
  assert.match(app, /class="brand"[^>]*>\s*<span class="mk">/, '앱 헤더에 마크가 없다')
})

test('아이콘을 굽는 스크립트가 전부 공용 정의를 쓴다', () => {
  for (const f of ['scripts/make-logo.mjs', 'scripts/make-brand.mjs']) {
    const src = read(f)
    assert.match(src, /from '\.\/lib\/brand-mark\.mjs'/, `${f}가 공용 정의를 안 쓴다`)
    // 옛 체크마크 좌표가 남아 있으면 어딘가에서 아직 그걸 그리고 있다는 뜻이다.
    assert.doesNotMatch(src, /const CHECK = \[/, `${f}에 옛 체크마크 정의가 남아 있다`)
  }
})

test('트레이 아이콘이 생성물이다 — 손으로 만들어 커밋하지 않는다', () => {
  const src = read('scripts/make-logo.mjs')
  // ★ 이게 이 사달의 원인이었다. 스크립트가 안 만드는 자산은 로고를 바꿔도 안 바뀐다.
  assert.match(src, /src-tauri\/icons\/tray\.png/, '트레이를 스크립트가 안 굽는다')
})

test('작은 크기에서는 대괄호를 뗀 원도를 쓴다', () => {
  // 24px 아래에서 [T]를 우겨넣으면 한 덩어리로 뭉갠다 — 실측으로 확인하고 정한 경계다.
  const small = markAt(SIMPLE_BELOW - 1)
  assert.equal(small.simple, true, '작은 타일인데 대괄호를 그린다')
  assert.equal(small.bracket.length, 0)
  assert.ok(small.tee.length > 0, 'T까지 사라지면 그건 로고가 아니다')

  const big = markAt(SIMPLE_BELOW + 1)
  assert.equal(big.simple, false, '큰 타일인데 대괄호가 없다')
  assert.equal(big.bracket.length, 6, '대괄호는 좌우 3획씩이다')

  // 대괄호를 뗀 자리를 T가 채운다 — 같은 크기로 두면 작아 보인다.
  assert.ok(small.teeHalf > markAt(SIMPLE_BELOW - 1, { simple: false }).teeHalf, 'T가 안 커졌다')
})

test('T가 대괄호보다 굵다 — 작은 크기에서 T가 먼저 읽혀야 한다', () => {
  const m = markAt(100, { simple: false })
  assert.ok(m.teeHalf > m.bracketHalf, '굵기가 같으면 24px에서 한 덩어리로 뭉친다')
})
