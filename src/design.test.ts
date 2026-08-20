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

/* ══════════════════════════════════════════════════════════════
   큼지막함 — 2026-08-20 실물에서 "글씨가 너무 작다"가 나왔다

   재보니 본문 16px에 읽는 폭 1000px이었다. 한 줄에 한글 62자다.
   토스는 390px 폭에 본문 17px, 한 줄 22자 — 글자가 화면 폭에서 차지하는
   비율이 세 배 차이였다. 그래서 두 손을 같이 쓴다:
   글자를 키우고(16→18), 글이 흐르는 폭을 좁힌다(--measure).

   ★ 눈으로만 지키면 다시 작아진다. 크기는 한 번에 안 줄고 한 화면씩
     "여긴 좀 작아도 되지"로 줄어든다. 그래서 바닥을 코드로 박는다.
   ══════════════════════════════════════════════════════════════ */

/** :root의 --t-* 토큰을 {이름: px}로 읽는다. */
function ramp(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of html().matchAll(/--t-([a-z0-9]+)\s*:\s*([0-9.]+)px/g)) out[m[1]] = Number(m[2])
  return out
}

/** 셀렉터 하나의 선언 블록을 통째로 꺼낸다. */
function rule(selector: string): string {
  const css = html()
  const i = css.indexOf(selector + '{')
  assert.ok(i >= 0, `${selector} 규칙을 찾지 못했다`)
  return css.slice(i, css.indexOf('}', i) + 1)
}

test('★ 읽는 본문이 18px 아래로 안 내려간다 — "글씨가 너무 작다"가 실물에서 나왔다', () => {
  const r = ramp()
  assert.ok(r.body >= 18, `본문이 ${r.body}px다`)
  assert.ok(r.small >= 16, `보조 본문이 ${r.small}px다 — 여기가 먼저 작아진다`)
  assert.ok(r.caption >= 15, `캡션이 ${r.caption}px다`)
  assert.ok(r.micro >= 13, `가장 작은 글자가 ${r.micro}px다 — 배지도 읽혀야 한다`)
})

test('★ 크기 단이 성큼 벌어진다 — 1~2px 차이는 위계가 아니라 오차로 읽힌다', () => {
  /* 본문 다음이 본문+1이면 둘은 같은 글자로 보이고, 결국 위계를 색으로 만들게
     된다 — 그래서 12px 청록 라벨이 여섯 개 생겼었다. 최소 15%씩 벌린다. */
  const r = ramp()
  const steps = ['body', 'title', 'h2', 'h1']
  for (let i = 1; i < steps.length; i++) {
    const lo = r[steps[i - 1]]
    const hi = r[steps[i]]
    assert.ok(hi >= lo * 1.15,
      `--t-${steps[i]}(${hi}px)가 --t-${steps[i - 1]}(${lo}px)보다 15% 이상 크지 않다`)
  }
})

test('★ 글이 흐르는 폭에 상한이 있다 — 한 줄이 길면 눈이 다음 줄 첫 글자를 못 찾는다', () => {
  assert.match(html(), /--measure\s*:/, '읽는 줄 길이를 정하는 토큰이 없다')
  /* 토큰만 있고 안 걸려 있으면 없는 것과 같다. 본문을 담는 곳에 실제로 건다.
     (카드 폭을 줄이는 게 아니라 글이 흐르는 폭만 줄인다 — 목록·표는 넓어야 한다) */
  for (const sel of ['.lede', '.fact-p', '.more-b', '.pagehead .sub']) {
    assert.match(rule(sel), /max-width:var\(--measure\)/, `${sel}에 읽는 폭 상한이 없다`)
  }
})

test('★ 눈썹 배지를 화면마다 달지 않는다 — 왼쪽 내비가 방금 한 말이다', () => {
  /* "숨은 공간 / 스캔에 안 보이는 용량"처럼 같은 말이 두 번, 열 곳에 있었다.
     게다가 청록 배지라 '누를 수 있는 것'의 색이 열 곳에서 장식으로 쓰였다. */
  assert.doesNotMatch(html(), /<span class="k">/, '눈썹 배지가 다시 생겼다')
})

test('★ 화면 안내가 카드로 맨 위를 차지하지 않는다', () => {
  /* 사용자가 이 화면에 온 이유(69.8GB)가 안내 카드 아래, 스크롤 밖에 있었다.
     안내는 카드가 아니라 화면 머리(.pagehead)로 두고, 배경 설명은 접는다. */
  assert.match(html(), /\.pagehead\{/, '화면 머리 스타일이 없다')
  const heads = (html().match(/<header class="pagehead">/g) ?? []).length
  assert.ok(heads >= 6, `화면 머리를 쓰는 화면이 ${heads}개뿐이다`)
})

test('★ 위험 문장은 접기 밖에 있다 — 접히면 안 읽히고, 안 읽히면 안 쓴 것이다', () => {
  /* 엔진이 ★를 붙인 줄은 "반드시 읽혀야 한다"는 표시다(노트북은 빠른 시작이
     꺼진다, 리눅스 환경이 통째로 사라진다 …). 접기 안으로 들어가면 안 된다. */
  const src = app()
  const i = src.indexOf('function explainCard(')
  assert.ok(i > 0, 'explainCard를 찾지 못했다')
  const body = src.slice(i, src.indexOf('\n}', i))
  assert.match(body, /includes\('★'\)/, '★ 줄을 따로 골라내지 않는다')
  const risk = body.indexOf('fact-risk')
  const fold = body.indexOf('<details')
  assert.ok(risk > 0 && fold > 0 && risk < fold,
    '★ 위험 줄이 접기(<details>) 안이나 뒤에 있다 — 펼치지 않으면 안 보인다')
})

test('★ "실행은 데스크톱 앱" 안내가 데스크톱 앱에서 안 뜬다', () => {
  /* 앱을 켜고 들어가면 "실측은 데스크톱 앱에서 하세요"가 떠 있었다 — 그 앱 안에서.
     홈 화면 것만, 그것도 스캔이 끝난 뒤에야 숨기고 있었기 때문이다. */
  assert.match(app(), /querySelectorAll<HTMLElement>\('\.web-only'\)[\s\S]{0,80}hidden = inTauri/,
    '웹 전용 안내를 앱 시작 때 숨기지 않는다')
  assert.match(html(), /class="web-only"/, '웹 전용 안내에 표시가 없다')
})
