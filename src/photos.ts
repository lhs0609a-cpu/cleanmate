/**
 * 사진 정리 — 스크린샷과 진짜 중복
 *
 * 사진첩이 무거워지는 건 추억이 많아서가 아니다. 실측에서도, 리서치에서도
 * 범인은 둘이었다: **스크린샷**과 **같은 파일이 여러 벌 있는 것**.
 * 그래서 이 모듈은 딱 그 둘만 다룬다. "비슷한 사진 골라주기"는 하지 않는다 —
 * 비슷한 것 중 뭘 남길지는 우리가 알 수 없고, 잘못 고르면 되돌릴 수 없는
 * 종류의 손해다(리서치: 오삭제 실제 피해는 시스템 파일이 아니라 개인 데이터).
 *
 * ── 중복 판정은 '내용이 같을 때'만 ───────────────────────────
 * 크기가 같다고 같은 파일이 아니다. 그래서 크기로 후보를 좁힌 뒤
 * 내용 해시로 확정한다. 해시가 다르면 후보에서 뺀다.
 * 확신이 없으면 목록에서 빼는 쪽을 택한다 — 사진은 되돌릴 수 없는 자산이다.
 *
 * ── 무엇을 남길지 ────────────────────────────────────────────
 * 원본을 남기고 사본을 치운다. 원본 추정 규칙은 단순하고 설명 가능해야 한다:
 *   1) 이름에 사본 표시가 있으면 사본 ('(1)', '복사본', 'copy', '- 복사본')
 *   2) 없으면 가장 오래된 것이 원본 (나중에 생긴 게 사본일 확률이 높다)
 * 그리고 그 근거를 화면에 그대로 보여준다.
 */

import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { basename, extname } from 'node:path'

export interface PhotoFile {
  path: string
  name: string
  size: number
  mtimeMs: number
}

/** 사진·영상 확장자. 이 밖의 파일은 애초에 보지 않는다. */
export const PHOTO_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.heif',
  '.tif', '.tiff', '.raw', '.cr2', '.nef', '.arw', '.dng',
  '.mp4', '.mov', '.avi', '.mkv',
])

export function isPhoto(name: string): boolean {
  return PHOTO_EXTS.has(extname(name).toLowerCase())
}

/**
 * 스크린샷인가.
 *
 * 윈도우·맥·안드로이드·아이폰이 각자 다른 이름을 붙이고, 한국어 윈도우는
 * "화면 캡처"를 쓴다. 캡처 도구(반디캡, 픽픽, ShareX)도 흔하다.
 * 확신이 없는 이름은 스크린샷으로 치지 않는다 — 사진을 스크린샷으로 오인하면
 * 추억이 정리 폴더로 들어간다.
 */
export function isScreenshot(name: string): boolean {
  const n = basename(name).toLowerCase()
  return (
    /^screenshot[ _-]/.test(n) ||
    /^screen shot/.test(n) ||
    /^스크린샷/.test(n) ||
    /^화면 ?캡처/.test(n) ||
    /^캡처[ _-]/.test(n) ||
    /^clipboard[ _-]?\d/.test(n) ||
    /^(sharex|picpick|bandicam|snipaste)[ _-]/.test(n) ||
    /^(그림|image)\d{1,3}\.(png|jpg)$/.test(n) // 붙여넣기로 저장된 것
  )
}

/* ────────────────────────────────────────────────────────────
   중복 — 크기로 좁히고 해시로 확정한다
   ──────────────────────────────────────────────────────────── */

/** 크기가 같은 것끼리 묶는다. 혼자인 크기는 중복일 수 없으므로 버린다. */
export function groupBySize(files: PhotoFile[]): PhotoFile[][] {
  const bySize = new Map<number, PhotoFile[]>()
  for (const f of files) {
    if (f.size === 0) continue // 빈 파일은 다루지 않는다
    const arr = bySize.get(f.size)
    if (arr) arr.push(f)
    else bySize.set(f.size, [f])
  }
  return [...bySize.values()].filter((g) => g.length > 1)
}

/**
 * 파일 내용 해시.
 *
 * 사진 한 장이 수십 MB라 통째로 읽으면 수천 장에서 몇 분이 걸린다.
 * 앞·뒤 256KB + 크기로 만든다 — JPEG는 헤더(촬영정보)와 꼬리가 다르면
 * 다른 파일이고, 앞뒤가 모두 같고 크기까지 같은데 가운데만 다른 경우는
 * 사실상 없다. 그래도 '사실상'이라는 걸 숨기지 않고 UI에 밝힌다.
 */
export async function contentHash(path: string, size: number): Promise<string> {
  const CHUNK = 256 * 1024
  const fh = await open(path, 'r')
  try {
    const h = createHash('sha256')
    h.update(String(size))
    const head = Buffer.alloc(Math.min(CHUNK, size))
    await fh.read(head, 0, head.length, 0)
    h.update(head)
    if (size > CHUNK) {
      const tailLen = Math.min(CHUNK, size - CHUNK)
      const tail = Buffer.alloc(tailLen)
      await fh.read(tail, 0, tailLen, size - tailLen)
      h.update(tail)
    }
    return h.digest('hex')
  } finally {
    await fh.close()
  }
}

export interface DupGroup {
  hash: string
  /** 남길 것 */
  keeper: PhotoFile
  /** 치울 것(사본) */
  copies: PhotoFile[]
  /** 사본을 치우면 비는 용량 */
  wastedBytes: number
  /** 왜 이걸 원본으로 봤는지 */
  keeperReason: string
}

const COPY_MARK = /\((\d+)\)\s*(\.[^.]+)?$|복사본|[ _-]copy\b|copy[ _-]?\d*\s*(\.[^.]+)?$/i

/**
 * 무엇을 원본으로 볼지. 규칙은 단순해야 하고 근거를 말할 수 있어야 한다.
 * (설명할 수 없는 판단은 사용자가 확인할 수 없고, 확인할 수 없으면 못 믿는다)
 */
export function pickKeeper(files: PhotoFile[]): { keeper: PhotoFile; reason: string } {
  const plain = files.filter((f) => !COPY_MARK.test(f.name))
  if (plain.length && plain.length < files.length) {
    const oldest = [...plain].sort((a, b) => a.mtimeMs - b.mtimeMs)[0]
    return { keeper: oldest, reason: '이름에 사본 표시가 없어서 원본으로 봤어요.' }
  }
  const oldest = [...files].sort((a, b) => a.mtimeMs - b.mtimeMs)[0]
  return { keeper: oldest, reason: '가장 먼저 만들어진 파일이라 원본으로 봤어요.' }
}

/** 해시가 같은 것끼리 묶어 중복 그룹을 만든다. */
export function buildDupGroups(hashed: { file: PhotoFile; hash: string }[]): DupGroup[] {
  const byHash = new Map<string, PhotoFile[]>()
  for (const { file, hash } of hashed) {
    const arr = byHash.get(hash)
    if (arr) arr.push(file)
    else byHash.set(hash, [file])
  }

  const groups: DupGroup[] = []
  for (const [hash, files] of byHash) {
    if (files.length < 2) continue
    const { keeper, reason } = pickKeeper(files)
    const copies = files.filter((f) => f.path !== keeper.path)
    groups.push({
      hash,
      keeper,
      copies,
      wastedBytes: copies.reduce((s, f) => s + f.size, 0),
      keeperReason: reason,
    })
  }
  return groups.sort((a, b) => b.wastedBytes - a.wastedBytes)
}

/* ────────────────────────────────────────────────────────────
   계획
   ──────────────────────────────────────────────────────────── */

export interface PhotoPlan {
  /** 정리 폴더로 옮길 오래된 스크린샷 */
  oldScreenshots: PhotoFile[]
  screenshotBytes: number
  /** 최근 스크린샷은 아직 쓸 일이 있다고 본다 */
  recentScreenshots: number
  dupGroups: DupGroup[]
  dupBytes: number
  /** 본 사진 수 */
  scanned: number
}

/** 이보다 최근에 만든 스크린샷은 아직 쓰는 중으로 본다 */
export const SCREENSHOT_KEEP_DAYS = 14

export function planPhotos(
  files: PhotoFile[],
  dupGroups: DupGroup[],
  opts: { now?: number; keepDays?: number } = {}
): PhotoPlan {
  const now = opts.now ?? Date.now()
  const keepDays = opts.keepDays ?? SCREENSHOT_KEEP_DAYS
  const cutoff = now - keepDays * 86_400_000

  const shots = files.filter((f) => isScreenshot(f.name))
  const oldScreenshots = shots.filter((f) => f.mtimeMs < cutoff).sort((a, b) => b.size - a.size)

  return {
    oldScreenshots,
    screenshotBytes: oldScreenshots.reduce((s, f) => s + f.size, 0),
    recentScreenshots: shots.length - oldScreenshots.length,
    dupGroups,
    dupBytes: dupGroups.reduce((s, g) => s + g.wastedBytes, 0),
    scanned: files.length,
  }
}
