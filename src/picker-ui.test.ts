/**
 * 낱개로 고르기 안전장치 — "하나씩 볼게요"가 전부 지우기가 되지 않게
 *
 * ★ 여기서 잡는 건 **판단의 해상도와 실행의 해상도가 어긋나는 것**이다.
 *   화면은 파일을 낱개로 보여주는데 실행 단위는 늘 '묶음 전체'였다.
 *   그 어긋남이 만든 실제 버그가 이거였다 —
 *
 *   "하나씩 볼게요"(REVIEW_ONE_BY_ONE)가 answerAction의 어느 분기에도 안 걸려서
 *   그대로 흘러내려갔고, 결과적으로 "140,613개 · 18.1GB 격리로 정리하기"라는
 *   일괄 버튼이 떴다. 하나씩 보겠다는 사람에게 전부 지우기를 내민 것이다.
 *   게다가 눌러도 안 됐다: 엔진은 이 답을 'review'로 보고 아무것도 안 한 채
 *   돌려주는데 화면은 r.quarantinedCount를 읽어 undefined로 터졌다.
 *
 *   타입도 단위 테스트도 못 잡는 종류다 — 화면은 멀쩡히 그려졌으니까.
 *   그래서 소스에서 못 박는다. (같은 이유·같은 방식 — startup-ui.test.ts)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const app = () => read('web/src/app.ts')
const engine = () => read('src/engine-cli.ts')

/** answerAction 본문만 떼어낸다. */
function answerActionBody(src: string): string {
  const start = src.indexOf('async function answerAction(')
  assert.ok(start > 0, 'answerAction을 찾지 못했다 — 이름이 바뀌었으면 이 테스트도 고쳐야 한다')
  const end = src.indexOf('\nfunction renderPicker', start)
  assert.ok(end > start, 'answerAction의 끝을 찾지 못했다')
  return src.slice(start, end)
}

test('★ "하나씩 볼게요"는 일괄 버튼으로 흘러내려가지 않는다', () => {
  const body = answerActionBody(app())

  // 일괄 실행 버튼을 만드는 자리보다 REVIEW_ONE_BY_ONE 분기가 **먼저** 와야 한다.
  const branch = body.indexOf("outcome === 'REVIEW_ONE_BY_ONE'")
  const bulk = body.indexOf('data-answer-go')
  assert.ok(branch > 0, 'REVIEW_ONE_BY_ONE을 따로 다루는 분기가 없다 — 일괄 버튼으로 흘러내려간다')
  assert.ok(bulk > 0, '일괄 실행 버튼을 찾지 못했다 — 이 테스트가 낡았다')
  assert.ok(
    branch < bulk,
    'REVIEW_ONE_BY_ONE 분기가 일괄 버튼보다 뒤에 있다 — 그러면 여전히 흘러내려간다'
  )

  // 그 분기는 낱개 목록으로 가야 한다.
  assert.match(body, /renderPicker\(/, 'REVIEW_ONE_BY_ONE이 낱개 목록을 열지 않는다')
})

test('★ 낱개 목록은 아무것도 안 고른 상태로 시작한다', () => {
  const src = app()
  const start = src.indexOf('function renderPicker(')
  const body = src.slice(start, src.indexOf('\nfunction renderKept', start))

  // 체크박스에 checked를 박아두면 그건 다시 일괄 삭제다.
  assert.doesNotMatch(
    body,
    /<input type="checkbox"[^>]*\bchecked\b/,
    '체크박스가 기본 선택돼 있다 — 실수로 누르면 전부 지워진다'
  )
  assert.match(body, /picked\.clear\(\)/, '이전 선택이 남아 있으면 엉뚱한 걸 지운다')
  // 고른 게 없으면 실행 버튼이 눌리면 안 된다.
  assert.match(body, /disabled\s*=\s*picked\.size === 0/, '고른 게 없어도 실행 버튼이 살아 있다')
})

test('★ 낱개 격리는 실행 직전에 엔진이 다시 분류한다 — 화면 말을 그냥 믿지 않는다', () => {
  const src = engine()
  const start = src.indexOf("case 'quarantine-paths'")
  assert.ok(start > 0, 'quarantine-paths 명령이 없다')
  const body = src.slice(start, src.indexOf("case 'startup'", start))

  // 밖에서 온 경로를 그대로 격리하면 임의 파일 삭제 통로가 된다.
  assert.match(body, /classifyOne\(/, '받은 경로를 다시 분류하지 않는다')
  assert.match(body, /zone === 'LOCKED'/, '잠근 항목을 거절하지 않는다')
  assert.match(body, /isFile\(\)/, '폴더가 들어와도 막지 않는다')
  // 계획 시점과 달라졌으면 격리가 건너뛰도록 expect를 넘겨야 한다(TOCTOU).
  assert.match(body, /expect:/, 'expect 없이 격리하면 그 사이 바뀐 파일을 그대로 가져간다')
})

test('★ 거절한 것을 숨기지 않는다 — 왜 안 됐는지가 신뢰의 근거다', () => {
  const src = engine()
  const start = src.indexOf("case 'quarantine-paths'")
  const body = src.slice(start, src.indexOf("case 'startup'", start))
  assert.match(body, /refused/, '거절 목록을 돌려주지 않는다')

  const ui = app()
  const pstart = ui.indexOf('function renderPicker(')
  const pbody = ui.slice(pstart, ui.indexOf('\nfunction renderKept', pstart))
  assert.match(pbody, /refused/, '화면이 거절 사유를 안 보여준다')
})

test('★ 전부 되돌리기도 실패를 말한다 — 조용히 끝나면 격리함의 존재 이유가 깨진다', () => {
  const src = app()
  const start = src.indexOf("getElementById('restore-all')")
  assert.ok(start > 0, 'restore-all 핸들러를 찾지 못했다')
  const body = src.slice(start, start + 900)
  assert.match(body, /catch/, 'restore-all에 catch가 없다 — 실패가 unhandled로 흘러 화면이 조용하다')
  assert.match(body, /errText\(err\)/, '실패 이유를 사람이 읽을 문장으로 안 바꾼다')
})

test('★ 오류 문구를 통째로 버리는 자리가 남아 있지 않다', () => {
  // Tauri의 invoke는 Error가 아니라 문자열을 던진다 — .message는 undefined다.
  // 화면에 "undefined"만 뜨던 실물 버그(v0.9.10)의 재발 방지.
  const hits = app().match(/\(err as Error\)\.message/g) ?? []
  assert.deepEqual(hits, [], `(err as Error).message가 ${hits.length}곳 남아 있다 — errText(err)를 써야 한다`)
})
