/**
 * 순위 — 행동 순서를 매기되, 안전을 깎아서 매기지 않는다
 *
 * 여기서 지키는 것은 하나다: **모르는 것이 위로 올라가지 않는다.**
 * 순위는 "뭐부터 누르면 되나"에 답하려고 만든 것이지, 물어봐야 할 것을
 * 지워도 되는 것처럼 보이게 하려고 만든 게 아니다. 그 선을 넘으면 순위는
 * 기능이 아니라 사고다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTiers } from './priority.ts'
import type { Classified } from './types.ts'

/** 존B 항목 하나. 경로가 곧 판정 근거라서 경로를 진짜처럼 준다. */
function ambig(path: string, size = 1_000_000): Classified {
  return {
    path,
    size,
    mtime: new Date('2026-01-01'),
    ageDays: 200,
    verdict: {
      zone: 'AMBIG',
      meaning: '무엇인지 더 봐야 하는 파일',
      reason: '규칙 DB에 없는 경로입니다',
      ruleBacked: false,
    },
  } as Classified
}

test('★ 모르는 파일은 2순위로 올라가지 않는다 — 순위가 안전장치를 깎으면 안 된다', () => {
  const { tiers } = buildTiers([], [ambig('D:/뭔가/알수없는파일.xyz')])
  const t2 = tiers.find((t) => t.id === 2)
  const t3 = tiers.find((t) => t.id === 3)
  assert.equal(t2, undefined, '정체를 모르는 파일이 "지워도 됩니다" 쪽에 실렸다')
  assert.equal(t3?.count, 1, '모르는 것은 물어보는 순위로 가야 한다')
  // ownerOf는 모르는 경로에 keep을 기본으로 준다 → 주의 표시가 켜져야 한다.
  assert.equal(t3?.cautionCount, 1, '"두시는 게 안전합니다"로 본 것을 안 센다')
})

test('★ 물어볼 것을 순위에서 지워버리지 않는다 — 숨기는 건 안전이 아니라 선택지 뺏기다', () => {
  /* ownerOf가 모르는 경로에 keep을 주기 때문에, keep을 '안 지움'으로 보내면
     존B가 통째로 목록에서 사라진다. 실측 PC에서 그건 285GB였다. */
  const items = [
    ambig('C:/Users/me/Documents/내가만든/영상.mp4', 5_000),
    ambig('D:/뭔가/알수없는파일.xyz', 3_000),
  ]
  const { tiers, untouched } = buildTiers([], items)
  const t3 = tiers.find((t) => t.id === 3)!
  assert.equal(t3.count, 2, '물어봐야 할 것이 목록에서 사라졌다')
  assert.equal(t3.bytes, 8_000)
  assert.equal(untouched.count, 0, '존C도 아닌 것이 "안 지움"에 들어갔다')
})

test('1순위는 규칙이 확증한 것만 — 존A가 그대로 온다', () => {
  const { tiers } = buildTiers(
    [{ meaning: '임시 파일', size: 300 }, { meaning: '앱 캐시', size: 700 }],
    []
  )
  const t1 = tiers.find((t) => t.id === 1)!
  assert.equal(t1.count, 2)
  assert.equal(t1.bytes, 1000)
  assert.equal(t1.reversible, true, '1순위는 다시 만들어지는 것이라 되돌릴 수 있다고 말해야 한다')
  assert.equal(t1.groups[0].meaning, '앱 캐시', '큰 것부터 보여줘야 한다')
})

test('빈 순위는 아예 안 내보낸다 — 할 일이 없는 칸을 그리지 않는다', () => {
  const { tiers } = buildTiers([{ meaning: '임시 파일', size: 10 }], [])
  assert.deepEqual(tiers.map((t) => t.id), [1], '비어 있는 2·3순위가 딸려 왔다')
})

test('★ 되돌릴 수 없는 순위는 그렇다고 말한다 — 1순위와 같은 문구를 쓰면 안 된다', () => {
  const { tiers } = buildTiers([{ meaning: '임시 파일', size: 10 }], [ambig('D:/x/y.zzz')])
  const t1 = tiers.find((t) => t.id === 1)!
  const t3 = tiers.find((t) => t.id === 3)!
  assert.equal(t1.reversible, true)
  assert.equal(t3.reversible, false, '물어보는 순위를 되돌릴 수 있다고 말하면 거짓말이다')
  assert.notEqual(t1.because, t3.because, '순위가 다른데 근거 문장이 같다')
})

test('존C만 "안 지움"에 들어간다 — 항목이 사라지거나 두 번 세어지지 않는다', () => {
  const { tiers, untouched } = buildTiers(
    [],
    [ambig('C:/Users/me/Documents/내가만든/영상.mp4', 5_000)],
    { bytes: 1_000, count: 3, groups: [{ meaning: '시스템 파일', bytes: 1_000, count: 3 }] }
  )
  const inTiers = tiers.reduce((n, t) => n + t.count, 0)
  assert.equal(inTiers + untouched.count, 1 + 3, '항목이 사라지거나 두 번 세어졌다')
  assert.equal(untouched.bytes, 1_000, '존C 용량이 지키는 쪽에 안 잡혔다')
})

test('★ 존C 한 줄을 파일 하나로 세지 않는다 — 개수가 1로 찍히면 화면이 거짓말한다', () => {
  const { untouched } = buildTiers([], [], {
    bytes: 9_000,
    count: 2_500,
    groups: [{ meaning: '시스템 파일', bytes: 9_000, count: 2_500 }],
  })
  assert.equal(untouched.count, 2_500, '집계로 온 존C를 한 개짜리로 접었다')
  assert.equal(untouched.groups[0].count, 2_500)
})

test('큰 것부터 6줄까지만 — 그 아래는 아무도 안 읽는다', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ meaning: `종류${i}`, size: (i + 1) * 100 }))
  const { tiers } = buildTiers(many, [])
  const t1 = tiers.find((t) => t.id === 1)!
  assert.equal(t1.groups.length, 6, '줄 수를 안 자른다')
  assert.equal(t1.count, 20, '★ 개수는 자르기 전 전체를 세야 한다 — 안 그러면 합계와 목록이 어긋난다')
  assert.equal(t1.bytes, many.reduce((n, m) => n + m.size, 0), '용량도 전체여야 한다')
})
