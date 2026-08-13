/**
 * 하나로 합치기 — 지우지 않고 중복을 없앤다
 *
 * ── 왜 지우기가 답이 아닌가 ──────────────────────────────────
 * 실측에서 나온 상황이다. 같은 AI 모델 파일이 6벌 있었다:
 *
 *   sd_xl_base_1.0.safetensors  6.46GB × 6벌 = 32.3GB 낭비
 *   C:\AI\ComfyUI_windows_portable\...
 *   C:\Users\me\GVF-ComfyUI\...
 *   ...\AppData\Roaming\megaload-desktop\engine\ComfyUI_windows_portable\...
 *
 * 여기서 5벌을 지우면 프로그램 5개가 모델을 못 찾는다. **6벌 다 진짜고 6벌 다
 * 필요하다.** 중복 정리의 보통 답("원본만 남기고 사본을 지운다")이 여기서는
 * 그냥 고장이다.
 *
 * ── 하드링크: 자리는 6개, 실물은 하나 ────────────────────────
 * NTFS는 파일 하나에 이름을 여러 개 달 수 있다. 6개 경로가 전부 살아 있고,
 * 디스크는 한 벌 분량만 쓴다. 관리자 권한도 필요 없다(실측 확인).
 *
 * ── 정직하게 밝혀야 하는 것 ──────────────────────────────────
 * 합친 뒤에는 **같은 실물**이다. 한쪽을 열어 내용을 고치면 양쪽이 같이 바뀐다.
 * 모델·영상처럼 읽기만 하는 파일에는 문제가 없고, 파일을 '교체'하는 프로그램은
 * 대개 새 파일을 쓰므로 링크가 자연히 끊긴다(안전한 방향). 그래도 이 사실은
 * 화면에 적는다 — 모르고 쓰면 나중에 배신당한 기분이 든다.
 *
 * ── 순서가 데이터를 지킨다 ───────────────────────────────────
 *   내용 재확인 → 사본을 임시 이름으로 옮김 → 링크 생성 → 확인 → 임시본 삭제
 * 어느 단계에서 실패해도 임시본을 제자리로 되돌린다. 지우는 건 링크가
 * 확실히 만들어진 뒤다.
 */

import { stat, lstat, rename, link, unlink, copyFile, readFile, appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { contentHash } from './photos.ts'
import { volumeOf, isSameVolume } from './relocate.ts'

/** 합치는 동안 사본이 잠깐 쓰는 이름. 여기서 멈추면 이 파일이 남는다. */
export const BACKUP_SUFFIX = '.teraclean-merge-backup'

/** 합치면 안 되는 자리 — 시스템은 건드리지 않는다. */
const NEVER_MERGE = [
  { test: /[\\/]windows[\\/]/i, why: '윈도우 시스템 폴더' },
  { test: /[\\/]program files( \(x86\))?[\\/]/i, why: '설치된 프로그램' },
  { test: /[\\/]\$recycle\.bin[\\/]/i, why: '휴지통' },
  { test: /[\\/]system volume information[\\/]/i, why: '시스템 복원' },
  { test: /[\\/]\.(teraclean|cleanmate)[\\/]/i, why: '보관함' },
  { test: new RegExp(BACKUP_SUFFIX.replace(/\./g, '\\.') + '$', 'i'), why: '합치는 중에 생긴 임시 파일' },
]

/**
 * 이 두 자리를 하나로 합쳐도 되나. 경로만 보고 답한다.
 *
 * 드라이브가 다르면 아예 안 된다 — 하드링크는 같은 드라이브 안에서만 만들어진다.
 * 이건 규칙이 아니라 파일 시스템의 성질이라 예외가 없다.
 */
export function mergeBlockReason(keeper: string, copy: string): string | null {
  if (keeper.toLowerCase() === copy.toLowerCase()) return '같은 파일입니다'
  if (!isSameVolume(keeper, copy)) {
    return `드라이브가 달라서 합칠 수 없어요 (${volumeOf(keeper)} ↔ ${volumeOf(copy)}). 이건 옮기기로 해결하세요.`
  }
  for (const rule of [...NEVER_MERGE]) {
    if (rule.test.test(keeper) || rule.test.test(copy)) return rule.why
  }
  return null
}

export interface MergeEntry {
  id: string
  /** 남긴 실물 */
  keeper: string
  /** 링크로 바뀐 자리 */
  linked: string
  size: number
  mergedAt: number
}

export interface MergeOutcome {
  ok: boolean
  /** 이미 같은 실물이라 할 일이 없었나 */
  already?: boolean
  bytes: number
  reason?: string
}

/** 두 경로가 이미 같은 실물인가(하드링크로 이어져 있나). */
export async function isSameFile(a: string, b: string): Promise<boolean> {
  try {
    const [x, y] = await Promise.all([stat(a), stat(b)])
    // ino는 윈도우에서도 채워진다(파일 참조 번호). dev까지 봐야 다른 드라이브의
    // 우연한 번호 충돌을 피한다.
    return x.ino !== 0 && x.ino === y.ino && x.dev === y.dev
  } catch {
    return false
  }
}

/**
 * 사본 자리를 원본의 하드링크로 바꾼다. 실패하면 사본을 그대로 되돌린다.
 *
 * ★ 링크를 걸기 직전에 **내용을 다시 대조한다.** 목록을 만든 뒤 사용자가 한쪽을
 *   고쳤을 수 있다. 여기서 확인 안 하면 다른 내용을 같은 것으로 만들어버린다 —
 *   중복 정리에서 낼 수 있는 가장 나쁜 사고다.
 */
export async function mergeIntoLink(keeper: string, copy: string): Promise<MergeOutcome> {
  const blocked = mergeBlockReason(keeper, copy)
  if (blocked) return { ok: false, bytes: 0, reason: blocked }

  let ks, cs
  try {
    ks = await stat(keeper)
    cs = await stat(copy)
  } catch {
    return { ok: false, bytes: 0, reason: '파일을 찾지 못했어요' }
  }
  if (!ks.isFile() || !cs.isFile()) return { ok: false, bytes: 0, reason: '파일이 아니에요' }
  if (await isSameFile(keeper, copy)) return { ok: true, already: true, bytes: 0 }
  if (ks.size !== cs.size) return { ok: false, bytes: 0, reason: '크기가 달라졌어요 — 합치지 않았습니다' }

  // 내용 재확인. 목록을 만든 뒤 바뀌었을 수 있다.
  try {
    const [kh, ch] = await Promise.all([contentHash(keeper, ks.size), contentHash(copy, cs.size)])
    if (kh !== ch) return { ok: false, bytes: 0, reason: '내용이 달라졌어요 — 합치지 않았습니다' }
  } catch {
    return { ok: false, bytes: 0, reason: '내용을 확인하지 못했어요 (파일이 사용 중일 수 있어요)' }
  }

  const backup = copy + BACKUP_SUFFIX
  try {
    await rename(copy, backup) // 사용 중이면 여기서 실패한다 — 그게 맞다
  } catch (err) {
    return { ok: false, bytes: 0, reason: `사용 중이라 건너뛰었어요: ${(err as Error).message}` }
  }

  try {
    await link(keeper, copy)
  } catch (err) {
    await rename(backup, copy).catch(() => {}) // 되돌린다
    return { ok: false, bytes: 0, reason: `합치지 못했어요: ${(err as Error).message}` }
  }

  // 진짜 같은 실물이 됐는지 확인하고 나서야 임시본을 지운다.
  if (!(await isSameFile(keeper, copy))) {
    await unlink(copy).catch(() => {})
    await rename(backup, copy).catch(() => {})
    return { ok: false, bytes: 0, reason: '합쳤는데 확인이 안 돼서 되돌렸어요' }
  }

  await unlink(backup).catch(() => {})
  return { ok: true, bytes: cs.size }
}

/* ────────────────────────────────────────────────────────────
   장부 — 합친 것을 되돌릴 수 있어야 한다
   ──────────────────────────────────────────────────────────── */

export const ledgerPathFor = (dir: string) => join(dir, 'merged.jsonl')

export async function appendMergeLedger(dir: string, entry: MergeEntry): Promise<void> {
  await mkdir(dirname(ledgerPathFor(dir)), { recursive: true })
  await appendFile(ledgerPathFor(dir), JSON.stringify(entry) + '\n', 'utf8')
}

export async function readMergeLedger(dir: string): Promise<MergeEntry[]> {
  try {
    const raw = await readFile(ledgerPathFor(dir), 'utf8')
    return raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as MergeEntry)
  } catch {
    return []
  }
}

/**
 * 합친 것을 다시 따로 떼어놓는다 — 진짜 사본으로 되돌린다.
 *
 * 되돌리면 그만큼 용량을 도로 쓴다. 그래서 '되돌리기'가 아니라 '따로 떼기'라고
 * 부르는 게 정확하고, 화면에도 그렇게 적는다.
 */
export async function splitLink(entry: MergeEntry): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (!(await isSameFile(entry.keeper, entry.linked))) {
      return { ok: false, reason: '이미 따로 떨어져 있어요' }
    }
    const temp = entry.linked + BACKUP_SUFFIX
    await copyFile(entry.keeper, temp) // 새 실물을 만든다
    await unlink(entry.linked)
    await rename(temp, entry.linked)
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: (err as Error).message }
  }
}

/**
 * 링크가 아직 살아 있나 — 장부를 화면에 그릴 때 쓴다.
 * 사용자가 그 사이 파일을 새로 받았으면 링크는 이미 끊겨 있다(그래도 안전하다).
 */
export async function linkStillAlive(entry: MergeEntry): Promise<boolean> {
  try {
    await lstat(entry.linked)
    return await isSameFile(entry.keeper, entry.linked)
  } catch {
    return false
  }
}
