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
