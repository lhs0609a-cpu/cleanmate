/**
 * 쉬운 말 검사 — 개발자 말이 화면으로 새어나가지 않게
 *
 * ── 왜 테스트로 잠그나 ───────────────────────────────────────
 * 화면 문구는 고쳐도 다시 돌아온다. 새 규칙을 하나 추가할 때 "가상환경",
 * "빌드 결과물", "패키지 캐시"라고 쓰는 게 쓰는 사람에겐 제일 자연스럽기
 * 때문이다. 실제로 그렇게 쌓여서 사용자 화면이 이렇게 돼 있었다:
 *
 *   torch_cuda.dll · 개발 중간 산출물 · 1.2GB
 *   파이썬 가상환경 라이브러리 — pip install로 되돌립니다
 *   node_modules도 한 덩어리예요. 일부만 지우면 어차피 npm install을…
 *
 * 이 앱의 사용자는 pip이 뭔지 모른다. 몰라도 되는 게 맞다 —
 * "인터넷에서 다시 받으면 돼요(몇 분)"면 결정은 충분히 내려진다.
 *
 * ── 무엇을 검사하나 ─────────────────────────────────────────
 * 화면으로 나가는 **문자열 리터럴**만 본다. 주석과 코드 식별자는 건드리지
 * 않는다 — 개발자끼리는 정확한 이름으로 부르는 게 맞고, 그게 이 저장소의
 * 문서이기도 하다. (그래서 주석을 먼저 걷어내고 검사한다)
 *
 * ── 예외를 두는 것 ──────────────────────────────────────────
 * ① 실제 폴더 이름(node_modules, .venv): 사용자가 탐색기에서 그대로 본다.
 *    숨기면 오히려 못 찾는다 — 단, 반드시 쉬운 말과 함께 쓴다.
 * ② 직접 쳐야 하는 명령(wsl --shutdown, docker system prune):
 *    쉬운 말로 바꾸면 아예 쓸 수 없다. 대신 어디에 붙여넣는지를 적는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** 사용자 화면 문구를 담은 파일들 */
const FILES = [
  'src/units.ts',
  'src/owners.ts',
  'src/kinds.ts',
  'src/engine.ts',
  'src/dupes.ts',
  'src/relocate.ts',
  'src/content/unknowns.ts',
  'src/probes/bulk.ts',
  'src/probes/reclaim.ts',
  'src/probes/hiberfil.ts',
]

/** 개발자 말 → 화면에서 쓰기로 한 말 */
const BANNED: [RegExp, string][] = [
  [/가상환경/, '부품 상자'],
  // 진짜 폴더 이름은 괄호에 넣어 쉬운 말 옆에 붙일 때만 허용한다: 부품 폴더(node_modules)
  [/(?<!\()node_modules/, '부품 폴더 — 폴더 이름을 쓸 거면 "부품 폴더(node_modules)"처럼 괄호로'],
  [/\bnpm install\b/, '부품을 다시 받습니다'],
  [/\bpip install\b/, '인터넷에서 다시 받습니다'],
  [/빌드/, '만들기 / 완성본'],
  [/라이브러리/, '부품'],
  [/패키지/, '부품'],
  [/캐시/, '임시 저장본'],
  [/셰이더/, '화면 밑그림'],
  [/소스 코드|원본 소스/, '직접 쓰신 원본'],
  [/산출물/, '만들어진 것'],
  [/런처/, '게임 실행 프로그램'],
  [/컨테이너|볼륨에|이미지·컨테이너/, '프로그램 묶음 / 저장한 자료'],
  [/디렉터리/, '폴더'],
  [/정션/, '안내판'],
  [/격리함/, '보관함'],
]

/** 주석을 걷어내고 문자열 리터럴만 뽑는다. 여기 있는 게 사용자가 읽는 말이다. */
function userStrings(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...code.matchAll(/(['"`])((?:[^\\\n]|\\.)*?)\1/g)]
    .map((m) => m[2])
    .filter((s) => /[가-힣]/.test(s)) // 한글이 든 것 = 화면 문구
}

test('★ 화면 문구에 개발자 말이 없다 — 사용자는 pip이 뭔지 모른다', () => {
  const found: string[] = []
  for (const file of FILES) {
    for (const s of userStrings(read(file))) {
      for (const [re, better] of BANNED) {
        if (re.test(s)) found.push(`${file}\n     "${s.slice(0, 80)}"\n     → ${better}로 쓰세요`)
      }
    }
  }
  assert.deepEqual(found, [], `개발자 말이 화면으로 새어나갑니다:\n\n  ${found.join('\n\n  ')}\n`)
})

test('★ 화면(web)에도 개발자 말이 없다', () => {
  const found: string[] = []
  for (const file of ['web/src/app.ts']) {
    for (const s of userStrings(read(file))) {
      for (const [re, better] of BANNED) {
        // 진짜 윈도우 '바로가기(.lnk)'를 다루는 자리가 있어서 그 말은 금지어가 아니다.
        if (re.test(s)) found.push(`${file}: "${s.slice(0, 70)}" → ${better}`)
      }
    }
  }
  assert.deepEqual(found, [], `개발자 말이 화면으로 새어나갑니다:\n  ${found.join('\n  ')}`)
})

/* ────────────────────────────────────────────────────────────
   쉬운 말로 바꾸면서 뜻까지 흐려지면 안 된다.
   결정에 필요한 세 가지는 바뀐 뒤에도 그대로 있어야 한다.
   ──────────────────────────────────────────────────────────── */

test('쉬운 말로 바꿔도 "얼마나 걸리나"는 남아 있다', () => {
  const units = read('src/units.ts')
  for (const must of ['1~3분', '몇 분', '다시 만들기 한 번']) {
    assert.ok(units.includes(must), `되돌리는 데 드는 시간이 사라졌다: ${must}`)
  }
})

test('직접 쳐야 하는 명령은 그대로 둔다 — 바꾸면 쓸 수가 없다', () => {
  const bulk = read('src/probes/bulk.ts')
  assert.match(bulk, /wsl --shutdown/, '실제로 쳐야 하는 명령이 사라졌다')
  assert.match(bulk, /docker system prune/, '실제로 쳐야 하는 명령이 사라졌다')
  // 명령만 주고 끝내지 않는다 — 어디에 붙여넣는지가 진짜 모르는 부분이다.
  assert.match(bulk, /관리자 권한으로 실행/, '그 창을 어떻게 여는지를 안 알려준다')
})
