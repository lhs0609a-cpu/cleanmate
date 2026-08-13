/**
 * 다른 드라이브로 옮기기 — "C에 꽉 찼는데 지우긴 아깝다"의 답
 *
 * 삭제가 아니라 이동이다. 용량 부족의 절반은 "지울 순 없는데 자리를 차지하는 것"이고,
 * 그건 지우는 게 아니라 옮겨야 한다.
 *
 * ── 옮기기가 지우기보다 위험할 수 있다 ────────────────────────
 * 지우면 격리함에 남아 되돌릴 수 있다. 옮기면 파일은 멀쩡한데 **그 파일을
 * 가리키던 것들이 깨진다** — 프로그램 설정, 바로가기, 라이브러리 경로.
 * 그래서 이동 대상은 삭제 대상보다 좁게 잡는다:
 *   - 존 C(잠금)는 당연히 제외
 *   - 프로그램이 설치된 위치·시스템 폴더·앱 설정은 제외 (파일은 살아도 앱이 깨진다)
 *   - 사용자 데이터(영상·이미지·압축파일 같은 큰 덩어리)만 대상
 *
 * ── 되돌릴 수 있어야 한다 ──────────────────────────────────────
 * 옮긴 자리에 장부(moved.jsonl)를 같이 둔다. 장부가 파일 옆에 있으면
 * 외장하드를 다른 PC에 꽂아도 어디서 왔는지 알 수 있다.
 * 중앙 장부는 드라이브를 뽑는 순간 실물과 어긋난다.
 */

import { stat, mkdir, appendFile, readFile } from 'node:fs/promises'
import { statfs } from 'node:fs/promises'
import { parse, join, relative, dirname, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { moveFile, isUnchanged, stampMtime } from './quarantine.ts'
import type { Classified } from './types.ts'

/** 옮긴 파일이 모이는 폴더 이름. 대상 드라이브 루트 아래 만든다. */
export const MOVED_FOLDER = 'TeraClean-Moved'
/** 대상 드라이브에 최소한 남겨둘 여유. 꽉 채우면 그 드라이브가 다음 문제가 된다. */
export const FREE_SPACE_MARGIN = 5 * 1024 * 1024 * 1024 // 5GB

export interface RelocateItem {
  path: string
  size: number
  meaning: string
  reason: string
  mtimeMs: number
}

export interface RelocateEntry {
  id: string
  originalPath: string
  movedTo: string
  size: number
  mtimeMs: number
  movedAt: number
  reason: string
  /**
   * 무엇을 옮겼나. 없으면 파일이다(옛 장부와 호환).
   *
   * 'folder'는 폴더째 옮기고 원래 자리에 정션을 남긴 것이다 — 되돌리는 방법이
   * 파일과 완전히 다르다(정션을 먼저 걷어내야 한다). 장부에 안 적으면
   * 되돌리기가 정션 위에 파일을 복사하려 든다.
   */
  kind?: 'file' | 'folder'
  /** 폴더일 때 안에 든 파일 수 */
  files?: number
}

export interface RelocatePlan {
  /** 옮길 대상 폴더 (예: D:\TeraClean-Moved) */
  destFolder: string
  items: { item: RelocateItem; dest: string }[]
  bytes: number
  skipped: { path: string; reason: string }[]
}

export interface RelocateResult {
  movedCount: number
  movedBytes: number
  failed: { path: string; reason: string }[]
  ledgerPath: string
}

/* ────────────────────────────────────────────────────────────
   판단 — 전부 순수 함수. 여기가 틀리면 앱이 깨지므로 테스트로 겨냥한다.
   ──────────────────────────────────────────────────────────── */

/**
 * 옮기면 안 되는 경로.
 *
 * 지우면 안 되는 것(존 C)과 겹치지만 같지 않다. 예를 들어 다운로드한 설치 파일은
 * 지워도 되지만, 프로그램이 설치된 폴더는 지우면 안 될 뿐 아니라 **옮겨서도** 안 된다.
 * 파일이 살아 있어도 프로그램이 그 경로를 못 찾으면 똑같이 깨진다.
 */
const NEVER_MOVE = [
  { test: /[\\/]windows[\\/]/i, why: '윈도우 시스템 폴더' },
  { test: /[\\/]program files( \(x86\))?[\\/]/i, why: '설치된 프로그램' },
  { test: /[\\/]programdata[\\/]/i, why: '프로그램 공용 데이터' },
  { test: /[\\/]appdata[\\/]local[\\/]programs[\\/]/i, why: '사용자 폴더에 설치된 프로그램' },
  { test: /[\\/]appdata[\\/]roaming[\\/]/i, why: '앱 설정 — 옮기면 설정이 초기화됩니다' },
  { test: /[\\/]\$recycle\.bin[\\/]/i, why: '휴지통' },
  { test: /[\\/]system volume information[\\/]/i, why: '시스템 복원' },
  // 새 이름(.teraclean)과 옛 이름(.cleanmate) 둘 다. 옛 격리함에도 사용자 파일이 들어 있다.
  { test: /[\\/]\.(teraclean|cleanmate)[\\/]/i, why: '보관함 — 여기서 직접 옮기면 안 됩니다' },
  { test: new RegExp(`[\\\\/]${MOVED_FOLDER}[\\\\/]`, 'i'), why: '이미 옮겨둔 폴더' },
  { test: /[\\/]node_modules[\\/]/i, why: '부품 폴더 — 옮기면 그 프로그램이 못 찾습니다' },
  /**
   * ★ 가상환경. node_modules는 막아뒀는데 .venv는 빠져 있었다 — 파이썬 쪽이
   *   훨씬 위험한데도. 가상환경은 **자기 절대 경로를 안에 적어두고**(pyvenv.cfg,
   *   Scripts의 실행 파일들) 그 경로로 자신을 찾는다. 드라이브만 바뀌어도
   *   `python`이 안 뜬다. 게다가 파일 하나(1.2GB짜리 dll)만 빼가면 폴더는
   *   멀쩡해 보이는데 import만 실패한다 — 원인을 찾기가 가장 어려운 고장이다.
   */
  { test: /[\\/](\.venv|venv|site-packages|__pycache__|\.git)[\\/]/i, why: '프로그램 부품 상자 — 옮기면 그 프로그램이 못 찾습니다' },
  /**
   * ★ AppData\Local 전체. 여태는 Local\Programs만 막았는데, 그건 이 화면이
   *   사용자 폴더(다운로드·영상·사진)만 훑던 시절의 규칙이다. 이제 질문 목록에서
   *   고른 파일을 그대로 옮길 수 있게 되면서 AppData 경로가 직접 들어온다 —
   *   `AppData\Local\MusicFactory\...\torch_cuda.dll` 같은 것들이다.
   *   프로그램이 자기 자리에 저장한 것이라 파일이 살아 있어도 그 앱은 못 찾는다.
   *   (지우는 건 격리함이 되돌려주지만, 옮기기는 앱이 조용히 고장 난다)
   *
   *   node_modules·가상환경 규칙보다 **뒤에** 둔다. 둘 다 걸리는 경로에서는
   *   "개발 환경 폴더"가 더 정확한 설명이고, 사용자가 다음에 할 행동도 달라진다.
   */
  { test: /[\\/]appdata[\\/]local[\\/]/i, why: '프로그램이 저장한 자료 — 옮기면 그 앱이 못 찾습니다' },
  { test: /[\\/](onedrive|dropbox|google drive|drivefs)[\\/]/i, why: '클라우드와 자동으로 맞추는 폴더' },
]

/**
 * 실행·연결에 쓰이는 파일 — 자리를 옮기면 부르는 쪽이 못 찾는다.
 *
 * 설치 파일(.exe·.msi)은 뺀다. 다운로드 폴더의 설치 파일은 옮겨도 아무도 안 깨지고,
 * 오히려 크기가 커서 옮길 값어치가 있다. 여기 넣는 건 **다른 프로그램이 경로로
 * 불러 쓰는 것들**이다.
 */
const NEVER_MOVE_EXT = /\.(dll|pyd|lib|so|dylib|sys|drv|ocx|node)$/i

export interface Relocatable {
  ok: boolean
  reason?: string
}

/**
 * 경로만 보고 옮기면 안 되는 이유를 찾는다. 없으면 null.
 *
 * ★ 왜 분류(Classified) 없이 쓰는 길을 따로 두나: 화면이 파일 목록을 그릴 때
 *   "이건 옮길 수 있다/없다"를 **미리** 보여줘야 한다. 그때는 스캔 결과가 아니라
 *   경로 문자열만 있다. 실행 직전에는 isRelocatable이 존까지 다시 본다 —
 *   보여주기는 느슨하게, 실행은 엄격하게.
 */
export function relocateBlockReason(path: string): string | null {
  for (const rule of NEVER_MOVE) {
    if (rule.test.test(path)) return rule.why
  }
  if (NEVER_MOVE_EXT.test(path)) {
    return '프로그램이 불러 쓰는 파일 — 자리를 옮기면 못 찾습니다'
  }
  return null
}

/**
 * 이 파일을 다른 드라이브로 옮겨도 되는가.
 * 모르면 거절한다 — 이동은 되돌리기가 삭제보다 번거롭다.
 */
export function isRelocatable(c: Classified): Relocatable {
  if (c.verdict.zone === 'LOCKED') {
    return { ok: false, reason: `잠근 항목입니다 (${c.verdict.meaning})` }
  }
  const blocked = relocateBlockReason(c.path)
  return blocked ? { ok: false, reason: blocked } : { ok: true }
}

/** 드라이브 루트를 대문자로 정규화한다. 'c:\' 와 'C:\' 는 같은 드라이브다. */
export function volumeOf(path: string): string {
  return parse(path).root.toUpperCase()
}

/** 원본과 대상이 같은 드라이브인가. 같으면 옮겨도 용량이 안 는다. */
export function isSameVolume(a: string, b: string): boolean {
  return volumeOf(a) === volumeOf(b)
}

/**
 * 옮길 위치를 정한다. 드라이브 안에서의 상대 경로를 그대로 유지한다.
 *
 *   C:\Users\me\Videos\a.mp4  →  D:\TeraClean-Moved\Users\me\Videos\a.mp4
 *
 * 파일 이름만 쓰면 서로 다른 폴더의 같은 이름이 충돌한다
 * (Videos\a.mp4 와 Downloads\a.mp4). 구조를 유지하면 충돌이 없고,
 * 나중에 사람이 폴더를 열어봐도 어디서 왔는지 알 수 있다.
 */
export function destinationFor(originalPath: string, destFolder: string): string {
  const { root } = parse(originalPath)
  const rel = relative(root, originalPath)
  return join(destFolder, rel)
}

/** 대상 드라이브의 TeraClean-Moved 폴더 경로 */
export function movedFolderOn(destRoot: string): string {
  return join(parse(destRoot).root || destRoot, MOVED_FOLDER)
}

/**
 * 여유 공간이 충분한가. 딱 맞게 채우지 않고 여유를 남긴다 —
 * 대상 드라이브를 꽉 채우면 그 드라이브가 다음 문제가 된다.
 */
export function hasEnoughSpace(freeBytes: number, needBytes: number, margin = FREE_SPACE_MARGIN): boolean {
  return freeBytes - needBytes >= margin
}

/* ────────────────────────────────────────────────────────────
   계획 · 실행
   ──────────────────────────────────────────────────────────── */

/** 대상 드라이브의 남은 공간(바이트). 못 구하면 null. */
export async function freeSpaceOn(destRoot: string): Promise<number | null> {
  try {
    const fs = await statfs(destRoot)
    return Number(fs.bavail) * Number(fs.bsize)
  } catch {
    return null
  }
}

/**
 * 계획만 세운다. 아무것도 건드리지 않는다 — 미리보기가 기본이다.
 */
export function planRelocate(items: RelocateItem[], destRoot: string): RelocatePlan {
  const destFolder = movedFolderOn(destRoot)
  const planned: RelocatePlan['items'] = []
  const skipped: RelocatePlan['skipped'] = []
  let bytes = 0

  for (const item of items) {
    if (isSameVolume(item.path, destFolder)) {
      skipped.push({ path: item.path, reason: '같은 드라이브라 옮겨도 용량이 늘지 않습니다' })
      continue
    }
    planned.push({ item, dest: destinationFor(item.path, destFolder) })
    bytes += item.size
  }

  // 큰 것부터 — 중간에 멈춰도 효과가 큰 것부터 옮겨져 있다.
  planned.sort((a, b) => b.item.size - a.item.size)
  return { destFolder, items: planned, bytes, skipped }
}

export const ledgerPathFor = (destFolder: string) => join(destFolder, 'moved.jsonl')

/**
 * 계획을 실행한다.
 *
 * 순서가 중요하다 — quarantine과 같은 규칙:
 *   재검증(TOCTOU) → 이동 → 장부. 장부를 먼저 적으면 실패 시 유령이 남는다.
 */
export async function applyRelocate(plan: RelocatePlan): Promise<RelocateResult> {
  const failed: RelocateResult['failed'] = []
  const ledger = ledgerPathFor(plan.destFolder)
  let movedCount = 0
  let movedBytes = 0

  for (const { item, dest } of plan.items) {
    try {
      const st = await stat(item.path)
      if (!st.isFile()) {
        failed.push({ path: item.path, reason: '파일이 아닙니다' })
        continue
      }
      // 계획을 세운 뒤 사용자가 그 파일을 고쳤을 수 있다.
      if (!isUnchanged({ size: st.size, mtimeMs: st.mtimeMs }, { size: item.size, mtimeMs: item.mtimeMs })) {
        failed.push({ path: item.path, reason: '계획을 세운 뒤에 파일이 바뀌었어요. 안전을 위해 건너뜁니다.' })
        continue
      }
      // 대상 자리에 이미 뭔가 있으면 덮어쓰지 않는다. 남의 파일을 날리면 안 된다.
      if (await exists(dest)) {
        failed.push({ path: item.path, reason: '옮길 자리에 같은 이름의 파일이 이미 있어요' })
        continue
      }

      await mkdir(dirname(dest), { recursive: true })
      await moveFile(item.path, dest)

      const entry: RelocateEntry = {
        id: randomUUID(),
        originalPath: item.path,
        movedTo: dest,
        size: st.size,
        mtimeMs: stampMtime(st.mtimeMs),
        movedAt: Date.now(),
        reason: item.reason,
      }
      await appendFile(ledger, JSON.stringify(entry) + '\n', 'utf8')

      movedCount++
      movedBytes += st.size
    } catch (err) {
      failed.push({ path: item.path, reason: (err as Error).message ?? String(err) })
    }
  }

  return { movedCount, movedBytes, failed, ledgerPath: ledger }
}

/** 옮긴 기록을 읽는다. 장부가 없으면 빈 목록. */
export async function readRelocateLedger(destFolder: string): Promise<RelocateEntry[]> {
  try {
    const raw = await readFile(ledgerPathFor(destFolder), 'utf8')
    return raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as RelocateEntry)
  } catch {
    return []
  }
}

export interface UndoResult {
  restored: RelocateEntry[]
  failed: { entry: RelocateEntry; reason: string }[]
}

/**
 * 옮긴 걸 원래 자리로 되돌린다.
 * 원래 자리를 누가 차지했으면 덮어쓰지 않는다 — 되돌리려다 남의 파일을 날리면
 * 이동 기능의 존재 이유가 사라진다. (quarantine의 restore와 같은 규칙)
 */
export async function undoRelocate(ids: string[], destFolder: string): Promise<UndoResult> {
  const entries = await readRelocateLedger(destFolder)
  const wanted = new Set(ids)
  const restored: RelocateEntry[] = []
  const failed: UndoResult['failed'] = []

  for (const entry of entries) {
    if (!wanted.has(entry.id)) continue
    try {
      // 폴더는 되돌리는 방법이 다르다 — 정션을 먼저 걷어내야 한다.
      if (entry.kind === 'folder') {
        const r = await undoFolderJunction(entry.originalPath, entry.movedTo)
        if (r.ok) restored.push(entry)
        else failed.push({ entry, reason: r.reason ?? '되돌리지 못했어요' })
        continue
      }
      if (await exists(entry.originalPath)) {
        failed.push({ entry, reason: '원래 자리에 다른 파일이 생겼어요. 덮어쓰지 않았습니다.' })
        continue
      }
      await mkdir(dirname(entry.originalPath), { recursive: true })
      await moveFile(entry.movedTo, entry.originalPath)
      restored.push(entry)
    } catch (err) {
      failed.push({ entry, reason: (err as Error).message ?? String(err) })
    }
  }

  return { restored, failed }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/* ────────────────────────────────────────────────────────────
   폴더째 옮기고 자리에 바로가기(정션)를 남기기

   ★ 이 기능이 위의 '옮기면 안 되는 목록'을 뒤집는다.

   NEVER_MOVE의 이유는 전부 하나였다 — "파일은 살아도 그 경로를 찾던 프로그램이
   깨진다". 그런데 폴더를 옮기고 **원래 자리에 정션(디렉터리 바로가기)을 남기면
   그 이유가 사라진다.** 프로그램이 C:\...\.venv를 열면 윈도우가 D:의 실물로
   조용히 이어준다. 게임 라이브러리를 다른 드라이브로 옮길 때 쓰는 그 방법이다.

   정션은 관리자 권한이 필요 없다(심볼릭 링크와 다르다). 그래서 우리가 할 수 있다.

   ── 그래도 안 되는 것 ────────────────────────────────────────
   윈도우 자신·설치된 프로그램·클라우드 동기화 폴더는 여전히 막는다.
     - 윈도우 폴더: 업데이트·복구가 실제 경로를 전제로 동작한다
     - Program Files: 설치 관리자가 자기 복구를 돌릴 때 깨진다
     - 동기화 폴더: 동기화 클라이언트가 통째로 다시 올리거나 내린다
   즉 "정션이면 다 된다"가 아니라 **"정션이면 앱 데이터·개발 환경·게임은 된다"**다.

   ── 순서가 데이터를 지킨다 ───────────────────────────────────
   복사 → 개수·용량 대조 → 원본 삭제 → 정션 생성.
   대조 없이 지우면 복사가 절반만 됐어도 알 수 없고, 정션을 먼저 만들면
   자기 자신을 가리키는 경로가 생긴다.
   ──────────────────────────────────────────────────────────── */

/** 정션으로도 옮기면 안 되는 곳. 위의 NEVER_MOVE보다 짧다 — 이유가 달라서다. */
const NEVER_JUNCTION = [
  { test: /[\\/]windows[\\/]/i, why: '윈도우 시스템 폴더' },
  { test: /[\\/]program files( \(x86\))?[\\/]/i, why: '설치된 프로그램 — 프로그램이 자기 파일을 못 찾게 됩니다' },
  { test: /[\\/]programdata[\\/]/i, why: '프로그램 공용 데이터' },
  { test: /[\\/](onedrive|dropbox|google drive|drivefs|icloud)[\\/]/i, why: '클라우드와 자동으로 맞추는 폴더 — 통째로 다시 올라갑니다' },
  { test: /[\\/]\$recycle\.bin[\\/]/i, why: '휴지통' },
  { test: /[\\/]system volume information[\\/]/i, why: '시스템 복원' },
  { test: /[\\/]\.(teraclean|cleanmate)[\\/]/i, why: '보관함' },
  { test: new RegExp(`[\\\\/]${MOVED_FOLDER}[\\\\/]`, 'i'), why: '이미 옮겨둔 폴더' },
]

/**
 * 이 폴더를 옮기고 정션을 남겨도 되나. 경로만 보고 답한다.
 *
 * 너무 얕은 경로(드라이브 뿌리·사용자 폴더 자체)도 막는다. C:\Users\me를 통째로
 * 옮기면 그건 이사지 정리가 아니고, 실패했을 때 되돌릴 수 있는 규모가 아니다.
 */
export function junctionBlockReason(path: string): string | null {
  const norm = path.replace(/\//g, '\\').replace(/\\+$/, '')
  for (const rule of NEVER_JUNCTION) {
    if (rule.test.test(norm + '\\')) return rule.why
  }
  const segs = norm.split('\\').filter(Boolean)
  if (segs.length <= 1) return '드라이브 전체는 옮길 수 없어요'
  if (/^users$/i.test(segs[1] ?? '') && segs.length <= 3) {
    return '사용자 폴더 전체는 옮기지 않아요 — 되돌리기가 감당이 안 되는 규모입니다'
  }
  return null
}

export interface FolderMoveResult {
  ok: boolean
  /** 실물이 실제로 있는 자리 */
  movedTo: string
  /** 원래 자리에 정션을 만들었나 */
  linked: boolean
  copiedFiles: number
  copiedBytes: number
  /** 안 됐으면 왜 — 사람이 읽을 문장 */
  reason?: string
}

/** 폴더 안의 파일 수·합계. 복사가 제대로 됐는지 대조하는 데만 쓴다. */
export async function measureFolder(dir: string): Promise<{ files: number; bytes: number }> {
  const { readdir } = await import('node:fs/promises')
  let files = 0
  let bytes = 0
  async function walk(d: string): Promise<void> {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(d, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        await walk(full)
        continue
      }
      if (!e.isFile()) continue
      try {
        const st = await stat(full)
        files++
        bytes += st.size
      } catch {
        /* 못 읽은 파일은 세지 않는다 — 대조가 느슨해지는 쪽이 안전하다 */
      }
    }
  }
  await walk(dir)
  return { files, bytes }
}

/**
 * 폴더를 다른 드라이브로 옮기고 원래 자리에 정션을 남긴다.
 *
 * 실패하면 **원본을 그대로 둔다.** 이 함수가 지켜야 할 유일한 약속이다.
 */
export async function moveFolderWithJunction(src: string, dest: string): Promise<FolderMoveResult> {
  const { cp, rm, symlink } = await import('node:fs/promises')
  const fail = (reason: string): FolderMoveResult =>
    ({ ok: false, movedTo: '', linked: false, copiedFiles: 0, copiedBytes: 0, reason })

  const blocked = junctionBlockReason(src)
  if (blocked) return fail(blocked)

  try {
    if (!(await stat(src)).isDirectory()) return fail('폴더가 아니에요')
  } catch {
    return fail('폴더를 찾지 못했어요')
  }
  if (await exists(dest)) return fail('옮길 자리에 같은 이름의 폴더가 이미 있어요')

  const before = await measureFolder(src)

  // ① 복사. 원본은 아직 그대로다.
  await mkdir(dirname(dest), { recursive: true })
  try {
    await cp(src, dest, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true })
  } catch (err) {
    // 반쯤 복사된 것을 남기지 않는다 — 다음 시도의 '이미 있어요'가 된다.
    await rm(dest, { recursive: true, force: true }).catch(() => {})
    return fail(`복사하지 못했어요: ${(err as Error).message}`)
  }

  // ② 대조. 개수와 용량이 같아야 원본을 지운다.
  const after = await measureFolder(dest)
  if (after.files !== before.files || after.bytes !== before.bytes) {
    await rm(dest, { recursive: true, force: true }).catch(() => {})
    return fail(
      `복사한 결과가 원본과 달라요 (원본 ${before.files}개·대상 ${after.files}개). 아무것도 지우지 않았습니다.`
    )
  }

  // ③ 원본 삭제 → ④ 정션. 이 사이가 유일하게 위험한 구간이라 바로 붙여 둔다.
  try {
    await rm(src, { recursive: true, force: true })
  } catch (err) {
    await rm(dest, { recursive: true, force: true }).catch(() => {})
    return fail(`원본을 비우지 못했어요(사용 중일 수 있어요): ${(err as Error).message}`)
  }

  try {
    await symlink(dest, src, 'junction')
  } catch (err) {
    // 실물은 dest에 멀쩡히 있다. 그 사실을 정확히 알려준다 — 여기서 얼버무리면
    // 사용자는 파일이 사라진 줄 안다.
    return {
      ok: false,
      movedTo: dest,
      linked: false,
      copiedFiles: after.files,
      copiedBytes: after.bytes,
      reason:
        `옮기기는 끝났는데 원래 자리에 바로가기를 못 만들었어요(${(err as Error).message}). ` +
        `파일은 ${dest}에 그대로 있습니다.`,
    }
  }

  return { ok: true, movedTo: dest, linked: true, copiedFiles: after.files, copiedBytes: after.bytes }
}

/**
 * 정션으로 옮긴 폴더를 되돌린다. 정션을 먼저 걷어내고 실물을 제자리로.
 * 순서를 바꾸면 자기 자신 위로 복사하게 된다.
 */
export async function undoFolderJunction(originalPath: string, movedTo: string): Promise<{ ok: boolean; reason?: string }> {
  const { rm, cp, lstat, unlink } = await import('node:fs/promises')
  try {
    const st = await lstat(originalPath).catch(() => null)
    if (st) {
      if (!st.isSymbolicLink() && !st.isDirectory()) return { ok: false, reason: '원래 자리에 다른 게 있어요' }
      if (st.isSymbolicLink()) await unlink(originalPath)
      // 정션이 아니라 실제 폴더가 생겼다면 덮어쓰지 않는다.
      else if ((await measureFolder(originalPath)).files > 0) {
        return { ok: false, reason: '원래 자리에 새 파일이 생겼어요. 덮어쓰지 않았습니다.' }
      } else await rm(originalPath, { recursive: true, force: true })
    }
    await mkdir(dirname(originalPath), { recursive: true })
    await cp(movedTo, originalPath, { recursive: true, preserveTimestamps: true })
    await rm(movedTo, { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: (err as Error).message }
  }
}

/* ────────────────────────────────────────────────────────────
   자동 목록 — "폴더를 고르세요"를 없앤다

   ★ 왜: 이 화면은 여태 '옮길 폴더 고르기'부터 시작했다. 그런데 어느 폴더에
     큰 게 들어 있는지 아는 사람이면 애초에 이 기능이 필요 없다. 용량이 부족한
     사람은 어디를 봐야 할지 몰라서 부족한 거다.
     (같은 이유로 스캔 쪽은 이미 기본 목록을 쓴다 — presets.ts 머리말)
   ──────────────────────────────────────────────────────────── */

/**
 * 옮길 것을 찾아볼 곳.
 *
 * ★ 스캔 기본 목록(presets.defaultRoots)과 **일부러 다르다.** 거기엔 AppData가
 *   들어 있는데, 앱 데이터는 지워도 되는 캐시일지언정 **옮기면 앱이 깨진다.**
 *   파일이 살아 있어도 프로그램이 그 경로를 못 찾으면 똑같이 고장이다.
 *   그래서 여기는 사람이 만든 큰 덩어리가 사는 곳만 본다.
 */
export function relocateRoots(env: { platform: NodeJS.Platform; home: string }): { label: string; path: string }[] {
  const j = (...p: string[]) => p.join(env.platform === 'win32' ? '\\' : '/')
  return [
    { label: '다운로드', path: j(env.home, 'Downloads') },
    { label: '동영상', path: j(env.home, 'Videos') },
    { label: '사진', path: j(env.home, 'Pictures') },
    { label: '문서', path: j(env.home, 'Documents') },
    { label: '바탕화면', path: j(env.home, 'Desktop') },
    { label: '음악', path: j(env.home, 'Music') },
  ]
}

export interface DriveInfo {
  root: string
  total: number
  free: number
  /** 윈도우가 깔린 드라이브 — 여기로 옮기면 용량이 안 는다 */
  isSystem: boolean
}

/**
 * 붙어 있는 드라이브를 훑는다. 대상으로 고를 수 있게 남은 공간과 함께 준다.
 *
 * 드라이브 목록을 얻자고 wmic·PowerShell을 부르지 않는다(의존성 0 원칙).
 * A–Z를 statfs로 두들겨 보면 붙어 있는 것만 답한다 — 없는 letter는 즉시 실패한다.
 */
export async function listDrives(): Promise<DriveInfo[]> {
  if (process.platform !== 'win32') return []
  const system = (process.env.SystemDrive ?? 'C:').toUpperCase()
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZAB'.split('')
  const found: DriveInfo[] = []
  await Promise.all(
    letters.map(async (L) => {
      const root = `${L}:\\`
      try {
        const fs = await statfs(root)
        const total = Number(fs.blocks) * Number(fs.bsize)
        if (!total) return
        found.push({
          root,
          total,
          free: Number(fs.bavail) * Number(fs.bsize),
          isSystem: `${L}:` === system,
        })
      } catch {
        /* 그 letter엔 드라이브가 없다 */
      }
    })
  )
  return found.sort((a, b) => a.root.localeCompare(b.root))
}

/** 경로 표시용 — UI에서 긴 경로를 줄여 보여줄 때. */
export function shortenPath(path: string, keep = 3): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= keep + 1) return path
  return parts[0] + sep + '…' + sep + parts.slice(-keep).join(sep)
}
