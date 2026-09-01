/**
 * 내 방, 지금 얼마나 관리되고 있나 — 생활 정리의 '보는 화면'
 *
 * ★ 왜 목록만으로는 부족한가
 *   생활 정리 탭은 지금까지 "오늘 할 것 N개"라는 **할 일 목록**이었다.
 *   할 일 목록은 사람을 오래 붙잡지 못한다 — 끝내도 다음 항목이 나오고,
 *   끝낸 것은 화면에서 사라지니 **쌓이는 감각이 없다.** 습관 앱이 목록이
 *   아니라 잔디밭·달력·연속 기록을 첫 화면에 두는 이유가 그것이다.
 *
 *   그래서 세 가지를 만든다. 셋 다 tidy.ts의 기록 하나에서 나온다.
 *
 *     ① 방 지도(roomView)     — 침대·책상·서랍·옷장·주방·컴퓨터가 지금 어떤
 *        상태인지. "내 방을 얼마나 관리하고 있나"에 직접 답하는 화면이다.
 *     ② 달력(calendarMonths)  — 어느 날 정리했는지. 점이 쌓이는 걸 본다.
 *     ③ 이번 달 요약(monthSummary) — 셀 수 있는 것만 센다.
 *
 * ── 설계 원칙 (tidy.ts와 같다) ────────────────────────────────
 * 1) **점수로 나무라지 않는다.** 방 상태는 빨강으로 그리지 않고 '빛의 세기'로
 *    그린다 — 최근에 정리한 곳은 또렷하고, 오래된 곳은 흐려질 뿐이다.
 *    "더러움 80%" 같은 문장은 사람을 화면에서 쫓아낸다.
 * 2) **한 번도 안 한 곳과 밀린 곳을 구분한다.** 처음 켠 사람의 방이 통째로
 *    빨갛게 밀려 있으면 그냥 앱을 닫는다. 안 해본 곳은 '아직 안 해본 곳'이다.
 * 3) **지어내지 않는다.** 여기서 세는 건 전부 기록에 실제로 있는 것뿐이다.
 *    "평균 사용자보다 23% 깨끗합니다" 같은 문장은 쓸 근거가 없다.
 * 4) 전부 순수 함수다. 날짜 계산이 틀리면 방 상태가 통째로 거짓말이 된다.
 */

import {
  ROUTINES,
  allRoutines,
  dayNumber,
  isDue,
  lastDone,
  type TidyRoutine,
  type TidyState,
} from './tidy.ts'

/* ────────────────────────────────────────────────────────────
   ① 방 지도

   공간은 '집의 실제 구획'으로 나눈다. 카테고리(디지털·책상·집)로 나누지
   않는 이유: 카테고리는 우리가 콘텐츠를 정리하려고 만든 서랍이고, 사용자가
   보는 건 자기 방이다. "책상 카테고리 3개 중 1개 완료"보다 "책상은 어제
   치웠다"가 훨씬 빨리 읽힌다.

   좌표(col,row)는 4×2 격자 위의 자리다. 실제 평면도가 아니라 **기억하기 쉬운
   배치**다 — 자리가 매번 바뀌면 지도가 아니라 그냥 카드 더미가 된다.
   ──────────────────────────────────────────────────────────── */

export type ZoneId = 'bed' | 'desk' | 'storage' | 'wardrobe' | 'kitchen' | 'pc' | 'bath' | 'living' | 'entry'

export interface RoomZone {
  id: ZoneId
  /** 화면에 쓰는 이름 */
  name: string
  /** 이 공간에서 하는 일들 */
  routineIds: string[]
  /** 4열 격자 위의 자리 */
  col: number
  row: number
  /** 격자에서 차지하는 칸 수 — 컴퓨터·책상처럼 항목이 많은 곳이 넓다 */
  span: number
  /** 이 공간이 무엇인지 한 줄. 지도 위에 그대로 뜬다 */
  hint: string
}

export const ROOM_ZONES: RoomZone[] = [
  { id: 'bed', name: '침대', routineIds: ['bed', 'bedding'], col: 1, row: 1, span: 1, hint: '하루 중 가장 먼저 끝내는 1분' },
  { id: 'desk', name: '책상', routineIds: ['desk-surface', 'desk-cables'], col: 2, row: 1, span: 2, hint: '작업대이지 수납장이 아닙니다' },
  { id: 'wardrobe', name: '옷장', routineIds: ['wardrobe', 'bag'], col: 4, row: 1, span: 1, hint: '계절이 바뀔 때 한 번' },
  { id: 'pc', name: '컴퓨터', routineIds: ['desktop-icons', 'downloads', 'startup-apps', 'photos', 'bookmarks', 'inbox'], col: 1, row: 2, span: 2, hint: '앱이 대신 해드릴 수 있는 곳' },
  { id: 'storage', name: '서랍', routineIds: ['drawer', 'paper'], col: 3, row: 2, span: 1, hint: '한 칸씩만 비웁니다' },
  { id: 'kitchen', name: '주방', routineIds: ['fridge', 'sink-strainer', 'dish-sponge', 'microwave', 'hood-filter', 'water-filter'], col: 4, row: 2, span: 1, hint: '냄새는 거의 배수망에서 시작합니다' },
  /* ── 여기부터 세 곳은 소모품·기기가 사는 자리다 ─────────────
     ★ 왜 늘렸나: 사람들이 몇 년씩 안 하는 일은 '책상 정리'가 아니라
       수건·배수구·필터처럼 **주기가 있는데 아무도 안 알려주는 것들**이다.
       그것들이 지도에 자리가 없으면 화면에서 영영 안 보인다. */
  { id: 'bath', name: '욕실', routineIds: ['towels', 'shower-drain', 'toothbrush', 'washer-filter'], col: 1, row: 3, span: 1, hint: '매일 젖는 곳 — 냄새가 가장 먼저 납니다' },
  { id: 'living', name: '거실·기기', routineIds: ['robot-bin', 'robot-brush', 'vacuum-filter', 'aircon-filter', 'purifier-filter', 'humidifier'], col: 2, row: 3, span: 2, hint: '기기가 청소해주는 대신, 기기를 청소해야 합니다' },
  { id: 'entry', name: '현관', routineIds: ['entrance'], col: 4, row: 3, span: 1, hint: '집에 들어올 때 처음 보는 곳' },
]

/** 공간의 상태 — 색이 아니라 '빛의 세기'로 말한다 */
export type ZoneMood = 'fresh' | 'ok' | 'aging' | 'never'

export const ZONE_MOOD_LABEL: Record<ZoneMood, string> = {
  fresh: '방금 정리했어요',
  ok: '아직 괜찮아요',
  aging: '슬슬 손볼 때',
  never: '아직 안 해본 곳',
}

export interface ZoneState extends RoomZone {
  /**
   * 0~1. 1이면 방금 했고, 0이면 권장 주기의 두 배를 넘겼다(FADE_AFTER).
   * 한 번도 안 한 공간은 0이지만 mood가 'never'라 화면에서 다르게 그린다.
   */
  freshness: number
  mood: ZoneMood
  /** 이 공간에서 마지막으로 뭔가 한 날. 없으면 null */
  lastDate: string | null
  /** 마지막으로 한 지 며칠. 한 번도 안 했으면 null */
  daysAgo: number | null
  /** 지금 손볼 때가 된 항목 수 */
  dueCount: number
  /** 이 공간의 전체 항목 수 */
  totalCount: number
}

/**
 * 흐려지는 데 걸리는 시간 = 권장 주기의 몇 배인가.
 *
 * ★ 이 값이 1이면 안 된다 — 실제로 그렇게 만들었다가 잡았다.
 *   1이면 '이불 정리'(주기 1일)를 **어제** 한 사람의 침대 칸이 오늘 벌써
 *   0%가 되고 "슬슬 손볼 때"가 뜬다. 매일 하는 사람의 방이 매일 어두운 셈이다.
 *   그건 이 화면이 하려는 말의 정반대다.
 *
 *   2를 쓰는 건 임의로 고른 값이 아니라 tidy.ts의 streak()과 같은 규칙이다
 *   ("주기의 2배까지는 이어진 것으로 본다"). 한 화면 안에서 연속 기록은
 *   이어졌다고 하는데 방 지도는 흐려져 있으면, 둘 중 하나가 거짓말이다.
 */
const FADE_AFTER = 2

/**
 * 항목 하나의 신선도. 흐려지기까지 얼마나 남았나.
 *
 * 주기를 넘겨도 음수로 내려가지 않게 0에서 멈춘다 — "180% 밀렸어요"는
 * 정보가 아니라 압박이다. 밀린 정도는 목록의 'N일 지남'이 이미 말한다.
 */
function routineFreshness(r: TidyRoutine, state: TidyState, today: string): number | null {
  const last = lastDone(state, r.id)
  if (!last) return null
  const elapsed = dayNumber(today) - dayNumber(last)
  if (elapsed <= 0) return 1
  return Math.max(0, Math.min(1, 1 - elapsed / (r.everyDays * FADE_AFTER)))
}

/**
 * 공간 하나의 상태.
 *
 * 평균을 쓰되 **한 번도 안 한 항목은 평균에서 뺀다.** 넣으면 항목이 여섯 개인
 * 컴퓨터 공간이 영원히 어두워진다 — 하나를 꾸준히 해도 나머지 다섯이 0을 끌어서.
 * 그건 "잘하고 있다"를 보여주는 화면이 할 일이 아니다.
 */
/**
 * 이 칸에 속하는 항목들.
 *
 * 기본 항목은 지도 쪽(routineIds)에 적혀 있고, 사용자가 만든 항목은 지도를
 * 고칠 수 없으니 항목 쪽(zoneId)에 적힌다. 둘을 여기서 합친다 —
 * 안 합치면 내가 만든 '화분에 물 주기'가 목록에는 있는데 지도에서만 사라진다.
 */
export function zoneRoutines(zone: RoomZone, state: TidyState): TidyRoutine[] {
  const built = zone.routineIds
    .map((id) => ROUTINES.find((r) => r.id === id))
    .filter((r): r is TidyRoutine => !!r)
  const mine = (state.custom ?? []).filter((r) => r.zoneId === zone.id)
  return mine.length ? [...built, ...mine] : built
}

/** 항목이 어느 칸에 사는가. 지도 밖(맡기는 것·자리 안 정한 내 루틴)이면 null. */
export function zoneOfRoutine(state: TidyState, routineId: string): RoomZone | null {
  return ROOM_ZONES.find((z) => zoneRoutines(z, state).some((r) => r.id === routineId)) ?? null
}

export function zoneState(zone: RoomZone, state: TidyState, today: string): ZoneState {
  const routines = zoneRoutines(zone, state)

  const scores: number[] = []
  let lastDay = -Infinity
  let lastDate: string | null = null
  let dueCount = 0

  for (const r of routines) {
    const f = routineFreshness(r, state, today)
    if (f === null) {
      dueCount++ // 아직 안 해본 것도 '지금 하면 되는 것'이다
      continue
    }
    scores.push(f)
    /* ★ '할 때가 됐다'는 신선도가 아니라 tidy.ts의 isDue()와 같은 규칙으로 센다.
       신선도는 두 배 주기에 걸쳐 흐려지는 값이라(FADE_AFTER), 그걸로 세면
       칸의 배지 숫자와 아래 '오늘 할 것' 목록의 개수가 서로 어긋난다. */
    if (isDue(r, state, today)) dueCount++
    const d = lastDone(state, r.id)!
    if (dayNumber(d) > lastDay) {
      lastDay = dayNumber(d)
      lastDate = d
    }
  }

  const freshness = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  const mood: ZoneMood = !scores.length ? 'never' : freshness >= 0.6 ? 'fresh' : freshness >= 0.25 ? 'ok' : 'aging'

  return {
    ...zone,
    freshness,
    mood,
    lastDate,
    daysAgo: lastDate ? dayNumber(today) - dayNumber(lastDate) : null,
    dueCount,
    totalCount: routines.length,
  }
}

export interface RoomView {
  zones: ZoneState[]
  /**
   * 방 전체 상태 0~100.
   *
   * ★ 이건 '점수'가 아니라 '지금 상태'다. 화면에서도 등급·비교·목표로 쓰지
   *   않는다. 한 번도 안 해본 공간은 여기서도 평균에 넣지 않는다 —
   *   처음 켠 사람에게 0점을 보여주는 건 시작하기 전에 지게 만드는 짓이다.
   */
  score: number
  /** 아직 한 번도 손대지 않은 공간 수 — 0에서 시작하는 사람을 다르게 대하려고 */
  untouchedZones: number
  /** 지금 손보면 좋은 공간. 없으면 null(= 지금은 안 해도 된다) */
  suggest: ZoneState | null
}

export function roomView(state: TidyState, today: string): RoomView {
  const zones = ROOM_ZONES.map((z) => zoneState(z, state, today))
  const known = zones.filter((z) => z.mood !== 'never')
  const score = known.length
    ? Math.round((known.reduce((a, z) => a + z.freshness, 0) / known.length) * 100)
    : 0

  /* 제안은 '가장 흐린 곳' 하나만. 여섯 개를 다 밀렸다고 말하면 아무것도
     안 하게 된다 — 하나만 가리키는 편이 실제로 하나를 하게 만든다.
     한 번도 안 한 곳이 있으면 그쪽을 먼저 권한다(첫 완료의 문턱이 가장 낮다). */
  const never = zones.find((z) => z.mood === 'never')
  const dim = [...known].sort((a, b) => a.freshness - b.freshness)[0]
  const suggest = never ?? (dim && dim.freshness < 0.5 ? dim : null)

  return {
    zones,
    score,
    untouchedZones: zones.filter((z) => z.mood === 'never').length,
    suggest: suggest ?? null,
  }
}

/* ────────────────────────────────────────────────────────────
   ② 달력

   왜 잔디밭(1년치 히트맵)이 아니라 달력인가:
   잔디밭은 1년을 한 눈에 보여주지만 **어제가 어디인지 못 찾는다.** 이 제품의
   기록은 아직 며칠~몇 달이고, 사용자가 확인하고 싶은 건 "이번 주에 뭘 했나"다.
   달력은 요일이 세로로 정렬돼 있어 "주말마다 하는구나"가 그냥 보인다.
   ──────────────────────────────────────────────────────────── */

export interface DayCell {
  /** 'YYYY-MM-DD'. 앞뒤 빈 칸은 null */
  date: string | null
  /** 그날 완료한 항목 수 */
  count: number
  isToday: boolean
  /** 오늘 이후 — 흐리게 그린다. 미래를 '안 한 날'로 세지 않는다 */
  isFuture: boolean
}

export interface MonthGrid {
  /** 'YYYY-MM' */
  ym: string
  label: string
  /** 7의 배수. 월요일 시작 */
  cells: DayCell[]
  /** 이 달에 뭔가 한 날 수 */
  activeDays: number
  /** 이 달의 총 완료 횟수 */
  doneCount: number
}

/** 날짜별 완료 횟수 — 여러 함수가 쓰므로 한 번만 만든다 */
function countsByDate(state: TidyState): Map<string, number> {
  const m = new Map<string, number>()
  for (const list of Object.values(state.done)) {
    for (const d of list) m.set(d, (m.get(d) ?? 0) + 1)
  }
  return m
}

const monthLabel = (y: number, m: number) => `${y}년 ${m}월`

/**
 * 월요일 시작인 이유: 한국 달력은 일요일 시작이지만, 이 화면이 보여주려는 건
 * '주간 리듬'이고 그건 주중/주말이 붙어 있어야 읽힌다. 요일 머리글을 여기서
 * 함께 내보내 화면이 순서를 따로 알 필요가 없게 한다.
 */
export const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'] as const

/** 최근 n개월의 달력. 마지막이 이번 달이다. */
export function calendarMonths(state: TidyState, today: string, months = 3): MonthGrid[] {
  const counts = countsByDate(state)
  const [ty, tm] = today.split('-').map(Number)
  const todayNum = dayNumber(today)
  const out: MonthGrid[] = []

  for (let back = months - 1; back >= 0; back--) {
    // Date.UTC가 월 넘김을 알아서 처리한다 — 직접 빼면 12월/1월 경계에서 틀린다.
    const anchor = new Date(Date.UTC(ty, tm - 1 - back, 1))
    const y = anchor.getUTCFullYear()
    const m = anchor.getUTCMonth() + 1
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
    // getUTCDay(): 0=일. 월요일 시작으로 옮긴다.
    const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7

    const cells: DayCell[] = []
    for (let i = 0; i < lead; i++) cells.push({ date: null, count: 0, isToday: false, isFuture: false })
    let activeDays = 0
    let doneCount = 0
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const count = counts.get(iso) ?? 0
      if (count) {
        activeDays++
        doneCount += count
      }
      cells.push({ date: iso, count, isToday: iso === today, isFuture: dayNumber(iso) > todayNum })
    }
    while (cells.length % 7) cells.push({ date: null, count: 0, isToday: false, isFuture: false })

    out.push({ ym: `${y}-${String(m).padStart(2, '0')}`, label: monthLabel(y, m), cells, activeDays, doneCount })
  }
  return out
}

/* ────────────────────────────────────────────────────────────
   ③ 이번 달 요약

   비교는 지난달과만 한다. 남과 비교하지 않고, 목표와도 비교하지 않는다 —
   목표를 우리가 정해주면 그건 남의 기준이고, 못 지키면 그만두는 이유가 된다.
   ──────────────────────────────────────────────────────────── */

export interface MonthSummary {
  ym: string
  label: string
  /** 이번 달 완료 횟수 */
  doneCount: number
  /** 이번 달에 뭔가 한 날 수 */
  activeDays: number
  /** 지난달 완료 횟수 (없으면 0) */
  prevDoneCount: number
  /** 이번 달 가장 많이 한 항목 — 없으면 null */
  top: { id: string; title: string; count: number } | null
  /** 이번 달에 처음 해본 항목 수 */
  firstTimeCount: number
}

export function monthSummary(state: TidyState, today: string): MonthSummary {
  const ym = today.slice(0, 7)
  const [y, m] = ym.split('-').map(Number)
  const prevAnchor = new Date(Date.UTC(y, m - 2, 1))
  const prevYm = `${prevAnchor.getUTCFullYear()}-${String(prevAnchor.getUTCMonth() + 1).padStart(2, '0')}`

  let doneCount = 0
  let prevDoneCount = 0
  let firstTimeCount = 0
  const days = new Set<string>()
  const perRoutine = new Map<string, number>()

  for (const [id, list] of Object.entries(state.done)) {
    let inMonth = 0
    for (const d of list) {
      if (d.startsWith(ym)) {
        inMonth++
        days.add(d)
      } else if (d.startsWith(prevYm)) prevDoneCount++
    }
    if (!inMonth) continue
    doneCount += inMonth
    perRoutine.set(id, inMonth)
    // 이 항목의 첫 기록이 이번 달이면 '이번 달에 처음 해본 것'이다.
    if (list.length && list[0].startsWith(ym)) firstTimeCount++
  }

  let top: MonthSummary['top'] = null
  for (const [id, count] of perRoutine) {
    if (top && count <= top.count) continue
    const r = ROUTINES.find((x) => x.id === id)
    if (r) top = { id, title: r.title, count }
  }

  return { ym, label: monthLabel(y, m), doneCount, activeDays: days.size, prevDoneCount, top, firstTimeCount }
}

/** 화면이 한 번에 받아 가는 묶음 — 엔진(데스크톱)과 브라우저가 같은 걸 만든다 */
export interface TidyBoard {
  room: RoomView
  calendar: MonthGrid[]
  month: MonthSummary
}

export function tidyBoard(state: TidyState, today: string, months = 3): TidyBoard {
  return {
    room: roomView(state, today),
    calendar: calendarMonths(state, today, months),
    month: monthSummary(state, today),
  }
}
