/**
 * 타이포그래피 테스트 — 조용히 무너지는 걸 막는 안전장치
 *
 * ★ 왜 이게 필요한가:
 *   이 앱의 글꼴은 **실패해도 아무 일도 안 일어난 것처럼 보인다.** 폰트 파일이
 *   빌드에서 빠지면 화면은 멀쩡히 뜨고, 그냥 맑은 고딕으로 돌아간다. 에러도,
 *   빈 화면도, 로그도 없다. 실제로 그 상태로 오래 있었다 — 스택 1순위가
 *   "Pretendard"였는데 윈도우엔 그게 깔려 있지 않으니, 설계한 디자인을
 *   본 사람이 아무도 없었다.
 *
 *   두 번째 실패 모드도 같다. 화면을 그리는 코드가 인라인 style로 글자 크기를
 *   적기 시작하면(11.5px·12.5px…) 디자인 시스템은 한 파일 안에서만 참이 된다.
 *   그것도 아무 에러를 안 낸다. 그래서 여기서 잠근다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const FONT = 'web/public/fonts/PretendardVariable.woff2'
const appHtml = () => read('web/app.html')

test('★ 글꼴 파일이 실제로 있다 — 빠지면 조용히 맑은 고딕으로 돌아간다', () => {
  const buf = readFileSync(join(root, FONT))
  // woff2 매직 넘버. 파일이 있어도 내용이 깨졌으면(LFS 포인터·404 HTML 등) 여기서 걸린다.
  assert.equal(buf.subarray(0, 4).toString('latin1'), 'wOF2', `${FONT}가 woff2가 아니다`)
  assert.ok(buf.length > 500_000, '가변 글꼴치고 너무 작다 — 받다 만 파일일 수 있다')
})

test('OFL 라이선스를 함께 배포한다 — 폰트를 넣었으면 의무다', () => {
  const ofl = read('web/public/fonts/Pretendard-OFL.txt')
  assert.match(ofl, /SIL OPEN FONT LICENSE/i)
  assert.match(ofl, /Pretendard/)
})

test('★ 글꼴을 네트워크로 받지 않는다 — 파일이 기기를 안 떠난다는 약속', () => {
  const html = appHtml()
  const faces = html.match(/@font-face\{[^}]*\}/g) ?? []
  assert.ok(faces.length > 0, '@font-face가 없다 — 글꼴을 넣어놓고 안 쓰는 셈이다')
  for (const f of faces) {
    assert.doesNotMatch(f, /https?:\/\//, 'CDN에서 글꼴을 받으면 안 된다')
    assert.match(f, /url\("\/fonts\//, '앱에 함께 담긴 경로여야 한다')
  }
})

test('글꼴을 미리 받기 시작한다(preload) — 첫 글자가 뜨는 시점을 당긴다', () => {
  assert.match(appHtml(), /rel="preload"[^>]*PretendardVariable\.woff2[^>]*as="font"/)
})

/* ────────────────────────────────────────────────────────────
   디자인 시스템이 '시스템'으로 남아 있는가
   ──────────────────────────────────────────────────────────── */

/** @font-face의 가변축 범위(font-weight:45 920)는 크기 규칙과 무관하니 뺀다. */
function stripFontFace(css: string) {
  return css.replace(/@font-face\{[^}]*\}/g, '')
}

test('★ 글자 크기를 직접 적지 않는다 — 램프에 없는 크기가 생기면 시스템이 깨진다', () => {
  const html = appHtml()
  const hardcoded = stripFontFace(html).match(/font-size:\s*[0-9.]+px/g) ?? []
  assert.deepEqual(hardcoded, [], `app.html에 하드코딩된 크기: ${hardcoded.join(', ')}`)

  // 화면을 그리는 코드가 특히 잘 어긴다. 여기가 90곳까지 벌어졌었다.
  const ts = read('web/src/app.ts').match(/font-size:\s*[0-9.]+px/g) ?? []
  assert.deepEqual(ts, [], `app.ts에 하드코딩된 크기: ${ts.join(', ')}`)
})

test('굵기도 토큰으로만 쓴다 — 600·650·700·750·800이 흩어지지 않게', () => {
  const html = stripFontFace(appHtml()).match(/font-weight:\s*[0-9]+/g) ?? []
  assert.deepEqual(html, [], `app.html에 하드코딩된 굵기: ${html.join(', ')}`)
  const ts = read('web/src/app.ts').match(/font-weight:\s*[0-9]+/g) ?? []
  assert.deepEqual(ts, [], `app.ts에 하드코딩된 굵기: ${ts.join(', ')}`)
})

test('★ 크기 토큰마다 줄간격·자간이 짝으로 있다 — 셋은 따로 놀면 안 된다', () => {
  const css = appHtml().split('<style>')[1].split('</style>')[0]
  const sizes = new Set([...css.matchAll(/--t-([a-z0-9]+)\s*:/g)].map((m) => m[1]))
  for (const step of sizes) {
    assert.match(css, new RegExp(`--lh-${step}\\s*:`), `--t-${step}에 짝이 되는 --lh-${step}이 없다`)
    assert.match(css, new RegExp(`--tr-${step}\\s*:`), `--t-${step}에 짝이 되는 --tr-${step}이 없다`)
  }
})

test('참조하는 CSS 변수가 전부 정의돼 있다 — var(--mono) 같은 오타를 막는다', () => {
  const html = appHtml()
  const css = html.split('<style>')[1].split('</style>')[0]
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
  // 인라인 style 속성과 app.ts가 쓰는 것까지 함께 본다 — 실제로 거기서 깨져 있었다.
  const used = new Set(
    [...(html + read('web/src/app.ts')).matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])
  )
  const missing = [...used].filter((v) => !defined.has(v))
  assert.deepEqual(missing, [], `정의되지 않은 CSS 변수: ${missing.join(', ')}`)
})

/**
 * ★ CSS 주석이 제대로 닫혀 있는가.
 *
 * 실물에서 릴리스를 깬 버그다. 주석 블록 중간에 `*​/`가 하나 더 생겨서,
 * 그 뒤 두 줄이 CSS 선언 자리에 알몸으로 놓였다.
 *
 *   **브라우저는 이걸 봐준다.** 크롬은 깨진 선언을 조용히 버리고 나머지를
 *   그린다. 그래서 헤드리스로 렌더링해봤을 때 멀쩡해 보였다. 반면 빌드의
 *   PostCSS는 엄격해서 "Unknown word"로 멈춘다 — 화면으로는 절대 못 잡는다.
 *   그러니 파서로 잡아야 한다.
 */
test('★ CSS 주석이 짝이 맞는다 — 브라우저는 봐주지만 빌드는 안 봐준다', () => {
  const css = appHtml().split('<style>')[1].split('</style>')[0]
  let inComment = false
  for (let i = 0; i < css.length - 1; i++) {
    const two = css.slice(i, i + 2)
    if (!inComment && two === '/*') { inComment = true; i++ }
    else if (inComment && two === '*/') { inComment = false; i++ }
    else if (!inComment && two === '*/') {
      const line = css.slice(0, i).split('\n').length
      assert.fail(`주석 밖에 닫는 '*/'가 있다 (style 기준 ${line}번째 줄) — 그 앞 줄들이 CSS 선언 자리에 노출된다`)
    }
  }
  assert.equal(inComment, false, '열린 주석이 닫히지 않았다 — 뒤 규칙이 통째로 먹힌다')
})

test('한글이 아무 데서나 안 끊긴다 — word-break:keep-all', () => {
  // 없으면 "정해집니 / 다"처럼 낱말 가운데가 잘린다.
  assert.match(appHtml(), /word-break:\s*keep-all/)
})

test('숫자는 문장에선 비례폭 — 표에서만 고정폭이다', () => {
  const css = appHtml().split('<style>')[1].split('</style>')[0]
  const body = css.match(/\bbody\{[^}]*\}/)![0]
  assert.match(body, /font-variant-numeric:\s*proportional-nums/,
    '본문에 tabular-nums를 걸면 문장 속 숫자만 칸이 벌어져 글줄에 구멍이 뚫린다')
  assert.match(css, /\.tnum[^{]*\{[^}]*tabular-nums/,
    '자릿수를 세로로 맞춰 읽어야 하는 곳을 위한 .tnum은 있어야 한다')
})

test('폰트 파일이 저장소에 실제로 담겨 있다 — CI가 받아오지 않는다', () => {
  // CI는 npm install만 한다. 글꼴을 따로 받는 단계가 없으므로, 저장소에 없으면
  // 빌드는 성공하고 앱만 조용히 맑은 고딕이 된다.
  assert.ok(statSync(join(root, FONT)).size > 0)
})
