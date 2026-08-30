/**
 * 시각 — 생활 정리를 다른 탭과 가르는 축
 *
 * ★ 여기서 잠그는 것
 *   ① 밤에 재촉하지 않는가. 밤 열한 시에 열었더니 "12개 밀렸어요"가 뜨는 것이
 *      할 일 앱이 사람을 지치게 하는 바로 그 지점이다.
 *   ② 순서를 시간대로 뒤엎지 않는가. 문턱을 낮추는 정렬(짧은 것 순)이 기본이고
 *      시간대는 그 위에 얹는 힌트다.
 *   ③ 콘텐츠가 실제로 그 시간을 말하고 있는가. 없는 시간대를 지어 붙이면
 *      목록 순서가 무작위로 보인다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROUTINES, type TidyRoutine } from './tidy.ts'
import { dayPart, fittingCount, greeting, sortByTime } from './daypart.ts'

const at = (h: number) => new Date(2026, 7, 31, h, 30, 0)

/* ── 시간대 ────────────────────────────────────────────────── */

test('하루를 넷으로 가른다', () => {
  assert.equal(dayPart(at(7)), 'morning')
  assert.equal(dayPart(at(13)), 'day')
  assert.equal(dayPart(at(19)), 'evening')
  assert.equal(dayPart(at(23)), 'night')
  assert.equal(dayPart(at(2)), 'night', '새벽은 밤이다')
})

test('경계에서 하나씩 밀리지 않는다', () => {
  assert.equal(dayPart(new Date(2026, 7, 31, 5, 0)), 'morning')
  assert.equal(dayPart(new Date(2026, 7, 31, 4, 59)), 'night')
  assert.equal(dayPart(new Date(2026, 7, 31, 11, 0)), 'day')
  assert.equal(dayPart(new Date(2026, 7, 31, 17, 0)), 'evening')
  assert.equal(dayPart(new Date(2026, 7, 31, 22, 0)), 'night')
})

/* ── 인사 ──────────────────────────────────────────────────── */

test('★ 밤에는 "안 하셔도 된다"고 말한다', () => {
  const n = greeting('night')
  assert.equal(n.quiet, true, '밤에 목록을 앞세운다')
  assert.match(n.sub, /안 하셔도 됩니다/)
  // 낮 시간대는 조용히 하지 않는다 — 그때는 권해도 된다.
  for (const p of ['morning', 'day', 'evening'] as const) {
    assert.equal(greeting(p).quiet, false, `${p}에 목록을 접었다`)
  }
})

test('★ 어느 시간대에도 재촉하거나 나무라지 않는다', () => {
  const banned = /밀렸|남았어요|서두|빨리|아직도|왜 안|해야 합니다|늦었/
  for (const p of ['morning', 'day', 'evening', 'night'] as const) {
    const g = greeting(p)
    assert.ok(g.hi.length > 3 && g.sub.length > 5, `${p}: 인사가 비었다`)
    assert.doesNotMatch(g.hi + g.sub, banned, `${p}: 재촉하는 문구다 — "${g.hi} / ${g.sub}"`)
  }
})

test('시간대마다 다른 말을 한다 — 같으면 시각을 넣은 의미가 없다', () => {
  const his = (['morning', 'day', 'evening', 'night'] as const).map((p) => greeting(p).hi)
  assert.equal(new Set(his).size, 4, `인사가 겹친다: ${his.join(' / ')}`)
})

/* ── 순서 ──────────────────────────────────────────────────── */

const R = (id: string, minutes: number, bestTime?: 'morning' | 'evening'): TidyRoutine => ({
  id, title: id, category: 'home', everyDays: 1, minutes,
  why: '테스트용 항목입니다. 왜가 없으면 잔소리가 됩니다.', steps: ['하나', '둘', '셋'],
  ...(bestTime ? { bestTime } : {}),
})

test('아침에는 아침 것이 먼저 온다', () => {
  const list = [R('a', 1), R('b', 3, 'morning'), R('c', 5)]
  assert.deepEqual(sortByTime(list, 'morning').map((r) => r.id), ['b', 'a', 'c'])
})

test('★ 같은 시간대끼리는 원래 순서를 지킨다 — 짧은 것 순이 기본 정렬이다', () => {
  /* 시간대는 문턱을 낮추는 정렬 위에 얹는 힌트지 그걸 대체하는 규칙이 아니다.
     여기서 순서가 뒤집히면 목록이 매번 다르게 보여서 못 믿게 된다. */
  const list = [R('a', 1), R('b', 3), R('c', 5, 'evening'), R('d', 20, 'evening')]
  assert.deepEqual(sortByTime(list, 'evening').map((r) => r.id), ['c', 'd', 'a', 'b'])
})

test('낮·밤에는 순서를 안 건드린다 — 없는 시간대를 지어내지 않는다', () => {
  const list = [R('a', 1), R('b', 3, 'morning'), R('c', 5, 'evening')]
  for (const p of ['day', 'night'] as const) {
    assert.deepEqual(sortByTime(list, p).map((r) => r.id), ['a', 'b', 'c'], `${p}에서 순서가 바뀌었다`)
  }
})

test('원본 배열을 바꾸지 않는다', () => {
  const list = [R('a', 1), R('b', 3, 'morning')]
  sortByTime(list, 'morning')
  assert.deepEqual(list.map((r) => r.id), ['a', 'b'])
})

test('지금 하기 좋은 것을 센다', () => {
  const list = [R('a', 1, 'morning'), R('b', 3, 'morning'), R('c', 5, 'evening')]
  assert.equal(fittingCount(list, 'morning'), 2)
  assert.equal(fittingCount(list, 'evening'), 1)
  assert.equal(fittingCount(list, 'day'), 0, '맞출 게 없는 시간대에 개수를 만들어낸다')
})

/* ── 콘텐츠 ────────────────────────────────────────────────── */

test('★ 시간대는 콘텐츠가 이미 말하고 있는 항목에만 붙었다', () => {
  const timed = ROUTINES.filter((r) => r.bestTime)
  assert.ok(timed.length >= 4, `시간대가 붙은 항목이 ${timed.length}개뿐이다 — 이 축이 죽어 있다`)

  for (const r of timed) {
    assert.ok(['morning', 'evening'].includes(r.bestTime!), `${r.id}: 모르는 시간대`)
    /* 붙일 근거는 콘텐츠 안에 있어야 한다. 이불은 "하루 중 가장 먼저",
       책상은 "일을 끝낼 때", 배수망은 "설거지 마지막에"라고 이미 쓰여 있다.
       근거 없이 시간대만 붙이면 목록 순서가 무작위로 보인다. */
    const text = r.why + r.steps.join(' ')
    const hint = r.bestTime === 'morning'
      ? /아침|먼저|하루 중|씻|일어나/
      : /끝낼 때|마지막|저녁|하루를 끝|집에 (와|돌아)/
    assert.match(text, hint, `${r.id}: ${r.bestTime}이라는 근거가 콘텐츠에 없다`)
  }
})

test('시간대가 안 붙은 항목이 대부분이다 — 아무 때나 해도 되는 게 정상이다', () => {
  const timed = ROUTINES.filter((r) => r.bestTime).length
  assert.ok(timed < ROUTINES.length / 3, `${timed}/${ROUTINES.length}개에 시간대가 붙었다 — 너무 많다`)
})
