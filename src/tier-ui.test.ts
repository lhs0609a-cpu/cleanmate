/**
 * 순위 화면 — 등급을 매긴 뒤에도 약속이 그대로인가
 *
 * 순위는 "뭐부터 누르면 되나"에 답하려고 만들었다. 그런데 순위를 매기면
 * 자연스럽게 다음 유혹이 생긴다 — **한 번에 다 지우는 버튼을 달자.**
 * 3순위에 그 버튼이 달리는 순간 "물어보고 정합니다"라는 이 제품의 약속이
 * 그 자리에서 깨진다. 화면은 멀쩡히 그려지고 타입도 통과한다.
 * 그래서 소스에서 못 박는다. (같은 이유·같은 방식 — picker-ui.test.ts)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/* 한 번만 읽는다. 이 저장소는 구글 드라이브 폴더에 있어서 파일 읽기가 네트워크를
   탄다 — 테스트마다 다시 읽으면 3초짜리 스위트가 77초가 된다(실측). */
const cache = new Map<string, string>()
const read = (p: string) => {
  let v = cache.get(p)
  if (v === undefined) { v = readFileSync(join(root, p), 'utf8'); cache.set(p, v) }
  return v
}
const app = () => read('web/src/app.ts')
const engine = () => read('src/engine-cli.ts')

/** tierHtml 본문만 떼어낸다 — 버튼을 만드는 자리가 여기다. */
function tierHtmlBody(src: string): string {
  const start = src.indexOf('function tierHtml(')
  assert.ok(start > 0, 'tierHtml을 찾지 못했다 — 이름이 바뀌었으면 이 테스트도 고쳐야 한다')
  const end = src.indexOf('function renderTiers(', start)
  assert.ok(end > start, 'tierHtml의 끝을 찾지 못했다')
  return src.slice(start, end)
}

test('★ 3순위에는 일괄 삭제 버튼을 달지 않는다 — 물어보기로 한 것을 버튼으로 지우면 안 된다', () => {
  const body = tierHtmlBody(app())
  // 실행 버튼은 1·2순위에만 있어야 한다.
  assert.match(body, /data-tier="1"/, '1순위 실행 버튼이 없다')
  assert.match(body, /data-tier="2"/, '2순위 실행 버튼이 없다')
  assert.doesNotMatch(body, /data-tier="3"/, '3순위에 일괄 실행 버튼이 달렸다 — 질문이 사라진다')
  // 3순위는 질문으로 보내야 한다.
  assert.match(body, /data-tier-ask/, '3순위가 질문으로 안내하지 않는다')
})

test('★ 순위마다 왜 그 순위인지 함께 보여준다 — 근거 없는 등급은 강요다', () => {
  const body = tierHtmlBody(app())
  assert.match(body, /t\.because/, '순위의 근거를 화면에 안 쓴다')
  assert.match(body, /t\.groups/, '무엇이 들어 있는지 안 보여준다 — 숫자만 보고는 못 누른다')
})

test('★ "두시는 게 안전합니다"로 본 것이 섞여 있으면 그 숫자를 말한다', () => {
  const body = tierHtmlBody(app())
  assert.match(body, /cautionCount/, '주의 항목 수를 숨긴다')
})

test('★ 2순위 확인창은 무엇을 지우는지 이름을 댄다 — 개수만 물으면 답할 수 없다', () => {
  const src = app()
  const start = src.indexOf('async function runTier2(')
  assert.ok(start > 0, 'runTier2를 찾지 못했다')
  const body = src.slice(start, start + 1800)
  assert.match(body, /confirm\(/, '확인 없이 지운다')
  assert.match(body, /tier\?\.groups|tier\.groups/, '무엇이 들어 있는지 확인창에 안 쓴다')
  assert.match(body, /되돌릴 수 없습니다/, '되돌릴 수 없다는 말을 안 한다')
  assert.match(body, /휴지통에도 안 남아요/, '휴지통에도 안 남는다는 걸 안 말한다')
})

test('★ 1순위 실행은 기존 통로를 그대로 쓴다 — 지우는 길을 두 벌로 만들지 않는다', () => {
  const src = app()
  const start = src.indexOf('function renderTiers(')
  const body = src.slice(start, src.indexOf('async function runTier2(', start))
  /* 1순위는 '지금 정리하기'와 같은 일이다. 여기서 engine('apply-sweep')을 따로
     부르면 확인 문구·진행 표시·완료 처리가 두 곳에 생기고, 한쪽만 고치는 날이 온다. */
  assert.match(body, /apply-btn/, '1순위가 기존 실행 버튼을 안 쓴다')
  assert.doesNotMatch(body, /engine\('apply-sweep'/, '실행 통로가 두 벌이 됐다')
})

test('★ 2순위 실행은 방금 본 그 목록을 지운다 — 다시 훑지 않는다', () => {
  const src = engine()
  const start = src.indexOf("case 'tier-apply'")
  assert.ok(start > 0, 'tier-apply 명령이 없다')
  const body = src.slice(start, src.indexOf("case 'quar-list'", start))

  /* 여기서 재스캔하면 화면이 보여준 목록과 지우는 목록이 달라진다.
     "0.93GB 3,789개"를 보고 눌렀는데 그 사이 늘어난 것까지 지우는 셈이다. */
  assert.match(body, /readPlanCache\(/, '적어둔 계획을 안 쓴다')
  assert.doesNotMatch(body, /await scan\(/, '실행하면서 다시 훑는다 — 본 목록과 달라진다')
  // 안전장치는 그대로 지나야 한다.
  assert.match(body, /deleteNow\(/, '검증된 삭제 통로를 안 지난다')
  assert.match(body, /expect: \{ size: i\.size, mtimeMs: i\.mtimeMs \}/,
    'expect 없이 지우면 계획을 세운 뒤 바뀐 파일을 그대로 가져간다')
})

test('★ 오래된 계획으로 지우지 않는다 — 순위 실행도 같은 유효기간을 지킨다', () => {
  const src = engine()
  // readPlanCache 안의 나이 검사를 tier-apply도 그대로 통과해야 한다.
  assert.match(src, /createdAt > PLAN_CACHE_MAX_AGE_MS/, '계획의 나이를 확인하지 않는다')
  const start = src.indexOf("case 'tier-apply'")
  const body = src.slice(start, src.indexOf("case 'quar-list'", start))
  assert.match(body, /오래됐어요|계획이 없거나/, '계획이 낡았을 때 사용자에게 말하지 않는다')
})
