/**
 * 맡기는 것 — '정리정돈'을 몸·옷·집까지 넓히면서 지켜야 하는 선
 *
 * ★ 이 확장의 위험
 *   서랍이 밀린 것과 머리를 안 자른 것은 무게가 다르다. 파일은 평가받아도
 *   기분이 안 나쁘지만 몸은 다르다. 그래서 이 항목들을 넣으면서 앱이
 *   **참견하는 물건**이 될 수 있는 자리가 새로 생겼다. 여기서 그걸 막는다:
 *
 *     1) 묻기 전엔 안 꺼낸다 — optIn 항목은 켜기 전까지 화면에 없다
 *     2) 날짜만 말한다 — "지저분해 보여요" 같은 상태 평가는 한 줄도 없다
 *     3) 방 지도에 몸을 안 그린다 — 밝기로 사람을 칠하지 않는다
 *     4) 끄면 진짜로 없어진다 — 목록에서도, 업체 제안의 근거에서도
 *     5) 의료는 날짜만 센다 — 무엇을 받을지 판단하지 않는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ROUTINES,
  emptyState,
  enabledRoutines,
  isRoutineOn,
  markDone,
  planToday,
  setRoutineOn,
  type TidyState,
} from './tidy.ts'
import {
  SERVICES,
  OVERDUE_FACTOR,
  PRO_OVERDUE_FACTOR,
  buildRequestSummary,
  servicesByGroup,
  stuckRoutines,
  suggestServices,
} from './referral.ts'

const TODAY = '2026-08-28'
const PRO = ROUTINES.filter((r) => r.doer === 'pro')

/* ── 1) 묻기 전엔 안 꺼낸다 ────────────────────────────────── */

test('★ 켜기 전에는 몸 이야기를 한 줄도 안 꺼낸다', () => {
  const plan = planToday(emptyState(), TODAY)
  const shown = [...plan.due, ...plan.book, ...plan.later].map((r) => r.id)
  for (const r of PRO) {
    assert.ok(!shown.includes(r.id), `'${r.title}'이 묻지도 않고 목록에 떴다`)
  }
  assert.ok(PRO.length >= 5, '맡기는 항목이 하나도 없다 — 확장이 안 붙었다')
  assert.ok(PRO.every((r) => r.optIn), '맡기는 항목 중에 기본으로 켜진 게 있다')
})

test('켜면 그때부터 나오고, 끄면 다시 사라진다', () => {
  const on = setRoutineOn(emptyState(), 'haircut', true)
  assert.ok(isRoutineOn(on, ROUTINES.find((r) => r.id === 'haircut')!))
  assert.ok(planToday(on, TODAY).book.some((r) => r.id === 'haircut'), '켰는데 안 뜬다')

  const off = setRoutineOn(on, 'haircut', false)
  const plan = planToday(off, TODAY)
  assert.ok(![...plan.due, ...plan.book, ...plan.later].some((r) => r.id === 'haircut'), '껐는데 아직 있다')
})

test('★ 껐다고 기록을 지우지 않는다 — 끄기는 되돌릴 수 있어야 한다', () => {
  let s = setRoutineOn(emptyState(), 'haircut', true)
  s = markDone(s, 'haircut', '2026-08-01')
  const off = setRoutineOn(s, 'haircut', false)
  assert.deepEqual(off.done.haircut, ['2026-08-01'], '끄면서 기록까지 날렸다')

  // 다시 켜면 그 기록 위에서 이어진다. 8/1에 잘랐으니 42일 주기로는 아직 때가 아니다.
  const again = planToday(setRoutineOn(off, 'haircut', true), TODAY)
  assert.ok(again.later.some((r) => r.id === 'haircut'), '다시 켰는데 기록이 처음부터가 됐다')
  assert.ok(!again.book.some((r) => r.id === 'haircut'), '아직 때가 아닌데 맡기라고 한다')
})

test('기본으로 켜진 항목도 끌 수 있다 — 우리가 정한 14개가 남의 기준이 되면 안 된다', () => {
  // 냉장고가 없는 집도 있고, 식탁에서 일하는 사람도 있다.
  const s = setRoutineOn(emptyState(), 'fridge', false)
  assert.ok(!enabledRoutines(s).some((r) => r.id === 'fridge'))
  assert.equal(planToday(s, TODAY).enabled, enabledRoutines(s).length, '화면이 셀 숫자와 목록이 어긋난다')
})

/* ── 2) 무엇을 눌러야 하는지가 카드마다 다르다 ───────────── */

test('★ 맡기는 것은 "오늘 할 것"에 섞이지 않는다 — 그 자리에서 못 끝낸다', () => {
  let s = emptyState()
  for (const r of PRO) s = setRoutineOn(s, r.id, true)
  const plan = planToday(s, TODAY)

  assert.ok(plan.book.length > 0, '맡길 것이 하나도 안 잡혔다')
  assert.ok(plan.due.every((r) => r.doer !== 'pro'), "'했어요'를 누를 수 없는 카드가 오늘 할 것에 껴 있다")
  assert.ok(plan.book.every((r) => r.doer === 'pro'), '내가 하는 일이 맡길 것으로 갔다')
})

test('맡길 것은 오래 지난 것부터 — 짧은 것 순은 여기서 의미가 없다', () => {
  let s = emptyState()
  s = setRoutineOn(s, 'haircut', true)
  s = setRoutineOn(s, 'nails', true)
  s = markDone(s, 'nails', '2026-08-20') // 8일 전 (주기 28일 → 아직)
  s = markDone(s, 'haircut', '2026-01-01') // 한참 전
  const book = planToday(s, TODAY).book
  assert.equal(book[0]?.id, 'haircut', '오래 지난 것이 맨 앞이 아니다')
})

/* ── 3) 방 지도에 몸을 안 그린다 ─────────────────────────── */
/* (room.test.ts의 '내가 하는 항목은 전부 어느 공간엔가 들어 있다'가 반대편을 잠근다) */

/* ── 4) 언제 업체를 꺼내는가 ─────────────────────────────── */

test('★ 맡기는 항목은 주기가 지나면 바로, 내가 하는 항목은 세 배가 지나야', () => {
  assert.equal(PRO_OVERDUE_FACTOR, 1)
  assert.equal(OVERDUE_FACTOR, 3)

  // 이발: 42일 주기. 50일 지났으면 1배 넘음 → 신호.
  let hair = setRoutineOn(emptyState(), 'haircut', true)
  hair = markDone(hair, 'haircut', '2026-07-09')
  assert.ok(stuckRoutines(hair, TODAY).some((s) => s.id === 'haircut'), '켜둔 주기가 지났는데 조용하다')

  // 냉장고: 7일 주기. 16일 지난 건 2배라 아직 아니다(잔소리 방지).
  const fridge = markDone(emptyState(), 'fridge', '2026-08-12')
  assert.deepEqual(stuckRoutines(fridge, TODAY), [], '내가 하는 일에 3배 규칙이 안 지켜졌다')
})

test('★ 끈 항목은 업체를 권하는 근거로도 안 쓰인다', () => {
  let s = markDone(emptyState(), 'wardrobe', '2024-01-01')
  s = markDone(s, 'drawer', '2024-01-01', )
  assert.ok(stuckRoutines(s, TODAY).length >= 2, '밀린 건 맞다')

  let off = setRoutineOn(s, 'wardrobe', false)
  off = setRoutineOn(off, 'drawer', false)
  assert.deepEqual(stuckRoutines(off, TODAY), [], '끈 항목을 근거로 영업했다')
})

test('★ 항목 하나가 업종 하나를 그대로 가리킬 때 그게 제일 먼저 온다', () => {
  let s = setRoutineOn(emptyState(), 'haircut', true)
  s = markDone(s, 'haircut', '2026-06-01')
  const out = suggestServices({ stuck: stuckRoutines(s, TODAY) })
  assert.equal(out[0]?.service.id, 'hair', '가장 확실한 근거가 뒤로 밀렸다')
  // 근거는 사용자의 기록에서 나온 날짜뿐이어야 한다.
  assert.match(out[0].reason, /머리 자르기/)
  assert.match(out[0].reason, /\d+일/)
})

test('★ 제안 문구가 사람을 평가하지 않는다', () => {
  let s = emptyState()
  for (const r of PRO) {
    s = setRoutineOn(s, r.id, true)
    s = markDone(s, r.id, '2020-01-01') // 전부 한참 지나게 만든다
  }
  const out = suggestServices({ stuck: stuckRoutines(s, TODAY) })
  assert.ok(out.length > 0, '전부 지났는데 아무 제안도 없다')

  const banned = /지저분|더럽|게으|방치|창피|부끄|엉망|관리가 안/
  for (const o of out) {
    assert.doesNotMatch(o.reason, banned, `${o.service.id}: 상태를 평가하는 문구가 들어갔다 — "${o.reason}"`)
  }
  for (const r of PRO) {
    const text = r.why + r.steps.join(' ') + (r.tip ?? '')
    assert.doesNotMatch(text, banned, `${r.id}: 콘텐츠가 사람을 평가한다`)
  }
})

/* ── 5) 업종 목록이 성립하는가 ───────────────────────────── */

test('맡기는 항목은 전부 실재하는 업종으로 이어진다 — 눌러도 아무 데도 안 가면 안 된다', () => {
  const ids = new Set(SERVICES.map((s) => s.id))
  for (const r of PRO) {
    assert.ok(r.serviceId, `${r.id}: 이어지는 업종이 없다`)
    assert.ok(ids.has(r.serviceId!), `${r.id}: 없는 업종 '${r.serviceId}'을 가리킨다`)
  }
})

test('업종마다 묶음과 방식이 정해져 있다 — 화면이 예약과 견적을 갈라 물어야 한다', () => {
  const groups = new Set<string>()
  for (const s of SERVICES) {
    assert.ok(['space', 'self', 'wear', 'upkeep', 'out'].includes(s.group), `${s.id}: 묶음이 없다`)
    assert.ok(['visit', 'shop'].includes(s.mode), `${s.id}: 오는지 가는지가 안 정해졌다`)
    groups.add(s.group)
  }
  assert.equal(groups.size, 5, '묶음이 비어 있는 게 있다')
  assert.equal(servicesByGroup().reduce((n, g) => n + g.items.length, 0), SERVICES.length, '묶다가 빠진 업종이 있다')
  // id가 겹치면 제안이 엉뚱한 곳으로 간다.
  assert.equal(new Set(SERVICES.map((s) => s.id)).size, SERVICES.length)
})

test('찾아가는 곳에는 시기를 묻고, 방문에는 지역을 묻는다', () => {
  const shop = buildRequestSummary({ serviceId: 'hair', region: '서울 마포구', when: '평일 저녁' })
  assert.ok(shop.ok)
  assert.match(shop.text, /예약/, '찾아가는 곳인데 견적 요청처럼 보낸다')
  assert.match(shop.text, /찾아갈 지역: 서울 마포구/)
  assert.match(shop.text, /원하는 시기: 평일 저녁/)

  const visit = buildRequestSummary({ serviceId: 'appliance-clean', region: '서울 마포구' })
  assert.ok(visit.ok)
  assert.match(visit.text, /방문 지역: 서울 마포구/)
  assert.ok(!/원하는 시기/.test(visit.text), '안 적은 걸 만들어 넣었다')
})

test('★ 시기 칸으로도 파일 경로가 새지 않는다', () => {
  const r = buildRequestSummary({ serviceId: 'hair', region: '서울', when: 'C:\\Users\\me 정리 후에요' })
  assert.equal(r.ok, false)
  assert.match(r.problem!, /파일 경로/)
})

/* ── 6) 의료는 날짜만 센다 ───────────────────────────────── */

test('★ 건강 항목이 진료를 대신 판단하지 않는다', () => {
  for (const id of ['dental', 'checkup']) {
    const r = ROUTINES.find((x) => x.id === id)!
    const text = r.why + r.steps.join(' ') + (r.tip ?? '')
    // 우리가 정할 수 없는 것을 정해주지 않는다.
    assert.doesNotMatch(text, /진단|치료해|처방|받으셔야 합니다|꼭 받으세요/, `${id}: 진료를 판단한다`)
    // 대신 어디서 확인하는지를 알려준다.
    assert.match(text, /확인/, `${id}: 어디서 확인하는지를 안 알려준다`)
  }
  const dental = SERVICES.find((s) => s.id === 'dental')!
  assert.match(dental.priceNote, /제도|확인/, '보험 적용을 단정한다 — 제도는 바뀐다')
})

test('새 업종도 전부 돈 이야기를 먼저 한다', () => {
  for (const s of SERVICES) {
    assert.ok(s.priceNote.length > 10, `${s.id}: 견적 안내가 없다`)
    assert.ok(s.when.length > 10 && s.whatTheyDo.length > 10, `${s.id}: 설명이 비었다`)
  }
})

test('검증할 수 없는 수치를 새 콘텐츠에도 쓰지 않는다', () => {
  for (const r of PRO) {
    const text = r.why + r.steps.join(' ') + (r.tip ?? '')
    assert.ok(!/\d+\s*%/.test(text), `${r.id}: 근거 없는 퍼센트 수치`)
    assert.ok(!/연구에 따르면|과학적으로 증명/.test(text), `${r.id}: 검증 못 하는 권위 인용`)
  }
  for (const s of SERVICES) {
    const text = s.when + s.whatTheyDo + s.priceNote
    assert.ok(!/\d+\s*%/.test(text), `${s.id}: 근거 없는 퍼센트 수치`)
  }
})

/* ── 되돌아보기: 기존 약속이 안 깨졌는가 ─────────────────── */

test('★ 앱이 대신 할 수 있는 것은 여전히 업체로 안 넘긴다', () => {
  let s: TidyState = markDone(emptyState(), 'desktop-icons', '2026-01-01')
  s = markDone(s, 'downloads', '2026-01-01')
  s = markDone(s, 'photos', '2026-01-01')
  assert.deepEqual(suggestServices({ stuck: stuckRoutines(s, TODAY) }), [], '디지털을 업체로 넘겼다')
})
