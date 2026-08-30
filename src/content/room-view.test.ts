/**
 * 생활 정리 화면이 실제로 무엇을 그리는가
 *
 * ★ 왜 이 테스트가 있나
 *   방 지도·달력은 판단(room.ts)과 그리기(web/src/tidy-view.ts)와 색(app.html)이
 *   세 파일에 나뉘어 있다. 판단만 테스트하면 **화면이 통째로 빈 채로 초록불**이
 *   난다 — 실제로 이 저장소에서 그런 일이 있었다(design.test.ts의 머리말 참고).
 *
 *   그래서 그리기 함수를 app.ts에서 떼어내 순수 함수로 만들고, 여기서 진짜
 *   상태를 넣어 나온 HTML을 본다. 확인하는 건 셋이다.
 *     ① 화면에 'undefined'·'NaN'이 새어 나오지 않는가
 *     ② 처음 켠 사람에게 "0%"를 들이밀지 않는가
 *     ③ 사람을 나무라는 말과 색이 안 들어갔는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, habitStats, markDone, type TidyState } from './tidy.ts'
import { tidyBoard, ROOM_ZONES } from './room.ts'
import { roomHtml, calendarHtml, monthHtml, agoWord } from '../../web/src/tidy-view.ts'

const TODAY = '2026-08-28'
const st = (done: Record<string, string[]>): TidyState => ({ done })

/** 화면에 절대 나오면 안 되는 것들 — 하나라도 보이면 사람이 앱을 못 믿는다 */
function assertClean(html: string, where: string) {
  for (const bad of ['undefined', 'NaN', 'null', '[object Object]']) {
    assert.ok(!html.includes(bad), `${where}에 '${bad}'가 새어 나온다`)
  }
}

test('★ 처음 켠 사람에게 0%를 들이밀지 않는다', () => {
  const b = tidyBoard(emptyState(), TODAY)
  const html = roomHtml(b.room)
  assertClean(html, '방 지도')

  assert.ok(!html.includes('room-score'), '기록이 하나도 없는데 상태 숫자를 띄운다')
  assert.match(html, /아직 아무 곳도 기록이 없어요/, '무엇부터 하면 되는지 말하지 않는다')
  // 여섯 칸은 그려야 한다 — 빈 화면이 아니라 '아직 안 해본 방'을 보여주는 것이다.
  assert.equal((html.match(/class="zone /g) ?? []).length, ROOM_ZONES.length)
  assert.equal((html.match(/class="zone never"/g) ?? []).length, ROOM_ZONES.length)
})

test('한 번이라도 하면 상태 숫자가 뜬다', () => {
  const html = roomHtml(tidyBoard(st({ bed: [TODAY] }), TODAY).room)
  assertClean(html, '방 지도')
  assert.match(html, /class="room-score"/, '기록이 있는데 상태 숫자가 없다')
  assert.match(html, /100<span class="u">%<\/span>/, '방금 한 항목이 100%로 안 잡힌다')
  assert.match(html, new RegExp(`${ROOM_ZONES.length}곳 중 <b>1곳</b>`), '몇 곳을 기록 중인지 안 말한다')
})

test('★ 화면이 사람을 나무라지 않는다 — 밀린 방에도 경고 문구가 없다', () => {
  // 여섯 달 전에 딱 한 번 한 상태. 전부 주기를 한참 넘겼다.
  const done: Record<string, string[]> = {}
  for (const z of ROOM_ZONES) for (const id of z.routineIds) done[id] = ['2026-02-01']
  const html = roomHtml(tidyBoard(st(done), TODAY).room)
  assertClean(html, '방 지도')

  for (const bad of ['밀렸', '경고', '위험', '실패', '못 했']) {
    assert.ok(!html.includes(bad), `방 지도에 '${bad}'가 있다 — 이 화면은 잔소리가 아니다`)
  }
  // 가리키는 곳은 하나뿐이어야 한다.
  assert.equal((html.match(/class="room-next/g) ?? []).length, 1)
})

test('다 최근에 했으면 "안 하셔도 됩니다"라고 말한다 — 없는 할 일을 만들지 않는다', () => {
  const done: Record<string, string[]> = {}
  for (const z of ROOM_ZONES) for (const id of z.routineIds) done[id] = [TODAY]
  const html = roomHtml(tidyBoard(st(done), TODAY).room)
  assert.match(html, /오늘은 안 하셔도 됩니다/)
  assert.match(html, /room-next calm/, '평온한 상태를 다른 색으로 안 그린다')
})

test('공간을 누르면 그 공간만 보이게 — data-zone이 붙어 있다', () => {
  const html = roomHtml(tidyBoard(st({ bed: [TODAY] }), TODAY).room)
  for (const z of ROOM_ZONES) {
    assert.ok(html.includes(`data-zone="${z.id}"`), `${z.name} 칸을 누를 수 없다`)
  }
})

test('★ 색 진하기만으로 상태를 말하지 않는다 — 읽어주는 기계에도 문장을 준다', () => {
  const html = roomHtml(tidyBoard(st({ bed: [TODAY] }), TODAY).room)
  // aria-label에 공간 이름과 상태가 함께 들어가야 한다.
  assert.match(html, /aria-label="침대 — 오늘 · 방금 정리했어요/)
})

test('★ 어제 한 매일 항목을 "슬슬 손볼 때"라고 하지 않는다 — 한 번 그랬다', () => {
  /* '이불 정리'는 주기가 1일이다. 신선도를 주기 그대로 나누면 어제 한 사람의
     침대 칸이 오늘 벌써 0%가 되고, 매일 하는 사람의 방이 매일 어둡다.
     그건 이 화면이 하려는 말의 정반대라 room.ts의 FADE_AFTER로 막아뒀다. */
  const html = roomHtml(tidyBoard(st({ bed: ['2026-08-27'] }), TODAY).room)
  assert.match(html, /aria-label="침대 — 어제 · 아직 괜찮아요/, '어제 한 걸 흐리게 그린다')
  assert.ok(!html.includes('침대 — 어제 · 슬슬 손볼 때'), '어제 한 사람에게 손보라고 한다')
})

test('★ 칸의 배지 숫자가 아래 목록과 같은 규칙으로 센다', () => {
  /* 배지는 '지금 할 수 있는 것' 수다. 그게 신선도로 계산되면 아래 "오늘 할 것"
     목록의 개수와 어긋난다 — 화면 안에서 두 숫자가 싸우게 된다. */
  /* 침대 칸엔 '이불 정리'(1일)와 '침구 세탁'(14일) 둘이 있다.
     침구는 오늘 해둬서 안 잡히고, 이불만 잡혀야 한다 — 배지는 1이다. */
  const state = st({ bed: ['2026-08-27'], bedding: [TODAY] })
  const zone = tidyBoard(state, TODAY).room.zones.find((z) => z.id === 'bed')!
  assert.equal(zone.dueCount, 1, '오늘 할 때가 된 항목이 배지에 안 잡힌다')
  // 배지에 1이 떠도 칸은 흐려지지 않는다 — 할 때가 된 것과 방치된 것은 다르다.
  assert.notEqual(zone.mood, 'aging', '할 때가 됐다고 칸까지 흐려지면 안 된다')
  assert.notEqual(zone.mood, 'never', '기록이 있는데 안 해본 곳으로 그린다')
})

test('지난 날짜를 사람 말로 적는다', () => {
  assert.equal(agoWord(null), '')
  assert.equal(agoWord(0), '오늘')
  assert.equal(agoWord(1), '어제')
  assert.equal(agoWord(3), '3일 전')
  assert.equal(agoWord(10), '1주 전')
  assert.equal(agoWord(60), '2개월 전')
  assert.equal(agoWord(500), '한참 전')
})

/* ── 달력 ───────────────────────────────────────────────────── */

test('달력이 세 달을 그리고, 한 날에 여러 개 하면 칸이 진해진다', () => {
  let s = emptyState()
  for (const id of ['bed', 'desk-surface', 'bag', 'drawer']) s = markDone(s, id, '2026-08-27')
  const b = tidyBoard(s, TODAY)
  const html = calendarHtml(b.calendar, habitStats(s, TODAY))
  assertClean(html, '달력')

  assert.equal((html.match(/class="cal"/g) ?? []).length, 3, '세 달이 안 그려진다')
  assert.match(html, /class="cal-d l4"[^>]*aria-label="2026-08-27 4개 완료"/, '네 개 한 날이 가장 진한 칸이 아니다')
  assert.match(html, /class="cal-d today"/, '오늘 칸이 표시되지 않는다')
  // 요일 머리글 7개 × 3달
  assert.equal((html.match(/class="wd"/g) ?? []).length, 21)
})

test('기록이 없는 달은 빈 격자를 스무 칸 늘어놓지 않는다', () => {
  const b = tidyBoard(emptyState(), TODAY)
  const html = calendarHtml(b.calendar, habitStats(emptyState(), TODAY))
  assertClean(html, '달력')
  assert.match(html, /기록 없음/, '기록이 없는 달을 그렇게 말하지 않는다')
  assert.match(html, /아직 기록이 없어요/, '습관 블록이 첫 사용자에게 다른 말을 안 한다')
})

test('미래 칸은 흐리게 — "안 한 날"로 세지 않는다', () => {
  const b = tidyBoard(emptyState(), TODAY)
  const html = calendarHtml(b.calendar, habitStats(emptyState(), TODAY))
  assert.match(html, /class="cal-d future"[^>]*aria-label="2026-08-29"/)
})

/* ── 이번 달 ────────────────────────────────────────────────── */

test('이번 달 요약이 셀 수 있는 것만 말한다', () => {
  const s = st({ bed: ['2026-07-30', '2026-08-01', '2026-08-02'], fridge: ['2026-08-02'] })
  const html = monthHtml(tidyBoard(s, TODAY).month)
  assertClean(html, '이번 달')

  assert.match(html, /2026년 8월/)
  assert.match(html, /3<span class="u">번<\/span>/, '이번 달 횟수가 안 맞는다')
  assert.match(html, /2<span class="u">일<\/span>/, '뭔가 한 날 수가 안 맞는다')
  assert.match(html, /지난달보다 2번 더/, '지난달과의 차이를 안 말한다')
  assert.match(html, /이불 정리/, '가장 자주 한 것이 안 나온다')
})

test('지난달보다 적어도 나무라지 않는다', () => {
  const s = st({ bed: ['2026-07-01', '2026-07-02', '2026-07-03', '2026-08-01'] })
  const html = monthHtml(tidyBoard(s, TODAY).month)
  assert.match(html, /지난달은 3번이었어요/, '사실만 적어야 한다')
  for (const bad of ['줄었', '떨어졌', '부진']) {
    assert.ok(!html.includes(bad), `'${bad}'는 기록이 아니라 평가다`)
  }
})

test('기록이 없어도 이번 달 블록이 조용히 나온다 — 던지지 않는다', () => {
  const html = monthHtml(tidyBoard(emptyState(), TODAY).month)
  assertClean(html, '이번 달')
  assert.match(html, /기록이 쌓이면 여기 나와요/)
})

test('없는 값을 넣어도 빈 문자열을 준다 — 화면이 깨지지 않는다', () => {
  assert.equal(roomHtml(null), '')
  assert.equal(monthHtml(null), '')
  assert.equal(calendarHtml([], null), '')
})

test('★ 항목 이름에 꺾쇠가 있어도 그대로 심지 않는다', () => {
  /* 지금 항목 이름은 우리가 쓴 것뿐이지만, 이 화면은 사용자 기록을 그린다.
     이스케이프가 한 번 빠지면 다음에 이름을 사용자가 정하게 될 때 구멍이 된다. */
  const html = roomHtml({
    zones: [{ ...ROOM_ZONES[0], name: '<img src=x onerror=1>', freshness: 1, mood: 'fresh',
              lastDate: TODAY, daysAgo: 0, dueCount: 0, totalCount: 1 }],
    score: 100, untouchedZones: 0, suggest: null,
  } as any)
  assert.ok(!html.includes('<img src=x'), '이름을 그대로 심는다')
  assert.match(html, /&lt;img src=x/)
})
