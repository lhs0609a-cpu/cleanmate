/**
 * 정리 코치 — "정리정돈 시작"을 누르면 실제로 도는 것
 *
 * ★ 이 모듈이 답하는 질문 셋
 *     ① 지금 내 집이 어떤 상태인가        → analyze()
 *     ② 그래서 오늘 어디를 하면 되나      → pickToday()
 *     ③ 이번 달에 뭘 했고 뭘 놓쳤나       → monthReport()
 *
 * ★ 왜 목록이 아니라 '한 곳'인가
 *   켤 수 있는 항목이 마흔 개다. 그걸 다 보여주면 사람은 **하나도 안 고른다.**
 *   고르는 것 자체가 일이라서다. 그래서 분석의 결과물은 목록이 아니라
 *   **딱 한 곳**이다. 나머지는 아래에 그대로 있고, 안 보고 싶으면 안 봐도 된다.
 *
 * ★ "분석 중"이 가짜여서는 안 된다
 *   여기 계산은 순수 함수라 눈 깜짝할 새에 끝난다. 그래서 화면에 가짜 진행률
 *   막대를 돌리면 그건 그냥 거짓말이다(이 저장소가 제일 싫어하는 종류의).
 *   대신 analyze()는 **실제로 센 값**을 단계별로 내놓고, 화면은 그걸 한 줄씩
 *   밝힌다. 보여주는 숫자가 전부 진짜면 잠깐 나눠 보여주는 건 연출이지 거짓이 아니다.
 *   AnalysisStep.result에 지어낸 값이 하나라도 들어가는 순간 이 원칙이 깨진다.
 */

import {
  ROUTINES,
  dayNumber,
  daysUntilDue,
  enabledRoutines,
  isDue,
  lastDone,
  type TidyRoutine,
  type TidyState,
} from './tidy.ts'
import { ROOM_ZONES, roomView, zoneOfRoutine } from './room.ts'

/**
 * 항목 id → 그 항목이 사는 공간. 지도 밖이면 null.
 *
 * ★ 상태를 받는다. 사용자가 만든 항목은 지도가 아니라 항목 쪽에 자리가 적혀
 *   있어서(zoneId), 고정된 표로는 못 찾는다 — 그러면 내가 만든 항목만
 *   "어디 것인지" 꼬리표가 안 붙는다.
 */
export function zoneOf(routineId: string, state?: TidyState): { id: string; name: string } | null {
  const z = zoneOfRoutine(state ?? { done: {} }, routineId)
  return z ? { id: z.id, name: z.name } : null
}

/** 내가 지금 이 자리에서 할 수 있는 것만 (맡기는 항목은 뺀다) */
const mine = (state: TidyState) => enabledRoutines(state).filter((r) => r.doer !== 'pro')

/* ════════════════════════════════════════════════════════════
   ① 분석 — 화면이 한 줄씩 밝히는 것
   ════════════════════════════════════════════════════════════ */

export interface AnalysisStep {
  /** 화면이 단계를 구분할 때 쓰는 이름 */
  key: 'records' | 'zones' | 'due' | 'missed' | 'pick'
  /** 무엇을 보는 중인지 */
  label: string
  /** 실제로 센 결과. ★ 여기에 지어낸 값이 들어가면 이 화면 전체가 거짓이 된다 */
  result: string
}

export function analyze(state: TidyState, today: string, exclude: ReadonlySet<string> = new Set()): AnalysisStep[] {
  const list = mine(state)
  const room = roomView(state, today)

  const days = new Set<string>()
  let total = 0
  for (const dates of Object.values(state.done)) {
    for (const d of dates) days.add(d)
    total += dates.length
  }

  const fresh = room.zones.filter((z) => z.mood === 'fresh').length
  const aging = room.zones.filter((z) => z.mood === 'aging').length
  const never = room.untouchedZones

  const due = list.filter((r) => isDue(r, state, today) && lastDone(state, r.id) !== today).length
  const missed = list.filter((r) => !lastDone(state, r.id)).length
  const pick = pickToday(state, today, exclude)

  return [
    {
      key: 'records',
      label: '기록을 읽는 중',
      result: total ? `${days.size}일에 걸쳐 ${total}번` : '아직 기록이 없어요',
    },
    {
      key: 'zones',
      label: `여기 ${room.zones.length}곳을 둘러보는 중`,
      result: never === room.zones.length
        ? '아직 아무 곳도 안 봤어요'
        : [
            fresh ? `${fresh}곳은 최근에` : '',
            aging ? `${aging}곳은 오래됐고` : '',
            never ? `${never}곳은 처음` : '',
          ].filter(Boolean).join(' · '),
    },
    {
      key: 'due',
      label: '지금 할 수 있는 것을 세는 중',
      result: due ? `${due}개` : '지금은 없어요',
    },
    {
      key: 'missed',
      label: '놓치고 있는 곳을 찾는 중',
      result: missed ? `${missed}개` : '없어요',
    },
    {
      key: 'pick',
      label: '오늘 한 곳을 고르는 중',
      result: pick ? pick.routine.title : '오늘은 안 하셔도 됩니다',
    },
  ]
}

/* ════════════════════════════════════════════════════════════
   ② 오늘 한 곳
   ════════════════════════════════════════════════════════════ */

export interface TodayPick {
  routine: TidyRoutine
  zone: { id: string; name: string } | null
  /** 왜 여기인지 — 사용자의 기록에서 나온 말만 쓴다 */
  because: string
  /**
   * 어떤 규칙으로 골랐나. 화면이 다르게 그릴 수 있게 이름을 준다.
   *   first  — 아직 한 번도 안 해본 것 (첫 완료의 문턱이 가장 낮다)
   *   oldest — 가장 오래된 공간에서, 그 안에서 가장 짧은 것
   */
  rule: 'first' | 'oldest'
  /** 꼼꼼히 볼 곳 — 없으면 빈 배열 */
  spots: string[]
}

/**
 * 오늘 할 한 곳을 고른다. 없으면 null — 없는 할 일을 만들지 않는다.
 *
 * ★ 규칙 순서에 이유가 있다.
 *   1) **안 해본 것 중 가장 짧은 것.** 시작을 못 하는 사람에게 20분짜리를
 *      들이밀면 그날도 아무것도 안 한다. 1분짜리 하나를 끝내본 사람이
 *      다음 걸 시작한다(ROUTINES 정렬과 같은 근거).
 *   2) 다 해봤으면 **가장 오래된 공간**을 고르고, 그 공간 안에서 가장 짧은 것.
 *      '가장 많이 밀린 항목'을 그냥 고르면 매번 제일 큰 일이 걸린다.
 *   3) 밀린 게 없으면 null. "그래도 뭐라도 하세요"는 이 앱이 할 말이 아니다.
 */
export function pickToday(
  state: TidyState,
  today: string,
  /** 오늘은 넘기기로 한 항목들. 기록에 남기지 않고 이번 화면에서만 뺀다. */
  exclude: ReadonlySet<string> = new Set()
): TodayPick | null {
  const list = mine(state).filter((r) => lastDone(state, r.id) !== today && !exclude.has(r.id))
  if (!list.length) return null

  const shortest = (rs: TidyRoutine[]) => [...rs].sort((a, b) => a.minutes - b.minutes)[0]
  const wrap = (r: TidyRoutine, rule: TodayPick['rule'], because: string): TodayPick => ({
    routine: r,
    zone: zoneOf(r.id, state),
    because,
    rule,
    spots: r.spots ?? [],
  })

  const never = list.filter((r) => !lastDone(state, r.id))
  if (never.length) {
    const r = shortest(never)
    const z = zoneOf(r.id, state)
    return wrap(
      r,
      'first',
      `${z ? `${z.name}에서 ` : ''}아직 한 번도 안 해보신 것 중 가장 짧아요 — ${r.minutes}분이면 끝납니다.`
    )
  }

  const due = list.filter((r) => isDue(r, state, today))
  if (!due.length) return null

  /* 가장 오래된 공간을 먼저 고른다. 공간이 없는 항목(지도 밖)은 그 항목 자체의
     지난 일수로 견준다 — 자리가 없다고 목록에서 빠지면 안 된다. */
  const room = roomView(state, today)
  const dimmest = [...room.zones]
    .filter((z) => z.mood !== 'never' && due.some((r) => zoneOf(r.id, state)?.id === z.id))
    .sort((a, b) => a.freshness - b.freshness)[0]

  const pool = dimmest ? due.filter((r) => zoneOf(r.id, state)?.id === dimmest.id) : due
  const r = shortest(pool)
  const late = -(daysUntilDue(r, state, today) ?? 0)

  return wrap(
    r,
    'oldest',
    dimmest
      ? `${dimmest.name}이 가장 오래됐어요. 그중에서 제일 짧은 것부터 골랐습니다 — ${r.minutes}분.`
      : `${late > 0 ? `${late}일 지났어요. ` : '오늘이 그날이에요. '}${r.minutes}분이면 됩니다.`
  )
}

/* ════════════════════════════════════════════════════════════
   ③ 이번 달 리포트

   ★ 여기서 지키는 것: **못 한 것을 나무라는 자리가 아니다.**
     "어디가 더러워지고 있나"는 사실이지만, 그걸 점수나 경고로 말하면
     그 화면은 한 달에 한 번 사람을 기분 나쁘게 하는 장치가 된다.
     그래서 넷으로 나눠 **사실만** 적는다 — 한 곳 / 흐려진 곳 / 아직 안 해본 것 /
     계속 미뤄지는 것. 그리고 다음 달에 볼 것 세 개만 고른다.
   ════════════════════════════════════════════════════════════ */

export interface MonthReport {
  ym: string
  /** 이번 달에 실제로 손댄 곳 — 많이 한 순 */
  cleaned: { id: string; name: string; times: number; lastDate: string; daysAgo: number }[]
  /** 기록은 있는데 이번 달엔 한 번도 안 온 곳 */
  fading: { id: string; name: string; daysAgo: number }[]
  /** 아직 한 번도 안 해본 항목 — '밀린 것'이 아니라 '아직'이다 */
  missed: { id: string; title: string; zoneName: string; minutes: number }[]
  /** 주기를 넘겨 계속 미뤄지는 항목 — 많이 지난 순 */
  slipping: { id: string; title: string; zoneName: string; daysLate: number; everyDays: number }[]
  doneCount: number
  prevDoneCount: number
  activeDays: number
  /** 다음 달에 꼼꼼히 볼 것. 셋을 넘기지 않는다 — 열 개를 주면 하나도 안 한다 */
  focus: { id: string; title: string; why: string }[]
}

export function monthReport(state: TidyState, today: string): MonthReport {
  const ym = today.slice(0, 7)
  const [y, m] = ym.split('-').map(Number)
  const prevAnchor = new Date(Date.UTC(y, m - 2, 1))
  const prevYm = `${prevAnchor.getUTCFullYear()}-${String(prevAnchor.getUTCMonth() + 1).padStart(2, '0')}`
  const list = mine(state)
  const t = dayNumber(today)

  /* ── 이번 달 손댄 곳 (공간 단위로 묶는다) ─────────────────
     항목 단위로 보여주면 스무 줄이 된다. 사람이 기억하는 단위는 공간이다. */
  const perZone = new Map<string, { times: number; last: string }>()
  let doneCount = 0
  let prevDoneCount = 0
  const activeDays = new Set<string>()

  for (const [id, dates] of Object.entries(state.done)) {
    const z = zoneOf(id, state)
    for (const d of dates) {
      if (d.startsWith(prevYm)) prevDoneCount++
      if (!d.startsWith(ym)) continue
      doneCount++
      activeDays.add(d)
      if (!z) continue
      const cur = perZone.get(z.id)
      if (!cur) perZone.set(z.id, { times: 1, last: d })
      else {
        cur.times++
        if (d > cur.last) cur.last = d
      }
    }
  }

  const cleaned = [...perZone.entries()]
    .map(([id, v]) => ({
      id,
      name: ROOM_ZONES.find((z) => z.id === id)?.name ?? id,
      times: v.times,
      lastDate: v.last,
      daysAgo: t - dayNumber(v.last),
    }))
    .sort((a, b) => b.times - a.times)

  /* ── 흐려지는 곳 ────────────────────────────────────────
     기록이 아예 없는 곳은 여기 넣지 않는다 — 그건 '흐려진 것'이 아니라
     '아직 안 해본 것'이고, 둘을 섞으면 처음 켠 사람의 리포트가 전부 빨개진다. */
  const fading = roomView(state, today).zones
    .filter((z) => z.mood !== 'never' && !perZone.has(z.id))
    .map((z) => ({ id: z.id, name: z.name, daysAgo: z.daysAgo ?? 0 }))
    .sort((a, b) => b.daysAgo - a.daysAgo)

  const missed = list
    .filter((r) => !lastDone(state, r.id))
    .map((r) => ({
      id: r.id,
      title: r.title,
      zoneName: zoneOf(r.id, state)?.name ?? '',
      minutes: r.minutes,
    }))
    .sort((a, b) => a.minutes - b.minutes)

  const slipping = list
    .map((r) => ({ r, left: daysUntilDue(r, state, today) }))
    .filter((x): x is { r: TidyRoutine; left: number } => x.left !== null && x.left < 0)
    .map(({ r, left }) => ({
      id: r.id,
      title: r.title,
      zoneName: zoneOf(r.id, state)?.name ?? '',
      daysLate: -left,
      everyDays: r.everyDays,
    }))
    /* 절대 일수가 아니라 **주기 대비**로 정렬한다. 30일 지난 연 1회 항목보다
       10일 지난 3일 주기 항목이 실제로는 더 밀린 것이다. */
    .sort((a, b) => b.daysLate / b.everyDays - a.daysLate / a.everyDays)

  /* ── 다음 달에 볼 것 셋 ─────────────────────────────────
     셋을 넘기지 않는다. 열 개를 주면 사람은 하나도 안 한다. */
  const focus: MonthReport['focus'] = []
  const add = (id: string, title: string, why: string) => {
    if (focus.length >= 3 || focus.some((f) => f.id === id)) return
    focus.push({ id, title, why })
  }
  if (missed[0]) add(missed[0].id, missed[0].title, `아직 한 번도 안 해보셨어요. ${missed[0].minutes}분이면 됩니다.`)
  if (slipping[0]) {
    const s = slipping[0]
    add(s.id, s.title, `${s.everyDays}일마다인데 ${s.daysLate}일 지났어요 — 지금 가장 많이 밀린 것입니다.`)
  }
  if (fading[0]) {
    const zoneDue = list.filter((r) => zoneOf(r.id, state)?.id === fading[0].id && isDue(r, state, today))
    const r = [...zoneDue].sort((a, b) => a.minutes - b.minutes)[0]
    if (r) add(r.id, r.title, `${fading[0].name}은 이번 달에 한 번도 안 오셨어요. 여기서 제일 짧은 것입니다.`)
  }
  // 자리가 남으면 밀린 것에서 채운다. 억지로 채우지는 않는다 — 없으면 없는 대로 둔다.
  for (const s of slipping.slice(1)) add(s.id, s.title, `${s.everyDays}일마다인데 ${s.daysLate}일 지났어요.`)

  return { ym, cleaned, fading, missed, slipping, doneCount, prevDoneCount, activeDays: activeDays.size, focus }
}

/** 화면이 한 번에 받아 가는 묶음 — 엔진(데스크톱)과 브라우저가 같은 걸 만든다 */
export interface CoachBoard {
  steps: AnalysisStep[]
  pick: TodayPick | null
  report: MonthReport
}

export function coachBoard(
  state: TidyState,
  today: string,
  exclude: ReadonlySet<string> = new Set()
): CoachBoard {
  return {
    steps: analyze(state, today, exclude),
    pick: pickToday(state, today, exclude),
    report: monthReport(state, today),
  }
}

/** 콘텐츠 점검용 — 꼼꼼히 볼 곳이 있는 항목 수 (테스트가 쓴다) */
export const routinesWithSpots = () => ROUTINES.filter((r) => r.spots?.length).length
