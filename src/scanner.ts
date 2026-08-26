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
  /**
   * 사용자가 "여기까지만 보기"를 눌렀을 때. 신호가 오면 **지금까지 모은 것을 들고**
   * 멈춘다 — 던지지 않는다(deadlineMs와 같은 규칙).
   *
   * ★ 왜 필요했나: 실측에서 AppData 38만 개에 133초가 걸린다. 그동안 사용자가
   *   할 수 있는 일이 작업관리자로 죽이는 것뿐이면, 그건 통제권이 없는 것이다.
   *   그리고 중단을 **빈 화면**으로 갚으면 취소가 벌이 된다 — 그래서 여태 훑은
   *   결과는 그대로 돌려준다. 덜 훑었다는 사실만 truncated로 알린다.
   */
  signal?: AbortSignal
}

export interface ScanResult {
  files: FileEntry[]
  /** 스캔 중 접근 못 한 경로 — 조용히 삼키지 않고 보고한다 */
  skipped: { path: string; reason: string }[]
  totalBytes: number
  elapsedMs: number
  /** 중간에 멈췄나. 결과를 '전부'라고 쓰면 안 되는 신호다 */
  truncated: boolean
  /**
   * 왜 멈췄나. `truncated`만으로는 "시간이 없어서"와 "사용자가 세웠다"를 구분 못 하는데,
   * 화면에 쓸 말이 서로 다르다 — 전자는 사과할 일이고 후자는 사용자가 시킨 일이다.
   */
  stoppedBy?: 'deadline' | 'cancel'
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
  let stoppedBy: ScanResult['stoppedBy']
  const now = Date.now()

  function stop(reason: NonNullable<ScanResult['stoppedBy']>): true {
    truncated = true
    // 먼저 선 이유를 남긴다. 취소한 뒤 마감시간이 지나도 "사용자가 세웠다"가 사실이다.
    stoppedBy ??= reason
    return true
  }

  async function walk(dir: string, depth: number): Promise<void> {
    if (opts.signal?.aborted) {
      stop('cancel')
      return
    }
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
      stop('deadline')
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
      // ★ 폴더 진입 지점에서만 보면 안 된다. AppData처럼 한 폴더에 수만 개가 든
      //   자리에서는 '다음 폴더'가 한참 뒤라, 누른 지 몇 초가 지나도 안 멈춘다.
      //   aborted는 속성 읽기라 항목마다 봐도 공짜다.
      if (opts.signal?.aborted) {
        stop('cancel')
        return
      }

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
          // 링크가 둘 이상일 때만 신원을 만든다. 대부분은 하나라 비워둔다.
          ino: st.nlink > 1 ? `${st.dev}:${st.ino}` : undefined,
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
  return { files, skipped, totalBytes, elapsedMs: Date.now() - started, truncated, stoppedBy }
}
