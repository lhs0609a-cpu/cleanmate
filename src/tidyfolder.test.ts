/**
 * 폴더 정리 테스트
 *
 * 겨냥하는 것:
 *   1) 지금 쓰는 파일을 옮기지 않는가 — 바탕화면은 없어진 게 눈에 바로 보인다
 *   2) 덮어쓰기로 원본을 날리지 않는가 — 덮어쓰면 되돌려도 원본이 없다
 *   3) 되돌아오는가 — 되돌릴 수 없는 이동은 그냥 삭제다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  planFolderTidy,
  applyFolderTidy,
  undoFolderTidy,
  readFolderEntries,
  readTidyLedger,
  tidyFolderName,
  DEFAULT_KEEP_DAYS,
  type FolderEntry,
} from './tidyfolder.ts'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 7, 3)

const entry = (name: string, over: Partial<FolderEntry> = {}): FolderEntry => ({
  name,
  path: join('C:\\Users\\me\\Desktop', name),
  size: 1024,
  mtimeMs: NOW - 30 * DAY,
  isDir: false,
  ...over,
})

/* ── 판단 ── */

test('오래 손대지 않은 것만 정리 폴더로 옮긴다', () => {
  const plan = planFolderTidy(
    [entry('오래된메모.txt'), entry('어제만든것.txt', { mtimeMs: NOW - 1 * DAY })],
    { folder: 'C:\\Users\\me\\Desktop', now: NOW }
  )
  assert.deepEqual(plan.moves.map((m) => m.name), ['오래된메모.txt'])
  assert.deepEqual(plan.keep.map((k) => k.name), ['어제만든것.txt'])
})

test('★ 최근에 손댄 것은 작업 중으로 보고 건드리지 않는다', () => {
  const items = [1, 3, 6].map((d) => entry(`d${d}.txt`, { mtimeMs: NOW - d * DAY }))
  const plan = planFolderTidy(items, { folder: 'D', now: NOW })
  assert.equal(plan.moves.length, 0, `${DEFAULT_KEEP_DAYS}일 안쪽은 전부 남아야 한다`)
  assert.ok(plan.keep.every((k) => /일 안에 손대신/.test(k.reason)))
})

test('시스템 항목과 우리가 만든 정리 폴더는 후보에서 뺀다', () => {
  const plan = planFolderTidy(
    [entry('desktop.ini'), entry('정리-2026-07', { isDir: true }), entry('TeraClean-Moved', { isDir: true })],
    { folder: 'D', now: NOW }
  )
  assert.equal(plan.moves.length, 0)
  assert.equal(plan.keep.length, 3)
})

test('깨진 바로가기는 옮기는 게 아니라 따로 모은다', () => {
  const plan = planFolderTidy([entry('없어진앱.lnk', { linkBroken: true })], { folder: 'D', now: NOW })
  assert.equal(plan.broken.length, 1)
  assert.equal(plan.moves.length, 0, '깨진 바로가기를 정리 폴더로 옮기면 쓰레기만 이동한다')
  assert.match(plan.broken[0].reason, /눌러도 열리지 않아요/)
})

test('모든 판단에 근거가 붙는다', () => {
  const plan = planFolderTidy(
    [entry('a.txt'), entry('b.txt', { mtimeMs: NOW }), entry('desktop.ini')],
    { folder: 'D', now: NOW }
  )
  for (const i of [...plan.moves, ...plan.keep, ...plan.broken]) {
    assert.ok(i.reason.length > 5, `${i.name}에 근거가 없다`)
  }
})

test('정리 폴더는 월 단위다 — 매일 하면 폴더만 늘어난다', () => {
  assert.equal(tidyFolderName(Date.UTC(2026, 7, 3)), '정리-2026-08')
  assert.equal(tidyFolderName(Date.UTC(2026, 11, 31)), '정리-2026-12')
})

test('큰 것부터 보여준다', () => {
  const plan = planFolderTidy(
    [entry('작은.txt', { size: 10 }), entry('큰.zip', { size: 9999 })],
    { folder: 'D', now: NOW }
  )
  assert.deepEqual(plan.moves.map((m) => m.name), ['큰.zip', '작은.txt'])
  assert.equal(plan.bytes, 10009)
})

/* ── 실행·되돌리기 (실파일) ── */

async function sandbox() {
  const base = await mkdtemp(join(tmpdir(), 'tc-desk-'))
  return {
    base,
    async file(name: string, content: string, ageDays = 30) {
      const p = join(base, name)
      await writeFile(p, content, 'utf8')
      const { utimes } = await import('node:fs/promises')
      const t = new Date(Date.now() - ageDays * DAY)
      await utimes(p, t, t)
      return p
    },
    cleanup: () => rm(base, { recursive: true, force: true }),
  }
}

test('★ 옮긴 파일은 내용 그대로 되돌아온다', async () => {
  const s = await sandbox()
  try {
    await s.file('보고서.txt', '소중한 내용')
    await s.file('오늘작업.txt', '건드리면 안 됨', 0)

    const plan = planFolderTidy(await readFolderEntries(s.base), { folder: s.base })
    assert.equal(plan.moves.length, 1, '오늘 만든 파일까지 옮기려 했다')

    const r = await applyFolderTidy(plan)
    assert.equal(r.movedCount, 1)
    assert.equal(r.failed.length, 0)
    assert.equal(await exists(join(s.base, '보고서.txt')), false, '원래 자리에서 사라져야 한다')
    assert.equal(await exists(join(s.base, '오늘작업.txt')), true, '최근 파일을 건드렸다')

    const ledger = await readTidyLedger(plan.destFolder)
    assert.equal(ledger.length, 1)

    const back = await undoFolderTidy(plan.destFolder)
    assert.equal(back.restoredCount, 1)
    assert.equal(await readFile(join(s.base, '보고서.txt'), 'utf8'), '소중한 내용')
  } finally {
    await s.cleanup()
  }
})

test('같은 이름이 정리 폴더에 이미 있으면 덮어쓰지 않는다', async () => {
  const s = await sandbox()
  try {
    await s.file('메모.txt', '이번 달 것')
    const plan = planFolderTidy(await readFolderEntries(s.base), { folder: s.base })
    await mkdir(plan.destFolder, { recursive: true })
    await writeFile(join(plan.destFolder, '메모.txt'), '지난번에 옮긴 것', 'utf8')

    await applyFolderTidy(plan)

    assert.equal(await readFile(join(plan.destFolder, '메모.txt'), 'utf8'), '지난번에 옮긴 것', '덮어썼다')
    assert.equal(await readFile(join(plan.destFolder, '메모 (2).txt'), 'utf8'), '이번 달 것')
  } finally {
    await s.cleanup()
  }
})

test('되돌릴 자리를 누가 차지했으면 덮어쓰지 않는다', async () => {
  const s = await sandbox()
  try {
    await s.file('a.txt', '원래 것')
    const plan = planFolderTidy(await readFolderEntries(s.base), { folder: s.base })
    await applyFolderTidy(plan)
    await writeFile(join(s.base, 'a.txt'), '새로 만든 것', 'utf8')

    const back = await undoFolderTidy(plan.destFolder)
    assert.equal(back.restoredCount, 0)
    assert.equal(back.failed.length, 1)
    assert.equal(await readFile(join(s.base, 'a.txt'), 'utf8'), '새로 만든 것')
    // 되돌리지 못한 것은 장부에 남아 있어야 다음에 다시 시도할 수 있다
    assert.equal((await readTidyLedger(plan.destFolder)).length, 1)
  } finally {
    await s.cleanup()
  }
})

test('계획을 세운 뒤 바뀐 파일은 건너뛴다 (TOCTOU)', async () => {
  const s = await sandbox()
  try {
    const p = await s.file('c.txt', '원래')
    const plan = planFolderTidy(await readFolderEntries(s.base), { folder: s.base })
    await writeFile(p, '방금 고친 중요한 내용', 'utf8') // 목록을 읽는 사이에 수정

    const r = await applyFolderTidy(plan)
    assert.equal(r.movedCount, 0)
    assert.match(r.failed[0].reason, /바뀌어서 건너뛰었어요/)
    assert.equal(await readFile(p, 'utf8'), '방금 고친 중요한 내용')
  } finally {
    await s.cleanup()
  }
})

async function exists(p: string) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

test('전부 되돌리면 빈 정리 폴더도 남기지 않는다', async () => {
  const s = await sandbox()
  try {
    await s.file('x.txt', '내용')
    const plan = planFolderTidy(await readFolderEntries(s.base), { folder: s.base })
    await applyFolderTidy(plan)
    await undoFolderTidy(plan.destFolder)

    // 정리해준 도구가 새 쓰레기를 하나 만들면 안 된다
    assert.equal(await exists(plan.destFolder), false, '빈 정리 폴더가 남았다')
  } finally {
    await s.cleanup()
  }
})

test('사용자가 정리 폴더에 뭘 넣어뒀으면 폴더를 지우지 않는다', async () => {
  const s = await sandbox()
  try {
    await s.file('y.txt', '내용')
    const plan = planFolderTidy(await readFolderEntries(s.base), { folder: s.base })
    await applyFolderTidy(plan)
    await writeFile(join(plan.destFolder, '내가 넣은 것.txt'), '보관', 'utf8')

    await undoFolderTidy(plan.destFolder)
    assert.equal(await exists(join(plan.destFolder, '내가 넣은 것.txt')), true, '남의 파일을 지웠다')
  } finally {
    await s.cleanup()
  }
})
