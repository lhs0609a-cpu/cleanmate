/**
 * 같은 파일이 여러 벌 — 사진 밖으로
 *
 * ── 왜 필요했나 ──────────────────────────────────────────────
 * 중복 판정은 이미 photos.ts에 있었는데 **사진에만** 묶여 있었다. 그런데 실제로
 * 자리를 많이 먹는 중복은 사진이 아니다. 이 PC를 훑다가 바로 나온 것:
 *
 *   MegaroadGlobal-Agent-Setup.exe      168MB
 *   MegaroadGlobal-Agent-Setup (1).exe  168MB   ← 완전히 같은 파일
 *
 * 설치 파일·영상·압축파일은 한 벌이 수백 MB라 두 벌만 있어도 사진 수백 장이다.
 *
 * ── 판정 지식은 새로 쓰지 않는다 ─────────────────────────────
 * 크기로 좁히고 → 앞뒤 256KB+크기 해시로 확정하고 → 사본 표시·나이로 원본을
 * 고르는 규칙은 photos.ts가 이미 갖고 있다. 여기서 다시 쓰면 반드시 갈라진다.
 * 그대로 가져다 쓰고, 이 파일은 **어디를 볼 것인가**만 담당한다.
 *
 * ── 중복이라고 다 지워도 되는 게 아니다 ──────────────────────
 * ★ 이게 이 모듈에서 제일 중요한 부분이다. `node_modules`에는 같은 파일이 수십 벌
 *   있는 게 **정상**이다. 각 패키지가 자기 것을 갖고 있어야 돌아간다. 가상환경도,
 *   게임 데이터도, 윈도우 시스템도 마찬가지다. 여기서 "사본"이라며 하나를 지우면
 *   그건 중복 정리가 아니라 그냥 고장이다.
 *   그래서 대상은 **사람이 만들거나 받아둔 자리**로만 좁힌다. 확신이 없으면 뺀다.
 */

import { extname } from 'node:path'
import { groupBySize, contentHash, buildDupGroups, pickKeeper, type PhotoFile, type DupGroup } from './photos.ts'

export type DupFile = PhotoFile
export type { DupGroup }

/** 이보다 작은 파일은 중복이어도 체감이 없다 — 목록만 길어진다. */
export const DUP_MIN_BYTES = 10 * 1024 * 1024 // 10MB

/**
 * 여기 있는 같은 파일은 '중복'이 아니라 '필요해서 여러 벌'이다.
 *
 * 지우면 깨지는 자리와, 우리가 관리하는 자리(격리함·이동 폴더)를 다 뺀다.
 * 이동 금지 목록(relocate.ts)과 겹치지만 같지 않다 — 저기는 '옮기면 깨지는 곳'이고
 * 여기는 '같은 파일이 여러 벌 있는 게 정상인 곳'이다. 예를 들어 다운로드 폴더는
 * 옮겨도 되지만 중복도 지워도 된다. 반대로 게임 폴더는 둘 다 안 된다.
 */
const NOT_DUPLICATES = [
  { test: /[\\/]windows[\\/]/i, why: '윈도우 시스템' },
  { test: /[\\/]program files( \(x86\))?[\\/]/i, why: '설치된 프로그램' },
  { test: /[\\/]programdata[\\/]/i, why: '프로그램 공용 데이터' },
  { test: /[\\/]appdata[\\/]/i, why: '프로그램이 저장한 데이터' },
  { test: /[\\/]node_modules[\\/]/i, why: '패키지마다 같은 파일을 갖고 있는 게 정상입니다' },
  { test: /[\\/](\.venv|venv|site-packages|__pycache__)[\\/]/i, why: '가상환경' },
  { test: /[\\/]\.git[\\/]/i, why: '깃 저장소 내부' },
  { test: /[\\/](steamapps?|epic ?games|riot games|battle\.net|nexon)[\\/]/i, why: '게임 데이터' },
  { test: /[\\/]\.(teraclean|cleanmate)[\\/]/i, why: '격리함' },
  { test: /[\\/]TeraClean-Moved[\\/]/i, why: '이미 옮겨둔 폴더' },
  { test: /[\\/]\$recycle\.bin[\\/]/i, why: '휴지통' },
  { test: /[\\/]system volume information[\\/]/i, why: '시스템 복원' },
]

/** 확장자가 이거면 '여러 벌 있는 게 정상'인 축이다(라이브러리·부분 파일 등). */
const NOT_DUP_EXT = new Set(['.dll', '.pyd', '.lib', '.so', '.dylib', '.sys', '.node', '.pdb', '.part', '.crdownload', '.tmp'])

export interface DupCheck {
  ok: boolean
  reason?: string
}

/** 이 파일을 중복 후보로 볼 수 있나. 모르면 뺀다. */
export function isDupeCandidate(path: string): DupCheck {
  for (const rule of NOT_DUPLICATES) {
    if (rule.test.test(path)) return { ok: false, reason: rule.why }
  }
  if (NOT_DUP_EXT.has(extname(path).toLowerCase())) {
    return { ok: false, reason: '프로그램이 불러 쓰는 파일이라 여러 벌 있는 게 정상입니다' }
  }
  return { ok: true }
}

/* ────────────────────────────────────────────────────────────
   무엇을 남길지 — 클라우드에 있는 쪽을 우선한다

   photos.ts의 규칙(사본 표시 없는 것 · 더 오래된 것)이 기본이고, 여기에 하나를
   더 얹는다: **동기화 폴더에 있는 쪽을 남긴다.** 그쪽은 지워도 클라우드에 남고,
   다른 기기에서도 보이니까 사용자에게 더 안전한 사본이다.
   ──────────────────────────────────────────────────────────── */

const CLOUD = /[\\/](onedrive|dropbox|google drive|드라이브|drivefs|icloud)[\\/]/i

export function isCloudPath(path: string): boolean {
  return CLOUD.test(path)
}

/**
 * 중복 묶음을 만든다. photos.ts의 묶기를 쓰고, 남길 것만 클라우드 쪽으로 옮긴다.
 * 바꿀 때는 근거 문장도 같이 바꾼다 — 근거가 결과와 다르면 그게 더 나쁘다.
 */
export function buildFileDupGroups(hashed: { file: DupFile; hash: string }[]): DupGroup[] {
  return buildDupGroups(hashed).map((g) => {
    if (isCloudPath(g.keeper.path)) return g
    const all = [g.keeper, ...g.copies]
    const cloud = all.filter((f) => isCloudPath(f.path))
    if (!cloud.length) return g
    const keeper = pickKeeper(cloud).keeper
    const copies = all.filter((f) => f.path !== keeper.path)
    return {
      ...g,
      keeper,
      copies,
      wastedBytes: copies.reduce((s, f) => s + f.size, 0),
      keeperReason: '클라우드 동기화 폴더에 있어서 남겼어요 — 다른 기기에서도 보이는 사본입니다.',
    }
  })
}

export interface DupScanResult {
  groups: DupGroup[]
  /** 사본을 치우면 비는 용량 */
  wastedBytes: number
  /** 본 파일 수(후보로 추린 것) */
  candidates: number
  /** 해시까지 읽어본 파일 수 — 이게 곧 든 시간이다 */
  hashed: number
  /** 중복이지만 손대면 안 되는 자리라 뺀 개수 */
  excluded: number
}

/**
 * 볼 것만 남긴다 — 순수 함수. 파일을 읽지 않으므로 규칙만 따로 시험할 수 있다.
 *
 * ★ 걸러내기와 해시 읽기를 갈라둔 이유: 규칙은 경로 문자열의 문제고, 해시는
 *   디스크의 문제다. 한 함수에 묶어두면 규칙을 시험하려 해도 실제 파일을 만들어야
 *   하고, 하필 임시 폴더가 AppData 아래라 규칙에 먼저 걸려서 해시 쪽을 아예
 *   시험할 수 없었다. 섞여 있으면 둘 다 제대로 못 본다.
 */
export function filterDupeCandidates(files: DupFile[]): { candidates: DupFile[]; excluded: number } {
  let excluded = 0
  const candidates = files.filter((f) => {
    if (f.size < DUP_MIN_BYTES) return false
    if (isDupeCandidate(f.path).ok) return true
    excluded++
    return false
  })
  return { candidates, excluded }
}

/**
 * 후보 → 중복 묶음. 여기서만 디스크를 읽는다.
 *
 * 해시는 **크기가 겹치는 것만** 읽는다. 파일 수가 아니라 '크기가 같은 파일 수'에
 * 비례하므로, 수만 개를 넣어도 실제로 읽는 건 보통 수십~수백 개다.
 */
export async function hashAndGroup(candidates: DupFile[]): Promise<Omit<DupScanResult, 'excluded'>> {
  const sizeGroups = groupBySize(candidates)
  const hashed: { file: DupFile; hash: string }[] = []
  for (const group of sizeGroups) {
    for (const f of group) {
      try {
        hashed.push({ file: f, hash: await contentHash(f.path, f.size) })
      } catch {
        /* 읽을 수 없는 파일은 후보에서 뺀다 — 못 읽은 걸 같다고 할 수는 없다 */
      }
    }
  }

  const groups = buildFileDupGroups(hashed)
  return {
    groups,
    wastedBytes: groups.reduce((s, g) => s + g.wastedBytes, 0),
    candidates: candidates.length,
    hashed: hashed.length,
  }
}

/** 걸러내고 → 해시로 확정한다. 엔진이 쓰는 통로는 이것 하나다. */
export async function findDuplicates(files: DupFile[]): Promise<DupScanResult> {
  const { candidates, excluded } = filterDupeCandidates(files)
  return { ...(await hashAndGroup(candidates)), excluded }
}
