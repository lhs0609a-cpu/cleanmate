/**
 * 백업 확인 테스트
 *
 * ★ 여기서 잠그는 건 **정반대로 말하지 않는 것**이다.
 *   - 클라우드에 사본이 있다 → "지워도 그쪽에 남습니다" (안심)
 *   - 그 파일 자체가 클라우드 폴더에 있다 → "여기서 지우면 클라우드에서도 지워집니다" (경고)
 *   이 둘을 섞으면 동기화 폴더의 원본을 "백업 있음"이라며 지우게 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cloudRoots, buildBackupIndex, checkBackup, INDEX_MIN_BYTES, type CloudRoot } from './backup.ts'

const MB = 1024 * 1024
const ROOTS: CloudRoot[] = [{ label: 'OneDrive', path: 'C:\\Users\\me\\OneDrive' }]

test('환경변수로 알려준 OneDrive 경로를 쓴다 — 회사 계정은 폴더 이름이 제각각이다', () => {
  const roots = cloudRoots({
    home: 'C:\\Users\\me',
    vars: { OneDriveCommercial: 'C:\\Users\\me\\OneDrive - 회사이름' },
  })
  assert.ok(roots.some((r) => r.path === 'C:\\Users\\me\\OneDrive - 회사이름'))
})

test('같은 경로를 두 번 담지 않는다', () => {
  const roots = cloudRoots({ home: 'C:\\Users\\me', vars: { OneDrive: 'C:\\Users\\me\\OneDrive' } })
  const paths = roots.map((r) => r.path.toLowerCase())
  assert.equal(new Set(paths).size, paths.length)
})

test('★ 클라우드에 같은 이름·크기가 있으면 "지워도 남는다"고 말한다', () => {
  const index = buildBackupIndex([{ path: 'C:\\Users\\me\\OneDrive\\영상\\trip.mp4', size: 500 * MB }], 'OneDrive')
  const hit = checkBackup({ path: 'C:\\Users\\me\\Videos\\trip.mp4', size: 500 * MB }, index, ROOTS)
  assert.equal(hit.found, true)
  assert.equal(hit.where, 'OneDrive')
  assert.match(hit.note, /남습니다/)
  // 추정이라는 근거를 문장에 남긴다 — 검증할 수 있는 문장이어야 정직하다.
  assert.match(hit.note, /이름과 크기/)
})

test('★ 동기화 폴더 안의 파일은 "백업 있음"이 아니라 정반대 경고다', () => {
  const index = buildBackupIndex([{ path: 'C:\\Users\\me\\OneDrive\\영상\\trip.mp4', size: 500 * MB }], 'OneDrive')
  const hit = checkBackup({ path: 'C:\\Users\\me\\OneDrive\\영상\\trip.mp4', size: 500 * MB }, index, ROOTS)
  assert.equal(hit.found, false, '원본을 백업이라고 말하면 그걸 지우게 된다')
  assert.match(hit.note, /클라우드에서도 지워집니다/)
})

test('크기가 다르면 같은 파일로 보지 않는다', () => {
  const index = buildBackupIndex([{ path: 'C:\\Users\\me\\OneDrive\\trip.mp4', size: 500 * MB }], 'OneDrive')
  const hit = checkBackup({ path: 'C:\\Users\\me\\Videos\\trip.mp4', size: 499 * MB }, index, ROOTS)
  assert.equal(hit.found, false)
  assert.equal(hit.note, '')
})

test('작은 파일은 색인에 담지 않는다 — 색인만 커진다', () => {
  const index = buildBackupIndex([{ path: 'C:\\Users\\me\\OneDrive\\a.txt', size: INDEX_MIN_BYTES - 1 }], 'OneDrive')
  assert.equal(index.size, 0)
})

test('대소문자가 달라도 같은 파일로 본다 — 윈도우는 구분하지 않는다', () => {
  const index = buildBackupIndex([{ path: 'C:\\Users\\me\\OneDrive\\Trip.MP4', size: 100 * MB }], 'OneDrive')
  const hit = checkBackup({ path: 'C:\\Users\\me\\Videos\\trip.mp4', size: 100 * MB }, index, ROOTS)
  assert.equal(hit.found, true)
})
