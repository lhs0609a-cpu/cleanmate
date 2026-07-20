/**
 * 자동 업데이트 판단 로직 테스트
 *
 * 여기서 잠그는 건 "언제 업데이트하는가"다. 이게 틀리면 두 방향으로 위험하다:
 * 못 잡으면 사용자가 옛 버전에 갇히고, 과하게 잡으면 같은 버전을 무한 재설치한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, checkForUpdate, silentInstallArgs } from './updater.ts'

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
