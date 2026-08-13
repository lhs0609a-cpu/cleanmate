/**
 * 백업 확인 — "이거 다른 데 백업해두셨어요?"를 우리가 대신 답한다
 *
 * ── 왜 질문을 없애려 하나 ────────────────────────────────────
 * U1(백업 여부)은 레버리지가 가장 높은 질문이다(engine.ts). 그런데 좋은 질문의
 * 조건은 '사용자만 아는 사실'이어야 한다는 것이고, 백업 여부는 **꽤 자주 우리가
 * 알 수 있는 사실이다.** 같은 이름·같은 크기의 파일이 OneDrive 폴더에 있으면
 * 그건 백업이다. 물어볼 필요가 없다.
 *
 * 그리고 답이 훨씬 강하다:
 *   "백업해두시나요?"                        → 사용자가 기억을 더듬어야 한다
 *   "이 12개는 OneDrive에도 있어요"          → 그냥 지우면 된다는 게 즉시 보인다
 *
 * ── 확신이 없으면 '있다'고 하지 않는다 ───────────────────────
 * 이름과 크기가 같으면 같은 파일로 본다. 내용까지 읽지는 않는다 — 수백 개를
 * 대조하는 데 시간이 너무 든다. 대신 **화면에 그 근거를 그대로 적는다**
 * ("이름과 크기가 같은 파일이 OneDrive에 있어요"). 사용자가 검증할 수 있는
 * 문장이면 추정이어도 정직하다. 검증할 수 없는 단정이 위험한 것이다.
 */

import { basename } from 'node:path'

export interface CloudRoot {
  label: string
  path: string
}

/**
 * 구글 드라이브는 홈 폴더가 아니라 **드라이브 문자**로 붙는다(G:\내 드라이브).
 * 언어에 따라 폴더 이름이 달라서 둘 다 본다. 실제로 있는지는 파일 시스템을
 * 봐야 알 수 있으므로 확인은 엔진이 한다 — 여기는 이름만 안다.
 */
export const GOOGLE_DRIVE_FOLDERS = ['내 드라이브', 'My Drive']

/**
 * 이 PC에 붙어 있는 클라우드 폴더.
 *
 * 환경변수를 먼저 본다 — OneDrive는 회사 계정이면 `OneDrive - 회사이름`처럼
 * 폴더 이름이 제각각이라 경로를 짐작할 수 없다. 윈도우가 알려주는 값이 정답이다.
 */
export function cloudRoots(env: { home: string; vars?: Record<string, string | undefined> }): CloudRoot[] {
  const vars = env.vars ?? {}
  const sep = env.home.includes('\\') ? '\\' : '/'
  const j = (...p: string[]) => p.join(sep)
  const found: CloudRoot[] = []
  const add = (label: string, path?: string) => {
    if (!path) return
    if (found.some((r) => r.path.toLowerCase() === path.toLowerCase())) return
    found.push({ label, path })
  }

  add('OneDrive', vars.OneDrive)
  add('OneDrive', vars.OneDriveConsumer)
  add('OneDrive(회사)', vars.OneDriveCommercial)
  add('OneDrive', j(env.home, 'OneDrive'))
  add('구글 드라이브', j(env.home, 'Google Drive'))
  add('구글 드라이브', j(env.home, 'GoogleDrive'))
  add('Dropbox', j(env.home, 'Dropbox'))
  add('iCloud', j(env.home, 'iCloudDrive'))
  return found
}

/**
 * 백업 색인 — `이름|크기` → 어느 클라우드인가.
 *
 * 경로는 안 담는다. 파일이 수만 개면 경로 문자열만으로 수 MB가 되고, 화면에
 * 필요한 건 "어디에 있나"(OneDrive)까지다. 정확한 자리를 알려면 사용자가
 * 그 폴더를 열어보면 된다.
 */
export type BackupIndex = Map<string, string>

export const backupKey = (name: string, size: number) => `${name.toLowerCase()}|${size}`

/** 색인에 담을 값어치가 있는 크기. 작은 파일까지 담으면 색인만 커진다. */
export const INDEX_MIN_BYTES = 1024 * 1024 // 1MB

export function buildBackupIndex(
  files: { path: string; size: number }[],
  where: string,
  into: BackupIndex = new Map()
): BackupIndex {
  for (const f of files) {
    if (f.size < INDEX_MIN_BYTES) continue
    const key = backupKey(basename(f.path), f.size)
    if (!into.has(key)) into.set(key, where)
  }
  return into
}

export interface BackupHit {
  /** 같은 이름·크기가 클라우드에 있나 */
  found: boolean
  /** 어디에 (OneDrive·구글 드라이브…). 없으면 빈 문자열 */
  where: string
  /** 화면에 그대로 쓰는 한 문장. 근거를 숨기지 않는다 */
  note: string
}

const NONE: BackupHit = { found: false, where: '', note: '' }

/**
 * 이 파일이 클라우드에도 있나.
 *
 * ★ 클라우드 폴더 안의 파일 자신은 '백업 있음'이 아니다. 그건 원본이다.
 *   여기서 지우면 클라우드에서도 지워지고 다른 기기에서도 사라진다 —
 *   정반대의 사실이라 반드시 갈라야 한다(kinds.ts의 cloud 판정과 같은 이유).
 */
export function checkBackup(
  file: { path: string; size: number },
  index: BackupIndex,
  roots: CloudRoot[]
): BackupHit {
  const lower = file.path.toLowerCase()
  const inCloud = roots.find((r) => lower.startsWith(r.path.toLowerCase()))
  if (inCloud) {
    return {
      found: false,
      where: inCloud.label,
      note: `이 파일 자체가 ${inCloud.label} 폴더에 있어요 — 여기서 지우면 클라우드에서도 지워집니다.`,
    }
  }
  const where = index.get(backupKey(basename(file.path), file.size))
  if (!where) return NONE
  return {
    found: true,
    where,
    note: `이름과 크기가 같은 파일이 ${where}에 있어요 — 지워도 그쪽에 남습니다.`,
  }
}
