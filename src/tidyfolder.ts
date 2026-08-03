/**
 * 폴더 한 곳 정리 — 콘텐츠의 '단계'를 앱이 대신 실행한다
 *
 * 생활 정리 콘텐츠(content/tidy.ts)의 바탕화면·다운로드 항목은 단계가
 * 이렇게 적혀 있다: "오늘 날짜 폴더를 만들고 → 작업 중인 것 몇 개만 빼고
 * 통째로 넣는다". 글로만 주면 대부분 안 한다. 그래서 그 단계를 그대로
 * 실행하는 모듈을 둔다.
 *
 * ── 왜 '지우기'가 아니라 '옮기기'인가 ────────────────────────
 * 바탕화면에 있는 건 대개 사용자가 직접 만든 것이다. 지울 대상이 아니라
 * 자리를 못 찾은 것들이다. 한 폴더에 모아두면 화면이 비고, 필요한 건
 * 거기서 꺼내 쓰면 된다. 한 달 뒤에도 안 열었으면 그때 판단하면 된다.
 *
 * ── 되돌리기 ─────────────────────────────────────────────────
 * 옮긴 자리에 장부(moved.jsonl)를 같이 둔다. relocate.ts와 같은 방식이다 —
 * 장부가 파일 옆에 있으면 폴더째 옮겨도 출처를 알 수 있다.
 *
 * ── 안 건드리는 것 ───────────────────────────────────────────
 * 바탕화면에서 파일을 옮기면 바로가기가 깨질 수 있다. 그래서 최근에 손댄 것,
 * 시스템이 쓰는 것, 우리가 만든 정리 폴더는 애초에 후보에서 뺀다.
 */

import { readdir, stat, mkdir, appendFile, readFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { moveFile, isUnchanged, stampMtime } from './quarantine.ts'

/** 이 안에 든 것은 후보로 보지 않는다 — 우리가 만든 폴더이거나 시스템이 쓰는 것 */
const NEVER_TOUCH = [
  /^desktop\.ini$/i,
  /^thumbs\.db$/i,
  /^\.ds_store$/i,
  /^정리-\d{4}-\d{2}$/,
  /^teraclean-moved$/i,
  /^\.(teraclean|cleanmate)$/i, // 격리함(새 이름·옛 이름)
]

/** 기본값: 최근 7일 안에 손댄 것은 '작업 중'으로 보고 그대로 둔다 */
export const DEFAULT_KEEP_DAYS = 7

export interface FolderEntry {
  name: string
  path: string
  size: number
  mtimeMs: number
  isDir: boolean
  /** .lnk 파일이 가리키는 대상. 없으면 undefined, 대상이 사라졌으면 '' */
  linkTarget?: string
  linkBroken?: boolean
}

export interface TidyItem {
  path: string
  name: string
  size: number
  mtimeMs: number
  isDir: boolean
  /** 왜 이렇게 판단했는지 — 근거 없이 옮기지 않는다 */
  reason: string
}

export interface FolderTidyPlan {
  folder: string
  /** 옮겨 넣을 폴더 (예: C:\Users\me\Desktop\정리-2026-08) */
  destFolder: string
  /** 그대로 두는 것 */
  keep: TidyItem[]
  /** 정리 폴더로 옮길 것 */
  moves: TidyItem[]
  /** 대상이 사라진 바로가기 — 옮기는 게 아니라 격리한다(되돌릴 수 있게) */
  broken: TidyItem[]
  bytes: number
}

const DAY_MS = 86_400_000

/** 정리 폴더 이름. 월 단위로 묶는다 — 매일 하면 폴더만 늘어난다. */
export function tidyFolderName(now = Date.now()): string {
  const d = new Date(now)
  return `정리-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 무엇을 옮기고 무엇을 둘지 정한다. 순수 함수 — 파일을 읽지도 건드리지도 않는다.
 *
 * 순수로 뺀 이유: 이 판단이 틀리면 사용자가 지금 쓰는 파일이 사라진 것처럼 보인다.
 * 바탕화면은 특히 그렇다 — 눈에 보이던 게 없어지는 거라 체감이 크다.
 */
export function planFolderTidy(
  entries: FolderEntry[],
  opts: { folder: string; now?: number; keepDays?: number } = { folder: '' }
): FolderTidyPlan {
  const now = opts.now ?? Date.now()
  const keepDays = opts.keepDays ?? DEFAULT_KEEP_DAYS
  const destFolder = join(opts.folder, tidyFolderName(now))

  const keep: TidyItem[] = []
  const moves: TidyItem[] = []
  const broken: TidyItem[] = []
  let bytes = 0

  for (const e of entries) {
    const item: TidyItem = {
      path: e.path,
      name: e.name,
      size: e.size,
      mtimeMs: e.mtimeMs,
      isDir: e.isDir,
      reason: '',
    }

    if (NEVER_TOUCH.some((re) => re.test(e.name))) {
      keep.push({ ...item, reason: '시스템이 쓰거나 정리 도구가 만든 항목입니다.' })
      continue
    }

    // 대상이 사라진 바로가기 — 눌러도 아무 일 안 일어나는 아이콘이다
    if (e.linkBroken) {
      broken.push({ ...item, reason: '가리키는 프로그램이나 파일이 이제 없습니다. 눌러도 열리지 않아요.' })
      continue
    }

    const ageDays = Math.floor((now - e.mtimeMs) / DAY_MS)
    if (ageDays < keepDays) {
      keep.push({ ...item, reason: `${keepDays}일 안에 손대신 것이라 작업 중으로 봅니다.` })
      continue
    }

    moves.push({
      ...item,
      reason: `${ageDays}일 동안 손대지 않으셨어요. 지우지 않고 정리 폴더로 옮깁니다.`,
    })
    bytes += e.size
  }

  // 큰 것부터. 목록을 위에서부터 훑으면 체감이 큰 것이 먼저 보인다.
  moves.sort((a, b) => b.size - a.size)

  return { folder: opts.folder, destFolder, keep, moves, broken, bytes }
}

/* ────────────────────────────────────────────────────────────
   실행 (IO)
   ──────────────────────────────────────────────────────────── */

export interface TidyLedgerEntry {
  id: string
  originalPath: string
  movedTo: string
  size: number
  mtimeMs: number
  movedAt: number
}

const ledgerPath = (destFolder: string) => join(destFolder, 'moved.jsonl')

/** 폴더 목록을 읽는다. 바로가기 대상 확인은 호출자가 채워 넣는다(플랫폼 의존). */
export async function readFolderEntries(folder: string): Promise<FolderEntry[]> {
  const names = await readdir(folder, { withFileTypes: true })
  const out: FolderEntry[] = []
  for (const d of names) {
    if (d.isSymbolicLink()) continue
    const full = join(folder, d.name)
    try {
      const st = await stat(full)
      out.push({
        name: d.name,
        path: full,
        size: st.isDirectory() ? 0 : st.size,
        mtimeMs: stampMtime(st.mtimeMs),
        isDir: st.isDirectory(),
      })
    } catch {
      /* 읽을 수 없는 항목은 건너뛴다 — 못 읽는 걸 옮기려 들지 않는다 */
    }
  }
  return out
}

export interface FolderTidyResult {
  movedCount: number
  movedBytes: number
  failed: { path: string; reason: string }[]
  destFolder: string
}

/**
 * 계획을 실행한다. 옮기기만 한다 — 지우지 않는다.
 *
 * 계획을 세운 뒤 사용자가 파일을 고쳤을 수 있으므로 옮기기 직전에 다시 확인한다
 * (격리와 같은 TOCTOU 방어). 하나 실패해도 나머지는 진행하고 정직하게 보고한다.
 */
export async function applyFolderTidy(plan: FolderTidyPlan): Promise<FolderTidyResult> {
  const failed: FolderTidyResult['failed'] = []
  let movedCount = 0
  let movedBytes = 0

  if (plan.moves.length) await mkdir(plan.destFolder, { recursive: true })

  for (const item of plan.moves) {
    try {
      const st = await stat(item.path)
      if (!item.isDir && !isUnchanged({ size: st.size, mtimeMs: st.mtimeMs }, { size: item.size, mtimeMs: item.mtimeMs })) {
        failed.push({ path: item.path, reason: '계획을 세운 뒤에 바뀌어서 건너뛰었어요.' })
        continue
      }

      // 같은 이름이 이미 있으면 덮어쓰지 않는다. 덮어쓰면 되돌려도 원본이 없다.
      let dest = join(plan.destFolder, item.name)
      let n = 2
      while (await exists(dest)) dest = join(plan.destFolder, `${stripExt(item.name)} (${n++})${extOf(item.name)}`)

      await moveFile(item.path, dest)

      const entry: TidyLedgerEntry = {
        id: randomUUID(),
        originalPath: item.path,
        movedTo: dest,
        size: item.size,
        mtimeMs: item.mtimeMs,
        movedAt: Date.now(),
      }
      // 장부는 이동 뒤에 적는다 — 실패한 것이 장부에 남으면 복구가 유령을 쫓는다.
      await appendFile(ledgerPath(plan.destFolder), JSON.stringify(entry) + '\n', 'utf8')

      movedCount++
      movedBytes += item.size
    } catch (err) {
      failed.push({ path: item.path, reason: describe(err) })
    }
  }

  return { movedCount, movedBytes, failed, destFolder: plan.destFolder }
}

export async function readTidyLedger(destFolder: string): Promise<TidyLedgerEntry[]> {
  try {
    const raw = await readFile(ledgerPath(destFolder), 'utf8')
    return raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as TidyLedgerEntry)
  } catch {
    return []
  }
}

export interface FolderUndoResult {
  restoredCount: number
  failed: { path: string; reason: string }[]
}

/** 전부 원래 자리로. 자리를 누가 차지했으면 덮어쓰지 않는다. */
export async function undoFolderTidy(destFolder: string): Promise<FolderUndoResult> {
  const entries = await readTidyLedger(destFolder)
  const failed: FolderUndoResult['failed'] = []
  let restoredCount = 0
  const remaining: TidyLedgerEntry[] = []

  for (const e of entries) {
    try {
      if (await exists(e.originalPath)) {
        failed.push({ path: e.originalPath, reason: '원래 자리에 같은 이름이 이미 있어요. 덮어쓰지 않았습니다.' })
        remaining.push(e)
        continue
      }
      await moveFile(e.movedTo, e.originalPath)
      restoredCount++
    } catch (err) {
      failed.push({ path: e.originalPath, reason: describe(err) })
      remaining.push(e)
    }
  }

  if (restoredCount) {
    const { writeFile, unlink, rmdir } = await import('node:fs/promises')
    if (remaining.length) {
      await writeFile(
        ledgerPath(destFolder),
        remaining.map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf8'
      )
    } else {
      // 전부 되돌아왔으면 흔적을 남기지 않는다. 빈 '정리-2026-08' 폴더가
      // 바탕화면에 남아 있으면, 정리해준 도구가 새 쓰레기를 하나 만든 셈이다.
      // rmdir은 폴더가 비어 있을 때만 성공한다 — 사용자가 그 안에 뭘 넣었으면 그대로 둔다.
      try {
        await unlink(ledgerPath(destFolder))
        await rmdir(destFolder)
      } catch {
        /* 안에 다른 게 있으면 그대로 둔다 */
      }
    }
  }
  return { restoredCount, failed }
}

/* ── 유틸 ──────────────────────────────────────────────────── */

const extOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.')) : '')
const stripExt = (name: string) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name)

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

function describe(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code
  switch (code) {
    case 'EBUSY':
    case 'EPERM':
      return '다른 프로그램이 쓰고 있어서 옮기지 못했어요.'
    case 'ENOENT':
      return '파일이 이미 없어요.'
    case 'EACCES':
      return '권한이 없어서 접근하지 못했어요.'
    default:
      return `실패: ${code ?? (err as Error).message}`
  }
}

/** 표시용 이름 — 경로 전체는 화면에서 읽기 어렵다 */
export const displayName = (p: string) => basename(p)
