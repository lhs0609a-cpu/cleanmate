/**
 * 크기 트리 — "어디가 큰가"
 *
 * 여기서 지키는 건 하나다: **사용자가 이미 아는 사실을 답이라고 내놓지 않는다.**
 * "C:\Users가 제일 큽니다"는 정보가 아니다. 알고 싶은 건 그 안 어디냐다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSizeTree, findHotspots } from './sizetree.ts'

const f = (path: string, size: number) => ({ path, size })

test('상위 폴더는 아래 전부를 합한 값을 갖는다 — 안 그러면 트리를 못 탄다', () => {
  const dirs = buildSizeTree([
    f('C:/a/b/c/1.bin', 100),
    f('C:/a/b/c/2.bin', 200),
    f('C:/a/d/3.bin', 50),
  ])
  assert.equal(dirs.get('C:/a')!.bytes, 350, '조상에 합산이 안 됐다')
  assert.equal(dirs.get('C:/a/b/c')!.bytes, 300)
  assert.equal(dirs.get('C:/a')!.files, 3)
})

test('★ 한 자식이 압도하면 그 폴더는 답이 아니다 — 더 안쪽이 진짜 자리다', () => {
  /* C:/a 아래가 사실상 big 하나뿐이면 "C:/a가 큽니다"는 쓸모없는 답이다. */
  const dirs = buildSizeTree([
    f('C:/a/big/x.bin', 990),
    f('C:/a/small/y.bin', 10),
  ])
  const spots = findHotspots(dirs, 1000, { minShare: 0.01 })
  const paths = spots.map((s) => s.path)
  assert.ok(!paths.includes('C:/a'), '압도적인 자식이 있는데 부모를 답으로 내놨다')
  assert.ok(paths.includes('C:/a/big'), '진짜 자리를 못 찾았다')
})

test('★ 갈리는 지점에서 멈춘다 — 거기가 사람이 "여기가 문제구나" 하는 자리다', () => {
  const dirs = buildSizeTree([
    f('C:/a/x/1.bin', 500),
    f('C:/a/y/2.bin', 500),
  ])
  const spots = findHotspots(dirs, 1000, { minShare: 0.01 })
  assert.ok(spots.some((s) => s.path === 'C:/a'), '반반으로 갈렸으면 그 부모가 답이다')
})

test('★ 하강 경로에서 갈라진 가지를 놓치지 않는다', () => {
  /* 실측에서 이걸 놓쳤다: MusicFactory로 내려가느라 형제인 Android 12.3GB가
     목록에 아예 안 올라왔다. 타고 내려가는 방식의 구조적 결함이었다. */
  const dirs = buildSizeTree([
    f('C:/r/huge/a/1.bin', 700),
    f('C:/r/huge/b/2.bin', 100),
    f('C:/r/medium/3.bin', 200),
  ])
  const spots = findHotspots(dirs, 1000, { minShare: 0.1 })
  const paths = spots.map((s) => s.path)
  assert.ok(paths.includes('C:/r/medium'), '큰 쪽으로 내려가느라 형제를 통째로 놓쳤다')
})

test('작은 것은 아예 안 올린다 — 목록만 길어진다', () => {
  const dirs = buildSizeTree([f('C:/a/x/1.bin', 999), f('C:/a/tiny/2.bin', 1)])
  const spots = findHotspots(dirs, 1000, { minShare: 0.1 })
  assert.ok(!spots.some((s) => s.path === 'C:/a/tiny'), '1%짜리를 목록에 올렸다')
})

test('★ 드라이브 루트에서 무한히 거슬러 올라가지 않는다', () => {
  // parentOf('C:\\')가 자기 자신을 돌려주므로 멈추는 조건이 필요하다.
  const dirs = buildSizeTree([f('C:\\x.bin', 10)])
  assert.ok(dirs.size > 0 && dirs.size < 5, `루트 근처에서 폴더가 이상하게 불어났다: ${dirs.size}`)
})

test('빈 입력에서 터지지 않는다', () => {
  assert.deepEqual(findHotspots(buildSizeTree([]), 0), [])
})
