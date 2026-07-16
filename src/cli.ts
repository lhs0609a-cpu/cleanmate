/**
 * 클린메이트 엔진 프로토타입 CLI
 *
 * ⚠️ 이 프로토타입은 아무것도 삭제하지 않는다. 오직 분석과 질문 생성만.
 *    제1 개발 원칙(기획서 10): "되돌릴 수 있는 그릇(격리·복구)이 준비되기 전엔
 *    아무것도 지우지 않는다." 격리 모듈이 붙기 전까지 삭제 코드는 없다.
 *
 * 목적: 핵심 가정 검증 —
 *   "존 B를 결정적 미지수로 묶으면, 질문 3~4개로 대량을 해결할 수 있는가?"
 *   지표: 질문당 해결 GB · 질문 수 · 규칙 커버리지
 *
 * 사용: npm run scan -- <경로>
 */

import { scan } from './scanner.ts'
import { classify, isAutoEligible } from './classify.ts'
import { run, fmtBytes } from './engine.ts'

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  safe: (s: string) => `\x1b[32m${s}\x1b[0m`,
  amb: (s: string) => `\x1b[33m${s}\x1b[0m`,
  lock: (s: string) => `\x1b[31m${s}\x1b[0m`,
  accent: (s: string) => `\x1b[36m${s}\x1b[0m`,
}

function bar(value: number, total: number, width = 24): string {
  if (total === 0) return ' '.repeat(width)
  const filled = Math.round((value / total) * width)
  return '█'.repeat(filled) + C.dim('░'.repeat(width - filled))
}

async function main() {
  const root = process.argv[2]
  if (!root) {
    console.error('사용법: npm run scan -- <스캔할 경로>')
    console.error('예:     npm run scan -- C:\\Users\\me\\Downloads')
    process.exit(1)
  }

  console.log()
  console.log(C.bold('  클린메이트 엔진 프로토타입') + C.dim('  (분석 전용 — 아무것도 삭제하지 않습니다)'))
  console.log('  ' + C.dim('─'.repeat(66)))
  console.log(`  대상: ${root}`)

  // ── 1. 스캔
  process.stdout.write(C.dim('  스캔 중...'))
  const scanned = await scan(root)
  process.stdout.write('\r' + ' '.repeat(40) + '\r')
  console.log(
    `  스캔 완료: ${C.bold(scanned.files.length.toLocaleString())}개 파일 · ` +
      `${C.bold(fmtBytes(scanned.totalBytes))} · ${scanned.elapsedMs}ms`
  )
  if (scanned.skipped.length) {
    console.log(C.dim(`  (접근 불가 ${scanned.skipped.length}곳은 건너뜀)`))
  }

  // ── 2. 3-존 분류
  const { safe, ambig, locked, belowNoiseFloor } = classify(scanned.files)
  const autoOk = safe.filter(isAutoEligible)
  const sum = (a: typeof safe) => a.reduce((s, i) => s + i.size, 0)
  const safeBytes = sum(safe)
  const ambigBytes = sum(ambig)
  const lockedBytes = sum(locked)
  const zoneTotal = safeBytes + ambigBytes + lockedBytes

  console.log()
  console.log(C.bold('  확신도 3-존 분류'))
  console.log(
    `  ${C.safe('존 A 안전 ')} ${bar(safeBytes, zoneTotal)} ${fmtBytes(safeBytes).padStart(7)} ` +
      C.dim(`${safe.length}개 · 알아서 처리`)
  )
  console.log(
    `  ${C.amb('존 B 애매 ')} ${bar(ambigBytes, zoneTotal)} ${fmtBytes(ambigBytes).padStart(7)} ` +
      C.dim(`${ambig.length}개 · 여기만 질문`)
  )
  console.log(
    `  ${C.lock('존 C 잠금 ')} ${bar(lockedBytes, zoneTotal)} ${fmtBytes(lockedBytes).padStart(7)} ` +
      C.dim(`${locked.length}개 · 건드리지 않음`)
  )
  console.log(C.dim(`  (1MB 미만 ${belowNoiseFloor.toLocaleString()}개는 노이즈로 제외)`))

  // R1 안전장치가 실제로 작동하는지 — 자동 처리 자격 검사
  console.log()
  console.log(
    `  ${C.dim('자동 처리 자격:')} ${autoOk.length}/${safe.length}개 ` +
      C.dim(`(규칙이 확증한 것만. 추론은 자동 처리 불가)`)
  )

  // ── 3. 고레버리지 질문 엔진
  const report = run(ambig)

  console.log()
  console.log(C.bold('  고레버리지 질문') + C.dim(`  — 애매한 ${fmtBytes(ambigBytes)}를 질문 ${report.questions.length}개로`))
  console.log('  ' + C.dim('─'.repeat(66)))

  if (!report.questions.length) {
    console.log(C.dim('  물어볼 만한 묶음이 없습니다. (애매한 항목이 적거나 잘게 흩어져 있음)'))
    console.log(C.dim('  → R2 리스크 사례: 클러스터 실패. 수동 검토로 폴백해야 하는 상황.'))
  }

  report.questions.forEach((q, i) => {
    console.log()
    console.log(`  ${C.accent(`Q${i + 1}`)}  ${C.bold(q.text)}`)
    console.log(`      ${C.dim('왜 묻나: ' + q.rationale)}`)
    for (const opt of q.options) {
      console.log(`      ${C.accent('[' + opt.label + ']')} ${C.dim('→ ' + opt.preview)}`)
    }
    console.log(`      ${C.dim(`걸린 용량: ${fmtBytes(q.stakeBytes)} · ${q.stakeCount}개`)}`)
  })

  // ── 4. 검증 지표 (핵심 가정 측정)
  console.log()
  console.log('  ' + C.dim('─'.repeat(66)))
  console.log(C.bold('  검증 지표'))
  console.log(`  질문당 해결 용량  ${C.bold(report.gbPerQuestion.toFixed(2) + ' GB/질문')}  ${C.dim('← 높을수록 고레버리지')}`)
  console.log(`  질문 수           ${C.bold(String(report.questions.length))}  ${C.dim('← 4개 넘으면 피로')}`)
  const coverage = scanned.files.length
    ? ((scanned.files.length - ambig.filter((a) => !a.verdict.ruleBacked).length) / scanned.files.length) * 100
    : 0
  console.log(`  규칙 커버리지     ${C.bold(coverage.toFixed(1) + '%')}  ${C.dim('← 낮으면 콜드스타트 취약(R2)')}`)
  if (report.leftover.count) {
    console.log(
      C.dim(`  질문 밖 잔여      ${report.leftover.count}개 · ${fmtBytes(report.leftover.bytes)} → 수동 검토 (강제하지 않음)`)
    )
  }
  console.log()
}

main().catch((err) => {
  console.error('실패:', err)
  process.exit(1)
})
