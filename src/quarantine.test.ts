/**
 * 격리 회귀 테스트
 *
 * 여기서 잠그는 건 "지워지는가"가 아니라 "되돌아오는가"다.
 * 복구가 안 되는 격리는 그냥 삭제다. 그래서 복구 테스트가 먼저 온다.
 *
 * BleachBit은 미리보기는 있는데 undo가 없어서 오삭제 사고가 반복됐다
 * (공식 포럼 "어떻게 UNDO하나"). 그 자리에 우리가 서려는 것이므로,
 * 복구는 기능이 아니라 존재 이유다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  quarantine,
  restore,
  purgeExpired,
  purgeNow,
  purgeEntries,
  readManifest,
  isExpired,
  isUnchanged,
  stampMtime,
  candidateRoots,
  listQuarantineRoots,
  quarantineRoot,
  legacyQuarantineRoot,
  manifestFile,
  GRACE_DAYS,
  type QuarantineEntry,
} from './quarantine.ts'

const DAY_MS = 86_400_000

/** 격리 저장소와 작업 폴더를 임시 디렉토리에 만든다 */
async function sandbox() {
  const base = await mkdtemp(join(tmpdir(), 'teraclean-q-'))
  const work = join(base, 'work')
  const root = join(base, 'quarantine')
  await mkdir(work, { recursive: true })
  return {
    base,
    work,
    root,
    opts: { rootFor: () => root },
    async file(name: string, content: string) {
      const p = join(work, name)
      await mkdir(join(p, '..'), { recursive: true })
      await writeFile(p, content, 'utf8')
      return p
    },
    async exists(p: string) {
      try {
        await stat(p)
        return true
      } catch {
        return false
      }
    },
    cleanup: () => rm(base, { recursive: true, force: true }),
  }
}

test('★격리한 파일은 내용 그대로 되돌아온다 — 이게 안 되면 나머지는 의미 없다', async () => {
  const s = await sandbox()
  try {
    const p = await s.file('보고서.txt', '소중한 내용입니다')

    const q = await quarantine([{ path: p, reason: '테스트', zone: 'AMBIG' }], s.opts)
    assert.equal(q.quarantined.length, 1)
    assert.equal(q.failed.length, 0)
    assert.equal(await s.exists(p), false, '격리했는데 원본이 그대로 있다')

    const r = await restore([q.quarantined[0].id], s.root)
    assert.equal(r.restored.length, 1, '복구가 안 됐다')
    assert.equal(r.failed.length, 0)
    assert.equal(await s.exists(p), true, '원래 자리로 안 돌아왔다')
    assert.equal(await readFile(p, 'utf8'), '소중한 내용입니다', '내용이 변했다')
  } finally {
    await s.cleanup()
  }
})

test('장부가 곧 복구 능력이다 — 이동한 것만 정확히 적힌다', async () => {
  const s = await sandbox()
  try {
    const p = await s.file('a.bin', 'x'.repeat(500))
    const q = await quarantine([{ path: p, reason: '오래된 캐시', zone: 'SAFE' }], s.opts)

    const m = await readManifest(s.root)
    assert.equal(m.length, 1)
    assert.equal(m[0].originalPath, p, '원래 경로를 모르면 되돌릴 수가 없다')
    assert.equal(m[0].size, 500)
    assert.equal(m[0].reason, '오래된 캐시', '왜 격리했는지 = 감사 로그')
    assert.equal(m[0].zone, 'SAFE')
    assert.ok(m[0].quarantinedAt > 0, '언제 격리했는지 모르면 30일을 셀 수 없다')
    assert.equal(m[0].id, q.quarantined[0].id)
  } finally {
    await s.cleanup()
  }
})

test('복구된 항목은 장부에서 빠진다 — 두 번 되살리지 않는다', async () => {
  const s = await sandbox()
  try {
    const p = await s.file('b.txt', 'hi')
    const q = await quarantine([{ path: p, reason: 't', zone: 'AMBIG' }], s.opts)
    await restore([q.quarantined[0].id], s.root)

    assert.equal((await readManifest(s.root)).length, 0, '복구했는데 장부에 유령이 남았다')
  } finally {
    await s.cleanup()
  }
})

test('되돌릴 자리를 누가 차지했으면 덮어쓰지 않는다', async () => {
  const s = await sandbox()
  try {
    const p = await s.file('c.txt', '옛날 것')
    const q = await quarantine([{ path: p, reason: 't', zone: 'AMBIG' }], s.opts)

    // 격리한 뒤 사용자가 같은 이름으로 새 파일을 만들었다
    await writeFile(p, '새로 만든 것', 'utf8')

    const r = await restore([q.quarantined[0].id], s.root)
    assert.equal(r.restored.length, 0)
    assert.equal(r.failed.length, 1)
    assert.match(r.failed[0].reason, /이미 있어요/)
    assert.equal(
      await readFile(p, 'utf8'),
      '새로 만든 것',
      '되돌리려다 사용자의 새 파일을 날렸다 — 격리의 존재 이유가 사라진다'
    )
  } finally {
    await s.cleanup()
  }
})

test('★스캔한 뒤에 파일이 바뀌었으면 건드리지 않는다 (TOCTOU)', async () => {
  const s = await sandbox()
  try {
    const p = await s.file('d.txt', '원래 내용')
    const before = await stat(p)

    // 사용자가 목록을 읽는 사이에 그 파일을 열어서 고쳤다.
    // 승인받은 파일과 지금 파일이 다른 파일이다.
    await writeFile(p, '방금 고친 중요한 내용', 'utf8')

    const q = await quarantine(
      [
        {
          path: p,
          reason: 't',
          zone: 'AMBIG',
          expect: { size: before.size, mtimeMs: before.mtimeMs },
        },
      ],
      s.opts
    )

    assert.equal(q.quarantined.length, 0, '바뀐 파일을 그대로 격리했다')
    assert.equal(q.failed.length, 1)
    assert.match(q.failed[0].reason, /바뀌었어요/)
    assert.equal(await readFile(p, 'utf8'), '방금 고친 중요한 내용', '원본이 살아있어야 한다')
  } finally {
    await s.cleanup()
  }
})

test('안 바뀌었으면 통과한다 — 재검증이 과민하면 아무것도 못 지운다', async () => {
  const s = await sandbox()
  try {
    const p = await s.file('e.txt', '그대로')
    const st = await stat(p)

    const q = await quarantine(
      [{ path: p, reason: 't', zone: 'SAFE', expect: { size: st.size, mtimeMs: st.mtimeMs } }],
      s.opts
    )
    assert.equal(q.quarantined.length, 1, '멀쩡한 파일을 거부했다')
  } finally {
    await s.cleanup()
  }
})

test('하나가 실패해도 나머지는 진행한다 — 부분 성공을 정직하게 보고', async () => {
  const s = await sandbox()
  try {
    const ok1 = await s.file('f1.txt', 'a')
    const ok2 = await s.file('f2.txt', 'b')
    const missing = join(s.work, '없는파일.txt')

    const q = await quarantine(
      [
        { path: ok1, reason: 't', zone: 'SAFE' },
        { path: missing, reason: 't', zone: 'SAFE' },
        { path: ok2, reason: 't', zone: 'SAFE' },
      ],
      s.opts
    )

    assert.equal(q.quarantined.length, 2, '하나 실패했다고 나머지를 포기했다')
    assert.equal(q.failed.length, 1)
    assert.equal(q.failed[0].path, missing)
    assert.match(q.failed[0].reason, /이미 없어요/, '에러 코드를 그대로 보여주면 안 된다')
  } finally {
    await s.cleanup()
  }
})

test('★30일 전에는 절대 안 지운다', async () => {
  const s = await sandbox()
  try {
    const p = await s.file('g.txt', 'still here')
    await quarantine([{ path: p, reason: 't', zone: 'AMBIG' }], s.opts)

    // 29일 23시간 뒤
    const almost = Date.now() + GRACE_DAYS * DAY_MS - 3600_000
    const r = await purgeExpired(s.root, almost)

    assert.equal(r.purged.length, 0, '유예가 안 끝났는데 지웠다')
    assert.equal((await readManifest(s.root)).length, 1, '아직 되돌릴 수 있어야 한다')
  } finally {
    await s.cleanup()
  }
})

test('30일이 지나야 실제로 지운다', async () => {
  const s = await sandbox()
  try {
    const p = await s.file('h.txt', 'bye')
    const q = await quarantine([{ path: p, reason: 't', zone: 'AMBIG' }], s.opts)

    const after = Date.now() + (GRACE_DAYS + 1) * DAY_MS
    const r = await purgeExpired(s.root, after)

    assert.equal(r.purged.length, 1)
    assert.equal(r.bytes, 3)
    assert.equal((await readManifest(s.root)).length, 0)

    // 이제는 진짜 없다
    const back = await restore([q.quarantined[0].id], s.root)
    assert.equal(back.restored.length, 0, '지웠는데 복구가 됐다 — 둘 중 하나가 거짓말이다')
  } finally {
    await s.cleanup()
  }
})

/* ────────────────────────────────────────────────────────────
   "지금 비우기" — 유예를 안 기다리는 경로

   격리함은 같은 드라이브에 있어서, 격리만으로는 용량이 1바이트도 안 준다.
   92% 찬 디스크를 들고 온 사람에게 "30일 뒤에 빕니다"는 답이 아니다.
   그래서 사용자가 확인하면 지금 지운다. 되돌릴 수 없는 경로이므로
   '무엇이 지워지고 무엇이 남는지'를 여기서 못 박는다.
   ──────────────────────────────────────────────────────────── */

test('★지금 비우기 — 유예가 안 끝났어도 지운다 (사용자가 확인한 경우)', async () => {
  const s = await sandbox()
  try {
    const p = await s.file('now.txt', 'gone')
    const q = await quarantine([{ path: p, reason: 't', zone: 'AMBIG' }], s.opts)

    // 방금 격리한 것 — purgeExpired였다면 하나도 안 지웠을 상태다
    assert.equal((await purgeExpired(s.root)).purged.length, 0, '자동 경로는 여전히 30일을 지켜야 한다')

    const r = await purgeNow(s.root)
    assert.equal(r.purged.length, 1)
    assert.equal(r.bytes, 4)
    assert.equal((await readManifest(s.root)).length, 0, '장부에서도 빠져야 한다')

    const back = await restore([q.quarantined[0].id], s.root)
    assert.equal(back.restored.length, 0, '지웠는데 복구가 됐다 — 둘 중 하나가 거짓말이다')
  } finally {
    await s.cleanup()
  }
})

test('★지금 비우기는 격리함 안의 것만 건드린다 — 원본 자리는 손대지 않는다', async () => {
  const s = await sandbox()
  try {
    const parked = await s.file('parked.txt', 'x')
    const untouched = await s.file('untouched.txt', 'keep me')
    await quarantine([{ path: parked, reason: 't', zone: 'AMBIG' }], s.opts)

    await purgeNow(s.root)

    // 격리한 적 없는 파일은 그대로 있어야 한다
    assert.equal(await readFile(untouched, 'utf8'), 'keep me')
  } finally {
    await s.cleanup()
  }
})

test('만료 안 된 건 남기고 만료된 것만 골라 지운다', async () => {
  const s = await sandbox()
  try {
    const old = await s.file('old.txt', 'o')
    const fresh = await s.file('fresh.txt', 'f')

    await quarantine([{ path: old, reason: 't', zone: 'AMBIG' }], s.opts)
    // 장부를 손으로 조작: old만 40일 전에 격리된 것으로
    const m = await readManifest(s.root)
    m[0].quarantinedAt = Date.now() - 40 * DAY_MS
    await writeFile(join(s.root, 'manifest.jsonl'), JSON.stringify(m[0]) + '\n', 'utf8')

    await quarantine([{ path: fresh, reason: 't', zone: 'AMBIG' }], s.opts)

    const r = await purgeExpired(s.root)
    assert.equal(r.purged.length, 1, '만료된 것만 지워야 한다')
    assert.equal(r.purged[0].originalPath, old)

    const left = await readManifest(s.root)
    assert.equal(left.length, 1)
    assert.equal(left[0].originalPath, fresh, '아직 유예 중인 걸 지웠다')
  } finally {
    await s.cleanup()
  }
})

test('★실측 버그 — Stats.mtime은 반올림, mtimeMs는 소수. 섞어 쓰면 절반이 오거부된다', () => {
  // 실제로 겪은 값이다. 안 건드린 캐시 파일 5개 중 3개가 "바뀌었어요"로
  // 거부됐다. 원인: node의 Stats.mtime은 mtimeMs를 Math.round해서 만든다.
  //   raw mtimeMs            = 1784276323518.8796
  //   Stats.mtime.getTime()  = 1784276323519   (node가 반올림)
  //   Math.floor(raw)        = 1784276323518   (옛 비교 코드)
  // → 519 !== 518 → 멀쩡한 파일을 거부. 소수부 0.5 이상이면 매번 터진다.
  const raw = 1784276323518.8796
  const viaDate = 1784276323519 // node의 Stats.mtime.getTime()이 주는 값

  assert.equal(Math.floor(raw), 1784276323518, '이게 옛 버그의 한쪽 값이었다')
  assert.notEqual(Math.floor(raw), viaDate, '두 표현이 실제로 어긋난다는 증거')

  assert.ok(
    isUnchanged({ size: 100, mtimeMs: raw }, { size: 100, mtimeMs: viaDate }),
    '같은 파일인데 표현이 달라서 "바뀌었다"고 판단했다 — 이게 그 버그다'
  )
  assert.equal(stampMtime(raw), stampMtime(viaDate), '표준형이 둘을 같게 만들어야 한다')
})

test('재검증은 진짜 변경은 잡는다 — 과민과 둔감 사이', () => {
  const base = { size: 100, mtimeMs: 1784276323518.8796 }
  assert.ok(isUnchanged(base, base), '자기 자신을 거부하면 안 된다')
  assert.ok(!isUnchanged({ ...base, size: 101 }, base), '크기가 바뀌었는데 통과시켰다')
  assert.ok(!isUnchanged({ ...base, mtimeMs: base.mtimeMs + 1000 }, base), '수정일이 바뀌었는데 통과시켰다')
  // 1ms 미만 차이는 같은 파일로 본다 — 표현 방식의 차이지 변경이 아니다
  assert.ok(isUnchanged({ ...base, mtimeMs: 1784276323519.0 }, base), '표현 오차를 변경으로 봤다')
})

test('실파일 20개 왕복 — 오거부가 하나도 없어야 한다', async () => {
  // 소수부는 파일마다 무작위다. 20개면 0.5 이상이 반드시 섞인다.
  // 옛 코드는 여기서 절반쯤 실패했다.
  const s = await sandbox()
  try {
    const reqs = []
    for (let i = 0; i < 20; i++) {
      const p = await s.file(`r${i}.bin`, 'x'.repeat(1000 + i))
      const st = await stat(p)
      // sweep이 하는 것과 똑같이 Date를 거쳐서 stamp를 만든다
      reqs.push({
        path: p,
        reason: 't',
        zone: 'SAFE' as const,
        expect: { size: st.size, mtimeMs: stampMtime(st.mtime.getTime()) },
      })
    }

    const q = await quarantine(reqs, s.opts)
    assert.equal(q.failed.length, 0, `안 건드린 파일 ${q.failed.length}개를 거부했다: ${q.failed[0]?.reason}`)
    assert.equal(q.quarantined.length, 20)
  } finally {
    await s.cleanup()
  }
})

test('isExpired는 경계에서 정확하다', () => {
  const base: QuarantineEntry = {
    id: 'x',
    originalPath: 'C:/a.txt',
    size: 1,
    mtimeMs: 0,
    quarantinedAt: 0,
    reason: 't',
    zone: 'SAFE',
  }
  assert.equal(isExpired(base, GRACE_DAYS * DAY_MS - 1), false, '1ms 모자라면 아직 아니다')
  assert.equal(isExpired(base, GRACE_DAYS * DAY_MS), true)
})

/* ────────────────────────────────────────────────────────────
   드라이브 전체 격리함

   ★ 이 테스트가 잠그는 사고: D 드라이브를 정리하면 격리함은 D:\.cleanmate에
   생기는데, 목록·복구·만료삭제가 C만 보고 있었다. 사용자 입장에서는 파일이
   그냥 사라진 것이다 — 목록에도 없고 되돌리기도 안 되고 30일 뒤에도 안 지워진다.
   ──────────────────────────────────────────────────────────── */

test('격리함 후보는 드라이브 전체다 (A·B는 제외)', () => {
  const win = candidateRoots('win32')
  const BS = String.fromCharCode(92) // 백슬래시
  assert.ok(win.includes('C:' + BS))
  assert.ok(win.includes('D:' + BS))
  assert.ok(win.includes('Z:' + BS))
  assert.ok(!win.some((r) => r.startsWith('A') || r.startsWith('B')))
  assert.deepEqual(candidateRoots('darwin'), ['/'])
})

test('장부가 있는 드라이브만 격리함으로 친다', async () => {
  const seen: string[] = []
  const roots = await listQuarantineRoots({
    platform: 'win32',
    exists: async (p) => {
      seen.push(p)
      return p.startsWith('D:') || p.startsWith('C:')
    },
  })
  const BS = String.fromCharCode(92)
  // 새 이름(.teraclean)과 옛 이름(.cleanmate)을 드라이브마다 함께 본다
  assert.deepEqual(roots, [
    quarantineRoot('C:' + BS),
    legacyQuarantineRoot('C:' + BS),
    quarantineRoot('D:' + BS),
    legacyQuarantineRoot('D:' + BS),
  ])
  // 장부 파일로 판단해야 한다 — 빈 폴더가 남아 있다고 격리함인 건 아니다
  assert.ok(seen.every((p) => p.endsWith('manifest.jsonl')))
})

test('★ 이름을 바꿔도 옛 격리함(.cleanmate)을 계속 찾는다 — 못 찾으면 맡아둔 파일을 잃는다', async () => {
  const seen: string[] = []
  const roots = await listQuarantineRoots({
    platform: 'win32',
    // 이 PC에는 옛 이름 격리함만 남아 있는 상황(v0.4.0까지 쓰던 사용자)
    exists: async (p) => {
      seen.push(p)
      return p.includes('.cleanmate') && p.startsWith('C:')
    },
  })
  assert.deepEqual(roots, [legacyQuarantineRoot('C:' + String.fromCharCode(92))])
  assert.ok(seen.some((p) => p.includes('.teraclean')), '새 이름도 함께 봐야 한다')
})

test('새로 격리하는 건 새 이름으로만 간다', () => {
  const p = 'C:' + String.fromCharCode(92) + 'a.txt'
  assert.ok(quarantineRoot(p).includes('.teraclean'))
  assert.ok(!quarantineRoot(p).includes('.cleanmate'))
  assert.ok(legacyQuarantineRoot(p).includes('.cleanmate'))
})

test('격리함이 하나도 없으면 빈 목록 — 없는 드라이브를 만들지 않는다', async () => {
  const roots = await listQuarantineRoots({ platform: 'win32', exists: async () => false })
  assert.deepEqual(roots, [])
})

test('★ 유예가 끝난 것만 지운다 — 만료 삭제가 실제로 용량을 비운다', async () => {
  const s = await sandbox()
  try {
    const old = await s.file('old.bin', 'x'.repeat(4096))
    const fresh = await s.file('fresh.bin', 'y'.repeat(2048))
    await quarantine(
      [
        { path: old, reason: '오래된 캐시', zone: 'SAFE' },
        { path: fresh, reason: '방금 캐시', zone: 'SAFE' },
      ],
      s.opts
    )

    // 하나만 30일 넘긴 것으로 만든다
    const manifest = await readManifest(s.root)
    manifest[0].quarantinedAt = Date.now() - (GRACE_DAYS + 1) * DAY_MS
    await writeFile(
      join(s.root, 'manifest.jsonl'),
      manifest.map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf8'
    )

    const r = await purgeExpired(s.root)
    assert.equal(r.purged.length, 1, '유예 지난 것만')
    assert.equal(r.bytes, 4096, '지운 만큼만 보고한다')

    const left = await readManifest(s.root)
    assert.equal(left.length, 1, '남은 것은 장부에 그대로')
    assert.equal(left[0].reason, '방금 캐시')
  } finally {
    await s.cleanup()
  }
})

/* ────────────────────────────────────────────────────────────
   방금 격리한 것만 지우기 (원클릭이 곧바로 용량을 비우는 경로)
   ──────────────────────────────────────────────────────────── */

test('★ purgeEntries는 방금 격리한 것만 지운다 — 남의 것을 건드리면 약속을 깬 것이다', async () => {
  const s = await sandbox()
  try {
    // 며칠 전 질문에 답해서 격리해 둔 것 — 아직 되돌릴 수 있다고 약속한 것
    const old = await s.file('중요한자료.psd', 'x'.repeat(4096))
    const before = await quarantine([{ path: old, reason: '질문에 답함', zone: 'AMBIG' }], s.opts)

    // 지금 원클릭이 격리한 캐시
    const c1 = await s.file('cache/a.bin', 'y'.repeat(1024))
    const c2 = await s.file('cache/b.bin', 'z'.repeat(2048))
    const now = await quarantine(
      [{ path: c1, reason: '캐시', zone: 'SAFE' }, { path: c2, reason: '캐시', zone: 'SAFE' }],
      s.opts
    )

    const r = await purgeEntries(now.quarantined, s.opts)
    assert.equal(r.purged.length, 2, '방금 격리한 둘만 지운다')
    assert.equal(r.bytes, 1024 + 2048)

    // ★ 며칠 전 것은 장부에도, 저장소에도 그대로 있어야 한다
    const left = await readManifest(s.root)
    assert.equal(left.length, 1, '남의 격리물이 사라졌다')
    assert.equal(left[0].id, before.quarantined[0].id)
    assert.ok(await s.exists(join(s.root, 'store', before.quarantined[0].id)),
      '되돌릴 수 있다고 약속한 파일이 실제로 없어졌다')
  } finally {
    await s.cleanup()
  }
})

test('purgeEntries에 빈 목록을 주면 아무것도 안 지운다', async () => {
  const s = await sandbox()
  try {
    const p = await s.file('a.bin', 'x'.repeat(512))
    await quarantine([{ path: p, reason: '캐시', zone: 'SAFE' }], s.opts)
    const r = await purgeEntries([], s.opts)
    assert.equal(r.purged.length, 0)
    assert.equal((await readManifest(s.root)).length, 1, '장부를 건드리면 안 된다')
  } finally {
    await s.cleanup()
  }
})
