/**
 * 드라이브 이동 테스트
 *
 * 여기서 잠그는 건 두 가지다.
 *   1. 옮기면 안 되는 걸 옮기지 않는가 — 파일은 살아도 앱이 깨지는 경로들
 *   2. 옮긴 걸 되돌릴 수 있는가 — 되돌릴 수 없는 이동은 그냥 분실이다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, stat, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isRelocatable,
  relocateBlockReason,
  isSameVolume,
  volumeOf,
  destinationFor,
  movedFolderOn,
  hasEnoughSpace,
  planRelocate,
  applyRelocate,
  readRelocateLedger,
  undoRelocate,
  ledgerPathFor,
  shortenPath,
  MOVED_FOLDER,
  type RelocateItem,
} from './relocate.ts'
import { stampMtime } from './quarantine.ts'
import type { Classified } from './types.ts'

function classified(path: string, zone: 'SAFE' | 'AMBIG' | 'LOCKED' = 'AMBIG'): Classified {
  const now = new Date()
  return {
    path,
    size: 1024,
    mtime: now,
    atime: now,
    ext: '.bin',
    ageDays: 400,
    verdict: { zone, meaning: '테스트', reason: '테스트', ruleBacked: false },
  }
}

/* ── 옮기면 안 되는 것 ──────────────────────────────────────── */

test('★잠근 항목(존 C)은 옮기지 않는다', () => {
  const r = isRelocatable(classified('C:\\Users\\me\\Videos\\a.mp4', 'LOCKED'))
  assert.equal(r.ok, false)
})

test('★파일은 살아도 앱이 깨지는 경로는 옮기지 않는다', () => {
  const 금지 = [
    'C:\\Windows\\System32\\drivers\\etc\\hosts',
    'C:\\Program Files\\App\\app.exe',
    'C:\\Program Files (x86)\\App\\app.exe',
    'C:\\ProgramData\\App\\data.db',
    'C:\\Users\\me\\AppData\\Local\\Programs\\App\\app.exe',
    'C:\\Users\\me\\AppData\\Roaming\\App\\config.json',
    'C:\\$Recycle.Bin\\S-1-5\\file.bin',
    'C:\\System Volume Information\\x.bin',
    'C:\\.cleanmate\\quarantine\\store\\abc',
    'C:\\dev\\proj\\node_modules\\react\\index.js',
    'C:\\Users\\me\\OneDrive\\문서\\a.docx',
    'C:\\Users\\me\\Google Drive\\a.docx',
    `C:\\${MOVED_FOLDER}\\Users\\me\\a.mp4`,
  ]
  for (const p of 금지) {
    const r = isRelocatable(classified(p))
    assert.equal(r.ok, false, `옮기면 안 되는데 허용됨: ${p}`)
    assert.ok(r.reason, `왜 안 되는지 이유가 있어야 한다: ${p}`)
  }
})

/**
 * ★ 낱개 이동이 생기면서 들어오는 경로의 성격이 바뀌었다.
 *
 * 여태 이동은 '다운로드·영상·사진 폴더를 훑어서'만 시작했다(relocateRoots).
 * 그래서 AppData나 가상환경 경로는 애초에 후보에 없었고, 규칙에도 없었다.
 * 이제 질문 목록에서 고른 파일이 그대로 들어온다 — 화면에 실제로 떠 있던
 * `AppData\Local\MusicFactory\ACE-Step-1.5\.venv\...\torch_cuda.dll` 같은 것들이다.
 * 이걸 옮기면 파일은 멀쩡한데 프로젝트만 조용히 안 돌아간다.
 */
test('★가상환경·AppData·불러 쓰는 파일은 옮기지 않는다 — 낱개 이동으로 들어오는 것들', () => {
  const 금지: [string, string][] = [
    ['C:\\Users\\me\\AppData\\Local\\App\\data.bin', 'AppData\\Local은 프로그램이 저장한 자리다'],
    ['C:\\dev\\proj\\.venv\\Lib\\site-packages\\torch\\lib\\torch_cuda.dll', '가상환경은 자기 경로를 안에 적어둔다'],
    ['C:\\dev\\proj\\venv\\Scripts\\python.exe', '가상환경'],
    ['C:\\dev\\proj\\.git\\objects\\pack\\a.pack', '.git을 옮기면 저장소가 깨진다'],
    ['C:\\Users\\me\\Downloads\\lib\\ffmpeg.dll', '경로가 멀쩡해도 불러 쓰는 파일이다'],
  ]
  for (const [p, why] of 금지) {
    assert.equal(isRelocatable(classified(p)).ok, false, `옮기면 안 되는데 허용됨(${why}): ${p}`)
    assert.ok(relocateBlockReason(p), `왜 안 되는지 이유가 있어야 한다: ${p}`)
  }
})

test('★목록을 그릴 때는 분류 없이 경로만으로도 판정이 나온다', () => {
  // 화면은 "이건 옮길 수 있어요"를 **고르기 전에** 보여줘야 한다. 그 시점엔
  // 스캔 결과가 아니라 경로 문자열뿐이다. 그래서 순수 함수 통로를 따로 둔다.
  assert.equal(relocateBlockReason('C:\\Users\\me\\Videos\\holiday.mp4'), null)
  assert.ok(relocateBlockReason('C:\\Windows\\System32\\x.bin'))
})

test('설치 파일은 옮길 수 있다 — 다시 받으면 그만인 큰 덩어리다', () => {
  // .dll은 막고 .exe·.msi는 막지 않는다. 다운로드 폴더의 설치 파일은 옮겨도
  // 아무도 안 깨지고, 크기가 커서 옮길 값어치가 가장 큰 축이다.
  assert.equal(isRelocatable(classified('C:\\Users\\me\\Downloads\\setup.exe')).ok, true)
  assert.equal(isRelocatable(classified('C:\\Users\\me\\Downloads\\office.msi')).ok, true)
})

test('평범한 사용자 데이터는 옮길 수 있다', () => {
  for (const p of [
    'C:\\Users\\me\\Videos\\holiday.mp4',
    'C:\\Users\\me\\Downloads\\bigfile.zip',
    'C:\\Users\\me\\Pictures\\raw\\DSC_0001.NEF',
  ]) {
    assert.equal(isRelocatable(classified(p)).ok, true, `옮길 수 있어야 하는데 거부됨: ${p}`)
  }
})

/* ── 경로 계산 ──────────────────────────────────────────────── */

test('드라이브 판별 — 대소문자 무관', () => {
  assert.equal(volumeOf('c:\\a\\b'), volumeOf('C:\\x\\y'))
  assert.ok(isSameVolume('c:\\a', 'C:\\b'))
  assert.ok(!isSameVolume('C:\\a', 'D:\\b'))
})

test('★옮길 자리는 드라이브 내 상대경로를 유지한다 — 이름만 쓰면 충돌한다', () => {
  const dest = movedFolderOn('D:\\')
  const a = destinationFor('C:\\Users\\me\\Videos\\a.mp4', dest)
  const b = destinationFor('C:\\Users\\me\\Downloads\\a.mp4', dest)
  assert.notEqual(a, b, '다른 폴더의 같은 이름이 같은 자리로 가면 하나가 사라진다')
  assert.match(a, /Videos/)
  assert.match(b, /Downloads/)
})

test('여유 공간 — 딱 맞으면 거절한다', () => {
  const GB = 1024 ** 3
  assert.equal(hasEnoughSpace(100 * GB, 10 * GB), true)
  assert.equal(hasEnoughSpace(10 * GB, 10 * GB), false, '꽉 채우면 그 드라이브가 다음 문제가 된다')
  assert.equal(hasEnoughSpace(12 * GB, 10 * GB), false, '여유 5GB를 못 남기면 거절')
  assert.equal(hasEnoughSpace(16 * GB, 10 * GB), true)
})

test('같은 드라이브로 옮기려 하면 계획에서 걸러낸다', () => {
  const item: RelocateItem = {
    path: 'C:\\Users\\me\\Videos\\a.mp4',
    size: 100,
    meaning: '영상',
    reason: '큼',
    mtimeMs: 1,
  }
  const plan = planRelocate([item], 'C:\\')
  assert.equal(plan.items.length, 0)
  assert.equal(plan.skipped.length, 1)
  assert.match(plan.skipped[0].reason, /같은 드라이브/)
})

test('경로 줄이기 — 앞뒤를 남긴다', () => {
  const s = shortenPath('C:\\Users\\me\\Videos\\2026\\holiday.mp4')
  assert.match(s, /^C:/)
  assert.match(s, /holiday\.mp4$/)
})

/* ── 실제 이동 왕복 ─────────────────────────────────────────── */

async function makeTree() {
  const base = await mkdtemp(join(tmpdir(), 'teraclean-reloc-'))
  const src = join(base, 'src')
  const dst = join(base, 'dst')
  await mkdir(src, { recursive: true })
  await mkdir(dst, { recursive: true })
  return { base, src, dst }
}

/** 같은 볼륨이라 planRelocate가 걸러내므로, 실행 테스트는 계획을 직접 만든다. */
async function itemFor(path: string): Promise<RelocateItem> {
  const st = await stat(path)
  return { path, size: st.size, meaning: '테스트 파일', reason: '큼', mtimeMs: stampMtime(st.mtimeMs) }
}

test('★옮기고 되돌리면 내용이 그대로다', async (t) => {
  const { base, src, dst } = await makeTree()
  t.after(() => rm(base, { recursive: true, force: true }))

  const f = join(src, 'sub', 'movie.bin')
  await mkdir(join(src, 'sub'), { recursive: true })
  await writeFile(f, 'ORIGINAL-CONTENT')

  const item = await itemFor(f)
  const plan = { destFolder: dst, items: [{ item, dest: join(dst, 'sub', 'movie.bin') }], bytes: item.size, skipped: [] }

  const r = await applyRelocate(plan)
  assert.equal(r.movedCount, 1, `이동 실패: ${JSON.stringify(r.failed)}`)
  assert.equal(await exists(f), false, '원본 자리는 비어야 한다')
  assert.equal(await readFile(join(dst, 'sub', 'movie.bin'), 'utf8'), 'ORIGINAL-CONTENT')

  const ledger = await readRelocateLedger(dst)
  assert.equal(ledger.length, 1, '장부에 기록이 남아야 되돌릴 수 있다')
  assert.equal(ledger[0].originalPath, f)

  const u = await undoRelocate([ledger[0].id], dst)
  assert.equal(u.restored.length, 1, `되돌리기 실패: ${JSON.stringify(u.failed)}`)
  assert.equal(await readFile(f, 'utf8'), 'ORIGINAL-CONTENT', '되돌린 내용이 원본과 같아야 한다')
})

test('★계획 뒤에 파일이 바뀌었으면 옮기지 않는다 (TOCTOU)', async (t) => {
  const { base, src, dst } = await makeTree()
  t.after(() => rm(base, { recursive: true, force: true }))

  const f = join(src, 'edited.bin')
  await writeFile(f, 'BEFORE')
  const item = await itemFor(f)

  // 사용자가 계획을 읽는 사이에 파일을 고쳤다
  await writeFile(f, 'AFTER-EDIT-DIFFERENT-LENGTH')

  const r = await applyRelocate({ destFolder: dst, items: [{ item, dest: join(dst, 'edited.bin') }], bytes: item.size, skipped: [] })
  assert.equal(r.movedCount, 0)
  assert.match(r.failed[0].reason, /바뀌었어요/)
  assert.equal(await readFile(f, 'utf8'), 'AFTER-EDIT-DIFFERENT-LENGTH', '건드리지 않아야 한다')
})

test('★옮길 자리에 파일이 있으면 덮어쓰지 않는다', async (t) => {
  const { base, src, dst } = await makeTree()
  t.after(() => rm(base, { recursive: true, force: true }))

  const f = join(src, 'a.bin')
  await writeFile(f, 'MINE')
  const 남의파일 = join(dst, 'a.bin')
  await writeFile(남의파일, 'SOMEONE-ELSE')

  const item = await itemFor(f)
  const r = await applyRelocate({ destFolder: dst, items: [{ item, dest: 남의파일 }], bytes: item.size, skipped: [] })

  assert.equal(r.movedCount, 0)
  assert.equal(await readFile(남의파일, 'utf8'), 'SOMEONE-ELSE', '남의 파일을 날리면 안 된다')
  assert.equal(await readFile(f, 'utf8'), 'MINE', '원본도 그대로여야 한다')
})

test('★되돌릴 자리를 누가 차지했으면 덮어쓰지 않는다', async (t) => {
  const { base, src, dst } = await makeTree()
  t.after(() => rm(base, { recursive: true, force: true }))

  const f = join(src, 'b.bin')
  await writeFile(f, 'MOVED-AWAY')
  const item = await itemFor(f)
  await applyRelocate({ destFolder: dst, items: [{ item, dest: join(dst, 'b.bin') }], bytes: item.size, skipped: [] })

  // 옮긴 뒤 사용자가 같은 이름의 새 파일을 만들었다
  await writeFile(f, 'NEW-FILE-SAME-NAME')

  const ledger = await readRelocateLedger(dst)
  const u = await undoRelocate([ledger[0].id], dst)
  assert.equal(u.restored.length, 0)
  assert.match(u.failed[0].reason, /덮어쓰지 않았습니다/)
  assert.equal(await readFile(f, 'utf8'), 'NEW-FILE-SAME-NAME')
})

test('하나 실패해도 나머지는 옮긴다 — 부분 성공을 정직하게 보고', async (t) => {
  const { base, src, dst } = await makeTree()
  t.after(() => rm(base, { recursive: true, force: true }))

  const ok1 = join(src, 'ok1.bin')
  const ok2 = join(src, 'ok2.bin')
  await writeFile(ok1, 'A')
  await writeFile(ok2, 'B')
  const i1 = await itemFor(ok1)
  const i2 = await itemFor(ok2)
  const 없는파일: RelocateItem = { path: join(src, 'ghost.bin'), size: 10, meaning: 'x', reason: 'x', mtimeMs: 1 }

  const r = await applyRelocate({
    destFolder: dst,
    items: [
      { item: i1, dest: join(dst, 'ok1.bin') },
      { item: 없는파일, dest: join(dst, 'ghost.bin') },
      { item: i2, dest: join(dst, 'ok2.bin') },
    ],
    bytes: 0,
    skipped: [],
  })

  assert.equal(r.movedCount, 2)
  assert.equal(r.failed.length, 1)
})

test('장부는 이동 뒤에 적는다 — 실패한 건 장부에 없어야 한다', async (t) => {
  const { base, src, dst } = await makeTree()
  t.after(() => rm(base, { recursive: true, force: true }))

  const 없는파일: RelocateItem = { path: join(src, 'nope.bin'), size: 10, meaning: 'x', reason: 'x', mtimeMs: 1 }
  await applyRelocate({ destFolder: dst, items: [{ item: 없는파일, dest: join(dst, 'nope.bin') }], bytes: 10, skipped: [] })

  const ledger = await readRelocateLedger(dst)
  assert.equal(ledger.length, 0, '실패한 이동이 장부에 남으면 되돌리기가 유령을 쫓는다')
  assert.equal(await exists(ledgerPathFor(dst)), false)
})

async function exists(p: string) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}
