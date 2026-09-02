/**
 * 여기가 어디인가 — 물어보고 시작하는가
 *
 * ★ 실물에서 나온 말 (2026-09-01): "나는 지금 사무실인데 행주를 빨라고 하면 어떻게해."
 *   맞는 말이었다. 이 앱을 켜는 자리는 둘 중 하나다 — 집 아니면 사무실.
 *   그런데 목록은 **집을 전제**로 만들어져 있어서, 사무실에서 켠 사람에게
 *   수건 갈기·칫솔모·욕실 배수구·싱크대 배수망이 떴다. 사무실엔 그런 게 없다.
 *
 * ★ 그리고 이게 '떠넘긴 판단' 문제의 답이다.
 *   그전까지의 해법은 "마흔 개를 하나씩 켜고 끄세요"였는데, 그건 판단을
 *   마흔 번 떠넘기는 것이다. 한 번 물으면 그 마흔 번이 한 번이 된다.
 *
 * 여기서 잠그는 것:
 *   ① 사무실에서 집 물건이 안 나오는가
 *   ② 안 물어본 사람의 화면이 갑자기 줄지 않는가 (예전부터 쓰던 사람)
 *   ③ 직접 켜고 끈 것을 장소가 덮어쓰지 않는가
 *   ④ 없는 방을 지도에 그려놓고 "안 해본 곳"이라 하지 않는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PLACE_LABEL,
  ROUTINES,
  currentPlace,
  emptyState,
  enabledRoutines,
  isRoutineOn,
  markDone,
  placesOf,
  planToday,
  setHere,
  setPlace,
  setRoutineOn,
} from './tidy.ts'
import { ROOM_ZONES, roomView } from './room.ts'
import { analyze, pickToday } from './coach.ts'
import { hereSwitchHtml, placeAskHtml, placeSettingHtml } from '../../web/src/tidy-view.ts'

const TODAY = '2026-09-01'
const at = (place: 'home' | 'office' | 'both') => setPlace(emptyState(), place)

/** 사무실엔 없는 물건들 — 여기 하나라도 뜨면 그건 틀린 알림이다 */
const HOME_ONLY = ['towels', 'toothbrush', 'shower-drain', 'sink-strainer', 'dish-sponge',
  'fridge', 'bedding', 'bed', 'entrance', 'wardrobe']

/* ── ① 사무실에서 집 물건이 안 나온다 ─────────────────────── */

test('★ 사무실에서 수건·행주·칫솔을 꺼내지 않는다', () => {
  const office = enabledRoutines(at('office')).map((r) => r.id)
  for (const id of HOME_ONLY) {
    const title = ROUTINES.find((r) => r.id === id)!.title
    assert.ok(!office.includes(id), `사무실인데 '${title}'이 떴다`)
  }
  assert.ok(office.length > 5, `사무실 목록이 ${office.length}개뿐이다 — 너무 많이 걷어냈다`)
})

test('사무실에도 실제로 있는 것은 남는다 — 책상·서랍·가방·종이·컴퓨터', () => {
  const office = enabledRoutines(at('office')).map((r) => r.id)
  for (const id of ['desk-surface', 'desk-cables', 'drawer', 'paper', 'bag',
                    'desktop-icons', 'downloads', 'inbox']) {
    assert.ok(office.includes(id), `사무실에도 있는 '${id}'가 빠졌다`)
  }
})

test('집은 사무실보다 넓다 — 사무실 목록은 집 목록의 부분집합이다', () => {
  const home = new Set(enabledRoutines(at('home')).map((r) => r.id))
  for (const r of enabledRoutines(at('office'))) {
    assert.ok(home.has(r.id), `'${r.title}'이 사무실에만 있다 — 집에도 있어야 한다`)
  }
})

test('장소가 안 적힌 항목은 집 것으로 본다 — 기본값이 조용히 새면 안 된다', () => {
  for (const r of ROUTINES) {
    assert.ok(placesOf(r).length > 0, `${r.id}: 있을 수 있는 곳이 없다`)
    assert.ok(placesOf(r).includes('home'), `${r.id}: 집에 없는 항목이 생겼다`)
  }
})

/* ── ② 안 물어본 사람 ──────────────────────────────────────── */

test('★ 아직 안 물어본 사람의 화면은 그대로다', () => {
  /* 예전부터 쓰던 사람이 아무것도 안 했는데 목록이 줄면, 그 사람에게는
     앱이 제멋대로 항목을 지운 것으로 보인다. */
  assert.equal(currentPlace(emptyState()), null, '안 물어봤는데 정해진 걸로 친다')
  assert.deepEqual(
    enabledRoutines(emptyState()).map((r) => r.id),
    enabledRoutines(at('home')).map((r) => r.id),
    '안 물어본 사람의 목록이 집과 다르다'
  )
})

test('들고 다니는 사람은 오늘 어디인지로 갈린다', () => {
  const both = at('both')
  assert.equal(currentPlace(both), 'home', "'둘 다'의 기본은 집이다")

  const office = setHere(both, 'office')
  assert.equal(currentPlace(office), 'office')
  assert.equal(office.place, 'both', '전환했다고 설정 자체가 바뀌면 안 된다')
  assert.ok(!enabledRoutines(office).some((r) => r.id === 'towels'), '사무실인데 수건이 뜬다')
  assert.ok(enabledRoutines(setHere(office, 'home')).some((r) => r.id === 'towels'), '집인데 수건이 없다')
})

test("한 곳으로 정하면 '오늘 어디'는 지워진다 — 안 쓰는 값이 남아 헷갈리지 않게", () => {
  const s = setPlace(setHere(at('both'), 'office'), 'home')
  assert.equal(s.here, undefined)
  assert.equal(currentPlace(s), 'home')
})

/* ── ③ 손수 정한 것이 먼저다 ──────────────────────────────── */

test('★ 장소를 바꿔도 직접 켜고 끈 것은 안 건드린다', () => {
  const towels = ROUTINES.find((r) => r.id === 'towels')!
  // 사무실에 개인 수건을 두는 사람도 있다 — 켜뒀으면 사무실에서도 나와야 한다.
  const on = setRoutineOn(at('office'), 'towels', true)
  assert.equal(isRoutineOn(on, towels), true, '손수 켠 걸 장소가 덮어썼다')

  // 반대도 같다. 집인데 껐으면 집에서도 안 나온다.
  const off = setRoutineOn(at('home'), 'towels', false)
  assert.equal(isRoutineOn(off, towels), false, '손수 끈 걸 장소가 되살렸다')
})

test('켜야만 나오는 항목은 장소와 상관없이 여전히 꺼져 있다', () => {
  for (const place of ['home', 'office'] as const) {
    const on = enabledRoutines(at(place)).map((r) => r.id)
    assert.ok(!on.includes('haircut'), `${place}: 묻지도 않고 머리 이야기를 꺼냈다`)
    assert.ok(!on.includes('robot-bin'), `${place}: 없을 수도 있는 기기를 꺼냈다`)
  }
})

/* ── ④ 없는 방을 그리지 않는다 ────────────────────────────── */

test('★ 사무실 지도에 침대·주방·욕실 칸이 없다', () => {
  const office = roomView(at('office'), TODAY)
  const names = office.zones.map((z) => z.id)
  for (const gone of ['bed', 'kitchen', 'bath', 'entry', 'wardrobe']) {
    assert.ok(!names.includes(gone), `사무실인데 '${gone}' 칸을 그렸다`)
  }
  assert.deepEqual(names, ['desk', 'pc', 'storage'], `사무실 칸이 이상하다: ${names.join(',')}`)
  // 그리는 칸은 전부 셀 게 있어야 한다.
  for (const z of office.zones) assert.ok(z.totalCount > 0, `${z.name}: 빈 칸을 그렸다`)
})

test('집 지도는 사무실보다 넓다', () => {
  const home = roomView(at('home'), TODAY)
  assert.ok(home.zones.length > roomView(at('office'), TODAY).zones.length)
  assert.ok(home.zones.length <= ROOM_ZONES.length)
})

test('기기를 하나도 안 켠 사람에게 거실 칸을 그리지 않는다', () => {
  /* 거실 칸은 전부 '켜야 나오는' 기기다. 안 켠 사람에게 그려놓고
     "아직 안 해본 곳"이라고 쓰면 없는 물건을 안 치웠다고 하는 셈이다. */
  assert.ok(!roomView(at('home'), TODAY).zones.some((z) => z.id === 'living'))
  const withRobot = setRoutineOn(at('home'), 'robot-bin', true)
  assert.ok(roomView(withRobot, TODAY).zones.some((z) => z.id === 'living'), '켰는데도 칸이 안 생긴다')
})

/* ── 코치도 같은 곳을 본다 ────────────────────────────────── */

test('★ 사무실에서 오늘 한 곳으로 집 물건을 고르지 않는다', () => {
  let s = at('office')
  for (let i = 0; i < 20; i++) {
    const pick = pickToday(s, TODAY)
    if (!pick) break
    assert.ok(!HOME_ONLY.includes(pick.routine.id),
      `사무실인데 '${pick.routine.title}'을 오늘 할 곳으로 골랐다`)
    s = markDone(s, pick.routine.id, TODAY)
  }
})

test('분석이 실제로 그린 칸 수를 말한다', () => {
  const s = at('office')
  const zones = roomView(s, TODAY).zones.length
  const step = analyze(s, TODAY).find((x) => x.key === 'zones')!
  assert.match(step.label, new RegExp(`${zones}곳`), `안 그린 칸까지 셌다: ${step.label}`)
})

/* ── 화면 ──────────────────────────────────────────────────── */

test('★ 안 물어봤으면 목록보다 질문이 먼저다', () => {
  const html = placeAskHtml()
  assert.match(html, /어디에 있나요/)
  for (const p of ['home', 'office', 'both']) assert.match(html, new RegExp(`data-place="${p}"`))
  // 왜 묻는지 한 줄로 말한다 — 이유 없는 질문은 귀찮기만 하다.
  assert.match(html, /여기에 없는 물건은 안 물어볼게요/)
  assert.match(html, /나중에.*바꿀 수 있어요/, '되돌릴 수 있다는 걸 안 알려준다')
})

test('들고 다니는 사람의 전환 자리가 지금 어디인지 밝힌다', () => {
  const html = hereSwitchHtml('office')
  assert.match(html, /data-here="office" class="on"/)
  assert.match(html, /aria-pressed="true"/, '읽어주는 기계에는 어디인지 안 알려준다')
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1, '두 곳이 동시에 켜져 있다')
})

test("'내 방'에서 언제든 바꿀 수 있고, 손수 정한 건 그대로라고 밝힌다", () => {
  const html = placeSettingHtml('office')
  assert.match(html, /data-place="office" class="opt on"|class="opt on" data-place="office"/)
  assert.match(html, /장소를 바꿔도 그대로/, '켜고 끈 게 날아가는지 아닌지를 안 알려준다')
  for (const p of ['home', 'office', 'both']) assert.match(html, new RegExp(`data-place="${p}"`))
})

test('★ 지금 무엇을 보고 있는지 숫자로 밝힌다', () => {
  /* 실물(2026-09-02): "사무실로 바꿔도 내용이 안 바뀌어." 실제로는 바뀌었다
     (21개 → 11개). 화면이 그걸 아무 데서도 말해주지 않았을 뿐이다.
     바뀐 걸 안 보여주면 안 바뀐 것과 같다. */
  const html = placeSettingHtml('office', { here: 'office', shown: 11, total: 41 })
  assert.match(html, /<b>사무실<\/b> 기준으로 보고 있어요/)
  assert.match(html, /전체 41개 중 <b>11개<\/b>/)

  // 아직 안 정한 사람에겐 지어낸 숫자를 안 쓴다.
  assert.doesNotMatch(placeSettingHtml(undefined), /기준으로 보고 있어요/)
})

test('장소 이름이 화면에 쓸 수 있게 있다', () => {
  assert.equal(PLACE_LABEL.home, '집')
  assert.equal(PLACE_LABEL.office, '사무실')
})

test('사무실에서도 하루 몫은 여전히 나온다 — 빈 화면이 되지 않는다', () => {
  const plan = planToday(at('office'), TODAY)
  assert.ok(plan.due.length >= 8, `사무실 할 일이 ${plan.due.length}개뿐이다`)
  assert.ok(plan.enabled > 0)
})
