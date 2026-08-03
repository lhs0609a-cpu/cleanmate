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
  { test: /[\\/]\.(teraclean|cleanmate)[\\/]/i, why: '격리함 — 여기서 직접 옮기면 안 됩니다' },
  { test: new RegExp(`[\\\\/]${MOVED_FOLDER}[\\\\/]`, 'i'), why: '이미 옮겨둔 폴더' },
  { test: /[\\/]node_modules[\\/]/i, why: '패키지 폴더 — 옮기면 프로젝트가 깨집니다' },
  { test: /[\\/](onedrive|dropbox|google drive|drivefs)[\\/]/i, why: '동기화 폴더' },
]

export interface Relocatable {
  ok: boolean
  reason?: string
}

/**
 * 이 파일을 다른 드라이브로 옮겨도 되는가.
 * 모르면 거절한다 — 이동은 되돌리기가 삭제보다 번거롭다.
 */
export function isRelocatable(c: Classified): Relocatable {
  if (c.verdict.zone === 'LOCKED') {
    return { ok: false, reason: `잠근 항목입니다 (${c.verdict.meaning})` }
  }
  for (const rule of NEVER_MOVE) {
    if (rule.test.test(c.path)) return { ok: false, reason: rule.why }
  }
  return { ok: true }
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

/** 경로 표시용 — UI에서 긴 경로를 줄여 보여줄 때. */
export function shortenPath(path: string, keep = 3): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= keep + 1) return path
  return parts[0] + sep + '…' + sep + parts.slice(-keep).join(sep)
}
