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
  markAlreadyLinked,
  hasRealWaste,
  isModelFile,
  findInstallCauses,
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

/* ── 받아온 자료(AI 모델)는 규칙이 다르다 ──────────────────── */

test('★ AppData 안이어도 받아온 모델은 중복으로 본다', () => {
  // 실측: 같은 모델 6.46GB가 6벌, 그중 3벌이 AppData 안이었다. AppData를 통째로
  // 빼는 규칙은 '프로그램 부품'을 위한 것이지 '받아온 자료'를 위한 게 아니다.
  const p = 'C:\\Users\\me\\AppData\\Roaming\\app\\engine\\ComfyUI\\models\\checkpoints\\sd_xl_base_1.0.safetensors'
  assert.equal(isModelFile(p), true)
  assert.equal(isDupeCandidate(p).ok, true, '모델인데도 AppData라는 이유로 빠졌다')
})

test('AppData 안의 평범한 파일은 여전히 안 본다 — 예외를 넓히지 않는다', () => {
  assert.equal(isDupeCandidate('C:\\Users\\me\\AppData\\Roaming\\app\\data.bin').ok, false)
})

test('확장자가 없어도 모델 자리에 있으면 모델로 본다 (ollama가 받아둔 것)', () => {
  assert.equal(isModelFile('C:\\Users\\me\\.ollama\\models\\blobs\\sha256-fffbdeec'), true)
})

test('★ 원인을 말한다 — "같은 프로그램이 4곳에 있어요"', () => {
  // 폴더 이름이 제각각이어도(GVF-ComfyUI · ComfyUI_windows_portable) 같은 프로그램으로 묶는다.
  const mk = (path: string) => ({ path, name: 'm.safetensors', size: 6 * 1024 ** 3, mtimeMs: 1 })
  const groups = [{
    hash: 'h',
    keeper: mk('C:\\AI\\ComfyUI_windows_portable\\ComfyUI\\models\\m.safetensors'),
    copies: [
      mk('C:\\Users\\me\\GVF-ComfyUI\\models\\m.safetensors'),
      mk('C:\\Users\\me\\AppData\\Roaming\\x\\engine\\ComfyUI_windows_portable\\ComfyUI\\models\\m.safetensors'),
    ],
    wastedBytes: 12 * 1024 ** 3,
    keeperReason: '',
  }]
  const [c] = findInstallCauses(groups as any)
  assert.equal(c.name, 'ComfyUI')
  assert.equal(c.roots.length, 3, '설치 자리를 다 세지 못했다')
  assert.equal(c.wastedBytes, 12 * 1024 ** 3)
})

test('한 곳에만 있으면 원인으로 올리지 않는다 — 겁주지 않는다', () => {
  const mk = (path: string) => ({ path, name: 'a.safetensors', size: 1024 ** 3, mtimeMs: 1 })
  const groups = [{
    hash: 'h',
    keeper: mk('C:\\AI\\ComfyUI\\models\\a.safetensors'),
    copies: [mk('C:\\AI\\ComfyUI\\models\\backup\\a.safetensors')],
    wastedBytes: 1024 ** 3,
    keeperReason: '',
  }]
  assert.deepEqual(findInstallCauses(groups as any), [])
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

/* ────────────────────────────────────────────────────────────
   이미 합쳐진 것을 "낭비"라고 하지 않는다

   ★ 실측 오보 (2026-08-18): AI 모델 폴더를 훑고 "낭비 58.86GB"라고 했다.
     그중 sd_xl_base_1.0.safetensors 6.46GB짜리가 6벌로 잡혀 32.31GB가
     낭비라고 나왔는데, fsutil로 보니 링크수가 6이었다 — 여섯 경로가 이미 같은
     실물 하나를 나눠 쓰고 있었고 회수 가능액은 0바이트였다.
     실제 회수 가능액은 19.7GB(Ollama 모델 쪽)뿐이었다.

     "58.86GB를 아낄 수 있어요"라고 해놓고 눌렀더니 아무것도 안 비는 건
     경쟁 도구가 하는 짓이다.
   ──────────────────────────────────────────────────────────── */

/** 테스트용 파일 한 줄. 실제 디스크를 안 쓴다 — 신원은 주입한다. */
const dupFile = (path: string, size = 1000) => ({ path, name: path.split('/').pop()!, size, mtimeMs: 0 })

function group(keeper: string, copies: string[], size = 1000) {
  return {
    hash: 'h',
    keeper: dupFile(keeper, size),
    copies: copies.map((c) => dupFile(c, size)),
    wastedBytes: copies.length * size,
    keeperReason: '테스트',
  }
}

test('★ 이미 하드링크된 사본은 낭비로 세지 않는다 — 치워도 1바이트도 안 빈다', () => {
  const g = group('/a/model.bin', ['/b/model.bin', '/c/model.bin'], 6_460_000_000)
  // 셋 다 같은 실물(링크수 3)
  const out = markAlreadyLinked([g], () => 'vol:1234')
  assert.equal(out[0].wastedBytes, 0, '이미 같은 실물인데 회수 가능하다고 말한다')
  assert.ok(out[0].copies.every((c: any) => c.alreadyLinked), '이미 링크됐다고 표시하지 않는다')
})

test('★ 진짜로 따로 차지하는 사본은 그대로 센다 — 링크 인식이 진짜 중복까지 지우면 안 된다', () => {
  const g = group('/a/m.bin', ['/b/m.bin'], 8_640_000_000)
  const out = markAlreadyLinked([g], (p) => (p === '/a/m.bin' ? 'vol:1' : null))
  assert.equal(out[0].wastedBytes, 8_640_000_000, '진짜 중복인데 낭비에서 뺐다')
})

test('신원을 모르면 낭비로 센다 — 모른다고 회수량을 0으로 깎지 않는다', () => {
  const g = group('/a/m.bin', ['/b/m.bin'])
  const out = markAlreadyLinked([g], () => null)
  assert.equal(out[0].wastedBytes, 1000, '못 읽었다고 중복이 없는 셈 쳤다')
})

test('사본끼리 서로 링크된 것도 한 번만 센다', () => {
  // 키퍼는 따로, 사본 둘은 서로 같은 실물 → 회수되는 건 한 벌치뿐이다.
  const g = group('/a/m.bin', ['/b/m.bin', '/c/m.bin'])
  const ids: Record<string, string> = { '/a/m.bin': 'v:1', '/b/m.bin': 'v:2', '/c/m.bin': 'v:2' }
  const out = markAlreadyLinked([g], (p) => ids[p] ?? null)
  assert.equal(out[0].wastedBytes, 1000, '서로 링크된 사본을 두 번 셌다')
})

test('회수할 게 없는 묶음은 목록에서 뺀다 — 눌러도 0바이트인 줄을 내밀지 않는다', () => {
  const g = group('/a/m.bin', ['/b/m.bin'])
  const out = markAlreadyLinked([g], () => 'same')
  assert.equal(out.filter(hasRealWaste).length, 0, '회수액 0인 묶음이 화면에 올라간다')
})
