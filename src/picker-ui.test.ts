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

/* ────────────────────────────────────────────────────────────
   목록이 "이게 뭔데요?"에 답하는가

   실물 화면에 이렇게 떴다:

     [ ] torch_cuda.dll                         1.2GB
         C:\…\ACE-Step-1.5\.venv\…\torch_cuda.dll
     [ ] dnnl.lib                               676MB
     [ ] cublasLt64_12.dll                      660MB

   파일명과 숫자만 주고 "지울 것을 고르세요"라고 한다 — 우리가 비판하던 화면
   그대로다. 무슨 파일인지, 누구 것인지, 지우면 뭐가 깨지는지가 없다.

   ★ 황당한 건 그 답을 **엔진이 이미 보내고 있었다는 것**이다(owners.ts →
     withOwner → evidence.samples[].owner). 접힌 '근거 자세히'는 그걸 다 쓰는데,
     정작 지울 것을 고르는 화면만 안 썼다. 정보가 없어서가 아니라 안 그려서
     못 읽은 것이다. 그래서 여기서 못 박는다.
   ──────────────────────────────────────────────────────────── */

/** renderPicker가 그리는 부분만 떼어낸다(묶음 머리 + 낱개 줄 + 본체). */
function pickerSource(src: string): string {
  const start = src.indexOf('function pickRowHtml(')
  assert.ok(start > 0, 'pickRowHtml을 찾지 못했다 — 이름이 바뀌었으면 이 테스트도 고쳐야 한다')
  const end = src.indexOf('\nfunction renderKept', start)
  assert.ok(end > start, '낱개 목록의 끝을 찾지 못했다')
  return src.slice(start, end)
}

test('★ 낱개 목록이 파일명·크기만 주지 않는다 — 무엇의 것이고 지우면 뭐가 깨지는지 함께 그린다', () => {
  const body = pickerSource(app())

  // 엔진이 실어 보낸 판단을 실제로 그려야 한다. 하나라도 빠지면 "고르세요"만 남는다.
  assert.match(body, /headline/, '누구 것인지(한 줄 정체)를 안 그린다')
  assert.match(body, /o\.onDelete/, '지우면 무슨 일이 생기는지를 안 그린다')
  assert.match(body, /o\?\.breaks/, '무엇이 깨지는지를 안 그린다')
  assert.match(body, /o\?\.intact/, '무엇이 그대로 남는지를 안 그린다 — 안심의 근거가 없다')
  assert.match(body, /o\.verdictLabel/, '지워도 되는지(판정)를 안 그린다')
  assert.match(body, /o\?\.because/, '왜 그렇게 봤는지(근거)를 안 그린다')
})

test('★ 설명은 묶음에 한 번만 — 파일마다 반복하면 아무도 안 읽는다', () => {
  const src = app()
  // 근거 패널과 낱개 목록이 같은 묶기 함수를 쓴다. 따로 묶으면 같은 파일이
  // 두 화면에서 다르게 묶여서, 어느 쪽 개수를 믿을지부터 고민하게 된다.
  assert.match(src, /function groupByOwner\(/, '묶기 함수가 없다')
  const uses = src.match(/groupByOwner\(/g) ?? []
  assert.ok(uses.length >= 3, `근거 패널과 낱개 목록이 같은 묶기를 쓰지 않는다 (${uses.length}곳)`)
})

test('★ 낱개 목록에서 옮기기도 할 수 있다 — 지우기만이 답은 아니다', () => {
  const body = pickerSource(app())
  // "지우긴 아까운데 자리는 차지한다"의 답은 삭제가 아니라 이동이다.
  assert.match(body, /relocate-paths-plan/, '옮기기 전에 계획(미리보기)을 안 받는다')
  assert.match(body, /relocate-paths-apply/, '고른 것을 옮기는 통로가 없다')
  // 옮기면 깨지는 파일을 옮기자고 하면 안 된다. 판정은 엔진이 실어 보낸다.
  assert.match(body, /canMove\(/, '옮길 수 있는지 판정을 안 쓴다')
  assert.match(body, /movable\.length/, '옮길 수 없는 것까지 세면 버튼의 개수가 거짓말이 된다')
})

test('★ "옮길래요"가 엉뚱한 목록으로 보내지 않는다', () => {
  const body = answerActionBody(app())
  const move = body.indexOf("outcome === 'MOVE'")
  assert.ok(move > 0, 'MOVE를 따로 다루는 분기가 없다')
  // 이동 화면(go('move'))은 다운로드·영상 폴더를 처음부터 다시 훑는다.
  // 방금 보던 파일과 아무 상관이 없는 목록이다 — 그것만 주고 끝내면 안 된다.
  assert.match(
    body.slice(move),
    /renderPicker\(/,
    '"옮길래요"가 방금 보던 파일을 못 옮기고 다른 화면으로만 보낸다'
  )
})

test('★ 14만 개를 낱개 체크박스로만 고르게 하지 않는다 — 폴더째가 먼저 온다', () => {
  const body = pickerSource(app())
  assert.match(body, /unitCardsHtml\(/, '결정 단위(폴더) 카드를 안 그린다')
  assert.match(body, /quarantine-folders/, '폴더째 정리하는 통로가 없다')

  // 폴더 카드가 낱개 목록보다 위에 있어야 한다. 아래에 있으면 14만 줄을 지나야 보인다.
  const cards = body.indexOf('unitCardsHtml(units)')
  const list = body.indexOf('groups.map(pickGroupHtml)')
  assert.ok(cards > 0 && list > 0, '두 목록을 다 찾지 못했다')
  assert.ok(cards < list, '폴더 카드가 낱개 목록보다 뒤에 있다')
})

test('★ 폴더째 정리도 폴더 안을 다시 분류한다 — 잠근 것은 폴더째라도 안 가져간다', () => {
  const src = engine()
  const start = src.indexOf("case 'quarantine-folders'")
  assert.ok(start > 0, 'quarantine-folders 명령이 없다')
  const body = src.slice(start, src.indexOf("case 'dupes-scan'", start))
  assert.match(body, /classifyOne\(/, '폴더 안 파일을 다시 분류하지 않는다')
  assert.match(body, /zone === 'LOCKED'/, '폴더째라고 잠근 항목까지 가져간다')
  assert.match(body, /isDirectory\(\)/, '파일을 폴더로 받아도 막지 않는다')
  assert.match(body, /expect:/, '계획 시점과 달라진 파일을 그대로 가져간다(TOCTOU)')
})

test('★ 고른 파일만 옮기는 것도 엔진이 다시 분류한다 — 이동은 삭제보다 되돌리기가 번거롭다', () => {
  const src = engine()
  const start = src.indexOf('async function relocatePathsPlan(')
  assert.ok(start > 0, 'relocatePathsPlan을 찾지 못했다')
  const body = src.slice(start, start + 2000)
  assert.match(body, /classifyOne\(/, '받은 경로를 다시 분류하지 않는다')
  assert.match(body, /isRelocatable\(/, '옮기면 안 되는 경로를 거르지 않는다')
  assert.match(body, /isFile\(\)/, '폴더가 들어와도 막지 않는다')
  assert.match(body, /stampMtime/, '계획 시점 상태를 안 적으면 그 사이 바뀐 파일을 그대로 옮긴다')
  assert.match(body, /refused/, '거절한 것을 안 돌려준다')
})

test('★ "두시는 게 안전합니다"를 고르면 한 번 더 묻는다 — 막지는 않는다', () => {
  const body = pickerSource(app())
  // 엔진은 존 C만 거절한다. owners의 keep(세이브·설정·직접 만든 문서)은 그보다 넓다.
  assert.match(body, /verdict === 'keep'/, 'keep 판정을 고른 걸 알아채지 못한다')
  assert.match(body, /risky\.length/, '확인 없이 그대로 실행한다')
  // 거절이 아니라 확인이어야 한다 — 자기 파일을 지울 권리는 사용자에게 있다.
  assert.doesNotMatch(body, /risky\.length\)\s*return\b/, '고른 것을 조용히 막아버린다')
})

test('★ 정리 결과를 "지금 빈 용량"으로 말한다 — 보관은 없앴다', () => {
  const src = app()
  const start = src.indexOf('function spaceHint(')
  assert.ok(start > 0, 'spaceHint를 찾지 못했다')
  const body = src.slice(start, start + 900)
  /* 보관함이 있던 시절엔 "지금은 용량이 안 빕니다"라는 변명 갈래가 필요했다.
     같은 드라이브로 옮기는 것이라 실제로 안 빴기 때문이다. 이제는 지우므로
     그 갈래가 있으면 안 된다 — 있으면 화면이 동작과 다른 말을 하는 것이다. */
  assert.doesNotMatch(body, /지금은 용량이 안 빕니다/, '보관 시절 문구가 남아 있다')
  assert.match(body, /남은 공간 \$\{fmtBytes\(lastDisk\.free\)\} → /, '전후 여유 공간을 안 보여준다')
})

test('★ 지우기 전 확인창은 되돌릴 수 없다는 말을 먼저 놓는다', () => {
  const body = pickerSource(app())
  const start = body.indexOf("engine('quarantine-paths'")
  assert.ok(start > 0, '낱개 삭제 실행부를 찾지 못했다')
  const before = body.slice(Math.max(0, start - 1200), start)
  assert.match(before, /confirm\(/, '확인 없이 지운다')
  assert.match(before, /되돌릴 수 없습니다/, '되돌릴 수 없다는 말을 안 한다')
  // 사람들이 아는 삭제는 대개 휴지통을 거친다. 안 적으면 "꺼내면 되지"로 읽는다.
  assert.match(before, /휴지통에도 안 남아요/, '휴지통에도 안 남는다는 걸 안 말한다')
  // 30일 보관을 약속하던 문구가 남아 있으면 그건 지금 거짓말이다.
  assert.doesNotMatch(before, /30일/, '지우면서 30일 보관을 약속한다')
})

test('★ 옮긴 것·합친 것은 되돌리기 화면에 남는다 — 보관함을 없애면서 같이 없애지 않는다', () => {
  const src = app()
  assert.match(src, /function renderMovedUndo\(/, '옮긴 것 되돌리기 목록이 없다')
  assert.match(src, /function renderMergedUndo\(/, '합친 것 따로 떼기 목록이 없다')
  assert.match(src, /engine\('undo-list'\)/, '옮긴 목록을 읽지 않는다')
  // 못 지운 것이 없어도 옮기거나 합친 게 있으면 보여야 한다.
  const empty = src.indexOf('되돌릴 것이 없어요')
  assert.ok(empty > 0, '빈 상태 문구를 찾지 못했다')
  assert.match(src.slice(empty - 600, empty), /renderMovedUndo\(/, '남은 게 없으면 되돌릴 길이 사라진다')
})

/* ────────────────────────────────────────────────────────────
   끝났다는 걸 알 수 있는가

   실물 화면: 폴더째 정리를 눌렀더니 그 버튼이 회색으로 바뀌고 글씨만
   "2,380개를 정리했어요"가 됐다. **버튼 모양 그대로**라 아직 처리
   중인지 다 된 건지 구분이 안 됐고, 사용자가 "다 된 거냐"고 물어야 했다.
   완료는 버튼이 아니라 칸으로 보여야 한다.
   ──────────────────────────────────────────────────────────── */

test('★ 처리가 끝나면 "완료"라고 말한다 — 버튼 글씨만 바꾸지 않는다', () => {
  const src = app()
  assert.match(src, /function doneBlock\(/, '완료 칸을 만드는 자리가 없다')

  const body = pickerSource(src)
  const start = body.indexOf("engine('quarantine-folders'")
  assert.ok(start > 0, '폴더째 정리 실행부를 찾지 못했다')
  const after = body.slice(start, start + 1200)

  assert.match(after, /doneBlock\(/, '끝난 뒤 완료 칸을 안 그린다')
  assert.match(after, /삭제 완료/, '"완료"라는 말이 없다')
  assert.match(after, /unit-done/, '끝난 카드를 표시하지 않는다 — 남은 것과 섞인다')
  // 버튼 글씨만 바꾸고 끝내던 옛 방식으로 돌아가지 않게.
  assert.doesNotMatch(after, /btn\.textContent = `\$\{r\.deletedCount/, '버튼 글씨만 바꾸고 끝낸다')
})

test('★ 완료 문구는 "지금 비었다"고 말한다 — 보관 시절의 유예 문구를 남기지 않는다', () => {
  const body = pickerSource(app())
  const start = body.indexOf("engine('quarantine-folders'")
  const after = body.slice(start, start + 1200)
  assert.match(after, /가 지금 비었습니다/, '용량이 언제 비는지 말하지 않는다')
  assert.doesNotMatch(after, /아직 용량은 그대로/, '보관 시절 문구가 남아 있다')
  assert.doesNotMatch(after, /mountPurgeNow\(/, '없앤 보관함을 비우는 버튼이 아직 붙는다')
  // 옮기긴 했는데 못 지운 것은 없어진 척하지 않는다.
  assert.match(after, /leftoverNote\(/, '못 지우고 남은 것을 말하지 않는다')
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

/* ────────────────────────────────────────────────────────────
   한 번에 고르기 · 보관 없이 바로 삭제

   실물 화면: 40줄짜리 목록에 "큰 것 10개 고르기"만 있었다. 나머지 30개를 지우려면
   체크박스를 서른 번 눌러야 했다 — 고르라고 해놓고 고를 방법을 안 준 셈이다.
   그리고 버튼은 늘 "(30일 보관)"이었다. 이미 지울 걸 다 정한 사람에게도
   30일을 기다리게 하고, 그동안 용량은 1바이트도 안 빴다. 보관함이 같은
   드라이브에 있었기 때문이다.

   ★ 그래서 전체 선택을 더하고, 보관은 없앴다. 그래도 **기본값은 안 건드린다** —
     목록은 여전히 아무것도 안 골라진 채로 열린다. 켜져 있는 걸 빼게 하는 것과,
     직접 눌러서 켜는 것은 실수했을 때 결과가 다르다.
   ──────────────────────────────────────────────────────────── */

test('★ 전체 선택이 있다 — 그래도 켜져 있는 채로 시작하지는 않는다', () => {
  const body = pickerSource(app())
  assert.match(body, /data-pick-every/, '목록을 한 번에 고르는 버튼이 없다 — 40줄을 하나씩 누르게 한다')
  assert.match(body, /전체 선택/, '전체 선택이라고 적혀 있지 않다')
  // 다시 누르면 풀려야 한다. 한 번 누르면 못 무르는 버튼이면 무서워서 못 누른다.
  assert.match(body, /전체 해제/, '전체 선택이 해제로 돌아가지 않는다')
  // '전체'는 화면에 보이는 목록까지다. 개수를 안 적으면 703개를 다 골랐다고 읽는다.
  assert.match(body, /samples\.length\}개\)`/, '버튼에 몇 개를 고르는지 안 적는다')
  // 체크박스에 checked를 박아두면 그건 다시 일괄 삭제다.
  assert.doesNotMatch(body, /data-pick="\$\{esc\(s\.path\)\}"\s+checked/, '기본으로 다 골라져 있다')
})

test('★ 보관 선택지가 화면에 남아 있지 않다 — 없앤 기능을 스위치로 남기지 않는다', () => {
  const body = pickerSource(app())
  assert.doesNotMatch(body, /data-pick-purge/, '보관/삭제를 고르는 체크박스가 아직 있다')
  assert.doesNotMatch(body, /30일 보관/, '버튼이 아직 30일 보관을 약속한다')
  // 실행 버튼은 무슨 일이 일어나는지 그 자리에서 말해야 한다.
  assert.match(body, /고른 \$\{picked\.size\}개 지우기/, '실행 버튼이 지운다고 말하지 않는다')
  assert.match(body, /goBtn\.classList\.toggle\('danger'/, '되돌릴 수 없는 실행인데 버튼이 평범해 보인다')
})

test('★ 삭제도 격리와 똑같은 안전장치를 지난다 — 지름길을 내지 않는다', () => {
  const src = engine()
  const start = src.indexOf('async function deleteNow(')
  assert.ok(start > 0, '삭제 통로(deleteNow)가 없다')
  const body = src.slice(start, start + 900)
  /* 재분류·잠금 거절·expect는 위 테스트가 이미 못 박았다. 여기서 보는 건
     그걸 **거치고 나서** 지우느냐다. 별도 삭제 루틴을 새로 파면 그 검사를 안 지난다. */
  assert.match(body, /await quarantine\(/, '검증된 통로를 안 지나고 지운다')
  assert.match(body, /purgeEntries\(/, '방금 옮긴 것만 지우지 않는다')
  // purgeNow는 그 드라이브의 장부를 통째로 비운다 — 옛 버전이 맡아둔 것까지 사라진다.
  assert.doesNotMatch(body, /purgeNow\(/, '장부를 통째로 비운다 — 옛 약속까지 깬다')
  // 못 지운 것은 없어진 척하지 않는다.
  assert.match(body, /leftover/, '옮기고 못 지운 것을 세지 않는다')
})

test('★ 정리하는 통로는 하나도 보관에서 멈추지 않는다 — 남겨두면 그게 새 보관함이 된다', () => {
  const src = engine()
  /* quarantine()을 직접 부르는 자리가 남아 있으면 그 통로만 조용히 보관에서 멈춘다.
     화면은 "지웠다"고 하는데 파일은 .teraclean에 쌓이고 용량은 안 빈다 —
     정확히 없애려던 상태다. 실제 삭제(deleteNow) 안의 한 번만 허용한다. */
  const calls = src.match(/await quarantine\(/g) ?? []
  assert.equal(calls.length, 1, `quarantine()을 직접 부르는 자리가 ${calls.length}곳이다 — deleteNow 안의 한 번만 있어야 한다`)

  // apply-sweep의 '보관에서 멈추기' 선택지도 없어야 한다.
  const sweep = src.slice(src.indexOf("case 'apply-sweep'"), src.indexOf("case 'quar-list'"))
  assert.doesNotMatch(sweep, /--quarantine/, '원클릭에 보관 갈래가 남아 있다')
  assert.match(sweep, /purge: true/, '원클릭이 지우지 않고 멈춘다')

  // 옛 버전이 남긴 것을 되돌리는 길은 지운다고 같이 없애면 안 된다.
  assert.match(src, /case 'restore'/, '남은 것을 되돌릴 길이 사라졌다')
  assert.match(src, /case 'quar-list'/, '남은 것을 볼 길이 사라졌다')
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
