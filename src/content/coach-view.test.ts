/**
 * 코치 화면이 실제로 무엇을 그리는가
 *
 * ★ 여기서 잠그는 건 문구다. 이 흐름은 하루에 한 번 사람이 보는 화면이라
 *   한 문장만 잘못 써도 "잔소리하는 앱"이 된다. 특히 셋:
 *
 *     ① 분석 화면에 **가짜 진행률**이 없는가 (계산은 순간에 끝난다)
 *     ② 넘기기·그만두기가 **벌처럼 보이지 않는가**
 *     ③ 리포트가 '아직 안 해본 것'과 '밀린 것'을 갈라 쓰는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, markDone, ROUTINES, type TidyState } from './tidy.ts'
import { analyze, coachBoard, monthReport, pickToday } from './coach.ts'
import { sessionView, startSession, toggleSpot } from './session.ts'
import {
  analyzingHtml, doneHtml, pickHtml, reportHtml, sessionHtml, startHtml,
} from '../../web/src/coach-view.ts'

const TODAY = '2026-08-28'
const st = (done: Record<string, string[]>): TidyState => ({ done })

function assertClean(html: string, where: string) {
  for (const bad of ['undefined', 'NaN', '[object Object]']) {
    assert.ok(!html.includes(bad), `${where}에 '${bad}'가 새어 나온다`)
  }
}

/** 사람을 평가하거나 재촉하는 말 — 이 흐름 어디에도 있으면 안 된다 */
const BANNED = /지저분|더럽|게으|방치|엉망|창피|실패|낙제|경고|초과|늦으셨|안 하시면/

/* ── 시작 ──────────────────────────────────────────────────── */

test('시작 버튼이 이 탭의 문이다 — 없으면 아무도 못 들어온다', () => {
  const html = startHtml()
  assertClean(html, '시작')
  assert.match(html, /id="coach-go"/, '시작 버튼이 없다')
  assert.match(html, /정리정돈 시작/)
  assert.match(html, /한 곳/, '목록이 아니라 한 곳이라는 약속이 화면에 없다')
})

/* ── 분석 ──────────────────────────────────────────────────── */

test('★ 분석 화면에 가짜 진행률이 없다 — 계산은 순간에 끝난다', () => {
  const steps = analyze(emptyState(), TODAY)
  const html = analyzingHtml(steps, steps.length)
  assertClean(html, '분석')
  /* 막대나 퍼센트를 그리면 "오래 걸리는 일을 하는 중"이라고 말하는 셈이고,
     그건 거짓말이다. 화면에는 실제로 센 값만 나온다. */
  assert.doesNotMatch(html, /prog-bar|progress|%/, '가짜 진행률을 그린다')
  for (const s of steps) {
    assert.ok(html.includes(s.result), `센 값이 화면에 안 나온다: ${s.label}`)
  }
})

test('밝힌 만큼만 나온다 — 아직 안 센 것을 미리 보여주지 않는다', () => {
  const steps = analyze(emptyState(), TODAY)
  const two = analyzingHtml(steps, 2)
  assert.equal((two.match(/<li /g) ?? []).length, 2)
  assert.ok(!two.includes(steps[4].result), '아직 안 밝힌 결과가 새어 나온다')
  assert.equal((analyzingHtml(steps, 0).match(/<li /g) ?? []).length, 0)
})

/* ── 오늘 여기 ─────────────────────────────────────────────── */

test('★ 오늘 여기 카드에 "같이 하기"와 "넘길게요"가 둘 다 있다', () => {
  const pick = pickToday(emptyState(), TODAY)!
  const html = pickHtml(pick)
  assertClean(html, '오늘 여기')

  assert.match(html, /id="coach-start"/, '같이 하는 통로가 없다 — 글만 주고 끝난다')
  assert.match(html, /id="coach-skip"/, '넘길 자리가 없다 — 미룰 곳이 없으면 그냥 무시하게 된다')
  assert.match(html, /id="coach-other"/, '다른 곳을 볼 수 없다')
  // 넘기는 게 벌이 아니라고 화면이 직접 말해야 한다.
  assert.match(html, /넘기셔도 아무 일 없습니다/)
  assert.doesNotMatch(html, BANNED, '오늘 여기 카드가 사람을 나무란다')

  assert.ok(html.includes(pick.routine.title), '무엇을 하라는지 안 쓴다')
  assert.ok(html.includes(pick.because), '왜 여기인지 안 쓴다')
})

test('꼼꼼히 볼 곳이 있으면 카드에 같이 나온다', () => {
  // 침대 칸은 spots가 있다 — 보이는 곳만 치우면 보이는 곳만 깨끗해진다.
  const pick = pickToday(emptyState(), TODAY)!
  if (pick.spots.length) {
    const html = pickHtml(pick)
    assert.match(html, /매번 빠지는 자리/, '왜 보라는지 설명이 없다')
    for (const s of pick.spots) assert.ok(html.includes(s), `빠진 자리: ${s}`)
  }
})

test('★ 할 게 없으면 "안 하셔도 됩니다"라고 쓴다 — 없는 할 일을 만들지 않는다', () => {
  const html = pickHtml(null)
  assertClean(html, '빈 화면')
  assert.match(html, /안 하셔도 됩니다/)
  assert.match(html, /id="coach-close"/, '닫을 수가 없다')
  assert.doesNotMatch(html, /id="coach-start"/, '할 게 없는데 시작 버튼이 있다')
})

/* ── 같이 하기 ─────────────────────────────────────────────── */

const R = ROUTINES.find((r) => r.id === 'desk-surface')!
const T0 = Date.UTC(2026, 7, 28, 9, 0, 0)

test('세션 화면이 지금 할 한 문장과 남은 시간을 보여준다', () => {
  const s = startSession(R.id, T0)
  const html = sessionHtml(sessionView(s, R, T0 + 30_000), R)
  assertClean(html, '세션')

  assert.ok(html.includes(R.steps[0]), '지금 할 단계가 안 나온다')
  assert.match(html, /2:30/, '남은 시간이 안 나온다')
  assert.match(html, /1 \/ 4/, '몇 번째 단계인지 안 나온다')
  assert.match(html, /id="ss-next"/, '다음으로 갈 수가 없다')
  assert.match(html, /id="ss-pause"/, '멈출 수가 없다')
  assert.match(html, /id="ss-quit"/, '그만둘 수가 없다')
  // 첫 단계에서는 뒤로 갈 데가 없다.
  assert.doesNotMatch(html, /id="ss-back"/)
})

test('★ 그만두는 게 벌이 아니라고 화면이 직접 말한다', () => {
  const html = sessionHtml(sessionView(startSession(R.id, T0), R, T0 + 1000), R)
  assert.match(html, /기록에 아무것도 안 남습니다/)
  assert.doesNotMatch(html, BANNED, '세션 화면이 사람을 나무란다')
})

test('★ 권장 시간을 넘겨도 "초과"라고 쓰지 않는다', () => {
  const v = sessionView(startSession(R.id, T0), R, T0 + 4 * 60_000)
  const html = sessionHtml(v, R)
  assertClean(html, '넘긴 세션')
  assert.match(html, /\+1:00/, '넘긴 시간을 안 보여준다')
  assert.match(html, /하셔도 됩니다/)
  assert.doesNotMatch(html, BANNED, `넘겼다고 나무란다`)
})

test('마지막 단계에서는 "다 했어요"로 바뀐다 — 끝을 누를 자리가 있어야 한다', () => {
  let s = startSession(R.id, T0)
  s = { ...s, stepIndex: R.steps.length - 1 }
  const html = sessionHtml(sessionView(s, R, T0 + 1000), R)
  assert.match(html, /id="ss-finish"/, '끝낼 수가 없다')
  assert.doesNotMatch(html, /id="ss-next"/, '마지막인데 다음 단계 버튼이 있다')
  assert.match(html, /id="ss-back"/, '마지막에서 앞으로 못 돌아간다')
})

test('꼼꼼히 볼 곳을 눌러 표시할 수 있다', () => {
  let s = startSession(R.id, T0)
  assert.match(sessionHtml(sessionView(s, R, T0), R), /data-spot="0"/, '체크할 자리가 없다')
  s = toggleSpot(s, 0)
  assert.match(sessionHtml(sessionView(s, R, T0), R), /class="spot on"/, '확인 표시가 안 남는다')
})

test('끝난 화면은 우리가 잰 시간만 말한다', () => {
  const html = doneHtml(R, '2:05 걸렸어요.')
  assertClean(html, '끝')
  assert.match(html, /2:05 걸렸어요/)
  assert.match(html, /id="coach-go"/, '한 곳 더 할 통로가 없다')
  assert.match(html, /id="coach-close"/, '여기서 멈출 수가 없다')
  assert.doesNotMatch(html, BANNED)
})

/* ── 이번 달 리포트 ────────────────────────────────────────── */

test('★ 리포트가 아직 안 해본 것과 밀린 것을 갈라 쓴다', () => {
  const html = reportHtml(monthReport(emptyState(), TODAY))
  assertClean(html, '리포트')
  assert.match(html, /아직 안 해본 것/)
  assert.match(html, /계속 미뤄지는 것/)
  assert.match(html, /이번 달에 안 온 곳/)
  assert.match(html, /정리한 곳/)
  assert.doesNotMatch(html, BANNED, '리포트가 사람을 나무란다')
})

test('줄어든 달에도 나쁜 달이라고 하지 않는다', () => {
  const s = st({ bed: ['2026-07-01', '2026-07-02', '2026-07-03', '2026-08-01'] })
  const html = reportHtml(monthReport(s, TODAY))
  assert.match(html, /줄었다고 나쁜 달은 아닙니다/, '줄어든 달에 아무 말도 안 한다')
  assert.doesNotMatch(html, BANNED)
})

test('다음 달 초점은 셋까지만 그리고, 없으면 없다고 쓴다', () => {
  const many = reportHtml(monthReport(emptyState(), TODAY))
  assert.ok((many.match(/<ol>[\s\S]*?<\/ol>/)?.[0].match(/<li>/g) ?? []).length <= 3)

  let all = emptyState()
  for (const r of ROUTINES) if (!r.optIn && r.doer !== 'pro') all = markDone(all, r.id, TODAY)
  const none = reportHtml(monthReport(all, TODAY))
  assert.match(none, /딱히 챙길 게 없습니다/, '없는 할 일을 만들어 준다')
})

test('리포트가 없으면 빈 문자열 — 화면이 안 깨진다', () => {
  assert.equal(reportHtml(null), '')
  assert.equal(reportHtml(undefined), '')
})

/* ── 새어 나가는 것 ────────────────────────────────────────── */

test('★ 꺾쇠를 막는다 — 항목 이름이 그대로 마크업이 되면 안 된다', () => {
  const evil = { ...R, title: '<img src=x onerror=alert(1)>', steps: ['<script>bad()</script>'] }
  const html = sessionHtml(sessionView(startSession(evil.id, T0), evil, T0), evil)
  assert.ok(!html.includes('<img src=x'), '제목이 그대로 마크업이 됐다')
  assert.ok(!html.includes('<script>bad'), '단계가 그대로 마크업이 됐다')
})

test('묶음 하나로 세 화면이 다 그려진다', () => {
  const b = coachBoard(st({ bed: ['2026-08-27'] }), TODAY)
  for (const html of [analyzingHtml(b.steps, b.steps.length), pickHtml(b.pick), reportHtml(b.report)]) {
    assertClean(html, '묶음')
    assert.ok(html.length > 50)
  }
})
