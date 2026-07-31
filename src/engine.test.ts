/**
 * 질문 엔진 테스트 — 특히 "답이 어떤 결과로 이어지는가"
 *
 * 여기서 잠그는 건 **사용자 의도가 뒤집히지 않는 것**이다.
 * 이 엔진은 답 하나로 수백 개 파일의 운명을 정한다. 라벨과 결과가 어긋나면
 * "지우지 말라"는 답이 삭제 후보를 만든다 — 삭제 도구에서 이건 사고다.
 *
 * 실제로 U7("옮길래요")이 CANDIDATE로, U6("확인할게요")이 CANDIDATE로
 * 매핑돼 있었다. 첫 선택지를 무조건 CANDIDATE로 박아둔 탓이고,
 * 이 매핑을 검사하는 테스트가 없어서 아무도 몰랐다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildQuestions, cluster } from './engine.ts'
import type { Classified, Unknown } from './types.ts'

/** 특정 미지수를 가진 애매 항목 n개를 만든다. 크기는 질문 문턱을 넘게 크게. */
function ambigItems(unknown: Unknown, n = 20, sizeEach = 300 * 1024 * 1024): Classified[] {
  const now = new Date()
  return Array.from({ length: n }, (_, i) => ({
    path: `C:\\test\\${unknown}\\file-${i}.bin`,
    size: sizeEach,
    mtime: now,
    atime: now,
    ext: '.bin',
    ageDays: 400,
    verdict: {
      zone: 'AMBIG' as const,
      meaning: '테스트 항목',
      reason: '테스트용으로 만든 애매 항목',
      unknown,
      ruleBacked: false,
    },
  }))
}

function questionFor(unknown: Unknown) {
  const qs = buildQuestions(cluster(ambigItems(unknown)))
  const q = qs.find((x) => x.unknown === unknown)
  assert.ok(q, `${unknown} 질문이 만들어져야 한다`)
  return q!
}

test('모든 질문에 보존(KEEP) 선택지가 반드시 있다', () => {
  const unknowns: Unknown[] = [
    'U1_BACKED_UP', 'U2_PROJECT_ACTIVE', 'U3_APP_IN_USE',
    'U4_NEED_LATER', 'U5_FOLDER_INTENT', 'U6_WHICH_ORIGINAL', 'U7_MOVE_OR_DELETE',
  ]
  for (const u of unknowns) {
    const q = questionFor(u)
    assert.ok(
      q.options.some((o) => o.outcome === 'KEEP'),
      `${u}: "그대로 두기" 선택지가 없으면 사용자가 압박당한다`
    )
  }
})

test('★삭제 후보(CANDIDATE)로 가는 선택지는 정리에 동의하는 라벨이어야 한다', () => {
  // 라벨이 "옮길래요"·"확인할게요"인데 결과가 CANDIDATE면 의도가 뒤집힌 것이다.
  const 보존을_뜻하는_말 = ['옮길', '둘래', '보관', '아직 써', '볼 수도', '나중에', '확인할게요']
  const unknowns: Unknown[] = [
    'U1_BACKED_UP', 'U2_PROJECT_ACTIVE', 'U3_APP_IN_USE',
    'U4_NEED_LATER', 'U5_FOLDER_INTENT', 'U6_WHICH_ORIGINAL', 'U7_MOVE_OR_DELETE',
  ]
  for (const u of unknowns) {
    const q = questionFor(u)
    for (const opt of q.options.filter((o) => o.outcome === 'CANDIDATE')) {
      for (const 말 of 보존을_뜻하는_말) {
        assert.ok(
          !opt.label.includes(말),
          `${u}: "${opt.label}"은(는) 보존 의도인데 삭제 후보(CANDIDATE)로 간다`
        )
      }
    }
  }
})

test('★U7 — "지워도 되나요"에 아니라고 하면 절대 삭제 후보가 되지 않는다', () => {
  const q = questionFor('U7_MOVE_OR_DELETE')
  const 거절 = q.options.find((o) => o.label.includes('아니요'))
  assert.ok(거절, '거절 선택지가 있어야 한다')
  assert.equal(거절!.outcome, 'KEEP', '거절이 삭제 후보가 되면 안 된다')
})

test('U6 — "확인할게요"는 삭제 동의가 아니라 하나씩 보기다', () => {
  const q = questionFor('U6_WHICH_ORIGINAL')
  const 확인 = q.options.find((o) => o.label === '확인할게요')
  assert.ok(확인)
  assert.equal(확인!.outcome, 'REVIEW_ONE_BY_ONE')
})

test('같은 선택지가 두 번 나오지 않는다', () => {
  const q = questionFor('U6_WHICH_ORIGINAL')
  const outcomes = q.options.map((o) => o.outcome)
  assert.equal(new Set(outcomes).size, outcomes.length, `중복된 결과: ${outcomes.join(', ')}`)
})

test('없는 기능을 제안하지 않는다 — 이동 위치 선택은 아직 없다', () => {
  // "옮길 위치를 고르실 수 있어요"라고 안내했지만 이동 실행 경로가 없었다.
  const q = questionFor('U7_MOVE_OR_DELETE')
  for (const o of q.options) {
    assert.ok(
      !/옮길 위치|이동 대상으로/.test(o.preview),
      `구현 없는 이동 기능을 약속하고 있다: "${o.preview}"`
    )
  }
})
