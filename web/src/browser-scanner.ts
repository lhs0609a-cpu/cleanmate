/**
 * 브라우저 스캐너 — File System Access API
 *
 * 데스크톱 scanner.ts와 같은 계약(FileEntry[])을 지킨다. 엔진은 그대로 재사용된다.
 *
 * ★ 이 데모는 우리 '온디바이스 우선' 원칙이 문자 그대로 참인 곳이다:
 *   파일은 브라우저 밖으로 한 바이트도 나가지 않는다. 서버도, 업로드도 없다.
 *   읽은 내용은 메모리에만 있고 탭을 닫으면 사라진다.
 *
 * 한계: 브라우저는 절대 경로를 주지 않는다. 사용자가 고른 폴더 이름을
 * 루트로 삼아 경로를 구성한다(예: Downloads를 고르면 /downloads/...).
 * 그래서 Downloads·바탕화면·프로젝트 폴더에서 가장 잘 맞고,
 * 시스템 경로 규칙(AppData, WinSxS 등)은 데스크톱 앱에서만 온전히 작동한다.
 */

import type { FileEntry } from '../../src/types.ts'

const DAY_MS = 86_400_000

export function isSupported(): boolean {
  return typeof (globalThis as any).showDirectoryPicker === 'function'
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await (globalThis as any).showDirectoryPicker({ mode: 'read' })
  } catch {
    return null // 사용자가 취소함 — 오류가 아니다
  }
}

export interface BrowserScanResult {
  files: FileEntry[]
  totalBytes: number
  elapsedMs: number
  skipped: number
}

export async function scanHandle(
  root: FileSystemDirectoryHandle,
  onProgress?: (count: number, current: string) => void
): Promise<BrowserScanResult> {
  const started = performance.now()
  const files: FileEntry[] = []
  const now = Date.now()
  let totalBytes = 0
  let skipped = 0

  async function walk(dir: FileSystemDirectoryHandle, prefix: string, depth: number): Promise<void> {
    if (depth > 12) return // 브라우저에서는 더 얕게 — 응답성 우선

    for await (const [name, handle] of (dir as any).entries()) {
      const path = `${prefix}/${name}`

      if (handle.kind === 'directory') {
        await walk(handle as FileSystemDirectoryHandle, path, depth + 1)
        continue
      }

      try {
        const file: File = await (handle as FileSystemFileHandle).getFile()
        const mtime = new Date(file.lastModified)
        files.push({
          path,
          size: file.size,
          mtime,
          atime: mtime, // 브라우저는 접근일을 주지 않는다 — 수정일로 대체
          ext: name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '',
          ageDays: Math.floor((now - file.lastModified) / DAY_MS),
        })
        totalBytes += file.size
        if (files.length % 200 === 0) {
          onProgress?.(files.length, path)
          await new Promise((r) => setTimeout(r, 0)) // UI 양보
        }
      } catch {
        skipped++ // 권한 없거나 잠긴 파일 — 조용히 세되 삼키지 않는다
      }
    }
  }

  await walk(root, `/${root.name}`, 0)
  return { files, totalBytes, elapsedMs: performance.now() - started, skipped }
}
