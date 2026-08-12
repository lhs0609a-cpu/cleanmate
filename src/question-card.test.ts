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
