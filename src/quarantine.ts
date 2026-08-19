/**
 * 격리 (M11) — 삭제 프로그램의 바닥
 *
 * 삭제를 4단계로 쪼갠다:
 *   후보 지정 → [격리] → 30일 유예 → 실제 삭제
 * 사용자에게 "지웠어요"라고 말하는 건 2단계, 진짜 지우는 건 4단계.
 * 이 시차가 안전의 전부다. CleanMyMac이 Alfred 워크플로를 날린 건
 * 이 시차가 없어서다.
 *
 * ── 설계 결정 ────────────────────────────────────────────────
 *
 * 1) 격리 폴더는 '원본과 같은 드라이브'에 둔다.
 *    같은 드라이브면 rename이 즉시고 공짜다(디스크를 안 읽는다).
 *    다른 드라이브면 복사+삭제라 40GB에 몇 분씩 걸리고 순간적으로
 *    공간이 두 배로 필요하다. 격리하겠다고 디스크를 꽉 채울 순 없다.
 *
 * 2) 장부도 그 드라이브에 같이 둔다.
 *    중앙 장부를 쓰면 외장 드라이브를 뽑았을 때 장부와 실물이 어긋난다.
 *    실물 옆에 장부를 두면 드라이브가 통째로 자기 완결적이다.
 *
 * 3) 부분 성공을 허용한다. 100개 중 50개째에서 실패해도 롤백하지 않는다.
 *    장부에 적힌 건 전부 복구 가능하므로 손실이 아니다. 억지 원자성보다
 *    "뭐가 됐고 뭐가 안 됐는지 정직하게 보고"가 낫다.
 *
 * 4) 격리해도 용량은 안 빈다. 옮기기만 했으니까.
 *    이걸 숨기면 제품이 거짓말하는 것이다. 존 A(캐시)는 재생성되니
 *    격리가 애초에 필요 없고 → 즉시 삭제로 공간이 바로 빈다.
 *    격리는 잃으면 못 되찾는 것(존 B)에만 쓴다.
 */

import { mkdir, rename, stat, copyFile, unlink, readFile, appendFile, rm } from 'node:fs/promises'
import { join, parse, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Zone } from './types.ts'

/** 유예 기간. 이 기간엔 원클릭으로 되돌아온다. */
export const GRACE_DAYS = 30
const DAY_MS = 86_400_000

/** 장부 한 줄 = 격리된 항목 하나. 이게 없으면 복구가 불가능하다. */
export interface QuarantineEntry {
  id: string
  originalPath: string
  size: number
  /** 재검증용. 격리 시점의 파일과 지금 파일이 같은지 확인한다. */
  mtimeMs: number
  quarantinedAt: number
  /** 왜 격리했나 — 감사 로그(M11.3). 사용자가 언제든 역추적할 수 있어야 한다. */
  reason: string
  zone: Zone
}

/** 격리 폴더 이름. 드라이브 루트에 이 이름으로 만든다. */
export const QUARANTINE_DIR = '.teraclean'

/**
 * 옛 이름(클린메이트 시절). v0.4.0까지는 여기에 격리했다.
 *
 * ★ 이름을 바꾼다고 옛 폴더를 잊으면 안 된다. 거기 든 파일은 사용자가
 *   "30일 안에 되돌릴 수 있다"는 말을 믿고 맡긴 것들이다. 목록·복구·만료삭제는
 *   옛 폴더도 함께 본다. 새로 격리하는 건 새 이름으로만 간다.
 */
export const LEGACY_QUARANTINE_DIR = '.cleanmate'

/**
 * 격리 저장소 위치. 원본과 같은 드라이브 루트에 둔다.
 * 테스트에서 갈아끼울 수 있게 함수로 뺐다.
 */
export function quarantineRoot(originalPath: string): string {
  const { root } = parse(originalPath)
  return join(root, QUARANTINE_DIR, 'quarantine')
}

/** 옛 이름으로 만들어진 격리함 위치 */
export function legacyQuarantineRoot(originalPath: string): string {
  const { root } = parse(originalPath)
  return join(root, LEGACY_QUARANTINE_DIR, 'quarantine')
}

export interface QuarantineOptions {
  rootFor?: (originalPath: string) => string
  /**
   * 몇 개까지 처리했나. 오래 걸리는 작업에서 화면이 "지우는 중…"만 띄우면
   * 사용자는 멈춘 건지 도는 건지 알 수 없다 — 실측에서 7,279개에 46초였다.
   * 부르는 쪽이 눌러 담는다(너무 자주 부르면 그리는 게 본 작업보다 느려진다).
   */
  onProgress?: (done: number, total: number, bytes: number) => void
}

const manifestPath = (root: string) => join(root, 'manifest.jsonl')
const storePath = (root: string, id: string) => join(root, 'store', id)

/** 장부 파일 경로. 격리함이 '있는지' 판단하는 유일한 기준이다. */
export const manifestFile = manifestPath

/**
 * 격리함이 있을 수 있는 드라이브 루트 후보.
 *
 * ★ 이게 필요한 이유(실측이 아니라 코드 리뷰에서 잡은 구멍):
 *   격리함은 원본과 '같은 드라이브'에 만들어진다(위 설계 결정 1).
 *   그런데 목록·복구·만료삭제는 전부 시스템 드라이브만 보고 있었다.
 *   D 드라이브를 정리하면 파일은 D:\.cleanmate로 옮겨지는데 격리함 화면엔
 *   안 뜨고, 되돌리기도 못 하고, 30일이 지나도 아무도 안 지운다 —
 *   즉 조용히 사라진 것처럼 보인다. 그래서 전 드라이브를 훑는다.
 */
export function candidateRoots(platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== 'win32') return ['/']
  // A·B는 예전 플로피 자리라 건드리지 않는다(비어 있어도 접근이 느려질 수 있다).
  // 없는 드라이브는 listQuarantineRoots에서 stat 한 번으로 걸러진다.
  return 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `${c}:\\`)
}

/**
 * 실제로 격리함(장부)이 있는 곳만 골라낸다.
 * 새 이름(.teraclean)과 옛 이름(.cleanmate)을 둘 다 본다 —
 * 이름을 바꿨다고 맡아둔 파일을 못 찾으면 그건 잃어버린 것이다.
 */
export async function listQuarantineRoots(opts: {
  platform?: NodeJS.Platform
  exists?: (p: string) => Promise<boolean>
} = {}): Promise<string[]> {
  const ex = opts.exists ?? exists
  const found: string[] = []
  for (const drive of candidateRoots(opts.platform)) {
    for (const root of [quarantineRoot(drive), legacyQuarantineRoot(drive)]) {
      if (await ex(manifestPath(root))) found.push(root)
    }
  }
  return found
}

/* ────────────────────────────────────────────────────────────
   격리
   ──────────────────────────────────────────────────────────── */

export interface QuarantineResult {
  quarantined: QuarantineEntry[]
  /** 실패는 조용히 삼키지 않는다. 왜 못 했는지 사용자에게 말한다. */
  failed: { path: string; reason: string }[]
  bytes: number
}

export interface QuarantineRequest {
  path: string
  reason: string
  zone: Zone
  /** 스캔 시점에 본 크기·수정일. 지금과 다르면 건드리지 않는다. */
  expect?: FileStamp
}

export interface FileStamp {
  size: number
  mtimeMs: number
}

/**
 * 수정일을 하나의 표준형으로 만든다.
 *
 * ★ 이 함수가 있는 이유 (실측으로 잡은 버그):
 *   node의 stat()은 mtimeMs를 소수점까지 준다 — 1784276323518.8796.
 *   그런데 Stats.mtime(Date)은 그 값을 **반올림**해서 만들어진다
 *   (node 내부 dateFromMs = new Date(Math.round(ms))). 스펙상 Date
 *   생성자는 절삭인데, node는 Date를 만들기 전에 이미 반올림해버린다.
 *
 *   그래서 한쪽이 mtime.getTime()(=반올림)으로 저장하고 다른 쪽이
 *   Math.floor(mtimeMs)(=내림)로 비교하면, 소수부가 0.5 이상인 파일마다
 *   어긋난다. 실측에서 파일의 절반이 "바뀌었어요"로 무작위 거부됐다.
 *   안 바뀐 파일인데도.
 *
 *   → 양쪽이 반드시 이 함수를 거치게 한다. 비교하는 두 값이 서로 다른
 *     방식으로 만들어질 여지를 없앤다.
 */
export function stampMtime(mtimeMs: number): number {
  return Math.round(mtimeMs)
}

/**
 * 승인받은 그 파일이 맞는가.
 *
 * 순수 함수로 뺀 이유: 이 판단이 틀리면 두 방향 모두로 위험하다.
 * 과민하면 아무것도 못 지우고(실측 버그), 둔하면 사용자가 방금 고친
 * 파일을 지운다. 그래서 테스트로 직접 겨냥할 수 있어야 한다.
 */
export function isUnchanged(actual: FileStamp, expect: FileStamp): boolean {
  return actual.size === expect.size && stampMtime(actual.mtimeMs) === stampMtime(expect.mtimeMs)
}

/**
 * 파일을 격리한다. 지우지 않는다 — 옮기고 장부에 적는다.
 *
 * 안전 규칙: 스캔 시점과 지금 사이에 파일이 바뀌었으면 건너뛴다.
 *   스캔하고 사용자가 목록을 읽는 사이에 몇 분이 뜬다. 그 사이에
 *   그 파일을 열어서 고쳤을 수 있다. 그러면 사용자가 승인한 파일과
 *   지금 파일이 다른 파일이다. (TOCTOU)
 */
export async function quarantine(
  items: QuarantineRequest[],
  opts: QuarantineOptions = {}
): Promise<QuarantineResult> {
  const rootFor = opts.rootFor ?? quarantineRoot
  const quarantined: QuarantineEntry[] = []
  const failed: QuarantineResult['failed'] = []
  let bytes = 0

  let seen = 0
  for (const item of items) {
    seen++
    opts.onProgress?.(seen, items.length, bytes)
    try {
      const st = await stat(item.path)

      if (!st.isFile()) {
        failed.push({ path: item.path, reason: '파일이 아닙니다' })
        continue
      }

      // 승인받은 그 파일이 맞는지 재검증
      if (item.expect && !isUnchanged({ size: st.size, mtimeMs: st.mtimeMs }, item.expect)) {
        failed.push({
          path: item.path,
          reason: '스캔한 뒤에 파일이 바뀌었어요. 안전을 위해 건너뜁니다.',
        })
        continue
      }

      const root = rootFor(item.path)
      const id = randomUUID()
      const dest = storePath(root, id)
      await mkdir(dirname(dest), { recursive: true })

      await moveFile(item.path, dest)

      const entry: QuarantineEntry = {
        id,
        originalPath: item.path,
        size: st.size,
        mtimeMs: st.mtimeMs,
        quarantinedAt: Date.now(),
        reason: item.reason,
        zone: item.zone,
      }

      // 장부는 '이동 뒤에' 적는다. 순서가 중요하다 —
      // 먼저 적고 이동에 실패하면 장부에 유령이 남고, 복구가 그 유령을
      // 되살리려다 실패한다. 이동이 성공한 것만 장부에 있어야 한다.
      await appendFile(manifestPath(root), JSON.stringify(entry) + '\n', 'utf8')

      quarantined.push(entry)
      bytes += st.size
    } catch (err) {
      failed.push({ path: item.path, reason: describeError(err) })
    }
  }

  return { quarantined, failed, bytes }
}

/**
 * 같은 드라이브면 rename(즉시), 다른 드라이브면 복사+삭제.
 * rename이 EXDEV로 실패하는 경우가 드라이브를 넘는 경우다.
 *
 * relocate.ts(다른 드라이브로 옮기기)도 이걸 쓴다 — EXDEV 처리와
 * "복사 성공 뒤에만 원본 삭제" 순서를 두 군데서 각자 구현하면 언젠가 어긋난다.
 */
export async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    // 복사가 성공한 뒤에만 원본을 지운다. 순서를 바꾸면 데이터가 날아간다.
    await copyFile(from, to)
    await unlink(from)
  }
}

/* ────────────────────────────────────────────────────────────
   복구 — 격리보다 먼저 검증돼야 하는 것.
   복구가 안 되는 격리는 그냥 삭제다.
   ──────────────────────────────────────────────────────────── */

export async function readManifest(root: string): Promise<QuarantineEntry[]> {
  try {
    const raw = await readFile(manifestPath(root), 'utf8')
    return raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as QuarantineEntry)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export interface RestoreResult {
  restored: QuarantineEntry[]
  failed: { entry: QuarantineEntry; reason: string }[]
}

/**
 * 원래 자리로 되돌린다.
 *
 * 자리를 이미 누가 차지했으면 덮어쓰지 않는다. 되돌리려다 남의 파일을
 * 날리면 격리의 존재 이유가 사라진다.
 */
export async function restore(
  ids: string[],
  root: string
): Promise<RestoreResult> {
  const manifest = await readManifest(root)
  const wanted = new Set(ids)
  const restored: QuarantineEntry[] = []
  const failed: RestoreResult['failed'] = []

  for (const entry of manifest) {
    if (!wanted.has(entry.id)) continue

    try {
      // 원래 자리가 비었는지 먼저 본다
      const occupied = await exists(entry.originalPath)
      if (occupied) {
        failed.push({
          entry,
          reason: '원래 자리에 같은 이름의 파일이 이미 있어요. 덮어쓰지 않았습니다.',
        })
        continue
      }

      await mkdir(dirname(entry.originalPath), { recursive: true })
      await moveFile(storePath(root, entry.id), entry.originalPath)

      restored.push(entry)
    } catch (err) {
      failed.push({ entry, reason: describeError(err) })
    }
  }

  // 복구된 항목은 장부에서 뺀다
  if (restored.length) {
    const done = new Set(restored.map((r) => r.id))
    await rewriteManifest(root, manifest.filter((e) => !done.has(e.id)))
  }

  return { restored, failed }
}

/* ────────────────────────────────────────────────────────────
   유예 만료 → 실제 삭제. 여기가 유일하게 진짜 지우는 곳이다.
   ──────────────────────────────────────────────────────────── */

export function isExpired(entry: QuarantineEntry, now = Date.now()): boolean {
  return now - entry.quarantinedAt >= GRACE_DAYS * DAY_MS
}

export interface PurgeResult {
  purged: QuarantineEntry[]
  bytes: number
  failed: { entry: QuarantineEntry; reason: string }[]
}

/** 고른 항목을 실제로 지운다. 아래 두 공개 함수가 공유하는 유일한 삭제 루프. */
async function purgeChosen(
  root: string,
  manifest: QuarantineEntry[],
  chosen: QuarantineEntry[],
  onProgress?: (done: number, total: number, bytes: number) => void
): Promise<PurgeResult> {
  const purged: QuarantineEntry[] = []
  const failed: PurgeResult['failed'] = []
  let bytes = 0

  let seen = 0
  for (const entry of chosen) {
    seen++
    onProgress?.(seen, chosen.length, bytes)
    try {
      await rm(storePath(root, entry.id), { force: true })
      purged.push(entry)
      bytes += entry.size
    } catch (err) {
      failed.push({ entry, reason: describeError(err) })
    }
  }

  if (purged.length) {
    const done = new Set(purged.map((p) => p.id))
    await rewriteManifest(root, manifest.filter((e) => !done.has(e.id)))
  }

  return { purged, bytes, failed }
}

/**
 * 30일이 지난 것만 실제로 지운다. 앱이 켜질 때 조용히 도는 자동 경로다.
 * 자동으로 도는 쪽은 만료된 것 외에는 절대 건드리지 않는다.
 */
export async function purgeExpired(root: string, now = Date.now()): Promise<PurgeResult> {
  const manifest = await readManifest(root)
  return purgeChosen(root, manifest, manifest.filter((e) => isExpired(e, now)))
}

/**
 * 유예를 기다리지 않고 **지금** 비운다.
 *
 * ── 왜 만들었나 ──────────────────────────────────────────────
 * 격리는 "버리기 전에 문 앞에 내놓기"다. 그런데 격리 폴더는 같은 드라이브에
 * 있으므로 **용량이 하나도 안 준다.** 디스크가 92% 찬 사람에게 "30일 뒤에
 * 37GB가 빕니다"는 답이 아니다. 지금 필요해서 이 앱을 연 사람이다.
 * 실제로 "삭제가 안 됐다니 이게 무슨 소리냐"는 말을 들었다.
 *
 * ── 그래도 자동은 아니다 ─────────────────────────────────────
 * 이 함수는 **사용자가 명시적으로 확인한 뒤에만** 불린다. 되돌릴 수 없기
 * 때문이다. 기본 경로는 여전히 30일 격리다 — 되돌릴 수 있다는 게 이 제품의
 * 약속이고, 그 약속을 없애는 게 아니라 '기다리지 않을 자유'를 더하는 것이다.
 */
export async function purgeNow(root: string): Promise<PurgeResult> {
  const manifest = await readManifest(root)
  return purgeChosen(root, manifest, manifest)
}

/**
 * **방금 격리한 것만** 지운다. 격리함에 이미 있던 건 건드리지 않는다.
 *
 * ── 왜 purgeNow로는 안 되나 ──────────────────────────────────
 * purgeNow는 그 드라이브의 격리함을 통째로 비운다. 원클릭이 곧바로 비우게
 * 만들면서 그걸 쓰면, 며칠 전 질문에 "정리해도 돼요"라고 답해 격리해 둔 것들도
 * — 아직 되돌릴 수 있다고 약속한 것들도 — 함께 사라진다. 사용자는 캐시를
 * 비운다고 눌렀을 뿐인데.
 *
 * 그래서 방금 만든 항목의 id만 골라 지운다. 약속의 범위를 좁히지 않는다.
 */
export async function purgeEntries(
  entries: QuarantineEntry[],
  opts: QuarantineOptions = {}
): Promise<PurgeResult> {
  const rootFor = opts.rootFor ?? quarantineRoot
  // 드라이브마다 격리함(장부)이 따로 있다. 원본 경로로 어느 격리함인지 되짚는다.
  const byRoot = new Map<string, QuarantineEntry[]>()
  for (const e of entries) {
    const root = rootFor(e.originalPath)
    const list = byRoot.get(root)
    if (list) list.push(e)
    else byRoot.set(root, [e])
  }

  const purged: QuarantineEntry[] = []
  const failed: PurgeResult['failed'] = []
  let bytes = 0
  for (const [root, mine] of byRoot) {
    const ids = new Set(mine.map((e) => e.id))
    const manifest = await readManifest(root)
    const r = await purgeChosen(root, manifest, manifest.filter((e) => ids.has(e.id)), (d, t, b) =>
      opts.onProgress?.(purged.length + d, entries.length, bytes + b)
    )
    // ★ push(...배열)로 쓰면 안 된다. 인자로 펼치는 건 12만 개쯤에서 스택이 터진다 —
    //   원클릭이 4만~50만 개를 지우는 경로라 정확히 그 사례다(테스트가 잡았다).
    for (const p of r.purged) purged.push(p)
    for (const f of r.failed) failed.push(f)
    bytes += r.bytes
  }
  return { purged, bytes, failed }
}

/* ── 유틸 ──────────────────────────────────────────────────── */

async function rewriteManifest(root: string, entries: QuarantineEntry[]): Promise<void> {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(
    manifestPath(root),
    entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''),
    'utf8'
  )
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** 에러 코드를 사람 말로. "EBUSY"는 사용자에게 아무 의미가 없다. */
function describeError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code
  switch (code) {
    case 'EBUSY':
    case 'EPERM':
      return '다른 프로그램이 이 파일을 쓰고 있어서 옮기지 못했어요.'
    case 'ENOENT':
      return '파일이 이미 없어요.'
    case 'EACCES':
      return '권한이 없어서 접근하지 못했어요.'
    case 'ENOSPC':
      return '디스크에 공간이 없어요.'
    default:
      return `실패: ${code ?? (err as Error).message}`
  }
}
