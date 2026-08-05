/**
 * 질문 설명 테스트
 *
 * 겨냥하는 것: "안전합니다"라고 단정하지 않는가.
 * 질문으로 넘어온 항목은 정의상 규칙이 확증 못 한 것들이다.
 * 여기서 안전을 단정하면 제품 전체의 전제가 무너진다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UNKNOWN_EXPLAIN } from './unknowns.ts'
import type { Unknown } from '../types.ts'

const ALL: Unknown[] = [
  'U1_BACKED_UP', 'U2_PROJECT_ACTIVE', 'U3_APP_IN_USE',
  'U4_NEED_LATER', 'U5_FOLDER_INTENT', 'U6_WHICH_ORIGINAL', 'U7_MOVE_OR_DELETE',
]

test('모든 질문에 설명이 있다 — 빠진 질문이 있으면 그 화면만 벌거벗는다', () => {
  for (const u of ALL) assert.ok(UNKNOWN_EXPLAIN[u], `${u} 설명이 없다`)
})

test('★ 손해를 반드시 쓴다 — 좋은 점만 쓰면 광고다', () => {
  for (const u of ALL) {
    const e = UNKNOWN_EXPLAIN[u]
    assert.ok(e.ifRemoved.length > 0, `${u}: 지우면 뭐가 달라지는지가 없다`)
    assert.ok(e.what.length > 20 && e.origin.length > 20, `${u}: 정체·출처 설명이 부실하다`)
  }
})

test('★ 개인 자료가 걸린 질문은 "되살릴 수 없다"를 분명히 말한다', () => {
  for (const u of ['U1_BACKED_UP', 'U4_NEED_LATER', 'U7_MOVE_OR_DELETE'] as Unknown[]) {
    const text = UNKNOWN_EXPLAIN[u].ifRemoved.join(' ')
    assert.match(text, /되살릴|영영|사라/, `${u}: 손실 가능성을 안 말한다`)
  }
})

test('★ 안전을 단정하지 않는다 — 질문으로 온 건 확증 못 한 것들이다', () => {
  for (const u of ALL) {
    const s = UNKNOWN_EXPLAIN[u].safety
    assert.ok(!/무조건 안전|100% 안전|완전히 안전/.test(s), `${u}: 안전을 단정했다`)
  }
})

test('되돌리기 안내가 모든 질문에 있다', () => {
  for (const u of ALL) {
    assert.match(UNKNOWN_EXPLAIN[u].recovery, /30일/, `${u}: 격리 안내가 없다`)
  }
})

test('안 지운다는 선택지를 뺏지 않는다', () => {
  for (const u of ALL) {
    assert.match(UNKNOWN_EXPLAIN[u].ifKept, /문제 없습니다/, `${u}: 그냥 둬도 된다는 말이 없다`)
  }
})
