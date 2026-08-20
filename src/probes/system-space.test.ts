/**
 * 윈도우가 잡아둔 공간(가상 메모리·시스템 복원) 테스트
 *
 * ★ 여기서 잠그는 건 **모르는 걸 아는 척하지 않는 것**이다.
 *   시스템 복원 크기는 권한이 없으면 못 읽는데, 그걸 "0GB"로 보고하면
 *   "없다"는 뜻이 된다. 실제로는 100GB가 잡혀 있을 수도 있다 —
 *   "없다"와 "못 봤다"는 완전히 다른 말이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probePageFile, probeRestore, gatherPageFile, parseRestore, SYSTEM_FLOOR_BYTES } from './system-space.ts'

const GB = 1024 ** 3

test('★ 가상 메모리는 잡아둔 양과 실제 쓰는 양을 갈라서 말한다', () => {
  const f = probePageFile({ path: 'C:\\pagefile.sys', bytes: 65 * GB, usedBytes: 16 * GB })!
  assert.ok(f)
  assert.equal(f.bytes, 65 * GB)
  assert.match(f.explain.what, /65\.0GB/)
  assert.match(f.explain.what, /16\.0GB/, '실제로 쓰는 양을 안 말하면 줄여도 되는지 판단이 안 된다')
  assert.match(f.explain.why, /놀고 있습니다/, '남는 양을 안 알려준다')
})

test('★ 우리가 직접 바꾸지 않는다 — 정식 창으로 넘긴다', () => {
  const f = probePageFile({ path: 'C:\\pagefile.sys', bytes: 65 * GB, usedBytes: 16 * GB })!
  assert.equal(f.zone, 'LOCKED')
  assert.equal(f.action, undefined, '가상 메모리를 우리가 바꾸는 통로가 생겼다')
  assert.equal(f.assist?.command, 'open-virtual-memory')
  // 외장하드 경고는 반드시 남아야 한다 — 옮겼다가 안 꽂으면 부팅이 이상해진다.
  assert.match(f.assist!.note, /외장하드/)
})

test('작으면 아예 안 띄운다', () => {
  assert.equal(probePageFile({ path: 'C:\\pagefile.sys', bytes: SYSTEM_FLOOR_BYTES - 1, usedBytes: 0 }), null)
})

test('★ 시스템 복원을 못 쟀으면 "0"이 아니라 "확인 필요"로 낸다', () => {
  const f = probeRestore({ measured: false, usedBytes: 0, allocatedBytes: 0, maxBytes: 0 })!
  assert.ok(f, '못 쟀다고 항목 자체를 빼면 사용자는 있는 줄도 모른다')
  assert.equal(f.bytes, 0, '지어낸 숫자를 넣으면 안 된다')
  assert.match(f.explain.what, /관리자 권한이 있어야/, '왜 숫자가 없는지 안 밝힌다')
  assert.equal(f.assist?.command, 'open-system-protection')
})

test('★ 못 쟀으면 "못 쟀다"로 끝내지 않는다 — 권한을 받아 재는 통로를 낸다', () => {
  /* 여태 화면엔 "권한이 있어야 볼 수 있어서 저희가 못 쟀습니다"만 떠 있었다.
     숨은 공간 중 가장 큰 항목이고 100GB가 잡혀 있을 수도 있는데, **물어보지도
     않고** 모른다고 한 것이다. 권한이 필요하면 권한을 물어보면 된다. */
  const f = probeRestore({ measured: false, usedBytes: 0, allocatedBytes: 0, maxBytes: 0 })!
  assert.equal(f.measure?.run, 'restore-measure', '권한을 받아 재는 통로가 없다')
  assert.equal(f.measure?.needsAdmin, true, '권한이 필요하다는 사실을 안 말한다')
  assert.match(f.measure!.note, /바꾸지 않아요|읽기만/, '무엇을 하는 통로인지 안 밝힌다 — 겁나서 못 누른다')
  assert.match(f.explain.what, /재서 알려드려요|누르시면/, '재줄 수 있다는 걸 본문이 안 말한다')
})

test('★ 다 잰 항목에는 재기 버튼을 안 낸다 — 할 일이 없는 버튼은 잡음이다', () => {
  const f = probeRestore({ measured: true, usedBytes: 40 * GB, allocatedBytes: 45 * GB, maxBytes: 155 * GB })!
  assert.equal(f.measure, undefined)
})

test('★ 재기는 읽기만 한다 — 복원 지점을 지우는 통로가 생기면 안 된다', () => {
  /* 지운 복원 지점은 못 되살린다(recovery: 'none'). 그래서 우리가 안 지운다.
     '재기'가 언젠가 '정리하기'로 자라면 그 원칙이 조용히 깨진다. */
  const f = probeRestore({ measured: false, usedBytes: 0, allocatedBytes: 0, maxBytes: 0 })!
  assert.equal(f.action, undefined, '시스템 복원을 우리가 바꾸는 통로가 생겼다')
  assert.equal(f.explain.recovery, 'none')
})

test('★ 한도를 안 걸었으면 16777216GB라고 쓰지 않는다', () => {
  /* 윈도우는 한도가 없으면 UINT64 최대값을 그대로 준다(≈16EB).
     그걸 숫자로 옮겨 적으면 화면이 고장난 것처럼 보인다. */
  const f = probeRestore({
    measured: true, usedBytes: 40 * GB, allocatedBytes: 45 * GB, maxBytes: 18446744073709551615,
  })!
  assert.doesNotMatch(f.explain.what, /1677|1844/, '무제한을 숫자로 옮겨 적었다')
  assert.match(f.explain.what, /한도를 따로 안 걸어두셔서/, '한도가 없다는 사실을 안 말한다')
})

test('파워셸이 뱉은 것을 사실로 옮긴다 — 빈 값은 "못 봤다"로 남는다', () => {
  assert.equal(parseRestore('').measured, false)
  assert.equal(parseRestore('{}').measured, false, '빈 결과를 0으로 보고하면 "없다"는 뜻이 된다')
  assert.equal(parseRestore('깨진 출력').measured, false, '파싱 실패가 숫자로 둔갑하면 안 된다')
  const ok = parseRestore('{"used":123,"alloc":456,"max":789}')
  assert.deepEqual(ok, { measured: true, usedBytes: 123, allocatedBytes: 456, maxBytes: 789 })
})

test('잰 값이 있으면 지금 쓰는 양과 한도를 같이 말한다', () => {
  const f = probeRestore({ measured: true, usedBytes: 40 * GB, allocatedBytes: 45 * GB, maxBytes: 155 * GB })!
  assert.equal(f.bytes, 45 * GB)
  assert.match(f.explain.what, /40\.0GB/)
  assert.match(f.explain.what, /155\.0GB/, '한도를 안 말하면 줄일 수 있다는 걸 모른다')
})

test('★ 복원 지점은 되살릴 수 없다고 분명히 쓴다', () => {
  const f = probeRestore({ measured: true, usedBytes: 40 * GB, allocatedBytes: 45 * GB, maxBytes: 155 * GB })!
  assert.equal(f.explain.recovery, 'none')
  assert.ok(f.explain.ifRemoved.some((s) => /★/.test(s)), '되돌릴 수 없다는 표시가 없다')
})

test('잰 값이 작으면 안 띄운다 — 화면을 아끼는 게 사용자를 아끼는 것', () => {
  assert.equal(
    probeRestore({ measured: true, usedBytes: 1 * GB, allocatedBytes: 1 * GB, maxBytes: 20 * GB }),
    null
  )
})

test('이 PC에서도 가상 메모리를 실제로 읽는다 — 권한 없이 되는지 확인', async () => {
  const f = await gatherPageFile()
  // 가상 메모리를 꺼둔 PC도 있으므로 null이어도 통과. 다만 값이 있으면 형태가 맞아야 한다.
  if (f) {
    assert.ok(f.bytes > 0)
    assert.match(f.path, /pagefile\.sys$/i)
  }
})
