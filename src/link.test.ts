/**
 * 하나로 합치기(하드링크) 테스트
 *
 * ★ 이 기능은 파일을 **지우지 않고** 중복을 없앤다. 대신 잘못 만들면 서로 다른
 *   두 파일을 같은 것으로 만들어버릴 수 있다 — 중복 정리에서 낼 수 있는 가장
 *   나쁜 사고다. 그래서 여기서 잠그는 건 셋이다.
 *
 *   1. 내용이 다르면 절대 안 합친다 (크기가 같아도)
 *   2. 실패하면 사본이 그대로 남는다
 *   3. 합친 뒤에도 양쪽 경로가 다 열린다 — 그게 이 기능의 존재 이유다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeBlockReason, mergeIntoLink, isSameFile, splitLink, BACKUP_SUFFIX } from './link.ts'

const MB = 1024 * 1024

test('★ 드라이브가 다르면 합칠 수 없다고 말한다 — 규칙이 아니라 성질이다', () => {
  const why = mergeBlockReason('C:\\a\\model.safetensors', 'D:\\b\\model.safetensors')
  assert.ok(why)
  assert.match(why!, /드라이브가 달라서/)
  // 대안을 함께 말한다. 막기만 하면 사용자는 거기서 멈춘다.
  assert.match(why!, /옮기기/)
})

test('★ 윈도우·설치된 프로그램 자리는 합치지 않는다', () => {
  assert.ok(mergeBlockReason('C:\\Windows\\System32\\a.dll', 'C:\\x\\a.dll'))
  assert.ok(mergeBlockReason('C:\\x\\a.dll', 'C:\\Program Files\\App\\a.dll'))
})

test('★ 실물로 합쳐 보고, 양쪽이 다 열리는지 확인한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teraclean-link-'))
  try {
    const keeper = join(dir, 'keep', 'model.safetensors')
    const copy = join(dir, 'copy', 'model.safetensors')
    const data = Buffer.alloc(2 * MB, 3)
    await writeFile(join(dir, 'keep.tmp'), '') // 폴더를 만들기 위해
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(dir, 'keep'), { recursive: true })
    await mkdir(join(dir, 'copy'), { recursive: true })
    await writeFile(keeper, data)
    await writeFile(copy, data)

    const before = (await stat(keeper)).ino !== (await stat(copy)).ino
    assert.ok(before, '시작할 때는 서로 다른 실물이어야 한다')

    const r = await mergeIntoLink(keeper, copy)
    assert.equal(r.ok, true, r.reason)
    assert.equal(r.bytes, 2 * MB, '회수한 용량을 정확히 보고해야 한다')

    // ① 두 경로가 다 열린다 — 프로그램이 안 깨진다는 뜻이다.
    assert.equal((await readFile(copy)).length, 2 * MB)
    assert.equal((await readFile(keeper)).length, 2 * MB)
    // ② 같은 실물이다 = 디스크는 한 벌만 쓴다.
    assert.equal(await isSameFile(keeper, copy), true)
    // ③ 임시 파일을 남기지 않는다.
    const left = await readdir(join(dir, 'copy'))
    assert.deepEqual(left.filter((f) => f.endsWith(BACKUP_SUFFIX)), [])

    // ④ 다시 따로 뗄 수 있다(용량은 도로 쓴다).
    const s = await splitLink({ id: 'x', keeper, linked: copy, size: 2 * MB, mergedAt: 0 })
    assert.equal(s.ok, true, s.reason)
    assert.equal(await isSameFile(keeper, copy), false, '따로 떼었는데 여전히 같은 실물이다')
    assert.equal((await readFile(copy)).length, 2 * MB, '따로 뗀 사본이 깨졌다')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('★ 크기가 같아도 내용이 다르면 안 합친다 — 여기가 제일 위험한 자리다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teraclean-link2-'))
  try {
    const a = join(dir, 'a.bin')
    const b = join(dir, 'b.bin')
    await writeFile(a, Buffer.alloc(1 * MB, 1))
    await writeFile(b, Buffer.alloc(1 * MB, 2)) // 크기는 같고 내용만 다르다

    const r = await mergeIntoLink(a, b)
    assert.equal(r.ok, false)
    assert.match(r.reason ?? '', /내용이 달라졌어요/)
    // 실패했으면 원래 파일이 그대로 있어야 한다.
    assert.equal((await readFile(b))[0], 2, '실패했는데 사본이 바뀌었다')
    assert.equal(await isSameFile(a, b), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('이미 합쳐져 있으면 조용히 넘어간다 — 두 번 세지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teraclean-link3-'))
  try {
    const a = join(dir, 'a.bin')
    const b = join(dir, 'b.bin')
    await writeFile(a, Buffer.alloc(1 * MB, 5))
    await writeFile(b, Buffer.alloc(1 * MB, 5))
    await mergeIntoLink(a, b)

    const again = await mergeIntoLink(a, b)
    assert.equal(again.ok, true)
    assert.equal(again.already, true, '이미 합쳐진 걸 또 합쳤다고 말한다')
    assert.equal(again.bytes, 0, '회수하지도 않은 용량을 보고한다')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('없는 파일은 조용히 실패한다 — 이유와 함께', async () => {
  const r = await mergeIntoLink('C:\\없는파일\\a.bin', 'C:\\없는파일\\b.bin')
  assert.equal(r.ok, false)
  assert.ok(r.reason)
})
