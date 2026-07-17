/**
 * 자동 정리 — 존 A만, 격리 경유
 *
 * "확실한 건 알아서"의 '알아서' 부분이다.
 *
 * ── 자동으로 지울 자격 ────────────────────────────────────────
 * 존 A라고 다 자동이 아니다. isAutoEligible()이 통과시킨 것만 —
 * 즉 '규칙 DB가 확증한 것'만이다. 추론으로 얻은 판단은 아무리
 * 그럴듯해도 자동 처리 자격이 없다. 이게 R1(오분류→오삭제)의 방어선이다.
 * (기획서 16.2: "(안전) 등급 정크만 무인. (확인 필요) 이상은 절대 무인 삭제 안 함")
 *
 * ── 왜 즉시 삭제가 아니라 격리인가 ────────────────────────────
 * 캐시는 재생성되니 격리가 무의미해 보인다. 하지만 R1은 이 프로젝트의
 * 유일한 '치명' 리스크이고, 아직 실측된 적이 없다:
 *   "존 A에서 오분류가 나면 격리가 손실을 100% 막는가?"
 * 격리를 안 거치면 이 질문에 영영 답할 수 없다. 규칙을 믿을 근거가
 * 쌓이기 전까지는 격리를 거친다. 신뢰가 쌓이면 그때 즉시 삭제로 승격한다.
 * (기획서 R3 완화안: "최초 N회는 신뢰 적립 후 승격")
 *
 * ── 노이즈 플로어를 쓰지 않는다 ───────────────────────────────
 * classify()는 1MB 미만을 버린다. 그건 '질문' 개념이다 — 작은 파일까지
 * 물어보면 질문 피로가 온다. 하지만 '정리'에서는 정반대다. 캐시는 작은
 * 파일이 수만 개고, 그게 곧 수 GB다. 그래서 여기선 classifyOne()을
 * 직접 돌려 전부 본다.
 */

import { scan } from './scanner.ts'
import { classifyOne, isAutoEligible } from './classify.ts'
import { quarantine, stampMtime, type QuarantineRequest } from './quarantine.ts'
import type { Classified } from './types.ts'

export interface SweepItem {
  path: string
  size: number
  /** 이게 뭔지 — 목록에 항상 보인다 */
  meaning: string
  /** 왜 지워도 되는지 — 근거 없이 지우지 않는다 (기획서 13.1) */
  reason: string
  mtimeMs: number
}

export interface SweepPlan {
  items: SweepItem[]
  bytes: number
  /** 뭘 안 건드렸는지도 보고한다. "안 하는 것"이 이 제품의 자랑이다. */
  skipped: {
    locked: { count: number; bytes: number }
    needsAsking: { count: number; bytes: number }
    /** 존 A지만 추론이라 자동 자격이 없는 것 — R1 방어선이 실제로 막은 양 */
    inferredNotAuto: { count: number; bytes: number }
  }
  scannedFiles: number
  elapsedMs: number
}

/**
 * 계획만 세운다. 아무것도 건드리지 않는다.
 * 삭제 프로그램의 기본 동작은 '미리보기'다 (기획서 11.1).
 */
export async function planSweep(root: string): Promise<SweepPlan> {
  const scanned = await scan(root)

  const items: SweepItem[] = []
  let bytes = 0
  const skipped: SweepPlan['skipped'] = {
    locked: { count: 0, bytes: 0 },
    needsAsking: { count: 0, bytes: 0 },
    inferredNotAuto: { count: 0, bytes: 0 },
  }

  for (const f of scanned.files) {
    const c: Classified = classifyOne(f)
    const { zone, ruleBacked, meaning, reason } = c.verdict

    if (zone === 'LOCKED') {
      skipped.locked.count++
      skipped.locked.bytes += f.size
      continue
    }
    if (zone === 'AMBIG') {
      skipped.needsAsking.count++
      skipped.needsAsking.bytes += f.size
      continue
    }
    // 존 A인데 규칙이 확증 못 한 것 — 자동 자격 없음
    if (!isAutoEligible(c)) {
      skipped.inferredNotAuto.count++
      skipped.inferredNotAuto.bytes += f.size
      continue
    }

    // stampMtime을 반드시 거친다. Date로 왕복시키면 값이 미묘하게 달라진다
    // (quarantine.ts의 stampMtime 주석 참고 — 실측에서 절반이 오거부됐다).
    items.push({ path: f.path, size: f.size, meaning, reason, mtimeMs: stampMtime(f.mtime.getTime()) })
    bytes += f.size
  }

  // 큰 것부터. 사용자가 목록을 위에서부터 훑으면 중요한 게 먼저 보인다.
  items.sort((a, b) => b.size - a.size)

  return { items, bytes, skipped, scannedFiles: scanned.files.length, elapsedMs: scanned.elapsedMs }
}

export interface SweepResult {
  quarantinedCount: number
  /** 30일 뒤 최종 확보될 용량. '지금' 비는 게 아니다 — 거짓말하지 않는다. */
  bytesAfterGrace: number
  failed: { path: string; reason: string }[]
}

/**
 * 계획을 실행한다. 격리로 옮길 뿐 지우지 않는다.
 *
 * expect를 넘기는 게 핵심이다. 계획을 세운 시점과 지금 사이에 파일이
 * 바뀌었으면 격리가 알아서 건너뛴다 (TOCTOU 방어).
 */
export async function applySweep(plan: SweepPlan): Promise<SweepResult> {
  const requests: QuarantineRequest[] = plan.items.map((i) => ({
    path: i.path,
    reason: i.reason,
    zone: 'SAFE',
    expect: { size: i.size, mtimeMs: i.mtimeMs },
  }))

  const r = await quarantine(requests)
  return {
    quarantinedCount: r.quarantined.length,
    bytesAfterGrace: r.bytes,
    failed: r.failed,
  }
}
