/**
 * 분류 엔진 — 3-존 판정
 *
 * R1 완화(오분류 리스크)의 핵심 설계:
 *   존 A(자동 처리)로 보낼 수 있는 건 '규칙 DB가 확증한 것'뿐이다.
 *   추론으로 얻은 판단은 절대 SAFE가 될 수 없고, 최대 AMBIG까지만 간다.
 *   → 추론이 틀려도 최악의 결과는 "쓸데없이 물어봄"이지 "잘못 지움"이 아니다.
 *
 * 나중에 온디바이스 LLM이 붙어도 이 규칙은 그대로다.
 * LLM은 AMBIG의 unknown을 추정하는 데만 쓰이고, SAFE 승격 권한이 없다.
 */

import type { Classified, FileEntry, Unknown, Verdict } from './types.ts'
import { PATH_RULES, normalizePath } from './knowledge/paths.ts'

/** 이 크기 미만은 정리해봐야 의미 없다 — 질문 피로만 늘린다 */
const NOISE_FLOOR_BYTES = 1024 * 1024 // 1MB

/**
 * 규칙에 안 걸린 항목의 미지수를 추론한다.
 * 규칙 DB가 못 덮은 영역 = 콜드스타트의 취약점(R2). 여기가 두꺼워질수록 좋다.
 */
function inferUnknown(f: FileEntry, normalized: string): Unknown {
  const inDownloads = /\/(downloads?|다운로드|desktop|바탕 ?화면)\//.test(normalized)

  // 임시 창고 성격의 폴더는 폴더 의도 자체가 미지수
  if (inDownloads && f.ageDays > 180) return 'U5_FOLDER_INTENT'
  // 큰데 오래 안 건드림 → 옮길지 지울지가 관건
  if (f.size > 500 * 1024 * 1024) return 'U7_MOVE_OR_DELETE'
  // 오래된 건 "나중에 볼 일 있나"
  if (f.ageDays > 365) return 'U4_NEED_LATER'
  return 'U4_NEED_LATER'
}

export function classifyOne(f: FileEntry): Classified {
  const normalized = normalizePath(f.path)

  for (const rule of PATH_RULES) {
    if (!rule.test.test(normalized)) continue

    const verdict: Verdict = {
      zone: rule.zone,
      meaning: rule.meaning,
      reason: rule.reason,
      unknown: rule.zone === 'AMBIG' ? rule.unknown : undefined,
      ruleBacked: true, // 규칙 DB가 확증 → 존 A 승격 자격 있음
      ruleId: rule.id, // 어느 규칙이 걸렸는지 — 판정 사다리가 이걸로 갈래를 탄다
    }
    return { ...f, verdict }
  }

  // 규칙 미매치 = 우리가 모르는 것.
  // 모르면 AMBIG. 절대 SAFE로 추측하지 않는다. (R1 안전장치)
  return {
    ...f,
    verdict: {
      zone: 'AMBIG',
      meaning: '알 수 없는 파일',
      reason: '이게 뭔지 확실히 모르겠어요. 그래서 함부로 지우지 않고 여쭤봅니다.',
      unknown: inferUnknown(f, normalized),
      ruleBacked: false, // 추론 → 자동 처리 절대 불가
    },
  }
}

export interface ClassifyResult {
  safe: Classified[]
  ambig: Classified[]
  locked: Classified[]
  /** 너무 작아서 무시한 것 — 질문 피로 방지 */
  belowNoiseFloor: number
}

export function classify(files: FileEntry[]): ClassifyResult {
  const safe: Classified[] = []
  const ambig: Classified[] = []
  const locked: Classified[] = []
  let belowNoiseFloor = 0

  for (const f of files) {
    const c = classifyOne(f)

    if (c.verdict.zone === 'LOCKED') {
      locked.push(c)
      continue
    }
    // 잠긴 게 아니면서 너무 작은 건 애초에 후보에서 뺀다
    if (f.size < NOISE_FLOOR_BYTES) {
      belowNoiseFloor++
      continue
    }
    if (c.verdict.zone === 'SAFE') safe.push(c)
    else ambig.push(c)
  }

  return { safe, ambig, locked, belowNoiseFloor }
}

/**
 * 자동 처리 자격 검사 — 존 A라고 다 자동이 아니다.
 * 규칙이 확증한 것만. 이 게이트가 R1(오분류→오삭제)의 마지막 방어선.
 */
export function isAutoEligible(c: Classified): boolean {
  return c.verdict.zone === 'SAFE' && c.verdict.ruleBacked
}
