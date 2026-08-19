/**
 * 질문 카드 안전장치 — "글자가 너무 많아 못 읽겠다"의 재발 방지
 *
 * ★ 여기서 잡는 건 **결정에 필요한 것과 그렇지 않은 것이 같은 무게로 실리는 것**이다.
 *
 *   전에는 근거를 한 줄도 접지 않았다. 그때의 이유는 이랬고, 그 자체론 옳았다 —
 *   "접어두면 아무도 안 펴고, 안 펴면 없는 것과 같다."
 *   그런데 결과는 반대쪽 극단이었다: 질문 하나에 왜 묻나 + 구성비 + 나이 +
 *   종류마다 3줄 + 지워도 되나 + 되돌리나 + 폴더 + 파일마다 4줄이 다 펼쳐졌고,
 *   **답변 버튼은 세 화면쯤 스크롤해야 나왔다.** 전부 보여줬더니 아무도 안 읽었다.
 *
 *   그래서 순서를 잠근다: 질문 → 결론 두 줄 → 답변 버튼 → (접힌) 근거.
 *   글자 크기를 키우는 것만으로는 이게 안 고쳐진다. 오히려 양이 더 눈에 띈다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** renderQuestions가 그리는 템플릿만 떼어낸다. */
function cardTemplate(): string {
  const src = read('web/src/app.ts')
  const start = src.indexOf('qEl.innerHTML = questions.map(')
  assert.ok(start > 0, 'renderQuestions의 템플릿을 찾지 못했다')
  // ★ 첫 .join('')로 자르면 안 된다 — 그건 답변 버튼을 만드는 **안쪽** map의 것이다.
  //   실제로 이 테스트가 처음에 그렇게 틀려서 카드 절반만 검사했다.
  const end = src.indexOf('qEl.querySelectorAll', start)
  assert.ok(end > start, '템플릿의 끝을 찾지 못했다')
  return src.slice(start, end)
}

test('★ 답변 버튼이 근거보다 먼저 온다 — 결정하러 왔지 읽으러 온 게 아니다', () => {
  const t = cardTemplate()
  const opts = t.indexOf('class="opts"')
  const more = t.indexOf('class="q-more"')
  assert.ok(opts > 0, '답변 버튼을 찾지 못했다')
  assert.ok(more > 0, '접힌 근거 칸이 없다 — 근거가 통째로 펼쳐져 있다')
  assert.ok(opts < more, '근거가 답변 버튼보다 위에 있다 — 버튼까지 스크롤해야 한다')
})

test('★ 근거는 접혀 있다 — 그리고 접힌 채로 열려 있지 않다', () => {
  const t = cardTemplate()
  assert.match(t, /<details class="q-more">/, '근거가 details로 접혀 있지 않다')
  // open을 박아두면 접은 의미가 없다.
  assert.doesNotMatch(t, /<details class="q-more"[^>]*\bopen\b/, '접기로 만들어놓고 기본으로 펴놨다')
})

test('★ 접힌 칸에 무엇이 들었는지 적는다 — 접힌 걸 모르면 없는 것과 같다', () => {
  const src = read('web/src/app.ts')
  const start = src.indexOf('function moreLabel(')
  assert.ok(start > 0, 'moreLabel이 없다')
  const body = src.slice(start, src.indexOf('\nfunction renderQuestions', start))
  // 개수를 보여줘야 펴볼 마음이 든다.
  assert.match(body, /종류 \$\{ev\.kinds\.length\}/, '종류가 몇 개인지 안 알려준다')
  assert.match(body, /큰 파일 \$\{ev\.samples\.length\}개/, '파일이 몇 개인지 안 알려준다')
})

test('★ 결론은 가장 큰 것 하나만 본다 — 꼬리는 결정을 안 바꾼다', () => {
  const src = read('web/src/app.ts')
  const start = src.indexOf('function gistHtml(')
  assert.ok(start > 0, 'gistHtml이 없다')
  const body = src.slice(start, src.indexOf('\n/** 접은 칸에', start))

  // 643KB짜리가 10.7GB짜리와 같은 무게로 실리던 게 문제였다.
  assert.match(body, /sort\(\(a: any, b: any\) => b\.bytes - a\.bytes\)\[0\]/,
    '가장 큰 종류를 고르지 않는다 — 작은 게 결론에 올라올 수 있다')
  // 근거가 없으면 빈 칸을 만들지 않는다.
  assert.match(body, /if \(!lines\.length\) return ''/, '근거가 없어도 빈 칸을 그린다')
})

test('★ 걸린 용량이 답하기 전에 보인다', () => {
  const t = cardTemplate()
  const stake = t.indexOf('q-stake')
  const opts = t.indexOf('class="opts"')
  // 전에는 카드 맨 아래에 있어서, 판단에 제일 중요한 숫자를 답한 뒤에야 봤다.
  assert.ok(stake > 0 && stake < opts, '걸린 용량이 답변 버튼보다 아래에 있다')
})


/* ────────────────────────────────────────────────────────────
   옮겨도 되나 — 누르기 전에 답한다

   ★ 실물에서 나온 문제 (2026-08-19)
     질문 카드가 "아주 큰 파일 18개(65.8GB)가 있어요. 지울까요, 다른 드라이브로
     옮길까요?"라고 묻고 [다른 드라이브로 옮길래요]를 내밀었다.

     그 18개는 **하나도 옮길 수 없었다.** 전부 AppData 안이라 "앱 설정 — 옮기면
     설정이 초기화됩니다"로 이미 판정돼 있었고, 그 판정은 엔진이 진작
     samples[].move에 실어 보내고 있었다. 화면이 안 읽었을 뿐이다.
     누르면 다음 화면에서 "옮길 수 있는 게 없었어요"를 보는 막다른 길이었다.

     ★ 그렇다고 "못 옮긴다"로 끝내도 틀렸다. 낱개는 0/17이었지만 폴더째로는
       21.9GB가 옮겨진다(정션을 남기면 앱은 그대로 열린다). 둘을 갈라 말해야
       선택지가 진짜 선택지가 된다.
   ──────────────────────────────────────────────────────────── */

test('★ 옮기기를 묻기 전에 옮길 수 있는지부터 말한다', () => {
  const src = read('web/src/app.ts')
  assert.match(src, /function moveOutlookHtml\(/, '옮기기 가능 여부를 말하는 자리가 없다')
  // 선택지보다 **위**에 있어야 한다. 누른 뒤에 알려주면 늦다.
  const note = src.indexOf('${moveOutlookHtml(q)}')
  const opts = src.indexOf('<div class="opts">')
  assert.ok(note > 0 && opts > 0, '질문 카드에서 두 자리를 못 찾았다')
  assert.ok(note < opts, '옮기기 안내가 선택지보다 아래에 있다 — 누른 뒤에 알려주는 셈이다')
})

test('★ 엔진이 이미 내린 판정을 읽는다 — 화면이 다시 추측하지 않는다', () => {
  const src = read('web/src/app.ts')
  const i = src.indexOf('function moveOutlook(')
  const body = src.slice(i, src.indexOf('function renderQuestions(', i))
  assert.match(body, /move\?\.ok === true/, 'samples의 이동 판정을 안 읽는다')
  assert.match(body, /units/, '폴더째 옮기기 후보를 안 본다')
})

test('★ "못 옮긴다"로 끝내지 않는다 — 폴더째 길이 있으면 그걸 말한다', () => {
  const src = read('web/src/app.ts')
  const i = src.indexOf('function moveOutlookHtml(')
  const body = src.slice(i, i + 1400)
  assert.match(body, /폴더째/, '낱개가 막혔을 때 다른 길을 안 알려준다')
  assert.match(body, /안내판/, '정션으로 앱이 그대로 열린다는 사실을 안 말한다')
  // 이유 없는 거절은 고장으로 읽힌다 — 왜 못 옮기는지 말해야 한다.
  assert.match(body, /그 앱이 못 찾습니다/, '왜 못 옮기는지 이유를 안 말한다')
})

test('옮기기 선택지가 없는 질문에는 아무것도 안 붙인다 — 없는 걱정을 만들지 않는다', () => {
  const src = read('web/src/app.ts')
  const i = src.indexOf('function moveOutlookHtml(')
  const body = src.slice(i, i + 400)
  assert.match(body, /outcome === 'MOVE'/, '옮기기 선택지 유무를 안 본다')
  assert.match(body, /return ''/, '해당 없는 질문에도 줄을 붙인다')
})
