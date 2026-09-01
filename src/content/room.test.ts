/**
 * 방 지도·달력 — 화면이 사람에게 거짓말하지 않는가
 *
 * ★ 이 파일이 잠그는 것
 *   이 화면은 "내 방이 지금 어떤 상태인가"를 말한다. 그 말이 틀리면 앱 전체가
 *   못 믿을 것이 된다. 그리고 여기서 틀리는 방식은 대체로 둘 중 하나다.
 *
 *     ① 날짜 계산이 틀린다 — 12월/1월 경계, 요일 시작, 미래 칸.
 *        "어제 했는데 안 한 걸로 나온다"가 여기서 나온다.
 *     ② 처음 켠 사람을 밀린 사람처럼 대한다 — 여섯 공간이 전부 어둡고,
 *        점수 0점이 뜬다. 그건 시작하기 전에 지게 만드는 화면이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROUTINES, emptyState, markDone, type TidyState } from './tidy.ts'
import {
  ROOM_ZONES,
  roomView,
  zoneState,
  calendarMonths,
  monthSummary,
  tidyBoard,
  WEEKDAYS,
} from './room.ts'

const st = (done: Record<string, string[]>): TidyState => ({ done })

/* ── 방 지도 ────────────────────────────────────────────────── */

test('★ 처음 켠 사람에게 0점짜리 방을 들이밀지 않는다', () => {
  const r = roomView(emptyState(), '2026-08-28')
  /* ★ 지도에 그리는 칸은 '지금 이 사람 목록에 항목이 있는 칸'뿐이다.
     기기를 하나도 안 켠 사람에게 거실 칸을 그려놓고 "아직 안 해본 곳"이라고
     쓰면, 없는 물건을 안 치웠다고 하는 셈이다. */
  assert.ok(r.zones.length > 0 && r.zones.length <= ROOM_ZONES.length)
  assert.equal(r.untouchedZones, r.zones.length, '전부 안 해본 곳이어야 한다')
  for (const z of r.zones) {
    assert.equal(z.mood, 'never', `${z.id}가 '밀린 곳'으로 그려진다`)
  }
  // 점수는 0이지만, 화면은 untouchedZones를 보고 점수 대신 다른 말을 한다.
  assert.equal(r.score, 0)
  assert.ok(r.suggest, '어디부터 하면 되는지는 알려줘야 한다')
})

test('한 번도 안 한 항목이 같은 공간의 점수를 끌어내리지 않는다', () => {
  /* 컴퓨터 공간엔 항목이 여섯 개다. 안 해본 다섯 개를 0으로 넣어 평균 내면
     하나를 매일 해도 이 공간은 영원히 어둡다 — 그건 사실이 아니라 계산 실수다. */
  const r = zoneState(ROOM_ZONES.find((z) => z.id === 'pc')!, st({ downloads: ['2026-08-28'] }), '2026-08-28')
  assert.equal(r.mood, 'fresh')
  assert.equal(r.freshness, 1)
  assert.equal(r.totalCount, 6)
})

test('공간 점수는 평균을 못 낸 곳을 빼고 낸다 — 안 해본 공간이 전체를 끌지 않는다', () => {
  const view = roomView(st({ bed: ['2026-08-28'] }), '2026-08-28')
  // 침대만 했다. 나머지 공간은 전부 'never'라 평균에서 빠지고 100이 나온다.
  assert.equal(view.score, 100)
  assert.equal(view.untouchedZones, view.zones.length - 1)
})

test('주기를 한참 넘겨도 음수로 내려가지 않는다 — "180% 밀렸어요"는 정보가 아니다', () => {
  const z = zoneState(ROOM_ZONES.find((x) => x.id === 'bed')!, st({ bed: ['2026-01-01'] }), '2026-08-28')
  assert.equal(z.freshness, 0)
  assert.equal(z.mood, 'aging')
  assert.ok(z.daysAgo! > 200)
})

test('제안은 하나만 한다 — 여섯 곳을 동시에 가리키면 아무것도 안 하게 된다', () => {
  const view = roomView(st({ bed: ['2026-01-01'], 'desk-surface': ['2026-01-01'] }), '2026-08-28')
  assert.ok(view.suggest, '가리킬 곳이 있어야 한다')
  // 안 해본 곳이 있으면 그쪽이 먼저다 — 첫 완료의 문턱이 가장 낮다.
  assert.equal(view.suggest!.mood, 'never')
})

test('다 최근에 했으면 아무 데도 가리키지 않는다 — 없는 할 일을 만들지 않는다', () => {
  const done: Record<string, string[]> = {}
  for (const z of ROOM_ZONES) for (const id of z.routineIds) done[id] = ['2026-08-28']
  const view = roomView(st(done), '2026-08-28')
  assert.equal(view.suggest, null)
  assert.equal(view.score, 100)
})

test('마지막으로 손댄 날은 그 공간에서 가장 최근 것이다', () => {
  const z = zoneState(
    ROOM_ZONES.find((x) => x.id === 'desk')!,
    st({ 'desk-surface': ['2026-08-20'], 'desk-cables': ['2026-08-27'] }),
    '2026-08-28'
  )
  assert.equal(z.lastDate, '2026-08-27')
  assert.equal(z.daysAgo, 1)
})

test('내가 하는 항목은 전부 어느 공간엔가 들어 있다 — 지도에서 사라지는 항목이 없다', () => {
  const placed = new Set(ROOM_ZONES.flatMap((z) => z.routineIds))
  for (const r of ROUTINES) {
    /* ★ 맡기는 항목(머리·치과·세탁)은 지도에 없는 게 맞다.
       이 지도는 '집의 구획'이고 몸은 방이 아니다. 침대·책상 옆에 '나' 칸을
       만들어 밝기로 상태를 칠하는 순간, 이 화면은 사람을 평가하는 화면이 된다.
       그 항목들은 아래 '맡길 때가 된 것' 목록에서 날짜로만 말한다. */
    if (r.doer === 'pro') {
      assert.ok(!placed.has(r.id), `맡기는 항목 '${r.title}'이 방 지도에 들어갔다 — 몸을 칠하면 안 된다`)
      continue
    }
    assert.ok(placed.has(r.id), `'${r.title}'(${r.id})이 방 지도 어디에도 없다`)
  }
  // 반대도 본다 — 없어진 항목을 지도가 아직 가리키고 있으면 빈 칸이 생긴다.
  for (const id of placed) {
    assert.ok(ROUTINES.some((r) => r.id === id), `지도가 없는 항목 '${id}'을 가리킨다`)
  }
})

/* ── 달력 ───────────────────────────────────────────────────── */

test('달력 한 달은 항상 7의 배수 칸이다 — 줄이 깨지지 않는다', () => {
  for (const m of calendarMonths(emptyState(), '2026-08-28', 3)) {
    assert.equal(m.cells.length % 7, 0, `${m.label}이 ${m.cells.length}칸이다`)
  }
  assert.equal(WEEKDAYS.length, 7)
  assert.equal(WEEKDAYS[0], '월', '월요일 시작이어야 주중/주말이 붙어 보인다')
})

test('★ 연말·연초를 넘어가도 달이 맞는다 — 직접 빼면 여기서 틀린다', () => {
  const months = calendarMonths(emptyState(), '2026-01-15', 3)
  assert.deepEqual(months.map((m) => m.ym), ['2025-11', '2025-12', '2026-01'])
  assert.equal(months[0].label, '2025년 11월')
})

test('윤년 2월이 29일이다', () => {
  const [feb] = calendarMonths(emptyState(), '2028-02-10', 1)
  const real = feb.cells.filter((c) => c.date).length
  assert.equal(real, 29)
})

test('첫 칸이 그 달 1일의 요일에 맞게 밀린다 (월요일 시작)', () => {
  // 2026-08-01은 토요일 → 앞에 빈 칸 5개(월화수목금)
  const [aug] = calendarMonths(emptyState(), '2026-08-28', 1)
  const lead = aug.cells.findIndex((c) => c.date !== null)
  assert.equal(lead, 5)
  assert.equal(aug.cells[5].date, '2026-08-01')
})

test('오늘 이후 칸은 미래로 표시된다 — 미래를 "안 한 날"로 세지 않는다', () => {
  const [aug] = calendarMonths(emptyState(), '2026-08-28', 1)
  const today = aug.cells.find((c) => c.date === '2026-08-28')!
  assert.equal(today.isToday, true)
  assert.equal(today.isFuture, false)
  assert.equal(aug.cells.find((c) => c.date === '2026-08-29')!.isFuture, true)
  assert.equal(aug.cells.find((c) => c.date === '2026-08-27')!.isFuture, false)
})

test('같은 날 여러 개를 하면 그 칸의 수가 올라간다', () => {
  let s = emptyState()
  s = markDone(s, 'bed', '2026-08-27')
  s = markDone(s, 'desk-surface', '2026-08-27')
  s = markDone(s, 'bag', '2026-08-27')
  const [aug] = calendarMonths(s, '2026-08-28', 1)
  assert.equal(aug.cells.find((c) => c.date === '2026-08-27')!.count, 3)
  assert.equal(aug.activeDays, 1, '하루에 세 개를 해도 "한 날"이다')
  assert.equal(aug.doneCount, 3)
})

/* ── 이번 달 요약 ───────────────────────────────────────────── */

test('이번 달과 지난달을 갈라 센다', () => {
  const s = st({ bed: ['2026-07-30', '2026-08-01', '2026-08-02'], drawer: ['2026-08-02'] })
  const m = monthSummary(s, '2026-08-28')
  assert.equal(m.doneCount, 3)
  assert.equal(m.prevDoneCount, 1)
  assert.equal(m.activeDays, 2, '8/1과 8/2 — 이틀')
  assert.equal(m.top!.id, 'bed')
  assert.equal(m.top!.count, 2)
})

test('1월의 "지난달"은 작년 12월이다', () => {
  const m = monthSummary(st({ bed: ['2025-12-31', '2026-01-02'] }), '2026-01-15')
  assert.equal(m.doneCount, 1)
  assert.equal(m.prevDoneCount, 1)
})

test('이번 달에 처음 해본 항목을 센다', () => {
  const s = st({ bed: ['2026-07-30', '2026-08-05'], fridge: ['2026-08-06'] })
  const m = monthSummary(s, '2026-08-28')
  assert.equal(m.firstTimeCount, 1, '냉장고만 이번 달이 처음이다')
})

test('기록이 없으면 요약이 0으로 조용히 나온다 — 던지지 않는다', () => {
  const m = monthSummary(emptyState(), '2026-08-28')
  assert.equal(m.doneCount, 0)
  assert.equal(m.top, null)
})

test('묶음 하나로 화면이 필요한 걸 다 받는다', () => {
  const b = tidyBoard(st({ bed: ['2026-08-28'] }), '2026-08-28', 3)
  assert.equal(b.calendar.length, 3)
  assert.ok(b.room.zones.length > 0 && b.room.zones.length <= ROOM_ZONES.length)
  assert.equal(b.month.doneCount, 1)
})
