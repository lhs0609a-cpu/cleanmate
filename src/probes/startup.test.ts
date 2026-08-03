/**
 * 시작프로그램 판정 테스트
 *
 * 겨냥하는 것:
 *   1) 모르는 항목을 "꺼도 된다"고 넘겨짚지 않는가 (이 프로브의 존재 이유)
 *   2) 끄면 손해 보는 것(보안·동기화)을 제안하지 않는가
 *   3) 회사 이름으로 성격을 판단하지 않는가 (실측에서 잡은 오분류)
 *   4) 끄기/켜기 값이 작업관리자와 같은 형식인가 — 다르면 되돌리기가 깨진다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgeStartup, approvalBytes, type StartupEntry } from './startup.ts'

const entry = (name: string, over: Partial<StartupEntry> = {}): StartupEntry => ({
  id: `hkcu-run|${name}`,
  name,
  command: '',
  source: 'hkcu-run',
  enabled: true,
  canToggle: true,
  ...over,
})

test('★ 모르는 항목은 끄자고 제안하지 않는다', () => {
  const v = judgeStartup(entry('GVF-Node'))
  assert.equal(v.suggestible, false)
  assert.equal(v.zone, 'AMBIG')
  assert.match(v.reason, /모르겠어요/)
})

test('보안 프로그램은 잠근다', () => {
  for (const n of ['SecurityHealth', 'V3 Lite', '알약 실시간 감시']) {
    const v = judgeStartup(entry(n))
    assert.equal(v.zone, 'LOCKED', `${n}이 잠기지 않았다`)
    assert.equal(v.suggestible, false)
  }
})

test('★ 회사 이름이 아니라 역할로 나눈다 — AhnLab Safe Transaction은 백신이 아니다', () => {
  // 실측에서 'ahnlab'이 백신 규칙에 먼저 걸려 "끄면 보호가 안 됩니다"로 잘못 설명됐다.
  // 은행 사이트용 모듈이라 성격이 완전히 다르다.
  const v = judgeStartup(entry('AhnLab Safe Transaction Application'))
  assert.equal(v.meaning, '금융·공공기관 보안 모듈')
  assert.equal(v.zone, 'AMBIG')
  // 반대로 진짜 백신은 여전히 잠겨야 한다
  assert.equal(judgeStartup(entry('AhnLab V3 Lite')).zone, 'LOCKED')
})

test('클라우드 동기화는 보여주되 먼저 권하지 않는다', () => {
  for (const n of ['OneDrive', 'GoogleDriveFS', 'Dropbox']) {
    const v = judgeStartup(entry(n))
    assert.equal(v.suggestible, false, `${n}을 끄자고 제안했다`)
    assert.match(v.ifDisabled, /동기화/)
  }
})

test('메신저는 제안하되 알림을 못 받는다는 손해를 먼저 말한다', () => {
  const v = judgeStartup(entry('KakaoTalk'))
  assert.equal(v.suggestible, true)
  assert.match(v.ifDisabled, /알림을 못 받습니다/)
})

test('브라우저 자동 시작은 브라우저 자체와 구분한다', () => {
  const v = judgeStartup(entry('GoogleChromeAutoLaunch_2CF9AD0FE25C1CD4'))
  assert.equal(v.meaning, '브라우저 자동 시작')
  assert.equal(v.suggestible, true)
  assert.match(v.ifDisabled, /직접 열면/)
})

test('이미 꺼진 항목·못 끄는 항목은 제안하지 않는다', () => {
  assert.equal(judgeStartup(entry('KakaoTalk', { enabled: false })).suggestible, false)
  assert.equal(judgeStartup(entry('KakaoTalk', { canToggle: false })).suggestible, false)
})

test('이름이 애매해도 명령줄로 판단한다', () => {
  const v = judgeStartup(entry('ALNotify', { command: 'C:\\Program Files\\ESTsoft\\ALNotify.exe' }))
  assert.equal(v.meaning, '자동 업데이트 도우미')
})

test('★ 끄기 값은 작업관리자와 같은 형식이다 — 다르면 되돌리기가 깨진다', () => {
  const on = approvalBytes(true)
  assert.equal(on.length, 12)
  assert.equal(on[0], 2, '사용 = 첫 바이트 2')
  assert.ok(on.slice(1).every((b) => b === 0), '사용 상태에는 시각을 적지 않는다')

  const off = approvalBytes(false, Date.UTC(2026, 7, 3))
  assert.equal(off.length, 12)
  assert.equal(off[0], 3, '해제 = 첫 바이트 3')
  assert.ok(
    off.slice(4).some((b) => b !== 0),
    '해제 시각(FILETIME)이 들어가야 작업관리자가 같은 상태로 읽는다'
  )
  assert.ok(off.every((b) => Number.isInteger(b) && b >= 0 && b <= 255), '전부 유효한 바이트')
})

test('모든 판정에는 끄면 뭐가 달라지는지가 반드시 붙는다', () => {
  for (const n of ['OneDrive', 'KakaoTalk', 'SecurityHealth', '정체불명', 'Steam']) {
    const v = judgeStartup(entry(n))
    assert.ok(v.ifDisabled.length > 10, `${n}에 결과 설명이 없다`)
    assert.ok(v.meaning && v.reason)
  }
})
