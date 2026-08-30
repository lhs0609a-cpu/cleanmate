/**
 * 생활 정리 콘텐츠·진행 관리 테스트
 *
 * 겨냥하는 것:
 *   1) "어제 했는데 오늘 또 하라고 한다" — 날짜 계산이 틀리면 바로 신뢰를 잃는다
 *   2) 처음 켠 사람에게 전부 밀린 것으로 보이지 않는가
 *   3) 하루 빠졌다고 연속 기록이 0이 되지 않는가 (사람을 그만두게 만드는 설계)
 *   4) 콘텐츠에 '왜'와 단계가 빠진 항목이 없는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ROUTINES,
  CATEGORY_LABEL,
  emptyState,
  dayNumber,
  todayISO,
  lastDone,
  daysUntilDue,
  isDue,
  streak,
  markDone,
  undoDone,
  planToday,
  type TidyRoutine,
} from './tidy.ts'

const R = (over: Partial<TidyRoutine> = {}): TidyRoutine => ({
  id: 'test',
  title: '테스트',
  category: 'home',
  everyDays: 7,
  minutes: 5,
  why: '테스트용',
  steps: ['하나'],
  ...over,
})

/* ── 날짜 계산 ── */

test('날짜는 문자열로만 다룬다 — 시간대 때문에 하루가 밀리지 않게', () => {
  assert.equal(dayNumber('2026-08-04') - dayNumber('2026-08-03'), 1)
  assert.equal(dayNumber('2026-03-01') - dayNumber('2026-02-28'), 1, '윤년 아닌 해')
  assert.equal(dayNumber('2024-03-01') - dayNumber('2024-02-29'), 1, '윤년')
  // 서머타임이 있는 지역 기준으로도 정확히 1일이어야 한다
  assert.equal(dayNumber('2026-11-02') - dayNumber('2026-11-01'), 1)
})

test('★ 오늘은 UTC가 아니라 사는 곳의 날짜다', () => {
  /* 실물에서 잡혔다(2026-08-31 07:54 KST): toISOString()을 쓰면 한국에서
     자정~오전 9시 사이에 앱이 어제를 산다. 아침에 정리하고 '했어요'를 누르면
     어제로 기록되고, 목록에서 안 사라지고, 달력 점이 하루 앞에 찍힌다.
     매일 아침 하는 사람일수록 자주 겪는다 — 이 앱을 제일 잘 쓰는 사람이다. */
  const at = (h: number, m = 0) => new Date(2026, 7, 3, h, m, 0).getTime()
  assert.match(todayISO(at(12)), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(todayISO(at(12)), '2026-08-03')
  assert.equal(todayISO(at(0, 30)), '2026-08-03', '자정 직후에 어제 날짜가 나온다')
  assert.equal(todayISO(at(23, 30)), '2026-08-03', '밤늦게 내일 날짜가 나온다')
})


/* ── 주기 판단 ── */

test('★ 어제 한 주간 항목을 오늘 또 하라고 하지 않는다', () => {
  const s = markDone(emptyState(), 'test', '2026-08-02')
  const r = R({ everyDays: 7 })
  assert.equal(daysUntilDue(r, s, '2026-08-03'), 6)
  assert.equal(isDue(r, s, '2026-08-03'), false)
})

test('주기가 되면 할 때가 된 것으로 본다', () => {
  const s = markDone(emptyState(), 'test', '2026-07-27')
  const r = R({ everyDays: 7 })
  assert.equal(daysUntilDue(r, s, '2026-08-03'), 0)
  assert.equal(isDue(r, s, '2026-08-03'), true)
})

test('매일 항목은 다음 날 다시 뜬다', () => {
  const r = R({ everyDays: 1 })
  const s = markDone(emptyState(), 'test', '2026-08-03')
  assert.equal(isDue(r, s, '2026-08-03'), false, '오늘 이미 했다')
  assert.equal(isDue(r, s, '2026-08-04'), true)
})

test('★ 한 번도 안 한 항목은 "밀린 것"이 아니다', () => {
  // 처음 켠 사람에게 목록이 전부 빨갛게 밀려 있으면 앱을 닫는다.
  const plan = planToday(emptyState(), '2026-08-03')
  const defaultOn = ROUTINES.filter((r) => !r.optIn)
  assert.equal(plan.due.length, defaultOn.length)
  assert.equal(plan.enabled, defaultOn.length)
  assert.ok(plan.due.every((d) => d.daysLate === null), '늦은 일수가 붙으면 안 된다')
  // 켜지 않은 항목은 '오늘 할 것'에도 '맡길 것'에도 없다 — 켜기 전엔 없는 항목이다.
  assert.deepEqual(plan.book, [], '켜지도 않은 항목이 목록에 떴다')
})

/* ── 연속 기록 ── */

test('★ 하루 빠졌다고 연속 기록이 0이 되지 않는다', () => {
  // 매일 항목을 3일 하고 하루 걸렀다 — 주기의 2배(2일)까지는 이어진 것으로 본다
  let s = emptyState()
  for (const d of ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-05']) s = markDone(s, 'test', d)
  assert.equal(streak(R({ everyDays: 1 }), s, '2026-08-05'), 4)
})

test('오래 끊기면 연속 기록이 리셋된다', () => {
  let s = emptyState()
  for (const d of ['2026-07-01', '2026-07-02']) s = markDone(s, 'test', d)
  assert.equal(streak(R({ everyDays: 1 }), s, '2026-08-03'), 0)
})

test('기록이 없으면 0', () => {
  assert.equal(streak(R(), emptyState(), '2026-08-03'), 0)
})

/* ── 기록 · 되돌리기 ── */

test('같은 날 두 번 눌러도 한 번으로 친다', () => {
  let s = markDone(emptyState(), 'test', '2026-08-03')
  s = markDone(s, 'test', '2026-08-03')
  assert.deepEqual(s.done.test, ['2026-08-03'])
})

test('잘못 눌렀으면 되돌릴 수 있다 — 여기서도 되돌리기가 기본이다', () => {
  let s = markDone(emptyState(), 'test', '2026-08-02')
  s = markDone(s, 'test', '2026-08-03')
  s = undoDone(s, 'test', '2026-08-03')
  assert.deepEqual(s.done.test, ['2026-08-02'])
  // 오늘 한 게 아니면 되돌려도 아무 일 없다(어제 기록을 지우지 않는다)
  assert.deepEqual(undoDone(s, 'test', '2026-08-03').done.test, ['2026-08-02'])
})

test('markDone은 원본을 바꾸지 않는다', () => {
  const before = emptyState()
  markDone(before, 'test', '2026-08-03')
  assert.deepEqual(before, emptyState())
})

test('기록은 무한정 쌓이지 않는다', () => {
  let s = emptyState()
  for (let i = 0; i < 100; i++) s = markDone(s, 'test', `2026-01-${String((i % 28) + 1).padStart(2, '0')}`)
  assert.ok(s.done.test.length <= 60)
})

/* ── 오늘의 목록 ── */

test('짧은 것부터 보여준다 — 시작 문턱을 낮추는 게 정렬 기준이다', () => {
  const plan = planToday(emptyState(), '2026-08-03')
  const mins = plan.due.map((d) => d.minutes)
  assert.deepEqual(mins, [...mins].sort((a, b) => a - b))
})

test('오늘 끝낸 것은 목록에서 빠지고 완료로 간다', () => {
  const s = markDone(emptyState(), 'bed', '2026-08-03')
  const plan = planToday(s, '2026-08-03')
  assert.ok(plan.doneToday.includes('bed'))
  assert.ok(!plan.due.some((d) => d.id === 'bed'))
})

test('아직 때가 아닌 것은 남은 일수와 함께 따로 모인다', () => {
  const s = markDone(emptyState(), 'wardrobe', '2026-08-03') // 180일 주기
  const plan = planToday(s, '2026-08-10')
  const found = plan.later.find((l) => l.id === 'wardrobe')
  assert.equal(found?.daysUntil, 173)
})

/* ── 콘텐츠 무결성 ── */

test('★ 모든 항목에 왜·단계가 있다 — 근거 없는 항목은 잔소리다', () => {
  for (const r of ROUTINES) {
    assert.ok(r.why.length > 30, `${r.id}: 왜 하는지가 없다`)
    assert.ok(r.steps.length >= 3 && r.steps.length <= 5, `${r.id}: 단계는 3~5개`)
    assert.ok(r.minutes > 0 && r.everyDays > 0, `${r.id}: 시간·주기가 있어야 한다`)
    assert.ok(CATEGORY_LABEL[r.category], `${r.id}: 분류가 이상하다`)
  }
})

test('id가 겹치지 않는다 — 겹치면 진행 기록이 섞인다', () => {
  const ids = ROUTINES.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('분류가 모두 있고, 앱이 대신 해줄 수 있는 항목은 화면으로 연결된다', () => {
  const cats = new Set(ROUTINES.map((r) => r.category))
  assert.deepEqual([...cats].sort(), ['desk', 'digital', 'gear', 'home', 'self', 'upkeep'])
  const linked = ROUTINES.filter((r) => r.appTab)
  assert.ok(linked.length >= 3, '글만 주고 끝내지 않는다')
})

test('검증할 수 없는 수치를 콘텐츠에 쓰지 않는다', () => {
  // "연구에 따르면 37% 향상" 같은 문장은 출처를 댈 수 없으면 신뢰를 깎는다.
  for (const r of ROUTINES) {
    const text = r.why + r.steps.join(' ') + (r.tip ?? '')
    assert.ok(!/\d+\s*%/.test(text), `${r.id}: 근거 없는 퍼센트 수치`)
    assert.ok(!/연구에 따르면|과학적으로 증명/.test(text), `${r.id}: 검증 못 하는 권위 인용`)
  }
})

test('lastDone은 가장 최근 날짜를 준다', () => {
  let s = markDone(emptyState(), 'test', '2026-08-01')
  s = markDone(s, 'test', '2026-08-03')
  assert.equal(lastDone(s, 'test'), '2026-08-03')
  assert.equal(lastDone(s, '없는항목'), null)
})
