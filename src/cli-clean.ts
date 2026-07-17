/**
 * 자동 정리 CLI
 *
 * 기본은 미리보기다. --apply 를 붙여야 실제로 격리한다.
 * "숨은 원탭 삭제 금지"(기획서 16.3) — 실수로 지워지는 경로가 없어야 한다.
 *
 * 사용: npm run clean -- <경로>           미리보기
 *       npm run clean -- <경로> --apply   격리 실행
 */

import { planSweep, applySweep } from './sweep.ts'
import { fmtBytes } from './engine.ts'
import { GRACE_DAYS } from './quarantine.ts'

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  good: (s: string) => `\x1b[32m${s}\x1b[0m`,
  warn: (s: string) => `\x1b[33m${s}\x1b[0m`,
  lock: (s: string) => `\x1b[31m${s}\x1b[0m`,
  accent: (s: string) => `\x1b[36m${s}\x1b[0m`,
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const root = args.find((a) => !a.startsWith('--'))

  if (!root) {
    console.error('사용법: npm run clean -- <경로> [--apply]')
    console.error('  --apply 없으면 미리보기만 합니다.')
    process.exit(1)
  }

  console.log()
  console.log(
    C.bold('  자동 정리') +
      (apply ? C.warn('  (실행 — 격리로 옮깁니다)') : C.dim('  (미리보기 — 아무것도 건드리지 않습니다)'))
  )
  console.log('  ' + C.dim('─'.repeat(70)))
  console.log(`  대상: ${root}`)

  process.stdout.write(C.dim('  스캔 중...'))
  const plan = await planSweep(root)
  process.stdout.write('\r' + ' '.repeat(40) + '\r')

  console.log(
    `  스캔: ${C.bold(plan.scannedFiles.toLocaleString())}개 파일 · ${plan.elapsedMs}ms`
  )

  // ── 안 건드리는 것부터 보여준다. 이게 이 제품의 자랑이다.
  console.log()
  console.log(C.bold('  건드리지 않은 것'))
  console.log(
    `  ${C.lock('잠금')}       ${fmtBytes(plan.skipped.locked.bytes).padStart(8)} ` +
      C.dim(`${plan.skipped.locked.count.toLocaleString()}개 · 시스템·설정·클라우드. 지우면 뭔가 깨집니다`)
  )
  console.log(
    `  ${C.warn('물어봐야')}   ${fmtBytes(plan.skipped.needsAsking.bytes).padStart(8)} ` +
      C.dim(`${plan.skipped.needsAsking.count.toLocaleString()}개 · 사용자만 아는 것. 무인 삭제 안 합니다`)
  )
  console.log(
    `  ${C.dim('추론뿐')}     ${fmtBytes(plan.skipped.inferredNotAuto.bytes).padStart(8)} ` +
      C.dim(`${plan.skipped.inferredNotAuto.count.toLocaleString()}개 · 규칙이 확증 못 함 → 자동 자격 없음 (R1 방어선)`)
  )

  // ── 정리 대상
  console.log()
  console.log(
    C.bold('  자동 정리 대상') + C.dim(`  — 규칙이 확증한 것만. 전부 다시 생기는 것들입니다`)
  )
  console.log('  ' + C.dim('─'.repeat(70)))

  if (!plan.items.length) {
    console.log(C.dim('  자동으로 지울 게 없습니다. 깔끔하네요.'))
    console.log()
    return
  }

  for (const item of plan.items.slice(0, 12)) {
    console.log(`  ${C.good(fmtBytes(item.size).padStart(8))}  ${C.bold(item.meaning)}`)
    console.log(`            ${C.dim(item.path)}`)
    console.log(`            ${C.dim('왜 지워도 되나: ' + item.reason)}`)
  }
  if (plan.items.length > 12) {
    console.log(C.dim(`  … 외 ${(plan.items.length - 12).toLocaleString()}개`))
  }

  console.log()
  console.log('  ' + C.dim('─'.repeat(70)))

  if (!apply) {
    console.log(
      `  ${C.bold('정리 가능')} ${C.bold(C.good(fmtBytes(plan.bytes)))} ` +
        C.dim(`· ${plan.items.length.toLocaleString()}개`)
    )
    console.log()
    console.log(C.dim('  실제로 정리하려면 --apply 를 붙이세요. 격리로 옮기고, 30일간 되돌릴 수 있습니다.'))
    console.log()
    return
  }

  // ── 실행
  process.stdout.write(C.dim('  격리 중...'))
  const result = await applySweep(plan)
  process.stdout.write('\r' + ' '.repeat(40) + '\r')

  console.log(`  ${C.bold('격리 완료')} ${C.bold(result.quarantinedCount.toLocaleString())}개`)
  console.log()

  // ── 효과성 대시보드 (기획서 17.3) — 거짓말하지 않는다
  console.log(C.bold('  확보 용량'))
  console.log(
    `  ${C.dim('지금 즉시')}      ${C.bold('0GB'.padStart(8))} ` +
      C.dim('· 격리는 옮기기만 한 겁니다. 아직 디스크에 그대로 있어요')
  )
  console.log(
    `  ${C.bold(`${GRACE_DAYS}일 뒤 최종`)}  ${C.bold(C.good(fmtBytes(result.bytesAfterGrace).padStart(8)))} ` +
      C.dim('· 유예가 끝나면 실제로 빕니다')
  )

  if (result.failed.length) {
    console.log()
    console.log(C.warn(`  못 옮긴 것 ${result.failed.length}개`) + C.dim(' — 조용히 넘어가지 않습니다'))
    for (const f of result.failed.slice(0, 5)) {
      console.log(`    ${C.dim(f.path)}`)
      console.log(`      ${C.dim(f.reason)}`)
    }
    if (result.failed.length > 5) console.log(C.dim(`    … 외 ${result.failed.length - 5}개`))
  }

  console.log()
  console.log(C.dim(`  되돌리려면: npm run restore`))
  console.log()
}

main().catch((err) => {
  console.error('실패:', err.message)
  process.exit(1)
})
