/**
 * 자동 업데이트 판단 로직 테스트
 *
 * 여기서 잠그는 건 "언제 업데이트하는가"다. 이게 틀리면 두 방향으로 위험하다:
 * 못 잡으면 사용자가 옛 버전에 갇히고, 과하게 잡으면 같은 버전을 무한 재설치한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compareVersions,
  checkForUpdate,
  silentInstallArgs,
  normalizeSha256,
  verifyIntegrity,
} from './updater.ts'

const A = 'a'.repeat(64) // 유효한 형식의 가짜 해시
const B = 'b'.repeat(64)

test('SemVer 비교 — 자리별로 정확히', () => {
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1, '마이너가 패치를 이긴다')
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1, '메이저가 다 이긴다')
  assert.equal(compareVersions('1.0', '1.0.0'), 0, '자리 수가 달라도 안전')
})

test('새 버전이 있으면 업데이트하고 manifest를 준다', async () => {
  const check = await checkForUpdate('0.1.0', 'x', async () => ({
    version: '0.2.0',
    notes: 'n',
    pub_date: 'd',
    url: 'u',
    signature: '',
  }))
  assert.equal(check.hasUpdate, true)
  assert.equal(check.latest, '0.2.0')
  assert.ok(check.manifest, '업데이트 시 설치 정보를 넘겨야 한다')
})

test('★같은 버전이면 절대 재설치하지 않는다 — 무한 재설치 방지', async () => {
  const check = await checkForUpdate('0.2.0', 'x', async () => ({
    version: '0.2.0',
    notes: 'n',
    pub_date: 'd',
    url: 'u',
    signature: '',
  }))
  assert.equal(check.hasUpdate, false)
  assert.equal(check.manifest, undefined, '업데이트가 없으면 설치 정보를 주면 안 된다')
})

test('서버가 더 낮은 버전을 줘도 다운그레이드하지 않는다', async () => {
  const check = await checkForUpdate('1.0.0', 'x', async () => ({
    version: '0.9.0',
    notes: 'n',
    pub_date: 'd',
    url: 'u',
    signature: '',
  }))
  assert.equal(check.hasUpdate, false)
})

test('무인 설치 인자 — 이노셋업 표준 플래그', () => {
  const args = silentInstallArgs()
  assert.ok(args.includes('/VERYSILENT'), 'UI 없이 설치')
  assert.ok(args.includes('/NORESTART'), '멋대로 재부팅 안 함')
})

/* ── 무결성 검증 ─────────────────────────────────────────────
   여기서 잠그는 건 "우리가 남의 파일을 실행해 주지 않는가"다.
   업데이트는 사용자 컴퓨터에서 코드를 실행하는 통로라, 틀리면 사고가 아니라 침해다. */

test('SHA-256 정규화 — 접두사·대문자·공백을 흡수한다', () => {
  assert.equal(normalizeSha256(A.toUpperCase()), A, '대문자도 같은 값')
  assert.equal(normalizeSha256(`sha256:${A}`), A, 'sha256: 접두사 허용')
  assert.equal(normalizeSha256(`SHA256=${A}`), A, 'SHA256= 형태도 허용')
  assert.equal(normalizeSha256(`  ${A}  `), A, '앞뒤 공백 무시')
})

test('SHA-256 정규화 — 형식이 아니면 null', () => {
  assert.equal(normalizeSha256(''), null, '빈 문자열')
  assert.equal(normalizeSha256(undefined), null)
  assert.equal(normalizeSha256(null), null)
  assert.equal(normalizeSha256('a'.repeat(63)), null, '63자 — 너무 짧음')
  assert.equal(normalizeSha256('a'.repeat(65)), null, '65자 — 너무 김')
  assert.equal(normalizeSha256('z'.repeat(64)), null, '16진수가 아님')
  assert.equal(normalizeSha256(A.slice(0, 60) + ' 123'), null, '중간 공백')
})

test('해시가 일치하면 통과', () => {
  assert.equal(verifyIntegrity(A, A).ok, true)
  assert.equal(verifyIntegrity(`sha256:${A.toUpperCase()}`, A).ok, true, '표기가 달라도 같은 값이면 통과')
})

test('★해시가 다르면 거절 — 바꿔치기된 설치파일을 실행하지 않는다', () => {
  const r = verifyIntegrity(A, B)
  assert.equal(r.ok, false)
  assert.match(r.reason ?? '', /달라요/)
})

test('★서명이 없으면 거절 (fail closed) — "검증 불가"는 통과가 아니다', () => {
  // 이게 뚫리면 서명 없는 릴리스를 아무나 흉내내 밀어넣을 수 있다.
  for (const empty of ['', '   ', undefined, null]) {
    const r = verifyIntegrity(empty, A)
    assert.equal(r.ok, false, `expected=${JSON.stringify(empty)}이면 거절해야 한다`)
  }
  assert.equal(verifyIntegrity('서명준비중', A).ok, false, '형식이 깨진 서명도 거절')
})

test('받은 파일의 해시를 못 구했으면 거절', () => {
  assert.equal(verifyIntegrity(A, '').ok, false)
  assert.equal(verifyIntegrity(A, undefined).ok, false)
})

test('양쪽 다 비어 있어도 절대 통과하지 않는다', () => {
  // 빈 값 == 빈 값 이라고 단순 비교했다면 여기서 통과해 버린다.
  assert.equal(verifyIntegrity('', '').ok, false)
})
