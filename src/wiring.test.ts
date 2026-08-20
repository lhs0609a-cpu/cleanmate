/**
 * 배선 — 화면이 부르는 명령이 엔진에 실제로 있는가
 *
 * ★ 왜 필요한가 (2026-08-19, 실물에서 터짐)
 *   v0.17.1에서 중복된 순위 체계를 걷어내면서 'tier-apply 시작 ~ quar-list'
 *   구간을 통째로 잘랐다. 그 사이에 **proposal-apply가 끼어 있었다.**
 *
 *   결과: 화면은 카드를 멀쩡히 그렸고, 사용자가 "3.5GB 지우기"를 눌렀더니
 *         "지우지 못했어요: 알 수 없는 명령: proposal-apply"가 떴다.
 *
 *   타입 검사는 통과한다(engine()이 문자열을 받으니까). 기존 테스트도 통과한다
 *   (각자 자기 쪽만 보니까). 화면과 엔진 **사이**가 끊긴 것이라 양쪽 어디를 봐도
 *   안 보인다. 그래서 여기서 그 사이를 본다.
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

/** 엔진이 실제로 처리하는 명령 이름들 — switch의 case 라벨을 그대로 읽는다. */
function engineCommands(): Set<string> {
  const src = read('src/engine-cli.ts')
  const out = new Set<string>()
  for (const m of src.matchAll(/case '([a-z0-9-]+)':/g)) out.add(m[1])
  return out
}

/** 화면이 engine('...')으로 부르는 이름들. */
function calledCommands(file: string): Set<string> {
  const src = read(file)
  const out = new Set<string>()
  for (const m of src.matchAll(/\bengine\(\s*'([a-z0-9-]+)'/g)) out.add(m[1])
  return out
}

test('★ 화면이 부르는 엔진 명령이 전부 엔진에 있다', () => {
  const have = engineCommands()
  const want = calledCommands('web/src/app.ts')
  assert.ok(want.size > 10, `화면이 부르는 명령을 못 찾았다(${want.size}개) — 이 테스트가 낡았다`)

  const missing = [...want].filter((c) => !have.has(c))
  assert.deepEqual(
    missing,
    [],
    `화면은 부르는데 엔진에 없는 명령: ${missing.join(', ')}\n` +
      '— 눌러도 "알 수 없는 명령"이 뜬다. 화면·엔진 어느 쪽만 봐서는 안 보이는 종류다.'
  )
})

test('★ 카드 실행 통로가 살아 있다 — 한 번 통째로 사라진 적이 있다', () => {
  const have = engineCommands()
  assert.ok(have.has('proposal-apply'), '카드를 눌러도 지울 방법이 없다')
  assert.ok(have.has('apply-sweep'), '원클릭 정리 통로가 없다')

  // 카드 버튼이 실제로 그 명령을 부르는지도 본다 — 이름만 있고 안 부르면 소용없다.
  const ui = read('web/src/app.ts')
  assert.match(ui, /engine\('proposal-apply'/, '화면의 카드 버튼이 실행 명령을 안 부른다')
})

test('★ 지운 명령을 화면이 아직 부르고 있지 않다', () => {
  // 반대 방향의 사고: 엔진에서 지웠는데 화면이 계속 부르는 경우.
  const ui = read('web/src/app.ts')
  for (const gone of ['tier-apply']) {
    assert.doesNotMatch(
      ui,
      new RegExp(`engine\\('${gone}'`),
      `엔진에서 지운 '${gone}'을 화면이 아직 부른다`
    )
  }
})

/**
 * ★ 화면이 이름을 변수로 넘기는 통로 — 위 테스트가 못 보는 자리다.
 *
 * 카드의 '실행'과 '재기' 버튼은 engine('literal')이 아니라 engine(f.action.run),
 * engine(f.measure.run)으로 부른다. 이름이 엔진이 아니라 **프로브가 만든 값**에
 * 들어 있어서, 위의 문자열 훑기로는 안 잡힌다. 그래서 그 이름들이 사는
 * types.ts의 유니온을 읽어 엔진과 맞춰본다.
 *
 * 이게 어긋나면 "지우기/재기를 눌렀더니 알 수 없는 명령"이 뜬다 —
 * proposal-apply 때와 정확히 같은 사고다.
 */
test('★ 프로브가 만드는 실행 이름(run)이 전부 엔진에 있다', () => {
  const types = read('src/types.ts')
  const have = engineCommands()

  const names = new Set<string>()
  // run?: 'hibernate-off' / undoRun?: 'hibernate-on' / run: 'restore-measure'
  for (const m of types.matchAll(/\b(?:run|undoRun)\??:\s*((?:'[a-z0-9-]+'\s*\|?\s*)+)/g)) {
    for (const q of m[1].matchAll(/'([a-z0-9-]+)'/g)) names.add(q[1])
  }
  assert.ok(names.size >= 3, `types.ts에서 실행 이름을 못 찾았다(${names.size}개) — 이 테스트가 낡았다`)

  const missing = [...names].filter((n) => !have.has(n))
  assert.deepEqual(missing, [], `프로브는 내는데 엔진에 없는 실행 이름: ${missing.join(', ')}`)
})

test('★ 정식 도구(assist) 이름도 전부 엔진에 있다', () => {
  const types = read('src/types.ts')
  const have = engineCommands()
  const block = types.match(/command:\s*((?:'[a-z0-9-]+'\s*\|\s*)+'[a-z0-9-]+')/)
  assert.ok(block, 'AssistAction의 command 유니온을 못 찾았다 — 이 테스트가 낡았다')
  const names = [...block![1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1])
  const missing = names.filter((n) => !have.has(n))
  assert.deepEqual(missing, [], `assist는 내는데 엔진에 없는 이름: ${missing.join(', ')}`)
})

test('★ 권한을 받아 재는 통로가 살아 있다 — "못 쟀다"로 끝내지 않기 위한 것', () => {
  assert.ok(engineCommands().has('restore-measure'), '시스템 복원을 재는 통로가 사라졌다')
  const ui = read('web/src/app.ts')
  assert.match(ui, /data-measure/, '화면에 재기 버튼을 그리는 자리가 없다')
  assert.match(ui, /querySelectorAll<HTMLButtonElement>\('\[data-measure\]'\)/, '재기 버튼이 아무 일도 안 한다')
})
