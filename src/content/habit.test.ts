/**
 * 습관 기록 — 게임처럼 만들되, 벌주는 장치가 되지 않게
 *
 * ★ 이 파일이 지키는 것
 *   "잘하고 있는지 보여달라"는 요구는 정당하다. 다만 그 장치가 사람을
 *   그만두게 만드는 쪽으로 기우는 게 이 바닥의 흔한 실패다 — 하루 걸렀다고
 *   연속 기록이 0이 되고, 등급이 내려가고, 빨간 글씨가 뜬다.
 *
 *   그래서 여기서 잠근다: 등급은 안 내려가고, 하루 빠짐은 봐주고,
 *   한 번도 안 한 사람에게 0을 들이밀지 않는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { habitStats, emptyState, markDone, HABIT_RANKS, type TidyState } from './tidy.ts'

/** 날짜 목록으로 상태를 만든다 (항목 하나 기준) */
function stateOf(dates: string[], id = 'desk'): TidyState {
  return { done: { [id]: [...dates] } }
}

test('아직 아무것도 안 한 사람에게 0을 들이밀지 않는다', () => {
  const s = habitStats(emptyState(), '2026-08-26')
  assert.equal(s.doneTotal, 0)
  assert.equal(s.currentDays, 0)
  assert.equal(s.bestDays, 0)
  // 첫 등급은 '시작'이다 — 시작도 안 한 사람이라고 말하지 않는다.
  assert.equal(s.rank.name, HABIT_RANKS[0].name)
  assert.equal(s.days7.length, 7, '최근 7일은 기록이 없어도 일곱 칸이다')
})

test('★ 하루 걸러도 이어가는 날수가 끊기지 않는다', () => {
  // 22·23·(24 쉼)·25·26 — 사람은 하루쯤 거른다.
  const s = habitStats(stateOf(['2026-08-22', '2026-08-23', '2026-08-25', '2026-08-26']), '2026-08-26')
  assert.equal(s.currentDays, 4, '하루 빠졌다고 처음부터 다시 세면 그건 벌이다')
})

test('이틀 연속 비면 그때 끊긴다', () => {
  const s = habitStats(stateOf(['2026-08-20', '2026-08-21', '2026-08-25']), '2026-08-25')
  assert.equal(s.currentDays, 1, '사흘 만에 돌아온 건 새로 시작한 것으로 센다')
  assert.equal(s.bestDays, 2, '지난 기록은 남는다')
})

test('오늘 아직 안 눌렀어도 어제까지의 기록은 살아 있다', () => {
  // ★ 이게 없으면 아침에 앱을 켤 때마다 "0일"이 뜬다 — 하루를 실패로 시작시킨다.
  const s = habitStats(stateOf(['2026-08-24', '2026-08-25']), '2026-08-26')
  assert.equal(s.currentDays, 2)
})

test('★ 등급은 누적 횟수로만 오르고, 내려가지 않는다', () => {
  const dates = Array.from({ length: 20 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`)
  const busy = habitStats(stateOf(dates), '2026-07-20')
  // 한 달 넘게 손 놓은 뒤에도 등급은 그대로다 — 몸에 붙은 건 안 사라진다.
  const later = habitStats(stateOf(dates), '2026-09-30')
  assert.equal(later.rank.name, busy.rank.name, '쉬었다고 등급을 뺏지 않는다')
  assert.equal(later.currentDays, 0, '다만 이어가는 중은 아니다 — 그건 사실대로')
  assert.ok(later.bestDays >= 20, '가장 길었던 기록은 남는다')
})

test('다음 등급까지 몇 번인지 말해준다', () => {
  const s = habitStats(stateOf(['2026-08-01', '2026-08-02', '2026-08-03']), '2026-08-03')
  assert.equal(s.doneTotal, 3)
  assert.ok(s.next, '다음 목표가 없으면 오늘 하나 더 할 이유가 없다')
  assert.equal(s.next!.remain, HABIT_RANKS[1].at - 3)
})

test('마지막 등급에서는 다음 목표를 지어내지 않는다', () => {
  const many = Array.from({ length: 130 }, (_, i) => `2025-${String((i % 12) + 1).padStart(2, '0')}-01`)
  const s = habitStats({ done: { a: many } }, '2026-08-26')
  assert.equal(s.next, null, '없는 목표를 만들어 붙이지 않는다')
})

test('여러 항목을 같은 날 하면 그날은 하루로 세되 횟수는 다 센다', () => {
  const s = habitStats({ done: { desk: ['2026-08-26'], bed: ['2026-08-26'] } }, '2026-08-26')
  assert.equal(s.doneTotal, 2, '두 번 한 건 두 번이다')
  assert.equal(s.currentDays, 1, '하루는 하루다')
  assert.equal(s.days7[6].count, 2, '오늘 칸에 두 개가 잡힌다')
})

test('markDone과 이어 붙여도 말이 된다', () => {
  let st = emptyState()
  st = markDone(st, 'desk', '2026-08-25')
  st = markDone(st, 'desk', '2026-08-26')
  st = markDone(st, 'desk', '2026-08-26') // 같은 날 두 번 눌러도 하나
  const s = habitStats(st, '2026-08-26')
  assert.equal(s.doneTotal, 2)
  assert.equal(s.currentDays, 2)
})
