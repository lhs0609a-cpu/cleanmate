/**
 * 화면 — 눈으로만 잡히던 것을 코드로 잡는다
 *
 * ★ 왜 필요한가 (2026-08-20, 전부 실물 스크린샷에서 나옴)
 *   타입도 통과하고 번들도 되고 테스트도 초록불인데 화면이 깨져 있었다.
 *   셋 다 CSS와 템플릿의 문제라 어느 테스트도 안 보던 자리다.
 *
 *     ① 전체 선택 버튼이 **글자 없는 청록 덩어리**로 보였다.
 *        .opt.strong이 .opt.chosen보다 아래에 있어서 색을 덮었고,
 *        청록 배경에 청록 글씨가 됐다. 특이도가 같으니 순서가 곧 승부다.
 *
 *     ② 질문 카드의 안내 문장이 여섯 조각으로 흩어졌다.
 *        "낱개로는 옮길 수  없어요 —   프로그램이 저장한  자료   라 자리를..."
 *        .q-move에 display:flex를 줘서 문장 속 <b> 하나하나가 flex 아이템이 됐다.
 *
 *     ③ 목록의 경로가 두 줄씩 먹고 단어 중간에서 잘렸다. 게다가 40줄이 전부
 *        video.mp4라 이름 칸이 아무 말도 안 했다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cache = new Map<string, string>()
const read = (p: string) => {
  let v = cache.get(p)
  if (v === undefined) { v = readFileSync(join(root, p), 'utf8'); cache.set(p, v) }
  return v
}
const html = () => read('web/app.html')
const app = () => read('web/src/app.ts')

test('★ 고른 버튼의 글씨가 배경에 묻히지 않는다 — 빈 버튼으로 보인 적이 있다', () => {
  const css = html()
  /* .opt.strong과 .opt.chosen은 특이도가 같다. 둘 다 걸릴 때 이기는 쪽을
     명시하지 않으면 파일 순서가 결정하고, 순서는 누가 줄 하나 옮기면 바뀐다. */
  assert.match(
    css,
    /\.opt\.strong\.chosen\{[^}]*color:var\(--accent-ink\)/,
    '두 클래스가 함께 걸릴 때의 글씨색이 안 정해져 있다 — 청록 위 청록이 될 수 있다'
  )
})

test('★ 문장을 flex로 배치하지 않는다 — 문장 속 <b>가 조각으로 흩어진다', () => {
  const css = html()
  const m = css.match(/\.q-move\{[^}]*\}/)
  assert.ok(m, '.q-move 규칙을 찾지 못했다')
  assert.doesNotMatch(m![0], /display:\s*flex/, '문장 컨테이너가 flex다 — <b>마다 벌어진다')
  assert.match(m![0], /display:\s*block/, '문장이 문장으로 흐르지 않는다')
})

test('★ 목록 한 줄이 한 줄에 들어간다 — 긴 경로는 접는다', () => {
  const src = app()
  assert.match(src, /function shortPath\(/, '긴 경로를 접는 자리가 없다')
  const i = src.indexOf('function shortPath(')
  const body = src.slice(i, i + 500)
  // 짧은 경로까지 접으면 오히려 정보가 준다.
  assert.match(body, /p\.length <= fitsAt/, '짧은 경로도 무조건 접는다')
  // 전체 경로를 아예 못 보게 하면 안 된다 — 판단에 쓰이는 정보다.
  assert.match(src, /title="\$\{esc\(s\.path\)\}"/, '전체 경로를 확인할 방법이 없다')
})

test('★ 같은 파일명이 반복될 때 구별되는 것을 앞에 세운다', () => {
  /* 실물에서 40줄이 전부 video.mp4였다. 구별되는 건 상위 폴더뿐이다. */
  const src = app()
  const i = src.indexOf('function pickRowHtml(')
  const body = src.slice(i, i + 700)
  assert.match(body, /pick-dir/, '상위 폴더를 안 보여준다 — 이름만으로는 구별이 안 된다')
})

test('★ 창이 화면에 맞춰 열린다 — 매번 손으로 늘리게 하지 않는다', () => {
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'))
  const w = conf.app.windows[0]
  assert.equal(w.maximized, true, '기본 크기로 열려서 목록이 잘린다')
  assert.ok(w.width >= 1100, `기본 너비가 좁다(${w.width}) — 최대화가 안 먹는 환경의 대비책이다`)
})
