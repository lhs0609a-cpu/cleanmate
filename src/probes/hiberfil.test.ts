/**
 * hiberfil 프로브 회귀 테스트 — 설명 레이어의 불변식을 잠근다
 *
 * 여기서 잠그는 건 '숫자'가 아니라 '설명이 정직한가'다.
 * 설명이 한 항목이라도 빠지면 사용자는 마음을 못 놓고, 마음을 못 놓으면
 * 이 제품은 존재 이유가 없다. 그래서 설명의 결손을 테스트로 막는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeHiberfil } from './hiberfil.ts'
import type { SystemFacts } from './facts.ts'

const GB = 1024 ** 3

/** 실측 기준값: 이 개발 PC (RAM 31.7GB, 데스크톱, 빠른 시작 켜짐) */
function facts(over: Partial<SystemFacts> = {}): SystemFacts {
  return {
    ramBytes: 34_000_797_696,
    systemDrive: 'C:',
    hiberfilBytes: 13_600_317_440,
    pagefileBytes: 30_064_771_072,
    fastStartupEnabled: true,
    hiberFileSizePercent: 0,
    isLaptop: false,
    laptopSignals: [],
    ...over,
  }
}

test('최대절전이 이미 꺼져 있으면 할 말이 없다', () => {
  // 파일의 '부재'가 곧 기능이 꺼졌다는 증거다. powercfg를 물어볼 필요가 없다.
  assert.equal(probeHiberfil(facts({ hiberfilBytes: 0 })), null)
})

test('실측 확인 — RAM의 40%가 hiberfil 크기다', () => {
  const f = probeHiberfil(facts())!
  assert.equal(f.bytes, 13_600_317_440)
  // 리서치가 주장한 "RAM의 ~40%"가 실측과 맞는지. 틀리면 설명이 거짓말이 된다.
  const pct = (f.bytes / facts().ramBytes) * 100
  assert.ok(pct > 39 && pct < 41, `RAM 대비 ${pct.toFixed(1)}% — 40% 가정이 깨졌다`)
})

test('★빠른 시작을 반드시 알려준다 — 이걸 놓치면 원망을 듣는다', () => {
  // "난 최대절전 안 쓰는데?" 하는 사람도 빠른 시작으로 매일 쓰고 있다.
  // 안 알려주고 끄게 하면 "얘 때문에 부팅이 느려졌다"가 된다.
  const on = probeHiberfil(facts({ fastStartupEnabled: true }))!
  assert.ok(
    on.explain.usedBy.some((u) => u.includes('빠른 시작')),
    '빠른 시작이 켜져 있는데 연관 목록에 없다'
  )
  assert.ok(
    on.explain.ifRemoved.some((u) => u.includes('빠른 시작')),
    '빠른 시작이 꺼진다는 손해를 안 알려주고 있다'
  )

  // 꺼져 있으면 있지도 않은 손해를 지어내면 안 된다. 그것도 거짓말이다.
  const off = probeHiberfil(facts({ fastStartupEnabled: false }))!
  assert.ok(!off.explain.usedBy.some((u) => u.includes('빠른 시작')))
  assert.ok(!off.explain.ifRemoved.some((u) => u.includes('빠른 시작')))
})

test('노트북이면 경고하고, 데스크톱이면 안 겁준다', () => {
  const laptop = probeHiberfil(facts({ isLaptop: true, laptopSignals: ['배터리가 있음'] }))!
  assert.ok(
    laptop.explain.ifRemoved.some((u) => u.includes('★') && u.includes('노트북')),
    '노트북인데 최대절전 경고가 없다'
  )
  // 판정 근거를 보여줘야 한다 — "왜 날 노트북이라 하지?"에 답할 수 있어야
  assert.ok(laptop.explain.ifRemoved.some((u) => u.includes('배터리가 있음')))

  const desktop = probeHiberfil(facts({ isLaptop: false }))!
  assert.ok(
    !desktop.explain.ifRemoved.some((u) => u.includes('★')),
    '데스크톱한테 노트북 경고를 하고 있다 — 근거 없는 공포는 금지'
  )
})

test('설명 불변식 — 7가지 질문에 하나도 빠짐없이 답한다', () => {
  const e = probeHiberfil(facts())!.explain

  assert.ok(e.what.length > 20, '① 이게 뭔가요')
  assert.ok(e.why.length > 20, '② 왜 이렇게 큰가요')
  assert.ok(e.usedBy.length > 0, '③ 뭐가 이걸 쓰나요 — 비면 SAFE 자격이 없다')
  assert.ok(e.ifRemoved.length > 0, '④⑤ 지우면 뭐가 달라지나요')
  assert.ok(e.recoveryNote.length > 20, '⑥ 되돌릴 수 있나요')
  assert.ok(e.ifKept.length > 20, "⑦ 안 지우면요 — '안 지운다'는 선택지를 뺏지 않는다")

  // 양면 정직: 손해를 반드시 하나는 말한다. 좋은 점만 쓰면 광고다.
  assert.ok(
    e.ifRemoved.some((u) => /못 씁니다|느려질|생각해보세요/.test(u)),
    '지우면 생기는 손해를 하나도 안 말하고 있다'
  )

  // 왜 이렇게 큰지 설명할 때 '당신 PC 숫자'를 써야 한다. 일반론은 위키백과다.
  assert.ok(e.why.includes('31.7GB') && e.why.includes('12.7GB'), '실측값이 설명에 안 들어갔다')
})

test('되돌리기 없는 SystemAction은 존재할 수 없다', () => {
  const a = probeHiberfil(facts())!.action!
  assert.ok(a.undo, '되돌리는 명령이 없는 액션은 만들지 않는다')
  assert.ok(a.undoDescribe, '되돌리기가 뭘 하는지 사람 말로 설명해야 한다')
  assert.equal(a.needsAdmin, true, '관리자 권한이 필요하다는 걸 숨기지 않는다')
})

test('크기를 직접 지정한 PC면 그 사실을 알려준다', () => {
  const custom = probeHiberfil(facts({ hiberFileSizePercent: 75 }))!
  assert.ok(custom.explain.why.includes('75%'), '사용자가 직접 바꾼 설정을 무시하면 안 된다')

  const dflt = probeHiberfil(facts({ hiberFileSizePercent: 0 }))!
  assert.ok(!dflt.explain.why.includes('직접 지정'), '기본값인데 지정됐다고 하면 안 된다')
})
