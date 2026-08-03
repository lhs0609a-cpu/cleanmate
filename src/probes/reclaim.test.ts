/**
 * 휴지통·업데이트 캐시 프로브 테스트
 *
 * 겨냥하는 것:
 *   1) 되돌릴 수 없는 항목이 '되돌릴 수 있다'고 말하지 않는가 (신뢰의 핵심)
 *   2) 우리가 지울 수 없는 것에 삭제 버튼을 만들지 않는가
 *   3) 작은 항목으로 화면을 채우지 않는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  probeRecycleBin,
  probeUpdateCache,
  REPORT_FLOOR_BYTES,
  type ReclaimFacts,
} from './reclaim.ts'

const GB = 1024 ** 3
const facts = (over: Partial<ReclaimFacts> = {}): ReclaimFacts => ({
  systemDrive: 'C:',
  recycleBytes: 0,
  recycleCount: 0,
  updateCacheBytes: 0,
  ...over,
})

test('작은 항목은 아예 보고하지 않는다', () => {
  const small = REPORT_FLOOR_BYTES - 1
  assert.equal(probeRecycleBin(facts({ recycleBytes: small, recycleCount: 3 })), null)
  assert.equal(probeUpdateCache(facts({ updateCacheBytes: small })), null)
})

test('휴지통 — 크기·개수를 설명에 그대로 쓴다', () => {
  const f = probeRecycleBin(facts({ recycleBytes: 3 * GB, recycleCount: 1240 }))!
  assert.equal(f.bytes, 3 * GB)
  assert.match(f.explain.what, /1,240개/)
  assert.match(f.explain.what, /3\.0GB/)
})

test('★ 휴지통은 되돌릴 수 없다고 말한다 — 격리로 못 가져온다', () => {
  const f = probeRecycleBin(facts({ recycleBytes: 2 * GB, recycleCount: 10 }))!
  assert.equal(f.explain.recovery, 'none')
  assert.match(f.explain.recoveryNote, /비우면 끝/)
  assert.ok(
    f.explain.ifRemoved.some((s) => s.includes('되돌릴 수 없습니다')),
    '손해를 먼저 말해야 한다(양면 정직)'
  )
  assert.equal(f.assist?.irreversible, true)
})

test('휴지통은 존 B — 사용자만 아는 것이라 자동 처리 대상이 아니다', () => {
  const f = probeRecycleBin(facts({ recycleBytes: 2 * GB, recycleCount: 10 }))!
  assert.equal(f.zone, 'AMBIG')
})

test('★ 우리가 지울 수 없는 것에 삭제 명령을 만들지 않는다', () => {
  const rb = probeRecycleBin(facts({ recycleBytes: 2 * GB, recycleCount: 10 }))!
  const uc = probeUpdateCache(facts({ updateCacheBytes: 4 * GB }))!
  // SystemAction은 undo를 요구한다(types.ts). 둘 다 undo가 없으므로 있으면 안 된다.
  assert.equal(rb.action, undefined)
  assert.equal(uc.action, undefined)
  // 대신 정식 도구만 연결한다. 임의 명령 문자열은 받지 않는다.
  assert.equal(rb.assist?.command, 'empty-recycle-bin')
  assert.equal(uc.assist?.command, 'open-cleanmgr')
})

test('업데이트 캐시는 존 C — 직접 건드리지 않고 정식 도구로 넘긴다', () => {
  const f = probeUpdateCache(facts({ updateCacheBytes: 6 * GB }))!
  assert.equal(f.zone, 'LOCKED')
  assert.equal(f.assist?.irreversible, false)
  assert.match(f.explain.what, /SoftwareDistribution/)
})

test('설명 7문답이 비어 있지 않다 — usedBy 없는 규칙은 만들지 않는다', () => {
  for (const f of [
    probeRecycleBin(facts({ recycleBytes: 2 * GB, recycleCount: 5 }))!,
    probeUpdateCache(facts({ updateCacheBytes: 2 * GB }))!,
  ]) {
    const e = f.explain
    assert.ok(e.what && e.why && e.recoveryNote && e.ifKept)
    assert.ok(e.usedBy.length > 0, '뭐가 이걸 쓰는지 모르면 뭐가 깨지는지도 모른다')
    assert.ok(e.ifRemoved.length > 0)
  }
})

test('안 지워도 된다는 선택지를 뺏지 않는다', () => {
  const f = probeRecycleBin(facts({ recycleBytes: 2 * GB, recycleCount: 5 }))!
  assert.match(f.explain.ifKept, /아무 문제 없습니다/)
})
