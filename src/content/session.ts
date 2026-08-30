/**
 * 같이 하기 — 글을 주고 기다리는 대신, 앱이 옆에서 끌고 간다
 *
 * ★ 왜 이게 필요한가
 *   지금까지 이 앱은 단계를 **글로 주고** '했어요' 버튼을 기다렸다. 사람들은
 *   그 글을 읽고 안 한다. 읽는 것과 하는 것 사이에 아무것도 없기 때문이다.
 *   할 일 앱과 실제로 쓰이는 도구의 차이가 정확히 이 한 칸에서 갈린다.
 *
 * ★ 타이머를 카운트다운으로 두는 이유 — 재촉이 아니라 **약속**이다
 *   "3분만 하면 끝"이라는 경계가 있으면 시작이 쉬워진다. 끝이 안 보이는 일은
 *   시작 자체가 안 된다. 그래서 남은 시간을 보여준다.
 *   그리고 0이 되면 **"여기까지 하셔도 됩니다"**라고 말한다. "시간 초과"가
 *   아니다 — 넘긴 사람을 늦은 사람으로 만들면 다음부터 이 버튼을 안 누른다.
 *
 * ★ 진행 막대는 시간이 아니라 **단계**로 센다.
 *   시간으로 재면 3분짜리를 5분에 끝낸 사람의 막대가 꽉 차서 멈춰 있다.
 *   그건 진행이 아니라 "늦었다"는 말이다. 단계로 세면 늘 사실이다.
 *
 * 전부 순수 함수다. 일시정지/재개 계산이 틀리면 타이머가 거짓말을 하고,
 * 거짓말하는 타이머는 없는 것보다 나쁘다.
 */

import type { TidyRoutine } from './tidy.ts'

export interface TidySession {
  routineId: string
  /** 지금 보고 있는 단계 (0부터) */
  stepIndex: number
  /** 시작한 시각 (epoch ms) */
  startedAt: number
  /** 멈춰 있던 시간의 합 */
  pausedMs: number
  /** 멈춘 시각. null이면 돌아가는 중 */
  pausedAt: number | null
  /** 꼼꼼히 볼 곳 중 확인한 것의 자리 번호 */
  checkedSpots: number[]
}

export function startSession(routineId: string, now = Date.now()): TidySession {
  return { routineId, stepIndex: 0, startedAt: now, pausedMs: 0, pausedAt: null, checkedSpots: [] }
}

/** 실제로 흐른 시간 — 멈춰 있던 만큼은 빼고 센다 */
export function elapsedMs(s: TidySession, now = Date.now()): number {
  const stopped = s.pausedMs + (s.pausedAt !== null ? now - s.pausedAt : 0)
  return Math.max(0, now - s.startedAt - stopped)
}

export function pauseSession(s: TidySession, now = Date.now()): TidySession {
  if (s.pausedAt !== null) return s // 이미 멈춰 있다 — 두 번 눌러도 시간이 안 꼬인다
  return { ...s, pausedAt: now }
}

export function resumeSession(s: TidySession, now = Date.now()): TidySession {
  if (s.pausedAt === null) return s
  return { ...s, pausedMs: s.pausedMs + Math.max(0, now - s.pausedAt), pausedAt: null }
}

export function isLastStep(s: TidySession, routine: TidyRoutine): boolean {
  return s.stepIndex >= routine.steps.length - 1
}

/** 다음 단계로. 마지막에서 더 누르면 그대로 둔다 — 끝은 '끝냈어요'로만 낸다. */
export function nextStep(s: TidySession, routine: TidyRoutine): TidySession {
  if (isLastStep(s, routine)) return s
  return { ...s, stepIndex: s.stepIndex + 1 }
}

/** 이전 단계로. 여기서도 되돌리기는 기본이다 — 잘못 눌렀을 때 갇히지 않게. */
export function backStep(s: TidySession): TidySession {
  return s.stepIndex <= 0 ? s : { ...s, stepIndex: s.stepIndex - 1 }
}

/** 꼼꼼히 볼 곳 하나를 확인/해제 */
export function toggleSpot(s: TidySession, index: number): TidySession {
  const has = s.checkedSpots.includes(index)
  return {
    ...s,
    checkedSpots: has ? s.checkedSpots.filter((i) => i !== index) : [...s.checkedSpots, index].sort((a, b) => a - b),
  }
}

/** m:ss. 시간 단위는 안 쓴다 — 한 시간 넘게 붙잡는 항목이 없다(가장 긴 게 60분). */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export interface SessionView {
  stepIndex: number
  stepCount: number
  stepText: string
  isLast: boolean
  paused: boolean
  /** 지금까지 걸린 시간 */
  elapsedLabel: string
  /** 남은 시간. 권장 시간을 넘겼으면 null */
  remainLabel: string | null
  /** 권장 시간을 넘겼나. ★ 경고가 아니다 — 넘겨도 아무 일 없다 */
  overtime: boolean
  /** 넘긴 시간 (+1:12). 안 넘겼으면 null */
  overLabel: string | null
  /** 넘겼을 때 화면에 뜨는 말. "시간 초과"라고 쓰지 않는다 */
  overNote: string | null
  /** 0~1 — 단계로 센다. 시간으로 세지 않는 이유는 파일 맨 위에 */
  progress: number
  spots: { text: string; checked: boolean }[]
}

export function sessionView(s: TidySession, routine: TidyRoutine, now = Date.now()): SessionView {
  const el = elapsedMs(s, now)
  const budget = routine.minutes * 60_000
  const over = el > budget
  const spots = routine.spots ?? []

  return {
    stepIndex: s.stepIndex,
    stepCount: routine.steps.length,
    stepText: routine.steps[s.stepIndex] ?? '',
    isLast: isLastStep(s, routine),
    paused: s.pausedAt !== null,
    elapsedLabel: clock(el),
    remainLabel: over ? null : clock(budget - el),
    overtime: over,
    overLabel: over ? `+${clock(el - budget)}` : null,
    overNote: over ? '여기까지 하셔도 됩니다. 더 하셔도 되고요.' : null,
    progress: (s.stepIndex + 1) / routine.steps.length,
    spots: spots.map((text, i) => ({ text, checked: s.checkedSpots.includes(i) })),
  }
}

/**
 * 끝냈을 때 화면에 쓸 한 줄.
 *
 * ★ 권장 시간과 비교하지 않는다. "3분 예상이었는데 5분 걸렸어요"는 실패
 *   통보다. 우리가 실제로 잰 것 하나만 말한다 — 그리고 대개 그 숫자는
 *   생각보다 짧아서, 그 자체가 다음에 또 하게 만드는 이유가 된다.
 */
export function finishLine(s: TidySession, now = Date.now()): string {
  const el = elapsedMs(s, now)
  if (el < 60_000) return `${Math.max(1, Math.round(el / 1000))}초 걸렸어요.`
  return `${clock(el)} 걸렸어요.`
}
