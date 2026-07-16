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
}

export interface ScanResult {
  files: FileEntry[]
  /** 스캔 중 접근 못 한 경로 — 조용히 삼키지 않고 보고한다 */
  skipped: { path: string; reason: string }[]
  totalBytes: number
  elapsedMs: number
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
  const now = Date.now()

  async function walk(dir: string, depth: number): Promise<void> {
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
  }

  await walk(root, 0)
  return { files, skipped, totalBytes, elapsedMs: Date.now() - started }
}
