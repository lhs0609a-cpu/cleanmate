/**
 * 같이 하기 — 타이머가 거짓말하지 않는가
 *
 * ★ 거짓말하는 타이머는 없는 것보다 나쁘다.
 *   멈췄다 다시 켰을 때 시간이 튀거나, 진행 막대가 꽉 찼는데 단계가 남아 있거나,
 *   권장 시간을 넘겼다고 사람을 늦은 사람 취급하면 — 다음부터 이 버튼을 안 누른다.
 *   여기서 잠그는 건 그 셋이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROUTINES, type TidyRoutine } from './tidy.ts'
import {
  backStep,
  clock,
  elapsedMs,
  finishLine,
  isLastStep,
  nextStep,
  pauseSession,
  resumeSession,
  sessionView,
  startSession,
  toggleSpot,
} from './session.ts'

const T0 = Date.UTC(2026, 7, 28, 9, 0, 0)
const sec = (n: number) => T0 + n * 1000

const R: TidyRoutine = {
  id: 'test',
  title: '테스트',
  category: 'home',
  everyDays: 1,
  minutes: 3,
  why: '테스트용 항목입니다. 왜가 없으면 잔소리가 됩니다.',
  steps: ['하나', '둘', '셋'],
  spots: ['구석', '틈새'],
}

/* ── 시간 ──────────────────────────────────────────────────── */

test('흐른 시간을 그대로 센다', () => {
  const s = startSession(R.id, T0)
  assert.equal(elapsedMs(s, sec(0)), 0)
  assert.equal(elapsedMs(s, sec(90)), 90_000)
})

test('★ 멈춘 동안은 안 센다 — 멈춘 채로 커피 마시고 왔더니 시간이 다 갔으면 안 된다', () => {
  let s = startSession(R.id, T0)
  s = pauseSession(s, sec(30))          // 30초 하고 멈춤
  assert.equal(elapsedMs(s, sec(300)), 30_000, '멈춰 있는데 시간이 흘렀다')
  s = resumeSession(s, sec(300))        // 4분 30초 쉬고 재개
  assert.equal(elapsedMs(s, sec(300)), 30_000)
  assert.equal(elapsedMs(s, sec(340)), 70_000, '재개 뒤 시간이 튀었다')
})

test('두 번 눌러도 시간이 안 꼬인다', () => {
  let s = startSession(R.id, T0)
  s = pauseSession(s, sec(10))
  s = pauseSession(s, sec(20)) // 이미 멈춰 있다
  s = resumeSession(s, sec(30))
  s = resumeSession(s, sec(40)) // 이미 돌아가고 있다
  assert.equal(elapsedMs(s, sec(50)), 30_000)
})

test('시계는 m:ss로 읽는다', () => {
  assert.equal(clock(0), '0:00')
  assert.equal(clock(9_000), '0:09')
  assert.equal(clock(75_000), '1:15')
  assert.equal(clock(-5_000), '0:00', '음수가 화면에 나가면 안 된다')
})

/* ── 단계 ──────────────────────────────────────────────────── */

test('단계를 앞뒤로 옮기고, 끝에서 갇히지 않는다', () => {
  let s = startSession(R.id, T0)
  assert.equal(isLastStep(s, R), false)
  s = nextStep(s, R)
  s = nextStep(s, R)
  assert.equal(s.stepIndex, 2)
  assert.equal(isLastStep(s, R), true)
  // 마지막에서 더 눌러도 넘어가지 않는다 — 끝은 '끝냈어요'로만 낸다.
  assert.equal(nextStep(s, R).stepIndex, 2)
  // 잘못 눌렀으면 돌아갈 수 있다.
  s = backStep(s)
  assert.equal(s.stepIndex, 1)
  assert.equal(backStep(backStep(backStep(s))).stepIndex, 0, '첫 단계 아래로 내려갔다')
})

test('★ 진행 막대는 시간이 아니라 단계로 센다', () => {
  /* 시간으로 재면 3분짜리를 5분 걸린 사람의 막대가 꽉 차서 멈춘다.
     그건 진행이 아니라 "늦었다"는 통보다. */
  let s = startSession(R.id, T0)
  const early = sessionView(s, R, sec(1))
  assert.ok(Math.abs(early.progress - 1 / 3) < 1e-9, '첫 단계인데 막대가 다르다')

  const late = sessionView(s, R, sec(600)) // 10분 지남
  assert.equal(late.progress, early.progress, '시간이 막대를 밀었다')

  s = nextStep(nextStep(s, R), R)
  assert.equal(sessionView(s, R, sec(1)).progress, 1, '마지막 단계인데 안 찼다')
})

/* ── 권장 시간을 넘겼을 때 ─────────────────────────────────── */

test('남은 시간을 보여준다 — "3분만 하면 끝"이라는 경계가 시작을 쉽게 만든다', () => {
  const s = startSession(R.id, T0)
  const v = sessionView(s, R, sec(60))
  assert.equal(v.remainLabel, '2:00')
  assert.equal(v.overtime, false)
  assert.equal(v.overLabel, null)
  assert.equal(v.overNote, null)
})

test('★ 넘겨도 나무라지 않는다 — "시간 초과"라고 쓰지 않는다', () => {
  const s = startSession(R.id, T0)
  const v = sessionView(s, R, sec(3 * 60 + 72)) // 1분 12초 넘김
  assert.equal(v.overtime, true)
  assert.equal(v.remainLabel, null, '남은 시간이 음수로 나간다')
  assert.equal(v.overLabel, '+1:12')
  assert.ok(v.overNote, '넘겼을 때 할 말이 없다')
  assert.doesNotMatch(v.overNote!, /초과|늦|실패|넘었|못/, `나무라는 문구다: ${v.overNote}`)
  assert.match(v.overNote!, /하셔도 됩니다/)
})

test('멈춘 상태가 화면에 그대로 보인다', () => {
  let s = startSession(R.id, T0)
  assert.equal(sessionView(s, R, sec(5)).paused, false)
  s = pauseSession(s, sec(5))
  assert.equal(sessionView(s, R, sec(99)).paused, true)
  assert.equal(sessionView(s, R, sec(99)).elapsedLabel, '0:05')
})

/* ── 꼼꼼히 볼 곳 ──────────────────────────────────────────── */

test('꼼꼼히 볼 곳을 하나씩 확인하고 되돌린다', () => {
  let s = startSession(R.id, T0)
  assert.deepEqual(sessionView(s, R, sec(1)).spots.map((x) => x.checked), [false, false])
  s = toggleSpot(s, 1)
  assert.deepEqual(sessionView(s, R, sec(1)).spots.map((x) => x.checked), [false, true])
  s = toggleSpot(s, 1)
  assert.deepEqual(sessionView(s, R, sec(1)).spots.map((x) => x.checked), [false, false])
})

test('꼼꼼히 볼 곳이 없는 항목도 그냥 돈다', () => {
  const bare = { ...R, spots: undefined }
  const v = sessionView(startSession(bare.id, T0), bare, sec(1))
  assert.deepEqual(v.spots, [])
  assert.equal(v.stepText, '하나')
})

/* ── 끝냈을 때 ─────────────────────────────────────────────── */

test('★ 끝나면 우리가 잰 시간만 말한다 — 예상과 비교하지 않는다', () => {
  const s = startSession(R.id, T0)
  assert.equal(finishLine(s, sec(42)), '42초 걸렸어요.')
  assert.equal(finishLine(s, sec(125)), '2:05 걸렸어요.')
  // "3분 예상이었는데 5분 걸렸어요"는 실패 통보다. 비교하는 말이 없어야 한다.
  const line = finishLine(s, sec(400))
  assert.doesNotMatch(line, /예상|보다|초과|늦/, `비교하는 문구가 들어갔다: ${line}`)
})

/* ── 실제 콘텐츠로 돌려본다 ────────────────────────────────── */

test('모든 항목이 세션으로 끝까지 돈다 — 단계가 비면 빈 화면이 뜬다', () => {
  for (const r of ROUTINES) {
    let s = startSession(r.id, T0)
    for (let i = 0; i < r.steps.length; i++) {
      const v = sessionView(s, r, sec(i))
      assert.ok(v.stepText.length > 0, `${r.id}: ${i}번째 단계가 비었다`)
      assert.equal(v.stepCount, r.steps.length)
      s = nextStep(s, r)
    }
    assert.equal(isLastStep(s, r), true, `${r.id}: 끝에 도달하지 못했다`)
    assert.equal(sessionView(s, r, sec(1)).progress, 1)
  }
})
