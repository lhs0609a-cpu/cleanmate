/**
 * 스캐너 — 원시 사실만 수집한다. 판단은 하지 않는다.
 *
 * 현재: Node fs 재귀 순회 (프로토타입)
 * 나중: Windows NTFS는 MFT 직접 읽기로 교체 (18분 → 14초급, 기획서 M01)
 *       이 모듈의 출력 형태(FileEntry[])만 유지하면 엔진은 그대로 쓴다.
 */

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { FileEntry } from './types.ts'
import { SKIP_DIRS, normalizePath } from './knowledge/paths.ts'

const DAY_MS = 86_400_000

export interface ScanOptions {
  /** 심볼릭 링크 순회 방지 + 과도한 깊이 차단 */
  maxDepth?: number
  onProgress?: (count: number, currentDir: string) => void
  /**
   * 여기까지만 훑는다(절대 시각, Date.now 기준). 넘으면 **지금까지 모은 것을 들고**
   * 멈춘다 — 던지지 않는다.
   *
   * ★ 왜 필요했나: 클라우드 폴더(구글 드라이브·OneDrive)는 네트워크 드라이브인
   *   경우가 있어서 한 번 훑는 데 몇 분이 걸린다. 백업 확인처럼 **없어도 되는
   *   부가 정보**를 위해 사용자를 몇 분 기다리게 할 수는 없다. 덜 훑으면 못 찾을
   *   뿐이고, 우리는 "있다"만 말하지 "없다"고는 말하지 않으므로 안전하다.
   */
  deadlineMs?: number
}

export interface ScanResult {
  files: FileEntry[]
  /** 스캔 중 접근 못 한 경로 — 조용히 삼키지 않고 보고한다 */
  skipped: { path: string; reason: string }[]
  totalBytes: number
  elapsedMs: number
  /** 시간이 다 돼서 중간에 멈췄나. 결과를 '전부'라고 쓰면 안 되는 신호다 */
  truncated: boolean
}

function shouldSkipDir(normalized: string): boolean {
  return SKIP_DIRS.some((re) => re.test(normalized + '/'))
}

export async function scan(root: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const started = Date.now()
  const maxDepth = opts.maxDepth ?? 24
  const files: FileEntry[] = []
  const skipped: ScanResult['skipped'] = []
  let totalBytes = 0
  let truncated = false
  const now = Date.now()

  async function walk(dir: string, depth: number): Promise<void> {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
      truncated = true
      return
    }
    if (depth > maxDepth) {
      skipped.push({ path: dir, reason: '최대 깊이 초과' })
      return
    }
    if (shouldSkipDir(normalizePath(dir))) return // 존 C는 보여주지도 않는다

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (err) {
      skipped.push({ path: dir, reason: (err as NodeJS.ErrnoException).code ?? '읽기 실패' })
      return
    }

    opts.onProgress?.(files.length, dir)

    for (const entry of entries) {
      const full = join(dir, entry.name)

      if (entry.isSymbolicLink()) continue // 순환 방지
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue

      try {
        const st = await stat(full)
        const ext = entry.name.includes('.')
          ? entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
          : ''
        files.push({
          path: full,
          size: st.size,
          mtime: st.mtime,
          atime: st.atime,
          ext,
          ageDays: Math.floor((now - st.mtime.getTime()) / DAY_MS),
        })
        totalBytes += st.size
      } catch (err) {
        skipped.push({ path: full, reason: (err as NodeJS.ErrnoException).code ?? 'stat 실패' })
      }
    }

    // 폴더를 다 본 뒤에도 한 번 알린다.
    //
    // 위(순회 시작)에서만 알리면 파일 수가 한참 뒤처져 보인다. 순회는 깊이 우선이라
    // 하위 폴더를 다 파고든 뒤에야 이 폴더의 파일이 세어지는데, 그 사이 화면의
    // 숫자는 멈춰 있다 — 진행률은 오르는데 파일 수만 굳어 있으면 이상하게 보인다.
    opts.onProgress?.(files.length, dir)
  }

  await walk(root, 0)
  return { files, skipped, totalBytes, elapsedMs: Date.now() - started, truncated }
}
