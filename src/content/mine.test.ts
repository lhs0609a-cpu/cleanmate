/**
 * 하루 몫 · 내 루틴 · 이번 주 — 2026-09-01에 실물 보고 나온 것들
 *
 * ★ 여기서 잠그는 것
 *   ① "오늘 할 것 20"이 다시 나오지 않는가. 사실이지만 그대로 쌓으면 빚 목록이다.
 *   ② 사용자가 만든 항목이 **모든 화면**에 나오는가. 한 군데라도 ROUTINES를
 *      직접 훑으면 그 화면에서만 조용히 사라진다.
 *   ③ 분류를 새로 만들었을 때 목록 고르기에서 빠지지 않는가 — 실제로 'gear'를
 *      그렇게 놓쳐서 로봇청소기·세탁기 필터 열 개를 켤 방법이 없었다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CATEGORY_LABEL,
  ROUTINES,
  addCustomRoutine,
  allRoutines,
  emptyState,
  enabledRoutines,
  isCustom,
  markDone,
  planToday,
  removeCustomRoutine,
  setRoutineOn,
} from './tidy.ts'
import { DAILY_MINUTES, dailyPicks, sortByTime } from './daypart.ts'
import { coachBoard, monthReport, pickToday } from './coach.ts'
import { roomView, zoneOfRoutine } from './room.ts'
import { stuckRoutines } from './referral.ts'
import { rowHtml, weekHtml } from '../../web/src/tidy-view.ts'
import { habitStats } from './tidy.ts'

const TODAY = '2026-09-01'
const NOW = Date.UTC(2026, 8, 1, 3, 0, 0)

const mine = (over = {}) =>
  addCustomRoutine(emptyState(), { title: '화분에 물 주기', everyDays: 5, minutes: 2, ...over }, NOW)

/* ── ① 하루 몫 ─────────────────────────────────────────────── */

test('★ 스무 줄을 늘어놓지 않는다 — 하루 몫만 낸다', () => {
  const due = sortByTime(planToday(emptyState(), TODAY).due, 'morning')
  assert.ok(due.length > 15, `할 때가 된 게 ${due.length}개뿐이다 — 이 테스트가 낡았다`)

  const q = dailyPicks(due)
  assert.ok(q.today.length < due.length, '전부 다 보여준다')
  assert.ok(q.minutes <= DAILY_MINUTES, `오늘 몫이 ${q.minutes}분이다 — 한도를 넘겼다`)
  assert.equal(q.today.length + q.rest.length, due.length, '담다가 흘린 항목이 있다')
})

test('★ 개수가 아니라 시간으로 자른다 — "하루 3개"는 근거를 댈 수 없다', () => {
  const R = (id: string, minutes: number) => ({ id, minutes })
  // 1분짜리면 여러 개가 담기고
  assert.equal(dailyPicks([R('a', 1), R('b', 1), R('c', 1)]).today.length, 3)
  // 20분짜리면 하나만 담긴다
  assert.equal(dailyPicks([R('a', 20), R('b', 20)]).today.length, 1)
})

test('★ 첫 항목이 한도를 넘겨도 빈 목록을 주지 않는다', () => {
  /* "할 게 없다"와 "오늘 몫에 안 들어갔다"는 다른 말이고, 빈 화면은 거짓말이다. */
  const q = dailyPicks([{ id: 'big', minutes: 600 }])
  assert.equal(q.today.length, 1)
  assert.equal(q.rest.length, 0)
})

test('순서를 다시 정렬하지 않는다 — 들어온 순서가 이미 답이다', () => {
  const list = [{ id: 'c', minutes: 5 }, { id: 'a', minutes: 1 }, { id: 'b', minutes: 2 }]
  assert.deepEqual(dailyPicks(list).today.map((r) => r.id), ['c', 'a', 'b'])
})

/* ── ② 내 루틴 ─────────────────────────────────────────────── */

test('내 루틴을 만들고 지운다', () => {
  const r = mine()
  assert.ok(r.ok, '못 만들었다')
  assert.ok(isCustom(r.id), `id가 기본 항목과 구분이 안 된다: ${r.id}`)
  assert.ok(!ROUTINES.some((x) => x.id === r.id), '기본 목록을 건드렸다')
  assert.equal(allRoutines(r.state).length, ROUTINES.length + 1)

  const gone = removeCustomRoutine(r.state, r.id)
  assert.equal(allRoutines(gone).length, ROUTINES.length)
})

test('★ 지울 때 기록도 같이 지운다 — 남기면 이름 없는 유령이 리포트에 잡힌다', () => {
  const r = mine()
  assert.ok(r.ok)
  let s = markDone(r.state, r.id, TODAY)
  s = setRoutineOn(s, r.id, true)
  assert.ok(s.done[r.id], '기록이 안 남았다')

  const gone = removeCustomRoutine(s, r.id)
  assert.ok(!gone.done[r.id], '항목은 지웠는데 기록이 남았다')
  assert.ok(!(r.id in (gone.on ?? {})), '켜고 끈 설정이 남았다')
})

test('기본 항목은 못 지운다 — 끄는 것만 된다', () => {
  const s = removeCustomRoutine(markDone(emptyState(), 'bed', TODAY), 'bed')
  assert.ok(allRoutines(s).some((r) => r.id === 'bed'), '기본 항목이 지워졌다')
  assert.ok(s.done.bed, '기본 항목 기록이 지워졌다')
})

test('★ 못 만들었으면 왜인지 사람 말로 말한다', () => {
  const cases: [string, object][] = [
    ['이름 없음', { title: '   ' }],
    ['주기 0', { everyDays: 0 }],
    ['주기 너무 김', { everyDays: 9999 }],
    ['시간 0', { minutes: 0 }],
    ['시간 너무 김', { minutes: 9999 }],
    ['숫자가 아님', { everyDays: NaN }],
  ]
  for (const [label, over] of cases) {
    const r = mine(over)
    assert.equal(r.ok, false, `${label}: 통과했다`)
    assert.ok((r as { problem: string }).problem.length > 5, `${label}: 이유가 없다`)
    assert.doesNotMatch((r as { problem: string }).problem, /[a-z]{4,}/, `${label}: 영어 오류가 나간다`)
  }
})

test('이름이 겹치면 만들지 않는다 — 목록에 같은 줄이 둘이면 기록이 헷갈린다', () => {
  const r = mine()
  assert.ok(r.ok)
  const again = addCustomRoutine(r.state, { title: '화분에 물 주기', everyDays: 3, minutes: 1 }, NOW)
  assert.equal(again.ok, false)
  assert.match((again as { problem: string }).problem, /이미 목록에 있어요/)

  // 기본 항목과 겹치는 것도 막는다.
  const dup = addCustomRoutine(emptyState(), { title: '이불 정리', everyDays: 1, minutes: 1 }, NOW)
  assert.equal(dup.ok, false)
})

test('같은 밀리초에 두 번 만들어도 id가 안 겹친다', () => {
  const a = addCustomRoutine(emptyState(), { title: '가', everyDays: 1, minutes: 1 }, NOW)
  assert.ok(a.ok)
  const b = addCustomRoutine(a.state, { title: '나', everyDays: 1, minutes: 1 }, NOW)
  assert.ok(b.ok)
  assert.notEqual(a.id, b.id)
})

test('★ 내 루틴이 모든 화면에 나온다 — 한 군데라도 빠지면 그 화면에서만 사라진다', () => {
  const r = mine({ zoneId: 'living' })
  assert.ok(r.ok)
  const s = r.state

  assert.ok(enabledRoutines(s).some((x) => x.id === r.id), '기본으로 켜져 있지 않다')
  assert.ok(planToday(s, TODAY).due.some((x) => x.id === r.id), '오늘 할 것에 없다')
  assert.equal(zoneOfRoutine(s, r.id)?.id, 'living', '방 지도에 자리가 없다')

  const living = roomView(s, TODAY).zones.find((z) => z.id === 'living')!
  assert.equal(living.totalCount, 7, '거실 칸이 내 항목을 안 센다')

  assert.ok(monthReport(s, TODAY).missed.some((m) => m.id === r.id), '리포트가 안 본다')

  // 오래 밀리면 업체 신호에도 잡혀야 한다(같은 규칙을 받는다).
  const old = markDone(s, r.id, '2025-01-01')
  assert.ok(stuckRoutines(old, TODAY).some((x) => x.id === r.id), '밀린 신호에서 빠진다')

  const b = coachBoard(s, TODAY)
  assert.ok(b.report.missed.some((m) => m.id === r.id))
})

test('자리를 안 정하면 지도에는 안 뜨고 목록에는 뜬다 — 그것도 괜찮다', () => {
  const r = mine()
  assert.ok(r.ok)
  assert.equal(zoneOfRoutine(r.state, r.id), null)
  assert.ok(planToday(r.state, TODAY).due.some((x) => x.id === r.id))
})

test('★ 내 루틴에는 단계를 지어내지 않는다', () => {
  /* 우리가 안 쓴 단계를 만들어 붙이면 '같이 하기'가 통째로 거짓말이 된다. */
  const r = mine()
  assert.ok(r.ok)
  const routine = allRoutines(r.state).find((x) => x.id === r.id)!
  assert.deepEqual(routine.steps, [])
  assert.equal(routine.category, 'mine')

  // 화면도 빈 태그를 그리지 않고, 대신 무엇인지 한 줄 쓴다.
  const html = rowHtml({ ...routine, daysLate: null }, { state: 'due' })
  assert.doesNotMatch(html, /<ol><\/ol>|<p><\/p>/, '빈 태그를 그린다')
  assert.match(html, /직접 만드신 항목이에요/)
})

test('내 루틴도 오늘 한 곳으로 골릴 수 있다', () => {
  // 다른 걸 다 해두면 남는 건 내 항목뿐이다.
  let s = mine({ everyDays: 1, minutes: 1 }).state as ReturnType<typeof emptyState>
  for (const r of ROUTINES) if (!r.optIn && r.doer !== 'pro') s = markDone(s, r.id, TODAY)
  const pick = pickToday(s, TODAY)
  assert.ok(pick, '내 항목이 남았는데 아무것도 안 골랐다')
  assert.ok(isCustom(pick!.routine.id))
})

/* ── ③ 분류가 화면에서 빠지지 않는가 ──────────────────────── */

test('★ 모든 분류가 목록 고르기에 자리가 있다 — 없으면 그 항목은 켤 수가 없다', () => {
  /* 실물에서 잡혔다(2026-09-01): 'gear'를 만들어놓고 화면의 순서 배열에 안 넣어서
     로봇청소기 먼지통·세탁기 거름망 등 켜야만 나오는 항목 열 개를 켤 방법이
     아예 없었다. 화면은 이제 CATEGORY_LABEL의 키 순서를 그대로 쓴다. */
  const order = Object.keys(CATEGORY_LABEL)
  for (const r of ROUTINES) {
    assert.ok(order.includes(r.category), `'${r.title}'의 분류(${r.category})가 화면에 자리가 없다`)
  }
  assert.ok(order.includes('mine'), '내가 만든 항목이 목록 고르기에 안 나온다')
  // 순서 첫머리는 사람이 가장 자주 보는 것이어야 한다.
  assert.equal(order[0], 'home')
})

/* ── ④ 이번 주 ─────────────────────────────────────────────── */

test('★ 안 한 날에 X를 치지 않는다 — 결석부가 아니다', () => {
  let s = emptyState()
  for (const d of ['2026-08-27', '2026-08-29', TODAY]) s = markDone(s, 'bed', d)
  const html = weekHtml(habitStats(s, TODAY))

  assert.equal((html.match(/class="wk-c/g) ?? []).length, 7, '일곱 칸이 아니다')
  assert.equal((html.match(/wk-c on/g) ?? []).length, 3, '한 날을 안 세거나 더 센다')
  assert.doesNotMatch(html, /✗|✕|X<|안 함|빠짐|실패/, '안 한 날에 표를 한다')
  assert.match(html, /이레 중 <b>3일<\/b>/)
  // 오늘 칸은 눈에 띄어야 한다.
  assert.match(html, /wk-c on today|today/, '오늘이 어디인지 안 보인다')
})

test('아직 아무것도 안 한 주에도 나무라지 않는다', () => {
  const html = weekHtml(habitStats(emptyState(), TODAY))
  assert.match(html, /이번 주는 아직이에요/)
  assert.doesNotMatch(html, /밀렸|못 했|실패|0일/, '빈 주를 나무란다')
})

test('기록 묶음이 없으면 빈 문자열 — 화면이 안 깨진다', () => {
  assert.equal(weekHtml(null), '')
  assert.equal(weekHtml(undefined), '')
})
