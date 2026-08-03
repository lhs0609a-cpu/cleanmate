/**
 * 업체 연결 테스트
 *
 * 여기서 잠그는 건 기능이 아니라 신뢰다:
 *   1) 처음 켠 사람에게 영업하지 않는가
 *   2) 앱이 대신 할 수 있는 걸 업체로 넘기지 않는가 (넘기면 중개상이다)
 *   3) 파일 경로가 밖으로 나가지 않는가
 *   4) 수수료·미제휴 사실을 숨기지 않는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SERVICES,
  OVERDUE_FACTOR,
  stuckRoutines,
  suggestServices,
  buildRequestSummary,
  DISCLOSURE,
} from './referral.ts'
import { emptyState, markDone, type TidyState } from './tidy.ts'

const TODAY = '2026-08-03'

/** id의 마지막 완료일을 직접 만들어 준다 */
const doneAt = (id: string, date: string, base: TidyState = emptyState()) => markDone(base, id, date)

/* ── 언제 꺼내는가 ── */

test('★ 한 번도 안 한 항목은 신호로 치지 않는다 — 처음 켠 사람에게 영업하면 안 된다', () => {
  assert.deepEqual(stuckRoutines(emptyState(), TODAY), [])
})

test('한두 번 건너뛴 건 그냥 바쁜 것이다', () => {
  // 냉장고: 7일 주기. 2주 전 = 2배 → 아직 신호 아님
  const s = doneAt('fridge', '2026-07-20')
  assert.equal(stuckRoutines(s, TODAY).length, 0)
})

test('주기의 3배가 지나야 "혼자 안 되는 것"으로 본다', () => {
  const s = doneAt('fridge', '2026-07-10') // 24일 = 7일 주기의 3배 이상
  const stuck = stuckRoutines(s, TODAY)
  assert.equal(stuck.length, 1)
  assert.equal(stuck[0].id, 'fridge')
  assert.ok(stuck[0].timesOverdue >= OVERDUE_FACTOR)
})

test('★ 앱이 대신 할 수 있는 것은 업체로 넘기지 않는다', () => {
  // 바탕화면·다운로드·사진은 우리가 한다. 이것만 밀렸다고 사람을 부르면 중개상이다.
  let s = doneAt('desktop-icons', '2026-05-01')
  s = doneAt('downloads', '2026-05-01', s)
  s = doneAt('photos', '2026-01-01', s)

  const stuck = stuckRoutines(s, TODAY)
  assert.ok(stuck.length >= 3, '밀린 건 맞다')
  assert.deepEqual(suggestServices({ stuck }), [], '디지털만 밀렸는데 업체를 제안했다')
})

test('집·책상 항목이 여러 개 밀리면 정리수납을 제안한다', () => {
  let s = doneAt('wardrobe', '2025-01-01')
  s = doneAt('drawer', '2026-05-01', s)
  const out = suggestServices({ stuck: stuckRoutines(s, TODAY) })
  assert.ok(out.some((o) => o.service.id === 'organizer'))
  assert.match(out[0].reason, /옷장|서랍/)
})

test('제안할 게 없으면 빈 배열 — 억지로 채우지 않는다', () => {
  assert.deepEqual(suggestServices({ stuck: [] }), [])
})

test('사용자가 직접 요청하면 신호가 없어도 보여준다', () => {
  const out = suggestServices({ stuck: [], askedByUser: true })
  assert.ok(out.length > 0)
  assert.match(out[0].reason, /직접 요청/)
})

test('정리하고도 디스크가 부족하면 PC 점검을 제안한다 — 이건 정리 문제가 아니다', () => {
  const out = suggestServices({ stuck: [], lowDiskAfterCleanup: true })
  assert.deepEqual(out.map((o) => o.service.id), ['pc-help'])
})

test('같은 서비스를 두 번 제안하지 않는다', () => {
  const out = suggestServices({ stuck: [], askedByUser: true, lowDiskAfterCleanup: true })
  const ids = out.map((o) => o.service.id)
  assert.equal(new Set(ids).size, ids.length)
})

/* ── 무엇을 보내는가 ── */

test('★ 파일 경로가 섞이면 요약을 만들지 않는다', () => {
  for (const note of [
    'C:\\Users\\me\\Pictures 정리해주세요',
    '/Users/me/Desktop 좀 봐주세요',
    '가족사진.jpg 가 너무 많아요',
  ]) {
    const r = buildRequestSummary({ serviceId: 'organizer', region: '서울 강남구', note })
    assert.equal(r.ok, false, `경로가 그대로 나갔다: ${note}`)
    assert.match(r.problem!, /파일 경로/)
  }
})

test('요약에는 사용자가 고른 것만 들어간다', () => {
  const r = buildRequestSummary({
    serviceId: 'cleaning',
    region: '부산 해운대구',
    note: '주방이 제일 급해요',
    contact: '010-0000-0000',
  })
  assert.ok(r.ok)
  assert.match(r.text, /집 청소/)
  assert.match(r.text, /부산 해운대구/)
  assert.match(r.text, /주방이 제일 급해요/)
  assert.match(r.text, /파일 목록이나 컴퓨터 정보가 들어 있지 않습니다/)
})

test('연락처를 안 적으면 요약에도 없다 — 없는 걸 만들지 않는다', () => {
  const r = buildRequestSummary({ serviceId: 'cleaning', region: '서울' })
  assert.ok(r.ok)
  assert.ok(!/연락처/.test(r.text))
})

test('지역이나 서비스가 없으면 만들지 않고 이유를 말한다', () => {
  assert.match(buildRequestSummary({ serviceId: 'cleaning', region: '  ' }).problem!, /지역/)
  assert.match(buildRequestSummary({ serviceId: '없는서비스', region: '서울' }).problem!, /골라주세요/)
})

/* ── 정직 고지 ── */

test('★ 수수료를 받는다는 사실과 아직 제휴가 없다는 사실을 둘 다 밝힌다', () => {
  assert.match(DISCLOSURE.fee, /수수료를 받습니다/)
  assert.match(DISCLOSURE.fee, /더 내는 돈은 없습니다/)
  assert.match(DISCLOSURE.status, /아직 제휴를 맺은 업체가 없습니다/)
  assert.match(DISCLOSURE.privacy, /보내지 않습니다/)
  assert.ok(DISCLOSURE.optOut.length > 0, '안 해도 된다는 선택지를 남긴다')
})

test('모든 서비스가 돈 이야기를 먼저 한다 — 나중에 놀라는 게 제일 나쁘다', () => {
  for (const s of SERVICES) {
    assert.ok(s.priceNote.length > 10, `${s.id}: 견적 안내가 없다`)
    assert.ok(s.when.length > 10 && s.whatTheyDo.length > 10)
  }
})
