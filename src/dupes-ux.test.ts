/**
 * 같은 파일 화면 — 기다림과 판단을 사용자에게 떠넘기지 않는가
 *
 * ★ 실물에서 나온 지적 둘
 *   1) "같은 파일을 찾는 중…" 한 줄로 몇 분을 버텼다. 몇 %인지도, 얼마나
 *      남았는지도 없었다. 진행 표시가 없을 때 사람이 견디는 건 중앙값 9초다.
 *   2) '합치기'와 '지우기' 버튼이 나란히 있고, 어느 쪽이 맞는지는 말해주지
 *      않았다. 심지어 지우기 쪽 숫자가 더 커 보인다(49.6GB vs 13.1GB) —
 *      그래서 더 나쁜 선택이 더 좋아 보였다. 엔진은 이미 답을 알고 있었는데도.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

test('오래 걸리는 두 단계가 각각 진행 상황을 낸다', () => {
  const eng = read('src/engine-cli.ts')
  // 훑기(빠름)와 안을 펼쳐 확인(느림)은 성격이 달라 한 막대로 합치면 멈춘 것처럼 보인다.
  assert.match(eng, /t: 'dupes-scan', phase: 'scan'/, '폴더 훑는 동안 아무 말이 없다')
  assert.match(eng, /t: 'dupes-hash'/, '해시 뜨는 동안 아무 말이 없다')
  assert.match(eng, /etaSec/, '남은 시간을 안 보낸다')
})

test('남은 시간을 지어내지 않는다', () => {
  const eng = read('src/engine-cli.ts')
  // 여태의 속도로만 잰다 — 근거 없는 숫자를 띄우면 그다음부터 다 안 믿는다.
  assert.match(eng, /done > 0 && elapsed > 1 \? Math\.round/, '근거 없이 남은 시간을 만든다')
})

test('해시 단계가 진행 콜백을 받는다', () => {
  const d = read('src/dupes.ts')
  assert.match(d, /onHashProgress/, '가장 오래 걸리는 자리가 조용하다')
  assert.match(d, /opts\.onHashProgress\?\.\(\+\+done, total/, '진행 수를 안 올린다')
})

test('화면이 진행률·남은 시간을 그린다', () => {
  const app = read('web/src/app.ts')
  assert.match(app, /dupes-scan' \|\| p\.t === 'dupes-hash'/, '진행 상황을 안 받는다')
  assert.match(app, /안을 펼쳐 확인하는 중/, '느린 단계를 이름으로 안 알려준다')
  assert.match(app, /남은 시간 약/, '남은 시간을 안 그린다')
  // 모를 때는 모른다고 말한다 — 빈칸으로 두면 사용자는 멈춘 줄 안다.
  assert.match(app, /남은 시간은 조금 더 봐야 알 수 있어요/, '모를 때 아무 말도 안 한다')
})

test('★ 무엇을 눌러야 하는지 화면이 말해준다', () => {
  const app = read('web/src/app.ts')
  assert.match(app, /합치기를 권합니다/, '버튼 두 개를 놓고 판단을 떠넘긴다')
  // 왜 합치기가 나은지가 핵심이다 — 지우면 프로그램이 다시 받는다.
  assert.match(app, /다시 받습니다/, '왜 합치기가 나은지 말하지 않는다')
  // 못 합치는 경우(드라이브가 다름)에는 다른 답을 준다.
  assert.match(app, /드라이브가 달라 합칠 수 없어요/, '못 합칠 때의 답이 없다')
})

test('위험한 쪽을 기본으로 강조하지 않는다', () => {
  const app = read('web/src/app.ts')
  // 합칠 수 있는 게 있으면 지우기는 빨갛게 강조하지 않는다 — 그건 권하는 모양새다.
  assert.match(
    app,
    /goBtn\.classList\.toggle\('danger', dupPicked\.size > 0 && !recommendMerge\)/,
    '합치기가 답인데도 지우기 버튼을 강조한다'
  )
})
