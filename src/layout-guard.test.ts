/**
 * 가로로 터지지 않는가
 *
 * ★ 실물에서 나온 증상: 글자가 한 줄에 한 자씩 떨어지고 창 밑에 가로
 *   스크롤바가 생겼다. 원인은 언제나 같다 — 안 끊기는 긴 문자열(경로,
 *   sha256-… 이름) 하나가 제 칸의 '최소 폭'을 창보다 넓게 만든다. 그러면
 *   같은 줄의 형제가 0에 가깝게 눌리고, 눌린 칸에서 글자가 한 자씩 떨어진다.
 *
 *   이건 한 군데를 고쳐서 될 일이 아니다. 경로를 그리는 자리는 계속 늘어나고,
 *   그때마다 같은 실수가 반복된다. 그래서 '터질 수 없게' 막아두고 여기서 잠근다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = () => readFileSync(join(root, 'web/app.html'), 'utf8')

test('창 전체는 가로로 밀리지 않는다 — 마지막 안전망', () => {
  const s = css()
  assert.match(s, /\.content\{[^}]*overflow-x:clip/, '내용 영역에 안전망이 없다')
  // hidden이 아니라 clip이어야 한다 — hidden은 스크롤 컨테이너를 만들어
  // 세로 스크롤과 sticky를 같이 망가뜨린다.
  assert.doesNotMatch(s, /\.content\{[^}]*overflow-x:hidden/, 'hidden은 세로 스크롤을 망가뜨린다')
})

test('눌릴 수 있어야 눌린다 — min-width를 풀어둔다', () => {
  const s = css()
  assert.match(s, /\.screen\{min-width:0\}/, '화면 칸이 안 줄어든다')
  assert.match(s, /\.pick-row > \*\{min-width:0\}/, '격자 칸이 안 줄어든다')
  assert.match(s, /\.pg,\.pg-h,\.pg-files\{min-width:0\}/, '중복 묶음 칸이 안 줄어든다')
})

test('제안 카드는 좁아지면 접힌다', () => {
  const s = css()
  const pcard = s.slice(s.indexOf('  .pcard{'), s.indexOf('  .pcard.t1'))
  assert.match(pcard, /flex-wrap:wrap/, '좁을 때만 접히면 긴 경로가 들어왔을 때 밀린다')
  assert.match(pcard, /min-width:0/, '카드가 안 줄어든다')
})

test('★ 버튼 자리에 문장이 들어오면 한 줄을 통째로 쓴다', () => {
  /* 실물에서 나온 그림: 다 지운 카드에서 "52.0 / GB", "MusicF / actory"처럼
     글자가 두세 자씩 끊겨 나왔다. 글꼴이 깨진 게 아니라 칸이 없어진 것이다 —
     버튼 자리(.pcard-act)에 flex:none이 걸려 있는데 거기에 한 문장이 들어오면,
     그 문장이 펼친 길이 그대로 자리를 먹고 옆칸이 90px로 눌린다.
     '줄지 마라'는 버튼을 위한 규칙이지 문장을 위한 규칙이 아니다. */
  const s = css()
  const app = readFileSync(join(root, 'web/src/app.ts'), 'utf8')

  assert.match(
    s,
    /\.pcard-act\.pcard-act-wide\{[^}]*flex:1 1 100%/,
    '결과가 들어와도 버튼 폭에 갇힌다 — 옆칸이 눌려 글자가 한 자씩 떨어진다'
  )
  assert.match(
    app,
    /classList\.add\('pcard-act-wide'\)/,
    '규칙만 있고 붙이는 쪽이 없다 — 화면은 그대로 터진다'
  )
})

test('긴 경로 목록은 제 상자 안에서 스크롤한다', () => {
  const s = css()
  // 밖으로 미는 대신 자기 안에서 스크롤하면 나머지 화면이 멀쩡하다.
  assert.match(s, /\.pcard-eg\{[^}]*overflow-x:auto/, '경로 목록이 화면을 민다')
})

test('본문은 긴 문자열을 끊을 수 있다', () => {
  const s = css()
  // keep-all은 한글이 아무 데서나 끊기는 걸 막고, anywhere는 긴 경로를 끊는다.
  assert.match(s, /word-break:keep-all;overflow-wrap:anywhere/, '둘은 짝으로 써야 한다')
})
