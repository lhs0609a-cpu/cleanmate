/**
 * 숨은 공간 프로브 CLI
 *
 * ⚠️ 읽기 전용이다. 아무것도 실행하지 않는다.
 *    이 증분의 목적은 "설명이 사람 마음을 놓게 하는가"를 먼저 보는 것이다.
 *    실행(powercfg)은 다음 증분 — 확인 흐름과 되돌리기 버튼이 붙고 나서.
 *
 * 사용: npm run probe
 */

import { gatherFacts } from './probes/facts.ts'
import { probeHiberfil } from './probes/hiberfil.ts'
import type { Finding } from './types.ts'

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  accent: (s: string) => `\x1b[36m${s}\x1b[0m`,
  warn: (s: string) => `\x1b[33m${s}\x1b[0m`,
  good: (s: string) => `\x1b[32m${s}\x1b[0m`,
}

const GB = 1024 ** 3
const gb = (n: number) => (n / GB).toFixed(1) + 'GB'

/** 한글은 터미널에서 두 칸을 먹는다. 그걸 세지 않으면 줄이 삐뚤어진다. */
const width = (s: string) =>
  [...s].reduce((w, ch) => w + (/[ᄀ-ᇿ　-鿿가-힯＀-｠]/.test(ch) ? 2 : 1), 0)

/** 이어지는 줄은 첫 줄보다 더 들여쓴다(행잉 인덴트) — 안 그러면 목록이 뭉갠다 */
function wrap(text: string, max: number, first: string, rest = first): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const indent = out.length === 0 ? first : rest
    if (line && width(indent) + width(line) + 1 + width(word) > max) {
      out.push((out.length === 0 ? first : rest) + line)
      line = word
    } else {
      line = line ? line + ' ' + word : word
    }
  }
  if (line) out.push((out.length === 0 ? first : rest) + line)
  return out
}

const W = 72

function section(label: string, body: string[], color = C.dim) {
  console.log()
  console.log('      ' + color(C.bold(label)))
  for (const b of body) {
    for (const l of wrap(b, W, '        ')) console.log(l)
  }
}

/** 목록 — 불릿 하나가 여러 줄이 되면 이어지는 줄을 불릿 아래로 정렬한다 */
function bullets(label: string, items: string[], color = C.dim) {
  console.log()
  console.log('      ' + color(C.bold(label)))
  for (const item of items) {
    for (const l of wrap(item, W, '        · ', '          ')) console.log(l)
  }
}

function render(f: Finding, i: number) {
  console.log()
  console.log('  ' + C.dim('─'.repeat(70)))
  console.log()
  console.log(`  ${C.accent(`발견 ${i}`)}  ${C.bold(f.title)}   ${C.bold(C.good(gb(f.bytes)))}`)

  section('이게 뭔가요', [f.explain.what])
  section('왜 이렇게 큰가요', [f.explain.why])
  bullets('뭐가 이걸 쓰나요', f.explain.usedBy, C.accent)
  bullets('지우면 뭐가 달라지나요', f.explain.ifRemoved, C.warn)
  section('되돌릴 수 있나요', [f.explain.recoveryNote])
  section('안 지우면요', [f.explain.ifKept])

  if (f.action) {
    console.log()
    console.log('      ' + C.dim(C.bold('회수 방법')))
    for (const l of wrap(f.action.describe, W, '        ')) console.log(l)
    console.log('        ' + C.dim(`$ ${f.action.command}`) + (f.action.needsAdmin ? C.dim('   (관리자 권한 필요)') : ''))
    console.log('        ' + C.dim(`되돌리기: $ ${f.action.undo}`))
  }
}

async function main() {
  console.log()
  console.log(
    C.bold('  숨은 공간 프로브') +
      C.dim('  (읽기 전용 — 아무것도 실행하지 않습니다)')
  )
  console.log('  ' + C.dim('─'.repeat(70)))

  const facts = await gatherFacts()

  console.log(
    `  RAM ${C.bold(gb(facts.ramBytes))} · ` +
      `${facts.isLaptop ? '노트북' : '데스크톱'} ${C.dim(`(${facts.laptopSignals.join(', ') || '배터리 없음'})`)} · ` +
      `빠른 시작 ${facts.fastStartupEnabled ? C.bold('켜짐') : '꺼짐'}`
  )

  const findings = [probeHiberfil(facts)].filter((f): f is Finding => f !== null)

  if (!findings.length) {
    console.log()
    console.log(C.dim('  회수할 숨은 공간이 없습니다. 이미 깔끔하네요.'))
    console.log()
    return
  }

  findings.forEach((f, i) => render(f, i + 1))

  const total = findings.reduce((s, f) => s + f.bytes, 0)
  console.log()
  console.log('  ' + C.dim('─'.repeat(70)))
  console.log(
    `  ${C.bold('회수 가능')} ${C.bold(C.good(gb(total)))}  ` +
      C.dim('— 파일 삭제 0건. 전부 공식 명령이고 전부 되돌릴 수 있습니다.')
  )
  console.log()
}

main().catch((err) => {
  console.error('실패:', err.message)
  process.exit(1)
})
