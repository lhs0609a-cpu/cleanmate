/**
 * 생활 정리가 파일 탭과 다른 옷을 입고 있는가
 *
 * ★ 실물에서 나온 지적 (2026-08-31): "너무 다른 거랑 똑같아."
 *   맞는 말이었다. 숨은 공간·시작프로그램·같은 파일과 정확히 같은 구조였다 —
 *   흰 카드, 항목 목록, 오른쪽에 큰 실행 버튼. 그런데 성격은 정반대다.
 *
 *     파일 탭  = 일하는 화면. 훑은 결과를 놓고, 무엇을 지울지 판단하고, 실행한다.
 *                항목마다 설명이 꼭 필요하다("뭘 지우는지 알고 지웁니다").
 *     생활 정리 = 사는 화면. 이불을 갤지 말지 판단하는 사람은 없다.
 *                하나 하고 닫는다. 그리고 매일 연다.
 *
 *   같은 옷을 입혀놓으니 "오늘 할 것 14개"가 스캔 결과처럼 읽혔다 —
 *   "정리할 게 14개 발견됨". 그 화면은 열 때마다 빚 독촉장이 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROUTINES } from './tidy.ts'
import { greeting } from './daypart.ts'
import { greetHtml, rowHtml, rowsHtml, segHtml } from '../../web/src/tidy-view.ts'

const R = ROUTINES.find((r) => r.id === 'bed')!
const banned = /undefined|NaN|\[object Object\]/
/** 화면에 들어간 뒤의 모습으로 견준다 — 콘텐츠에 따옴표가 있으면 &quot;가 된다 */
const esc = (t: string) =>
  t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/* ── 목적이 셋이면 화면도 셋 ───────────────────────────────── */

test('★ 한 탭에 여덟 블록을 쌓지 않는다 — 오늘 / 내 방 / 기록', () => {
  const html = segHtml('today')
  assert.doesNotMatch(html, banned)
  for (const s of ['오늘', '내 방', '기록']) assert.ok(html.includes(s), `${s} 탭이 없다`)
  for (const s of ['today', 'room', 'log']) assert.match(html, new RegExp(`data-seg="${s}"`))
  // 지금 어디인지 눈으로도, 읽어주는 기계에도 알려야 한다.
  assert.match(html, /data-seg="today" class="on"/, '활성 탭 표시가 없다')
  assert.match(html, /aria-selected="true"/, '읽어주는 기계에는 어디인지 안 알려준다')
  assert.equal((segHtml('log').match(/aria-selected="true"/g) ?? []).length, 1, '활성 탭이 둘이다')
})

/* ── 시각 ──────────────────────────────────────────────────── */

test('★ 밤에는 인사가 작아지고 목록을 앞세우지 않는다', () => {
  const night = greetHtml(greeting('night'), 0)
  assert.match(night, /class="lhi quiet"/, '밤에도 큰 글씨로 재촉한다')
  assert.match(night, /안 하셔도 됩니다/)

  const morning = greetHtml(greeting('morning'), 0)
  assert.doesNotMatch(morning, /quiet/, '아침에 목록을 접었다')
  assert.match(morning, /좋은 아침/)
})

test('오늘 끝낸 개수는 셌을 때만 나온다 — 0을 들이밀지 않는다', () => {
  assert.doesNotMatch(greetHtml(greeting('morning'), 0), /lhi-done/, '0개 끝냈다고 적는다')
  assert.match(greetHtml(greeting('morning'), 3), /오늘 3개 끝냈어요/)
})

/* ── 카드가 아니라 줄 ──────────────────────────────────────── */

test('★ 항목이 카드가 아니라 줄이다 — 설명은 누른 사람에게만', () => {
  const html = rowHtml({ ...R, daysLate: null, streak: 0 }, { state: 'due', zoneName: '침대' })
  assert.doesNotMatch(html, banned)

  assert.match(html, /class="lrow due"/, '줄이 아니라 다른 걸 그린다')
  assert.doesNotMatch(html, /class="card"/, '생활 정리 항목이 카드다 — 파일 탭과 같아진다')

  // 제목·시간·공간은 항상 보이고
  assert.match(html, /<b class="tt">이불 정리<\/b>/)
  assert.match(html, /1분 · 침대 · 아직/)
  // 왜·단계·꼼꼼히 볼 곳은 details 안에 있어야 한다.
  const summaryEnd = html.indexOf('</summary>')
  assert.ok(summaryEnd > 0, 'details가 아니다')
  assert.ok(!html.slice(0, summaryEnd).includes(esc(R.why)), '설명이 접히지 않고 항상 보인다')
  assert.ok(html.includes(esc(R.why)), '펼쳐도 설명이 없다')
  assert.ok(html.includes(esc(R.steps[0])), '단계가 없다')
  assert.ok(html.includes(esc(R.spots![0])), '꼼꼼히 볼 곳이 없다')
})

test("★ '했어요'가 실행 버튼이 아니라 체크다", () => {
  /* 큰 pill 버튼이 열네 개 있으면 그 화면은 '실행 버튼 열네 개'로 읽힌다.
     이건 실행이 아니라 표시다 — 눌러도 파일 하나 안 움직인다. */
  const html = rowHtml({ ...R, daysLate: null }, { state: 'due' })
  assert.match(html, /class="ck" data-tidy="bed" data-done="1"/, '체크가 없다')
  assert.doesNotMatch(html, /class="opt"|class="btn"/, '줄에 실행 버튼이 붙었다')
  // 화면에 글자가 없으니 읽어주는 기계에는 이름을 줘야 한다.
  assert.match(html, /aria-label="이불 정리 했어요"/)

  const done = rowHtml({ ...R }, { state: 'done' })
  assert.match(done, /class="lrow done"/)
  assert.match(done, /data-done="0"/, '끝낸 것을 되돌릴 수 없다')
  assert.match(done, /aria-label="이불 정리 되돌리기"/)
})

test('지금 시각에 맞는 것은 옅게 표시만 한다 — 경고가 아니다', () => {
  const fits = rowHtml({ ...R, daysLate: null }, { state: 'due', fits: true })
  assert.match(fits, /class="now">지금</, '지금 하기 좋은 것을 안 알려준다')
  const plain = rowHtml({ ...R, daysLate: null }, { state: 'due', fits: false })
  assert.doesNotMatch(plain, /class="now"/, '아무 때나 해도 되는 것에 지금 표시를 붙였다')
})

test('아직 때가 아닌 것은 남은 날로 말한다', () => {
  const html = rowHtml({ ...R, daysUntil: 5 }, { state: 'later' })
  assert.match(html, /class="lrow later"/)
  assert.match(html, /5일 뒤/)
})

/* ── 묶음 ──────────────────────────────────────────────────── */

test('묶음이 비면 이유를 쓴다 — 빈 자리를 그냥 두지 않는다', () => {
  const empty = rowsHtml('오늘 할 것', [], '오늘 할 건 다 하셨어요.')
  assert.match(empty, /오늘 할 건 다 하셨어요/)
  assert.doesNotMatch(empty, /<details/, '비었는데 펼칠 게 있는 것처럼 보인다')

  const full = rowsHtml('오늘 할 것', ['<div class="lrow"></div>'], '없음')
  assert.match(full, /<details class="lgroup" open>/, '기본이 접힘이다 — 오늘 할 것은 보여야 한다')
  assert.match(full, /<span>1<\/span>/, '몇 개인지 안 쓴다')

  const closed = rowsHtml('아직 때가 아닌 것', ['<div class="lrow"></div>'], '없음', false)
  assert.doesNotMatch(closed, /open/, '아직 때가 아닌 것까지 펼쳐 놓는다')
})

test('★ 이 화면 어디에도 사람을 나무라는 말이 없다', () => {
  const html = [
    segHtml('today'),
    greetHtml(greeting('night'), 0),
    rowHtml({ ...R, daysLate: 30 }, { state: 'due', zoneName: '침대' }),
    rowsHtml('오늘 할 것', [], '오늘 할 건 다 하셨어요.'),
  ].join('')
  assert.doesNotMatch(html, /지저분|더럽|게으|방치|엉망|창피|경고|밀렸어요|서두/, '화면이 사람을 나무란다')
})

test('★ 꺾쇠를 막는다', () => {
  const evil = { ...R, title: '<img src=x onerror=alert(1)>', steps: ['<script>bad()</script>'] }
  const html = rowHtml(evil as any, { state: 'due', zoneName: '<b>침대</b>' })
  assert.ok(!html.includes('<img src=x'), '제목이 그대로 마크업이 됐다')
  assert.ok(!html.includes('<script>bad'), '단계가 그대로 마크업이 됐다')
  assert.ok(!html.includes('<b>침대</b>'), '공간 이름이 그대로 마크업이 됐다')
})
