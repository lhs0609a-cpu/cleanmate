/**
 * 큰 덩어리 프로브 테스트
 *
 * 여기서 잠그는 건 셋이다.
 *   1. 우리가 지우지 않는다 — vhdx에 실행 가능한 삭제 경로가 생기면 안 된다
 *   2. "안에서 지워도 안 줄어든다"는 사실을 반드시 말한다 (이걸 모르면 사용자가 헛수고한다)
 *   3. 작은 건 아예 안 띄운다 — 목록이 길어지면 큰 항목을 놓친다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeBulk, gatherBulkFacts, BULK_FLOOR_BYTES, type BulkItem } from './bulk.ts'

const GB = 1024 ** 3
const item = (kind: BulkItem['kind'], bytes: number, path = 'C:\\x\\ext4.vhdx', label = 'Ubuntu'): BulkItem =>
  ({ kind, bytes, path, label })

test('★우리가 지우는 경로를 만들지 않는다 — vhdx 한 장이 곧 그 환경 전부다', () => {
  for (const f of probeBulk([item('wsl', 40 * GB), item('docker', 30 * GB)])) {
    assert.equal(f.action, undefined, '실행 가능한 삭제·회수 명령이 붙었다')
    assert.equal(f.assist, undefined, 'vhdx에 정식 도구 버튼이 붙었다 — 우리가 다룰 물건이 아니다')
    assert.equal(f.explain.recovery, 'none', '되돌릴 수 있는 것처럼 말한다')
  }
})

test('★"안에서 지워도 안 줄어든다"를 말한다 — 이걸 빠뜨리면 사용자가 헛수고한다', () => {
  const [wsl] = probeBulk([item('wsl', 40 * GB)])
  assert.match(wsl.explain.why, /커지기만/, '동적 디스크가 커지기만 한다는 사실이 없다')
  assert.match(wsl.explain.recoveryNote, /wsl --shutdown/, '실제로 줄이는 방법을 안 알려준다')
})

test('Docker는 파일이 아니라 Docker에게 정리시킨다', () => {
  const [d] = probeBulk([item('docker', 30 * GB, 'C:\\x\\Docker\\wsl\\data\\ext4.vhdx')])
  assert.match(d.title, /Docker/)
  assert.match(d.explain.recoveryNote, /docker system prune/, '정식 정리 명령을 안 알려준다')
  assert.ok(d.explain.ifRemoved.some((s) => /볼륨/.test(s)), '볼륨 데이터가 날아간다는 경고가 없다')
})

test('Windows.old는 윈도우 정식 도구로 넘긴다 — 우리가 지우지 않는다', () => {
  const [w] = probeBulk([item('windows-old', 25 * GB, 'C:\\Windows.old', '')])
  assert.equal(w.zone, 'LOCKED')
  assert.equal(w.assist?.command, 'open-cleanmgr')
  assert.equal(w.assist?.irreversible, true, '되돌릴 수 없다는 표시가 없다')
  assert.match(w.explain.ifKept, /10일/, '기다리면 알아서 지워진다는 선택지를 안 준다')
})

test('작은 것은 아예 보고하지 않는다', () => {
  assert.deepEqual(probeBulk([item('wsl', BULK_FLOOR_BYTES - 1)]), [])
  assert.equal(probeBulk([item('wsl', BULK_FLOOR_BYTES)]).length, 1)
})

test('배포판 이름이 없으면 지어내지 않는다', () => {
  const [f] = probeBulk([item('wsl', 40 * GB, 'C:\\x\\ext4.vhdx', 'LocalState')])
  assert.match(f.title, /WSL 배포판/, '폴더 이름을 그대로 배포판 이름처럼 쓴다')
})

test('없는 PC에서는 조용히 빈 목록 — 프로브 하나가 전체를 죽이지 않는다', async () => {
  // 이 PC에 WSL·Docker·Windows.old가 없어도 예외 없이 끝나야 한다.
  const items = await gatherBulkFacts()
  assert.ok(Array.isArray(items))
})
