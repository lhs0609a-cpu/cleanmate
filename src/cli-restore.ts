/**
 * 되돌리기 CLI
 *
 * "되돌리기는 항상 한 번에 접근 가능해야 한다" (기획서 16.3).
 * BleachBit은 미리보기는 있는데 undo가 없어서 오삭제 사고가 반복됐다.
 * 그 자리에 서려면 이건 기능이 아니라 존재 이유다.
 *
 * 사용: npm run restore              격리 목록 보기
 *       npm run restore -- --all     전부 되돌리기
 *       npm run restore -- <id>      하나만 되돌리기
 */

import { readManifest, restore, quarantineRoot, isExpired, GRACE_DAYS } from './quarantine.ts'
import { fmtBytes } from './engine.ts'

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  good: (s: string) => `\x1b[32m${s}\x1b[0m`,
  warn: (s: string) => `\x1b[33m${s}\x1b[0m`,
}

const DAY_MS = 86_400_000

async function main() {
  const args = process.argv.slice(2)
  const all = args.includes('--all')
  const id = args.find((a) => !a.startsWith('--'))

  // 지금은 시스템 드라이브의 격리소만 본다.
  // (여러 드라이브 지원은 드라이브별 장부를 순회하면 된다 — 설계상 이미 가능)
  const root = quarantineRoot(process.env.SystemDrive ? process.env.SystemDrive + '\\' : '/')
  const manifest = await readManifest(root)

  console.log()
  console.log(C.bold('  격리함') + C.dim(`  ${root}`))
  console.log('  ' + C.dim('─'.repeat(70)))

  if (!manifest.length) {
    console.log(C.dim('  격리된 게 없습니다.'))
    console.log()
    return
  }

  if (!all && !id) {
    const total = manifest.reduce((s, e) => s + e.size, 0)
    for (const e of manifest.slice(0, 20)) {
      const daysLeft = Math.ceil((GRACE_DAYS * DAY_MS - (Date.now() - e.quarantinedAt)) / DAY_MS)
      console.log(
        `  ${C.dim(e.id.slice(0, 8))}  ${fmtBytes(e.size).padStart(8)}  ` +
          (isExpired(e) ? C.warn('만료됨') : C.good(`${daysLeft}일 남음`))
      )
      console.log(`            ${C.dim(e.originalPath)}`)
      console.log(`            ${C.dim('격리 이유: ' + e.reason)}`)
    }
    if (manifest.length > 20) console.log(C.dim(`  … 외 ${(manifest.length - 20).toLocaleString()}개`))

    console.log()
    console.log(`  ${C.bold('합계')} ${manifest.length.toLocaleString()}개 · ${C.bold(fmtBytes(total))}`)
    console.log()
    console.log(C.dim('  전부 되돌리려면: npm run restore -- --all'))
    console.log()
    return
  }

  const ids = all ? manifest.map((e) => e.id) : [manifest.find((e) => e.id.startsWith(id!))?.id].filter(Boolean) as string[]

  if (!ids.length) {
    console.log(C.warn(`  '${id}'로 시작하는 격리 항목이 없습니다.`))
    console.log()
    return
  }

  const r = await restore(ids, root)

  console.log(`  ${C.bold(C.good('되돌림'))} ${r.restored.length.toLocaleString()}개 · ` +
    C.bold(fmtBytes(r.restored.reduce((s, e) => s + e.size, 0))))

  if (r.failed.length) {
    console.log()
    console.log(C.warn(`  못 되돌린 것 ${r.failed.length}개`))
    for (const f of r.failed.slice(0, 5)) {
      console.log(`    ${C.dim(f.entry.originalPath)}`)
      console.log(`      ${C.dim(f.reason)}`)
    }
  }
  console.log()
}

main().catch((err) => {
  console.error('실패:', err.message)
  process.exit(1)
})
