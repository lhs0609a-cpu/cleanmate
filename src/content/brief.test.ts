/**
 * 하루의 흐름 — 여기 있는 동안 저기는 어떻게 되고 있나
 *
 * ★ 실물에서 나온 말 (2026-09-02): "오늘 집을 나서기 전 어떤 정리를 했는지,
 *   오늘 퇴근하면 어떤 정리를 집에 가서 할 건지 알려주고."
 *
 *   들고 다니는 사람에게 '지금 있는 곳'만 보여주는 건 반쪽이다. 아침에 두 개
 *   하고 나온 걸 알면 그날 하루가 다르게 보이고, 퇴근하면 뭘 하게 되는지 알면
 *   오는 길이 달라진다(냉장고 비우기가 떠 있으면 장을 볼지가 달라진다).
 *
 * 여기서 잠그는 것:
 *   ① 지금 못 하는 일을 '오늘 할 것'에 섞지 않는가
 *   ② 여기서도 할 수 있는 걸 "저쪽에서"로 미루지 않는가
 *   ③ 어디서 했는지를 짐작하지 않고 기록에서 읽는가
 *   ④ 한 곳에만 있는 사람에게 없는 이야기를 지어내지 않는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyState,
  markDone,
  placeOfDone,
  planToday,
  setHere,
  setPlace,
  undoDone,
  type TidyState,
} from './tidy.ts'
import { briefLabels, dayBrief } from './daypart.ts'
import { briefDoneHtml, briefTodoHtml } from '../../web/src/tidy-view.ts'

const TODAY = '2026-09-02'

/** 아침에 집에서 둘 하고 나와 사무실에 있는 사람 */
function atOffice(): TidyState {
  let s = setHere(setPlace(emptyState(), 'both'), 'home')
  s = markDone(s, 'bed', TODAY)
  s = markDone(s, 'towels', TODAY)
  return setHere(s, 'office')
}

/* ── ③ 어디서 했는지는 기록에서 읽는다 ───────────────────── */

test('★ 어디서 했는지를 짐작하지 않고 적어둔다', () => {
  /* 항목의 places로 짐작할 수도 있다(수건은 집에만 있으니 집에서 했겠지).
     그런데 '책상 위 비우기'는 양쪽에 다 있다. 짐작으로 "오늘 아침 집에서
     하셨어요"라고 쓰면 그건 지어낸 문장이다. */
  let s = setHere(setPlace(emptyState(), 'both'), 'home')
  s = markDone(s, 'desk-surface', TODAY)
  assert.equal(placeOfDone(s, 'desk-surface', TODAY), 'home')

  s = setHere(s, 'office')
  s = markDone(s, 'drawer', TODAY)
  assert.equal(placeOfDone(s, 'drawer', TODAY), 'office', '사무실에서 한 걸 집으로 적었다')
})

test('되돌리면 어디서 했는지도 같이 지운다', () => {
  const s = markDone(setHere(setPlace(emptyState(), 'both'), 'home'), 'bed', TODAY)
  assert.equal(placeOfDone(undoDone(s, 'bed', TODAY), 'bed', TODAY), null)
})

test('장소를 안 정한 사람의 기록에는 장소가 안 붙는다 — 모르는 걸 아는 척하지 않는다', () => {
  const s = markDone(emptyState(), 'bed', TODAY)
  assert.equal(placeOfDone(s, 'bed', TODAY), null)
  assert.equal(s.at, undefined)
})

/* ── ④ 없는 이야기를 지어내지 않는다 ─────────────────────── */

test('★ 한 곳에만 있는 사람에게는 아무것도 안 준다', () => {
  /* 집 PC와 사무실 PC가 다르면 각자 자기 기록만 갖는다. 그때 "오늘 사무실에서
     한 것"을 보여주려면 지어내는 수밖에 없다. */
  for (const p of ['home', 'office'] as const) {
    assert.equal(dayBrief(setPlace(emptyState(), p), TODAY), null, `${p}: 없는 이야기를 만들었다`)
  }
  assert.equal(dayBrief(emptyState(), TODAY), null, '안 물어본 사람에게도 만들었다')
})

/* ── ① 지금 못 하는 일을 목록에 안 섞는다 ────────────────── */

test('★ 사무실 목록에 수건·배수망이 없다 — 저쪽 이야기는 따로 둔다', () => {
  const s = atOffice()
  const here = planToday(s, TODAY).due.map((r) => r.id)
  for (const id of ['towels', 'sink-strainer', 'shower-drain', 'toothbrush']) {
    assert.ok(!here.includes(id), `사무실 '오늘 할 것'에 ${id}가 섞였다`)
  }
  // 그런데 저쪽 이야기에는 있어야 한다 — 안 보여주는 게 아니라 자리를 나눈 것이다.
  const b = dayBrief(s, TODAY)!
  assert.ok(b.todoThere.some((x) => x.id === 'sink-strainer'), '퇴근하고 할 것을 안 알려준다')
})

test('저쪽 몫도 하루 몫만큼만 — 열다섯 줄을 미리 보여주지 않는다', () => {
  const b = dayBrief(atOffice(), TODAY)!
  assert.ok(b.todoMinutes <= 15, `저쪽 몫이 ${b.todoMinutes}분이다`)
  assert.ok(b.todoRest >= 0)
  assert.ok(b.todoThere.length > 0 && b.todoThere.length < 10)
})

/* ── ② 여기서도 되는 걸 미루지 않는다 ────────────────────── */

test('★ 사무실에서도 할 수 있는 것은 "퇴근하고"에 넣지 않는다', () => {
  /* '책상 위 비우기'는 사무실에도 있다. 그걸 "퇴근하고 집에서"에 넣으면
     지금 할 수 있는 일을 나중으로 미루라는 말이 된다. */
  const b = dayBrief(atOffice(), TODAY)!
  for (const id of ['desk-surface', 'desk-cables', 'drawer', 'paper', 'bag', 'downloads']) {
    assert.ok(!b.todoThere.some((x) => x.id === id), `여기서도 되는 '${id}'를 저쪽으로 미뤘다`)
  }
})

test('집에 있으면 "사무실에서만 되는 것"이 없다 — 집이 더 넓기 때문이다', () => {
  const s = setHere(atOffice(), 'home')
  assert.deepEqual(dayBrief(s, TODAY)!.todoThere, [], '없는 일을 만들어냈다')
})

/* ── 무엇을 하고 나왔는가 ─────────────────────────────────── */

test('★ 아침에 하고 나온 것을 사무실에서 보여준다', () => {
  const b = dayBrief(atOffice(), TODAY)!
  assert.equal(b.here, 'office')
  assert.equal(b.there, 'home')
  assert.deepEqual(b.doneThere.map((x) => x.id).sort(), ['bed', 'towels'])
})

test('집에 돌아오면 사무실에서 한 것이 보인다', () => {
  let s = markDone(atOffice(), 'desk-surface', TODAY)
  s = setHere(s, 'home')
  const b = dayBrief(s, TODAY)!
  assert.deepEqual(b.doneThere.map((x) => x.id), ['desk-surface'])
})

test('어제 한 것은 오늘 이야기에 안 들어간다', () => {
  let s = setHere(setPlace(emptyState(), 'both'), 'home')
  s = markDone(s, 'bed', '2026-09-01')
  s = setHere(s, 'office')
  assert.deepEqual(dayBrief(s, TODAY)!.doneThere, [])
})

/* ── 언제 이야기로 쓰는가 ─────────────────────────────────── */

test('★ 저녁에 "오늘 사무실에서 하실 것"이라고 쓰지 않는다', () => {
  const atHome = setHere(atOffice(), 'home')
  const b = dayBrief(atHome, TODAY)!
  assert.equal(briefLabels(b, 'morning').todo, '오늘 사무실에서')
  assert.equal(briefLabels(b, 'evening').todo, '내일 사무실에서', '이미 지난 이야기를 오늘로 쓴다')
  assert.equal(briefLabels(b, 'night').todo, '내일 사무실에서')

  const office = briefLabels(dayBrief(atOffice(), TODAY)!, 'day')
  assert.equal(office.done, '오늘 집에서 나서기 전에')
  assert.equal(office.todo, '퇴근하고 집에서')
})

/* ── 화면 ──────────────────────────────────────────────────── */

test('★ 지금 못 하는 것이라고 화면이 분명히 말한다', () => {
  const b = dayBrief(atOffice(), TODAY)!
  const L = briefLabels(b, 'day')
  const html = briefTodoHtml(b, L.todo)
  assert.match(html, /퇴근하고 집에서/)
  assert.match(html, /여기서는 못 하는 것<\/b>이라 목록에 안 넣었어요/, '왜 따로 있는지 안 말한다')
  assert.match(html, /합쳐서 \d+분/)
  assert.doesNotMatch(html, /undefined|NaN/)
  // 경고가 아니다 — 재촉하는 말이 없어야 한다.
  assert.doesNotMatch(html, /밀렸|서둘|빨리|해야 합니다/)
})

test('하고 나온 것은 성취로 쓴다', () => {
  const b = dayBrief(atOffice(), TODAY)!
  const html = briefDoneHtml(b, briefLabels(b, 'day').done)
  assert.match(html, /오늘 집에서 나서기 전에/)
  assert.match(html, /2개 하고 나오셨어요/)
  assert.match(html, /이불 정리/)
  assert.doesNotMatch(html, /undefined|NaN/)
})

test('보여줄 게 없으면 빈 문자열 — 빈 상자를 그리지 않는다', () => {
  const empty = dayBrief(setHere(setPlace(emptyState(), 'both'), 'office'), TODAY)!
  assert.equal(briefDoneHtml(empty, '오늘 집에서'), '', '아무것도 안 했는데 상자를 그린다')
  assert.equal(briefDoneHtml(null, 'x'), '')
  assert.equal(briefTodoHtml(null, 'x'), '')
})
