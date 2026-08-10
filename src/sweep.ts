/**
 * 자동 정리 — 존 A만
 *
 * "확실한 건 알아서"의 '알아서' 부분이다.
 *
 * ── 자동으로 지울 자격 ────────────────────────────────────────
 * 존 A라고 다 자동이 아니다. isAutoEligible()이 통과시킨 것만 —
 * 즉 '규칙 DB가 확증한 것'만이다. 추론으로 얻은 판단은 아무리
 * 그럴듯해도 자동 처리 자격이 없다. 이게 R1(오분류→오삭제)의 방어선이다.
 * (기획서 16.2: "(안전) 등급 정크만 무인. (확인 필요) 이상은 절대 무인 삭제 안 함")
 *
 * ── 격리에서 멈추지 않는다 (v0.9.9에서 바뀐 것) ───────────────
 * 원래는 격리까지만 하고 30일을 기다렸다. 이유는 R1(오분류→오삭제)이 이
 * 프로젝트의 유일한 '치명' 리스크라서, 규칙을 믿을 근거가 쌓이기 전까지
 * 격리를 거치자는 것이었다. 이 주석은 이렇게 끝나 있었다 —
 * "신뢰가 쌓이면 그때 즉시 삭제로 승격한다."
 *
 * 승격했다. 이유는 사용자 쪽에 있었다. 격리함은 같은 드라이브에 있어서
 * 격리만으로는 용량이 1바이트도 안 준다. 디스크가 94% 찬 사람이
 * "지금 정리 가능 7.0GB"를 보고 눌렀는데 "용량은 아직 그대로입니다"가 뜨면,
 * 버튼이 약속을 안 지킨 것이다. 두 번 같은 항의를 들었다.
 *
 * 대신 안전장치는 위치를 옮겼을 뿐 없애지 않았다:
 *   · 여기 오는 건 규칙 DB가 확증한 것만이다(isAutoEligible). 추론은 못 온다.
 *   · 곧바로 unlink하지 않고 격리를 경유해서 지운다 — 크기·수정일 재검증과
 *     사용 중 파일 회피가 그 경로에 들어 있다.
 *   · 질문에 답해서 정리하는 것(존 B)은 여전히 격리에서 멈춘다. 되돌릴 수
 *     있어야 하는 건 그쪽이다.
 *
 * ── 노이즈 플로어를 쓰지 않는다 ───────────────────────────────
 * classify()는 1MB 미만을 버린다. 그건 '질문' 개념이다 — 작은 파일까지
 * 물어보면 질문 피로가 온다. 하지만 '정리'에서는 정반대다. 캐시는 작은
 * 파일이 수만 개고, 그게 곧 수 GB다. 그래서 여기선 classifyOne()을
 * 직접 돌려 전부 본다.
 */

import { scan } from './scanner.ts'
import { classifyOne, isAutoEligible } from './classify.ts'
import { quarantine, purgeEntries, stampMtime, type QuarantineRequest } from './quarantine.ts'
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
  /** 손댄 파일 수 (지웠거나 격리했거나) */
  quarantinedCount: number
  /** 처리한 용량. purge=true면 '지금 빈 용량', false면 '30일 뒤 빌 용량' */
  bytesAfterGrace: number
  /** 실제로 지웠는가. 화면 문구가 이걸로 갈린다 — 거짓말하지 않는다. */
  purged: boolean
  /** 지운 파일 수 (purge=false면 0) */
  purgedCount: number
  failed: { path: string; reason: string }[]
}

export interface SweepOptions {
  /**
   * 격리에서 멈추지 않고 곧바로 지운다 → 용량이 지금 빈다.
   *
   * ── 왜 기본이 됐나 ────────────────────────────────────────
   * 격리함은 **같은 드라이브에 있다.** 그래서 격리만으로는 용량이 1바이트도
   * 안 준다. 디스크가 94% 찬 사람이 "지금 정리 가능 7.0GB"를 보고 눌렀는데
   * "용량은 아직 그대로입니다"가 나오면, 그건 버튼이 약속을 안 지킨 것이다.
   * 실제로 "격리함으로 옮기지 말라니까? 바로 삭제하라고"를 들었다. 두 번.
   *
   * ── 그래도 격리를 거쳐서 지운다 ───────────────────────────
   * 곧바로 unlink하지 않는다. 격리 경로에는 검증이 들어 있다(계획 시점과
   * 크기·수정일이 같은지, 사용 중이 아닌지). 그 검증을 통과한 것만 지운다.
   * 같은 드라이브 안 이동이라 rename 한 번이고, 비용은 거의 없다.
   *
   * ── 무엇을 지우는지가 좁다 ────────────────────────────────
   * 여기 오는 건 존 A + isAutoEligible, 즉 **규칙 DB가 확증한 캐시·로그·임시**
   * 파일만이다. 추론으로 얻은 판단은 애초에 이 목록에 못 들어온다.
   */
  purge?: boolean
  /**
   * 격리함 위치를 바꿔 끼운다. 테스트에서만 쓴다 —
   * 안 열어두면 통합 테스트가 진짜 드라이브 루트(C:\.teraclean)에 쓰게 된다.
   */
  rootFor?: (originalPath: string) => string
}

/**
 * 계획을 실행한다.
 *
 * expect를 넘기는 게 핵심이다. 계획을 세운 시점과 지금 사이에 파일이
 * 바뀌었으면 격리가 알아서 건너뛴다 (TOCTOU 방어).
 */
export async function applySweep(plan: SweepPlan, opts: SweepOptions = {}): Promise<SweepResult> {
  const requests: QuarantineRequest[] = plan.items.map((i) => ({
    path: i.path,
    reason: i.reason,
    zone: 'SAFE',
    expect: { size: i.size, mtimeMs: i.mtimeMs },
  }))

  const qOpts = opts.rootFor ? { rootFor: opts.rootFor } : {}
  const r = await quarantine(requests, qOpts)
  if (!opts.purge) {
    return {
      quarantinedCount: r.quarantined.length,
      bytesAfterGrace: r.bytes,
      purged: false,
      purgedCount: 0,
      failed: r.failed,
    }
  }

  // ★ 방금 격리한 것만 지운다. purgeNow는 격리함을 통째로 비워서,
  //   며칠 전 "정리해도 돼요"라고 답해 맡겨둔 것까지 함께 없앤다.
  const p = await purgeEntries(r.quarantined, qOpts)
  const failed = [
    ...r.failed,
    // 옮기긴 했는데 못 지운 것 — 조용히 성공으로 보고하지 않는다.
    ...p.failed.map((f) => ({ path: f.entry.originalPath, reason: f.reason })),
  ]
  return {
    quarantinedCount: r.quarantined.length,
    bytesAfterGrace: p.bytes,
    purged: true,
    purgedCount: p.purged.length,
    failed,
  }
}
