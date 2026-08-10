/**
 * 자동 정리 테스트 — "지웠다"고 말했으면 정말 지워야 한다
 *
 * ★ 이 파일이 생긴 이유:
 *   원클릭이 격리함으로만 옮기고 멈췄다. 격리함은 같은 드라이브에 있으니
 *   용량이 1바이트도 안 줬는데, 화면에는 "지금 정리 가능 7.0GB" 버튼이 있었다.
 *   사용자가 두 번 같은 말을 했다 — "격리함으로 옮기지 말라니까? 바로 삭제하라고."
 *
 *   그래서 기본을 즉시 삭제로 바꿨다. 되돌릴 수 없게 되니, 무엇을 지우고 무엇을
 *   안 지우는지가 정확해야 한다. 그 경계를 여기서 잠근다.
 *
 * ★ 왜 경계 검증은 파일을 안 만드나:
 *   임시 폴더에 샌드박스를 만들면 그 안의 모든 것이 경로상 AppData\Local\Temp
 *   아래가 된다. 그래서 '계약서.hwp'조차 규칙상 정당하게 '임시 파일'로 잡힌다
 *   (처음 이 테스트를 그렇게 썼다가 걸렸다). 경계는 경로 판단의 문제이므로
 *   classifyOne에 직접 물어본다 — 디스크를 타면 오히려 흐려진다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planSweep, applySweep, type SweepPlan } from './sweep.ts'
import { readManifest, manifestFile, stampMtime } from './quarantine.ts'
import { classifyOne, isAutoEligible } from './classify.ts'
import type { FileEntry } from './types.ts'

async function sandbox() {
  const base = await mkdtemp(join(tmpdir(), 'teraclean-sweep-'))
  const work = join(base, 'work')
  const root = join(base, 'quarantine')
  await mkdir(work, { recursive: true })
  return {
    base,
    work,
    root,
    /** 격리함을 임시 폴더로 돌린다 — 안 하면 진짜 C:\.teraclean에 쓴다 */
    rootFor: () => root,
    async file(rel: string, bytes: number) {
      const p = join(work, rel)
      await mkdir(join(p, '..'), { recursive: true })
      await writeFile(p, 'x'.repeat(bytes))
      return p
    },
    async exists(p: string) {
      try { await stat(p); return true } catch { return false }
    },
    cleanup: () => rm(base, { recursive: true, force: true }),
  }
}

/** 실제 파일에서 계획 항목을 만든다. planSweep을 안 거치고 실행만 시험할 때 쓴다. */
async function planFor(paths: string[]): Promise<SweepPlan> {
  const items = []
  let bytes = 0
  for (const path of paths) {
    const st = await stat(path)
    items.push({
      path, size: st.size, meaning: '임시 파일', reason: '테스트',
      mtimeMs: stampMtime(st.mtime.getTime()),
    })
    bytes += st.size
  }
  return {
    items, bytes, scannedFiles: paths.length, elapsedMs: 0,
    skipped: { locked: { count: 0, bytes: 0 }, needsAsking: { count: 0, bytes: 0 }, inferredNotAuto: { count: 0, bytes: 0 } },
  }
}

test('★ purge=true면 원본이 디스크에서 사라진다 — 용량이 지금 빈다', async () => {
  const s = await sandbox()
  try {
    const a = await s.file('a.bin', 4096)
    const b = await s.file('b.bin', 8192)

    const r = await applySweep(await planFor([a, b]), { purge: true, rootFor: s.rootFor })
    assert.equal(r.purged, true)
    assert.equal(r.purgedCount, 2)
    assert.equal(r.bytesAfterGrace, 4096 + 8192, '지금 빈 용량을 보고한다')

    assert.equal(await s.exists(a), false, '원본이 남아 있다 — 용량이 안 빈다')
    assert.equal(await s.exists(b), false)

    // ★ 격리함에도 없어야 한다. 남아 있으면 용량을 그대로 먹고 있는 것이다.
    assert.equal((await readManifest(s.root)).length, 0, '격리함에 그대로 남았다')
  } finally {
    await s.cleanup()
  }
})

test('purge를 안 주면 옛 동작 그대로 — 격리에서 멈춘다', async () => {
  const s = await sandbox()
  try {
    const a = await s.file('a.bin', 4096)

    const r = await applySweep(await planFor([a]), { rootFor: s.rootFor })
    assert.equal(r.purged, false)
    assert.equal(r.purgedCount, 0)
    assert.equal(await s.exists(a), false, '원본 자리에서는 옮겨져야 한다')
    assert.equal((await readManifest(s.root)).length, 1, '격리함에 남아야 되돌릴 수 있다')
    assert.equal(await s.exists(manifestFile(s.root)), true)
  } finally {
    await s.cleanup()
  }
})

test('지울 게 없으면 조용히 0으로 끝난다', async () => {
  const s = await sandbox()
  try {
    const r = await applySweep(await planFor([]), { purge: true, rootFor: s.rootFor })
    assert.equal(r.purgedCount, 0)
    assert.equal(r.bytesAfterGrace, 0)
    assert.deepEqual(r.failed, [])
  } finally {
    await s.cleanup()
  }
})

test('없는 파일이 계획에 있어도 죽지 않고 실패로 보고한다', async () => {
  const s = await sandbox()
  try {
    const a = await s.file('a.bin', 512)
    const plan = await planFor([a])
    plan.items[0].path = join(s.work, '사라진파일.bin') // 계획 세운 뒤 없어진 상황

    const r = await applySweep(plan, { purge: true, rootFor: s.rootFor })
    assert.equal(r.purgedCount, 0)
    assert.equal(r.failed.length, 1, '조용히 성공으로 보고하면 안 된다')
    assert.equal(await s.exists(a), true, '엉뚱한 파일을 지우면 안 된다')
  } finally {
    await s.cleanup()
  }
})

/* ────────────────────────────────────────────────────────────
   ★ 즉시 삭제의 유일한 방어선 — 무엇이 자동 대상이 되는가

   격리를 안 거치므로 이 경계가 곧 안전장치 전부다. 경로 판단이므로
   디스크를 만들지 않고 classifyOne에 직접 묻는다.
   ──────────────────────────────────────────────────────────── */

const entry = (path: string, size = 4096): FileEntry => ({
  path, size, mtime: new Date(), atime: new Date(),
  ext: path.slice(path.lastIndexOf('.')).toLowerCase(), ageDays: 10,
})

test('★ 문서·사진·동영상은 자동 삭제 대상이 아니다', () => {
  for (const p of [
    'D:\\문서\\계약서.hwp',
    'D:\\사진\\가족여행.jpg',
    'D:\\영상\\결혼식.mp4',
    'D:\\작업\\정산.xlsx',
    'C:\\Users\\me\\Desktop\\이력서.docx',
  ]) {
    const c = classifyOne(entry(p))
    assert.ok(!isAutoEligible(c), `${p}가 자동 삭제 대상이 됐다 (zone=${c.verdict.zone})`)
  }
})

test('★ 클라우드 동기화 폴더는 자동 삭제 대상이 아니다 — 지우면 다른 기기에서도 사라진다', () => {
  for (const p of [
    'C:\\Users\\me\\OneDrive\\문서\\계획.docx',
    'C:\\Users\\me\\Dropbox\\사진.jpg',
    'C:\\Users\\me\\AppData\\Local\\Google\\DriveFS\\metadata_sqlite_db',
  ]) {
    const c = classifyOne(entry(p))
    assert.ok(!isAutoEligible(c), `${p}가 자동 삭제 대상이 됐다`)
  }
})

test('★ 세이브·설정은 자동 삭제 대상이 아니다', () => {
  for (const p of [
    'D:\\Steam\\steamapps\\common\\Elden Ring\\SaveGames\\ER0000.sl2',
    'C:\\Users\\me\\AppData\\Roaming\\SomeApp\\settings.json',
  ]) {
    const c = classifyOne(entry(p))
    assert.ok(!isAutoEligible(c), `${p}가 자동 삭제 대상이 됐다`)
  }
})

test('캐시·로그·썸네일은 자동 삭제 대상이다 — 이게 안 되면 원클릭이 아무것도 못 한다', () => {
  const targets = [
    'C:\\Users\\me\\AppData\\Local\\Temp\\a.tmp',
    'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache\\f_00123',
    'C:\\Users\\me\\AppData\\Local\\SomeApp\\logs\\app.log',
  ]
  const ok = targets.filter((p) => isAutoEligible(classifyOne(entry(p))))
  assert.ok(ok.length >= 2, `자동 대상이 너무 적다: ${ok.length}/${targets.length}`)
})

test('스캔을 거쳐도 같은 경계가 유지된다 (planSweep 연동)', async () => {
  const s = await sandbox()
  try {
    // ★ 샌드박스가 AppData\Local\Temp 안이라 여기 든 건 규칙상 전부 '임시 파일'이다.
    //   그래서 이 테스트는 '경계'가 아니라 '스캔→계획이 실제로 항목을 만드는지'를 본다.
    await s.file('cache/x.bin', 2048)
    const plan = await planSweep(s.work)
    assert.ok(plan.items.length >= 1, 'planSweep이 자동 대상을 하나도 못 만들었다')
    assert.ok(plan.bytes > 0)
  } finally {
    await s.cleanup()
  }
})
