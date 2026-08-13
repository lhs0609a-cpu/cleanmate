/**
 * 같은 파일 찾기 테스트
 *
 * ★ 여기서 잠그는 건 "중복이니까 지워도 된다"가 **틀리는 자리**다.
 *   node_modules·가상환경·게임에는 같은 파일이 여러 벌 있는 게 정상이다.
 *   거기서 한 벌을 지우면 정리가 아니라 고장이고, 되돌리기 전까지 원인도 안 보인다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isDupeCandidate,
  findDuplicates,
  hashAndGroup,
  buildFileDupGroups,
  DUP_MIN_BYTES,
  type DupFile,
} from './dupes.ts'

const f = (path: string, size: number, mtimeMs = 1000): DupFile => ({
  path,
  name: path.slice(path.lastIndexOf('\\') + 1),
  size,
  mtimeMs,
})

test('★ 여러 벌 있는 게 정상인 자리는 후보에서 뺀다', () => {
  const 제외 = [
    'C:\\dev\\proj\\node_modules\\react\\index.js',
    'C:\\dev\\proj\\.venv\\Lib\\site-packages\\numpy\\core.py',
    'C:\\Users\\me\\AppData\\Local\\App\\cache.bin',
    'C:\\Program Files\\App\\app.dat',
    'D:\\Steam\\steamapps\\common\\Game\\pak.pak',
    'C:\\Windows\\System32\\x.bin',
    'C:\\dev\\proj\\.git\\objects\\a.pack',
  ]
  for (const p of 제외) {
    const r = isDupeCandidate(p)
    assert.equal(r.ok, false, `중복 후보로 잡히면 안 되는데 잡힘: ${p}`)
    assert.ok(r.reason, `왜 뺐는지 이유가 있어야 한다: ${p}`)
  }
})

test('★ 라이브러리 파일은 확장자만으로도 뺀다 — 경로가 멀쩡해 보여도', () => {
  assert.equal(isDupeCandidate('C:\\Users\\me\\Downloads\\lib\\ffmpeg.dll').ok, false)
  assert.equal(isDupeCandidate('C:\\Users\\me\\Downloads\\video.mp4').ok, true)
})

test('사람이 받아둔 자리는 후보가 된다', () => {
  for (const p of [
    'C:\\Users\\me\\Downloads\\setup.exe',
    'C:\\Users\\me\\Videos\\holiday.mp4',
    'C:\\Users\\me\\OneDrive\\문서\\보고서.pdf',
  ]) {
    assert.equal(isDupeCandidate(p).ok, true, `후보여야 하는데 빠짐: ${p}`)
  }
})

test('★ 클라우드에 있는 쪽을 남긴다 — 지워도 다른 기기에 남는 사본이다', () => {
  const local = f('C:\\Users\\me\\Downloads\\report.pdf', 20 * 1024 * 1024, 1000)
  const cloud = f('C:\\Users\\me\\OneDrive\\문서\\report.pdf', 20 * 1024 * 1024, 5000)
  // 나이만 보면 로컬(더 오래된 것)이 원본이지만, 남길 것은 클라우드 쪽이어야 한다.
  const [g] = buildFileDupGroups([
    { file: local, hash: 'same' },
    { file: cloud, hash: 'same' },
  ])
  assert.equal(g.keeper.path, cloud.path, '클라우드 사본을 남기지 않는다')
  assert.match(g.keeperReason, /클라우드/, '왜 그걸 남겼는지 근거가 바뀌지 않았다')
})

test('★ 실제 파일로 확인 — 내용이 같아야만 중복이다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teraclean-dupes-'))
  try {
    const big = Buffer.alloc(DUP_MIN_BYTES + 1024, 7)
    const other = Buffer.alloc(DUP_MIN_BYTES + 1024, 9) // 크기는 같고 내용만 다르다
    await mkdir(join(dir, 'sub'), { recursive: true })
    const a = join(dir, 'a.bin')
    const b = join(dir, 'sub', 'a (1).bin')
    const c = join(dir, 'c.bin')
    await writeFile(a, big)
    await writeFile(b, big)
    await writeFile(c, other)

    const files: DupFile[] = [
      { path: a, name: 'a.bin', size: big.length, mtimeMs: 1000 },
      { path: b, name: 'a (1).bin', size: big.length, mtimeMs: 2000 },
      { path: c, name: 'c.bin', size: other.length, mtimeMs: 3000 },
    ]
    // 임시 폴더는 AppData 아래라 걸러내기 규칙에 먼저 걸린다(그게 맞다).
    // 여기서 보려는 건 규칙이 아니라 **해시로 확정하는가**이므로 해시 쪽만 부른다.
    const r = await hashAndGroup(files)

    assert.equal(r.groups.length, 1, '크기만 같은 파일을 중복으로 잡았다')
    assert.equal(r.groups[0].keeper.path, a, '사본 표시가 있는 쪽을 남겼다')
    assert.deepEqual(r.groups[0].copies.map((x) => x.path), [b])
    assert.equal(r.wastedBytes, big.length)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('작은 파일은 아예 안 본다 — 목록만 길어진다', async () => {
  const r = await findDuplicates([
    f('C:\\Users\\me\\Downloads\\a.txt', 1024),
    f('C:\\Users\\me\\Downloads\\b.txt', 1024),
  ])
  assert.equal(r.candidates, 0)
  assert.equal(r.groups.length, 0)
})

test('뺀 개수를 보고한다 — 조용히 빼면 "왜 안 나오지"가 된다', async () => {
  const r = await findDuplicates([
    f('C:\\dev\\proj\\node_modules\\a\\big.bin', DUP_MIN_BYTES + 1),
    f('C:\\dev\\proj\\node_modules\\b\\big.bin', DUP_MIN_BYTES + 1),
  ])
  assert.equal(r.excluded, 2)
  assert.equal(r.groups.length, 0)
})
