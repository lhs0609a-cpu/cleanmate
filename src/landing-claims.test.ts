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
