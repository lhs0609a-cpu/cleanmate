/**
 * 폴더째 옮기고 바로가기(정션) 남기기 — 테스트
 *
 * ★ 이 기능은 "옮기면 깨져요"라고 막아둔 것들의 답이라서, 반대로 **깨뜨릴 수
 *   있는 힘**도 그만큼 크다. 그래서 여기서 잠그는 건 딱 두 가지다.
 *
 *   1. 실패하면 원본이 그대로 남는가 — 이 함수가 지켜야 할 유일한 약속
 *   2. 옮긴 뒤 원래 경로로 그대로 읽히는가 — 그게 안 되면 존재 이유가 없다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  junctionBlockReason,
  measureFolder,
  moveFolderWithJunction,
  undoFolderJunction,
} from './relocate.ts'

const isWindows = process.platform === 'win32'

test('★ 윈도우·설치 프로그램·동기화 폴더는 정션으로도 안 옮긴다', () => {
  const 금지 = [
    'C:\\Windows\\System32',
    'C:\\Program Files\\App',
    'C:\\ProgramData\\App',
    'C:\\Users\\me\\OneDrive\\사진',
    'C:\\Users\\me\\.teraclean\\quarantine',
  ]
  for (const p of 금지) assert.ok(junctionBlockReason(p), `막아야 하는데 통과됨: ${p}`)
})

test('★ 너무 큰 단위는 막는다 — 되돌릴 수 없는 규모는 기능이 아니다', () => {
  assert.ok(junctionBlockReason('C:\\'))
  assert.ok(junctionBlockReason('C:\\Users\\me'))
})

test('앱 데이터·게임·가상환경은 정션 대상이다 — 여기가 이 기능의 존재 이유다', () => {
  for (const p of [
    'C:\\Users\\me\\AppData\\Local\\MusicFactory\\ACE-Step-1.5\\.venv',
    'D:\\Games\\Steam\\steamapps\\common\\BigGame',
    'C:\\dev\\proj\\node_modules',
  ]) {
    assert.equal(junctionBlockReason(p), null, `옮길 수 있어야 하는데 막힘: ${p}`)
  }
})

test('폴더 크기 대조 — 개수와 합계를 센다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teraclean-measure-'))
  try {
    await mkdir(join(dir, 'sub'), { recursive: true })
    await writeFile(join(dir, 'a.bin'), Buffer.alloc(100))
    await writeFile(join(dir, 'sub', 'b.bin'), Buffer.alloc(250))
    const m = await measureFolder(dir)
    assert.equal(m.files, 2)
    assert.equal(m.bytes, 350)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('★ 옮길 자리에 뭔가 있으면 아무것도 안 한다 — 원본이 그대로 남는다', async () => {
  const base = await mkdtemp(join(tmpdir(), 'teraclean-jx-'))
  try {
    const src = join(base, 'src')
    const dest = join(base, 'dest')
    await mkdir(src, { recursive: true })
    await mkdir(dest, { recursive: true })
    await writeFile(join(src, 'a.txt'), 'hello')

    const r = await moveFolderWithJunction(src, dest)
    assert.equal(r.ok, false)
    assert.match(r.reason ?? '', /이미 있어요/)
    assert.equal(await readFile(join(src, 'a.txt'), 'utf8'), 'hello', '실패했는데 원본이 사라졌다')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('막힌 폴더는 아무것도 안 건드린다', async () => {
  const r = await moveFolderWithJunction('C:\\Windows\\System32', 'D:\\anywhere')
  assert.equal(r.ok, false)
  assert.equal(r.movedTo, '')
})

/**
 * 실물 검증. 정션은 윈도우 기능이라 여기서만 돈다.
 * 같은 드라이브 안에서 만들지만(임시 폴더), 정션 자체는 드라이브가 달라도 같다 —
 * 여기서 보려는 건 "원래 경로로 그대로 읽히는가"다.
 */
test('★ 옮긴 뒤에도 원래 경로로 그대로 읽힌다 (윈도우)', { skip: !isWindows }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'teraclean-jx2-'))
  try {
    const src = join(base, 'app-data')
    const dest = join(base, 'moved', 'app-data')
    await mkdir(join(src, 'inner'), { recursive: true })
    await writeFile(join(src, 'inner', 'config.json'), '{"keep":true}')

    const r = await moveFolderWithJunction(src, dest)
    assert.equal(r.ok, true, r.reason)
    assert.equal(r.linked, true)
    assert.equal(r.copiedFiles, 1)

    // ① 원래 경로로 읽으면 그대로 나온다 — 프로그램이 안 깨진다는 뜻이다.
    assert.equal(await readFile(join(src, 'inner', 'config.json'), 'utf8'), '{"keep":true}')
    // ② 원래 자리는 진짜 폴더가 아니라 바로가기다.
    assert.ok((await lstat(src)).isSymbolicLink(), '원래 자리가 정션이 아니다')
    // ③ 실물은 옮긴 자리에 있다.
    assert.deepEqual(await readdir(dest), ['inner'])

    // ④ 되돌리면 원래대로. 정션을 먼저 걷어내야 한다.
    const undo = await undoFolderJunction(src, dest)
    assert.equal(undo.ok, true, undo.reason)
    assert.ok((await lstat(src)).isDirectory())
    assert.equal((await lstat(src)).isSymbolicLink(), false, '되돌렸는데 정션이 남아 있다')
    assert.equal(await readFile(join(src, 'inner', 'config.json'), 'utf8'), '{"keep":true}')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
