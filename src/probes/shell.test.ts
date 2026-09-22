/**
 * 프로브가 바깥에 말을 거는 통로는 하나다
 *
 * ★ 왜 잠그나 (실물에서 겪은 것)
 *   '숨은 공간' 화면이 55초를 기다렸다. 원인은 조사가 무거워서가 아니었다 —
 *   조사 자체는 다 합쳐 0.6초다. 파워셸을 새로 띄우는 값이 비쌌고, 그걸 다섯 번
 *   **줄 세워** 치르고 있었다. 게다가 '얼마까지 기다릴 것인가'를 정할 자리가
 *   없었다: execFile 호출이 다섯 군데에 똑같이 복사돼 있었기 때문이다.
 *
 *   그래서 통로를 shell.ts 하나로 모으고, 한도를 거기 한 곳에 뒀다.
 *   여기서 지키는 것은 그 약속이다 — 통로 밖으로 새면 그 항목만 조용히
 *   한도 없이 매달리고, 화면은 다시 영원히 안 뜬다.
 *   (같은 이유로 로딩 표시를 한 곳에 모아 잠갔다 — loading-progress.test.ts)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** src/probes 아래의 진짜 코드 파일 (테스트·통로 자신은 뺀다) */
const probeFiles = readdirSync(here)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'shell.ts')

test('★ ps()를 쓰는 파일은 ps()를 들여온다 — 안 그러면 그 화면만 통째로 죽는다', () => {
  /* 실제로 여기서 한 번 놓쳤다. import 한 줄이 빠진 채로 목록은 멀쩡히
     돌아갔고, '시작프로그램' 화면만 "ps is not defined"로 죽었다.
     타입 검사 단계가 없는 프로젝트라 실행해 보기 전에는 안 보인다. */
  for (const f of probeFiles) {
    const src = readFileSync(join(here, f), 'utf8')
    if (!/\bps\(/.test(src)) continue
    assert.match(
      src,
      /import \{ ps \} from '\.\/shell\.ts'/,
      `${f}이 ps()를 쓰면서 들여오지 않는다 — 이 화면은 열자마자 죽는다`
    )
  }
})

/**
 * 파일 안에서 powershell.exe를 띄우는 호출 하나하나를 통째로 잘라낸다.
 *
 * ★ 정규식으로 끝을 찾으려다 한 번 속았다 — `\n\s*\)`로 닫는 괄호를 찾았더니
 *   세 자리 중 한 자리만 걸렸다(나머지는 `})`로 끝난다). 통과했는데 안 보고
 *   있었던 것이다. 괄호를 세는 쪽이 짧고, 무엇보다 안 속는다.
 */
function powershellCalls(src: string): string[] {
  const out: string[] = []
  const NEEDLE = "'powershell.exe'"
  for (let at = src.indexOf(NEEDLE); at !== -1; at = src.indexOf(NEEDLE, at + 1)) {
    // 이름표(`'powershell.exe': '파워셸'`)는 호출이 아니다. 인자로 넘어가는 것만 본다.
    if (src[at + NEEDLE.length] !== ',') continue
    const open = src.lastIndexOf('(', at)
    let depth = 0
    for (let i = open; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')' && --depth === 0) { out.push(src.slice(open, i + 1)); break }
    }
  }
  return out
}

test('★ 화면이 기다리는 조회는 전부 통로를 지난다 — 한도가 한 곳에 있어야 한다', () => {
  /* 통로 밖에서 직접 띄우면 그 호출만 한도 없이 매달린다. 화면은 그게 어느
     항목인지도 못 말하고 무한 막대만 돌린다 — 고치려던 바로 그 그림이다.

     ★ 다만 '읽기'에만 해당한다. 아래 예외들은 사용자가 버튼을 눌러 시작한
       **쓰기**이고, 그중 하나는 관리자 확인 창을 기다린다 — 사람이 '예'를
       누르는 데 걸리는 시간에 한도를 걸면 그게 버그다. */

  /** 통로를 안 지나는 자리와 그 이유. 예외는 근거를 적어야 남길 수 있다. */
  const EXCEPTIONS: { needle: string; why: string; bounded: boolean }[] = [
    {
      // 경로 수백 개를 명령줄에 이어붙이면 길이 제한에 걸리고, 무엇보다
      // 파일 경로가 스크립트 본문에 섞이는 주입 통로가 생긴다.
      needle: 'SIGNATURES',
      why: '경로를 stdin으로 넘겨야 해서 자식 손잡이가 필요하다',
      bounded: true,
    },
    {
      needle: '-Verb RunAs',
      why: '관리자 확인 창을 기다린다 — 사람이 누르는 시간이다',
      bounded: false, // ★ 여기에 한도를 걸면 '예'를 누르려던 사용자를 자른다
    },
    {
      needle: 'TC_BYTES',
      why: '시작프로그램 켜기/끄기 — 사용자가 누른 쓰기다',
      bounded: false,
    },
  ]

  let seen = 0
  for (const f of probeFiles) {
    for (const call of powershellCalls(readFileSync(join(here, f), 'utf8'))) {
      seen++
      const ex = EXCEPTIONS.find((e) => call.includes(e.needle))
      assert.ok(
        ex,
        `${f}이 파워셸을 직접 띄운다 — ps()를 쓰거나, 못 쓰는 이유를 여기 적어라:\n` +
          call.slice(0, 160)
      )
      assert.equal(
        /timeout:/.test(call),
        ex!.bounded,
        ex!.bounded
          ? `${f}의 '${ex!.why}' 호출에 한도가 없다 — 막히면 영영 안 끝난다`
          : `${f}의 '${ex!.why}' 호출에 한도가 붙었다 — 사람이 기다리는 자리다`
      )
    }
  }
  /* ★ 아무것도 못 찾고 조용히 통과하는 게 제일 위험하다 — 위에서 실제로
     그랬다(셋 중 하나만 걸렸다). 예외 목록만큼은 찾았는지 세어본다. */
  assert.equal(seen, EXCEPTIONS.length, `직접 띄우는 자리를 ${seen}곳 찾았다 — 훑는 눈이 어긋났다`)
})

test('★ 한도는 넉넉하되 유한하다 — 여기서 걸리는 건 느린 게 아니라 막힌 것이다', () => {
  const src = read('src/probes/shell.ts')
  const m = src.match(/export const PS_TIMEOUT_MS = ([\d_]+)/)
  assert.ok(m, '한도를 정하는 자리가 없다')
  const ms = Number(m![1].replace(/_/g, ''))
  // 실측에서 가장 느린 조사가 0.3초였다. 아래로 내리면 멀쩡한 답을 자른다.
  assert.ok(ms >= 10_000, `한도가 너무 짧다(${ms}ms) — 느린 PC의 정상 답까지 자른다`)
  // 위로 올리면 '한도가 있다'는 말이 무의미해진다. 사용자는 그만큼 기다린다.
  assert.ok(ms <= 60_000, `한도가 너무 길다(${ms}ms) — 화면이 그만큼 빈 채로 버틴다`)
})
