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
import {
  probePageFile, probeRestore, gatherPageFile, parseRestore, recommendPageFile,
  SYSTEM_FLOOR_BYTES, PAGEFILE_WORTH_BYTES,
} from './system-space.ts'
import type { PageFileFacts } from './system-space.ts'

const GB = 1024 ** 3

/** 실측 PC를 본뜬 값. 필요한 것만 덮어쓴다. */
function pf(over: Partial<PageFileFacts> = {}): PageFileFacts {
  return {
    path: 'C:\\pagefile.sys',
    bytes: 71 * GB,
    usedBytes: 16 * GB,
    peakBytes: 24 * GB,
    automatic: true,
    ramBytes: 32 * GB,
    initialMB: 0,
    maximumMB: 0,
    ...over,
  }
}

test('★ 가상 메모리는 잡아둔 양과 실제 쓰는 양을 갈라서 말한다', () => {
  const f = probePageFile(pf({ bytes: 65 * GB, usedBytes: 16 * GB }))!
  assert.ok(f)
  assert.equal(f.bytes, 65 * GB)
  assert.match(f.explain.what, /65\.0GB/)
  assert.match(f.explain.what, /16\.0GB/, '실제로 쓰는 양을 안 말하면 줄여도 되는지 판단이 안 된다')
  assert.match(f.explain.why, /놀고 있습니다/, '남는 양을 안 알려준다')
})

/* ══════════════════════════════════════════════════════════════
   권장 크기 — 근거는 '최고 사용 기록' 하나다

   ★ "지금 쓰는 양"으로 정하면 안 된다. 지금 16GB를 쓴다고 20GB로 줄였는데
     영상 편집을 시작하는 순간 24GB가 필요해지면 프로그램이 꺼진다.
     실측 PC가 정확히 그랬다: 지금 15.9GB, 최고 24.0GB.
   ══════════════════════════════════════════════════════════════ */

test('★ 권장 크기는 최고 기록의 1.5배 이상이다 — 지금 쓰는 양이 아니라', () => {
  const r = recommendPageFile(pf({ usedBytes: 16 * GB, peakBytes: 24 * GB }))!
  assert.ok(r, '줄일 여지가 있는데 제안하지 않는다')
  assert.ok(r.targetBytes >= 24 * GB * 1.5, `권장 ${r.targetBytes / GB}GB가 최고 기록의 1.5배에 못 미친다`)
  assert.ok(r.targetBytes < 71 * GB, '줄어들지 않는 권장은 권장이 아니다')
  assert.equal(r.freesBytes, 71 * GB - r.targetBytes)
})

test('★ 최고 기록을 못 읽었으면 제안하지 않는다 — 근거 없이 시스템을 바꾸지 않는다', () => {
  assert.equal(recommendPageFile(pf({ peakBytes: 0 })), null)
})

test('★ 조금밖에 못 줄이면 제안하지 않는다 — 재시작까지 시킬 값을 못 한다', () => {
  // 최고 기록이 커서 권장값이 지금 크기에 붙는 경우.
  const f = pf({ bytes: 40 * GB, peakBytes: 26 * GB })
  const r = recommendPageFile(f)
  if (r) assert.ok(r.freesBytes >= PAGEFILE_WORTH_BYTES, '푼돈을 벌자고 재시작을 시킨다')
  const tight = recommendPageFile(pf({ bytes: 40 * GB, peakBytes: 30 * GB }))
  assert.equal(tight, null, '거의 못 줄이는데도 제안한다')
})

test('★ 메모리를 거의 안 쓰는 PC에도 바닥은 남긴다', () => {
  const r = recommendPageFile(pf({ bytes: 60 * GB, peakBytes: 1 * GB }))!
  assert.ok(r.targetBytes >= 4 * GB, '0에 가깝게 줄이면 메모리가 몰릴 때 프로그램이 꺼진다')
})

test('★ 우리가 바꾸되, 되돌리는 명령을 반드시 들고 있다', () => {
  /* types.ts 규약: 되돌리는 명령이 없으면 SystemAction으로 만들지 않는다.
     가상 메모리는 되돌릴 수 있어서 통과한 것이지, 규약이 느슨해진 게 아니다. */
  const f = probePageFile(pf())!
  assert.equal(f.zone, 'LOCKED')
  assert.equal(f.action?.run, 'pagefile-set')
  assert.equal(f.action?.undoRun, 'pagefile-restore', '되돌리는 명령이 없는 실행을 만들었다')
  assert.equal(f.action?.needsAdmin, true)
  assert.match(f.action!.undoDescribe, /알아서 관리|자동 관리|원래 값/, '무엇으로 되돌아가는지 안 말한다')
  // 정식 창도 남긴다 — 직접 정하고 싶은 사람의 길을 막지 않는다.
  assert.equal(f.assist?.command, 'open-virtual-memory')
  assert.match(f.assist!.note, /외장하드/)
})

test('★ 사람이 이미 값을 정해둔 PC는 그 값으로 되돌린다 — 자동 관리로 바꿔놓지 않는다', () => {
  const f = probePageFile(pf({ automatic: false, initialMB: 8192, maximumMB: 16384 }))!
  assert.match(f.action!.undoDescribe, /8192/, '원래 값을 안 적어두면 되돌릴 수가 없다')
  assert.match(f.action!.undoDescribe, /16384/)
})

test('★ 재시작해야 반영된다고 먼저 말한다 — 누르고 나서 알면 늦다', () => {
  /* v0.16.0: "58.86GB를 아낄 수 있어요"라고 해놓고 0바이트였다. 같은 자리다. */
  const f = probePageFile(pf())!
  assert.ok(
    f.explain.ifRemoved.some((s) => /★/.test(s) && /재시작/.test(s)),
    '재시작 전까지 용량이 안 빈다는 말이 눈에 띄는 자리에 없다'
  )
})

test('★ 줄일 게 없으면 실행 버튼을 안 만든다 — 근거 없는 실행은 사고다', () => {
  const f = probePageFile(pf({ bytes: 10 * GB, peakBytes: 8 * GB }))!
  assert.equal(f.action, undefined)
  assert.equal(f.assist?.command, 'open-virtual-memory', '그래도 직접 여는 길은 남아야 한다')
})

test('작으면 아예 안 띄운다', () => {
  assert.equal(probePageFile(pf({ bytes: SYSTEM_FLOOR_BYTES - 1, usedBytes: 0 })), null)
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
