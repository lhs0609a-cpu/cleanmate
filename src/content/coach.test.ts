/**
 * 정리 코치 — "시작"을 눌렀을 때 화면이 하는 말이 사실인가
 *
 * ★ 이 화면이 틀리는 방식은 셋이다. 셋 다 여기서 잠근다.
 *
 *   ① **가짜 분석** — 진행률만 돌리고 실제로는 아무것도 안 세는 것.
 *      analyze()가 내놓는 값은 전부 기록에서 나온 수여야 한다.
 *   ② **문턱 높은 첫 제안** — 시작을 못 하는 사람에게 20분짜리를 들이미는 것.
 *      그날도 아무것도 안 하게 된다.
 *   ③ **리포트가 나무라는 것** — 한 달에 한 번 사람 기분을 상하게 하는 화면이
 *      되면 다음 달엔 안 연다. 아직 안 해본 것과 밀린 것을 섞으면 그렇게 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROUTINES, emptyState, markDone, setRoutineOn, type TidyState } from './tidy.ts'
import { ROOM_ZONES } from './room.ts'
import { analyze, coachBoard, monthReport, pickToday, zoneOf } from './coach.ts'

const TODAY = '2026-08-28'
const st = (done: Record<string, string[]>): TidyState => ({ done })

/** 켜져 있는 '내가 하는' 항목 전부를 그날 한 것으로 */
function allDone(date: string): TidyState {
  let s = emptyState()
  for (const r of ROUTINES) if (!r.optIn && r.doer !== 'pro') s = markDone(s, r.id, date)
  return s
}

/* ── ① 분석이 진짜인가 ─────────────────────────────────────── */

test('★ 분석은 실제로 센 것만 말한다 — 기록이 없으면 없다고 한다', () => {
  const steps = analyze(emptyState(), TODAY)
  assert.equal(steps.length, 5, '단계가 바뀌었다 — 화면이 기대하는 순서다')
  assert.deepEqual(steps.map((s) => s.key), ['records', 'zones', 'due', 'missed', 'pick'])

  const by = new Map(steps.map((s) => [s.key, s.result]))
  assert.match(by.get('records')!, /기록이 없어요/, '없는 기록을 있다고 한다')
  assert.match(by.get('zones')!, /아직 아무 곳도/, '안 본 곳을 봤다고 한다')
  for (const s of steps) {
    assert.ok(s.label.length > 3 && s.result.length > 0, `${s.key}: 빈 단계`)
  }
})

test('★ 분석의 숫자가 기록과 맞는다 — 여기서 어긋나면 화면 전체가 못 믿을 것이 된다', () => {
  let s = markDone(emptyState(), 'bed', '2026-08-26')
  s = markDone(s, 'bed', '2026-08-27')
  s = markDone(s, 'towels', '2026-08-27')

  const by = new Map(analyze(s, TODAY).map((x) => [x.key, x.result]))
  // 이틀에 걸쳐 세 번 — 둘 다 실제로 센 값이다.
  assert.match(by.get('records')!, /2일/)
  assert.match(by.get('records')!, /3번/)
  // 침대·욕실 두 곳만 기록이 있다.
  assert.match(by.get('zones')!, new RegExp(`${ROOM_ZONES.length - 2}곳은 처음`))
})

test('놓치고 있는 것을 실제로 센다', () => {
  const by = new Map(analyze(emptyState(), TODAY).map((x) => [x.key, x.result]))
  const shouldMiss = ROUTINES.filter((r) => !r.optIn && r.doer !== 'pro').length
  assert.equal(by.get('missed'), `${shouldMiss}개`)

  const done = new Map(analyze(allDone(TODAY), TODAY).map((x) => [x.key, x.result]))
  assert.equal(done.get('missed'), '없어요', '다 해봤는데 놓쳤다고 한다')
})

/* ── ② 오늘 한 곳 ──────────────────────────────────────────── */

test('★ 처음 켠 사람에게는 가장 짧은 것 하나만 준다', () => {
  const pick = pickToday(emptyState(), TODAY)
  assert.ok(pick, '고를 게 있는데 아무것도 안 골랐다')
  assert.equal(pick!.rule, 'first')

  const shortest = Math.min(
    ...ROUTINES.filter((r) => !r.optIn && r.doer !== 'pro').map((r) => r.minutes)
  )
  assert.equal(pick!.routine.minutes, shortest, `20분짜리를 첫 제안으로 줬다: ${pick!.routine.title}`)
  assert.match(pick!.because, /짧|분/, '왜 이걸 골랐는지 안 말한다')
})

test('★ 맡기는 일은 오늘 할 곳으로 안 고른다 — 그 자리에서 못 끝낸다', () => {
  let s = emptyState()
  for (const r of ROUTINES) if (r.doer === 'pro') s = setRoutineOn(s, r.id, true)
  for (let i = 0; i < 40; i++) {
    const pick = pickToday(s, TODAY)
    if (!pick) break
    assert.notEqual(pick.routine.doer, 'pro', `${pick.routine.title}을 오늘 할 일로 골랐다`)
    s = markDone(s, pick.routine.id, TODAY)
  }
})

test('다 해봤으면 가장 오래된 공간에서, 그 안에서 짧은 것을 고른다', () => {
  // 전부 오래전에 한 번씩 했다 → 이제 'first'가 아니라 'oldest' 규칙이다.
  const s = allDone('2026-01-01')
  const pick = pickToday(s, TODAY)
  assert.ok(pick)
  assert.equal(pick!.rule, 'oldest')
  assert.ok(pick!.zone, '공간을 못 찾았다')

  // 고른 공간 안에서 더 짧은 게 남아 있으면 안 된다.
  const sameZone = ROUTINES.filter(
    (r) => !r.optIn && r.doer !== 'pro' && zoneOf(r.id)?.id === pick!.zone!.id
  )
  const min = Math.min(...sameZone.map((r) => r.minutes))
  assert.equal(pick!.routine.minutes, min, '같은 공간에 더 짧은 게 있는데 큰 걸 골랐다')
})

test('★ 오늘 다 했으면 없는 할 일을 만들지 않는다', () => {
  assert.equal(pickToday(allDone(TODAY), TODAY), null, '"그래도 뭐라도 하세요"는 우리가 할 말이 아니다')
  const by = new Map(analyze(allDone(TODAY), TODAY).map((x) => [x.key, x.result]))
  assert.match(by.get('pick')!, /안 하셔도 됩니다/)
})

test('꼼꼼히 볼 곳을 같이 준다 — 보이는 곳만 치우면 보이는 곳만 깨끗해진다', () => {
  const s = allDone('2026-01-01')
  let found = 0
  let cur = s
  for (let i = 0; i < 10; i++) {
    const pick = pickToday(cur, TODAY)
    if (!pick) break
    if (pick.spots.length) found++
    cur = markDone(cur, pick.routine.id, TODAY)
  }
  assert.ok(found > 0, '어느 제안에도 꼼꼼히 볼 곳이 안 붙었다')
})

/* ── ③ 이번 달 리포트 ──────────────────────────────────────── */

test('이번 달 한 곳을 공간 단위로 센다', () => {
  const s = st({ bed: ['2026-08-02', '2026-08-10'], towels: ['2026-08-11'], fridge: ['2026-07-30'] })
  const r = monthReport(s, TODAY)

  assert.equal(r.ym, '2026-08')
  assert.equal(r.doneCount, 3, '이번 달 횟수가 틀리다')
  assert.equal(r.prevDoneCount, 1, '지난달과 안 갈랐다')
  assert.equal(r.activeDays, 3)

  const bed = r.cleaned.find((c) => c.id === 'bed')
  assert.ok(bed, '침대를 두 번 했는데 목록에 없다')
  assert.equal(bed!.times, 2)
  assert.equal(bed!.lastDate, '2026-08-10')
  assert.equal(r.cleaned[0].id, 'bed', '많이 한 순이 아니다')
})

test('★ 흐려진 곳과 아직 안 해본 곳을 섞지 않는다 — 섞으면 첫 달 리포트가 통째로 빨개진다', () => {
  const fresh = monthReport(emptyState(), TODAY)
  assert.deepEqual(fresh.fading, [], '한 번도 안 해본 곳을 "흐려졌다"고 한다')
  assert.ok(fresh.missed.length > 0, '아직 안 해본 것은 안 해본 것으로 잡혀야 한다')
  assert.deepEqual(fresh.slipping, [], '기록도 없는데 밀렸다고 한다')

  // 지난달엔 했고 이번 달엔 안 온 곳 → 여기가 진짜 '흐려지는 곳'이다.
  const r = monthReport(st({ fridge: ['2026-07-05'] }), TODAY)
  assert.ok(r.fading.some((f) => f.id === 'kitchen'), '이번 달에 안 온 곳을 못 찾는다')
})

test('★ 밀린 정도는 절대 일수가 아니라 주기 대비로 센다', () => {
  /* 30일 지난 연 1회 항목보다 10일 지난 3일 주기 항목이 실제로는 더 밀렸다.
     절대 일수로 정렬하면 리포트가 매번 "옷장 계절 정리"만 가리킨다. */
  const s = st({ towels: ['2026-08-18'], wardrobe: ['2026-06-01'] }) // 10일 지남 / 아직 안 지남
  const r = monthReport(s, TODAY)
  assert.equal(r.slipping[0]?.id, 'towels', `주기 대비로 안 세고 있다: ${r.slipping[0]?.id}`)
})

test('다음 달에 볼 것은 셋을 넘지 않는다 — 열 개를 주면 하나도 안 한다', () => {
  for (const s of [emptyState(), allDone('2026-01-01'), st({ bed: ['2026-08-01'] })]) {
    const r = monthReport(s, TODAY)
    assert.ok(r.focus.length <= 3, `${r.focus.length}개를 골랐다`)
    assert.equal(new Set(r.focus.map((f) => f.id)).size, r.focus.length, '같은 걸 두 번 넣었다')
    for (const f of r.focus) assert.ok(f.why.length > 5, `${f.id}: 왜 보라는지가 없다`)
  }
})

test('할 게 없으면 다음 달 초점도 비운다 — 억지로 채우지 않는다', () => {
  assert.deepEqual(monthReport(allDone(TODAY), TODAY).focus, [])
})

test('★ 리포트가 사람을 나무라지 않는다', () => {
  const s = st({ bed: ['2025-01-01'], fridge: ['2025-01-01'] })
  const r = monthReport(s, TODAY)
  const text = JSON.stringify(r) + JSON.stringify(analyze(s, TODAY))
  const banned = /지저분|더럽|게으|방치|엉망|창피|실패|낙제|경고/
  assert.doesNotMatch(text, banned, '리포트가 사람을 평가한다')
})

test('묶음 하나로 화면이 필요한 걸 다 받는다', () => {
  const b = coachBoard(st({ bed: ['2026-08-27'] }), TODAY)
  assert.equal(b.steps.length, 5)
  assert.ok(b.pick, '오늘 할 곳이 없다')
  assert.equal(b.report.ym, '2026-08')
})

test('끈 항목은 코치도 안 본다 — 끄기가 화면 한쪽에만 먹히면 안 된다', () => {
  let s = emptyState()
  for (const r of ROUTINES) if (!r.optIn && r.doer !== 'pro' && r.id !== 'bed') s = setRoutineOn(s, r.id, false)
  const pick = pickToday(s, TODAY)
  assert.equal(pick?.routine.id, 'bed', '끈 항목을 오늘 할 일로 골랐다')
  assert.deepEqual(monthReport(s, TODAY).missed.map((m) => m.id), ['bed'])
})
