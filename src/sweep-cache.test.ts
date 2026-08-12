/**
 * 정리 계획 캐시 · 진행률 안전장치
 *
 * ★ 실물에서 잰 것: "지금 정리하기"를 누르면 방금 끝낸 스캔을 **처음부터 다시**
 *   돌렸다. 이 PC 기준 14만 개에 7분. 화면은 이미 "10.1GB 정리 가능"이라고
 *   숫자까지 보여준 뒤인데, 누르면 그 7분을 다시 기다리게 했다. 그동안 화면은
 *   "지우는 중…" 한 줄이 전부였다 — 몇 개 중 몇 개인지, 도는 중인지조차 몰랐다.
 *
 *   고약한 건 이게 **개발 PC에선 안 보인다**는 점이다. 파일이 적으면 재스캔이
 *   1초도 안 걸려서 아무도 눈치채지 못한다. 디스크가 꽉 찬 사람일수록 오래
 *   기다리는데, 정확히 그 사람만 겪는다. (breakdown.test.ts의 12만 개 버그와 같은 성질)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const engine = () => read('src/engine-cli.ts')

/**
 * 주석을 걷어낸다.
 * ★ 안 걷으면 "전에는 planSweep()을 불렀고" 같은 **설명문**이 코드로 잡힌다.
 *   실제로 이 테스트가 처음에 그렇게 틀렸다 — 주석이 코드인 척했다.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** apply-sweep 갈래만 떼어낸다(주석 제외). */
function applySweepCase(src: string): string {
  const code = stripComments(src)
  const start = code.indexOf("case 'apply-sweep'")
  assert.ok(start > 0, "apply-sweep 갈래를 찾지 못했다")
  const end = code.indexOf("case 'quar-list'", start)
  assert.ok(end > start, 'apply-sweep의 끝을 찾지 못했다')
  return code.slice(start, end)
}

test('★ 정리할 때 다시 훑지 않는다 — 계획은 스캔이 이미 만들었다', () => {
  const body = applySweepCase(engine())
  assert.match(body, /readPlanCache\(/, '캐시된 계획을 안 쓰고 있다 — 전체 재스캔으로 돌아간다')

  // 캐시가 있으면 planSweep(=전체 스캔)을 부르면 안 된다.
  const cacheHit = body.indexOf('readPlanCache(')
  const rescan = body.indexOf('planSweep(')
  assert.ok(cacheHit > 0 && (rescan < 0 || cacheHit < rescan), '캐시 확인보다 재스캔이 먼저 온다')
})

test('★ 스캔이 만든 목록을 버리지 않는다', () => {
  const src = engine()
  // scanPlan은 이미 모든 파일에 isAutoEligible을 돌린다. 그 결과가 곧 지울 목록이다.
  assert.match(src, /autoItems\.push\(/, 'scanPlan이 자동 정리 대상을 모으지 않는다')
  assert.match(src, /writePlanCache\(paths, autoItems\)/, '모아놓고 저장하지 않는다')
})

test('★ 캐시는 오래되면 안 쓴다 — 묵은 목록으로 지우기 시작하면 안 된다', () => {
  const src = engine()
  assert.match(src, /PLAN_CACHE_MAX_AGE_MS/, '캐시 유효기간이 없다')
  assert.match(src, /createdAt > PLAN_CACHE_MAX_AGE_MS/, '나이를 확인하지 않는다')
  // 다른 폴더를 훑은 계획을 갖다 쓰면 안 된다.
  assert.match(src, /raw\.roots\]\.sort\(\)/, '어느 폴더의 계획인지 대조하지 않는다')
})

test('★ 캐시를 믿고 지우지 않는다 — 파일마다 다시 대조한다', () => {
  // 캐시는 후보일 뿐이다. 실제 격리는 크기·수정일이 그대로일 때만 한다(TOCTOU).
  const sweep = read('src/sweep.ts')
  assert.match(sweep, /expect: \{ size: i\.size, mtimeMs: i\.mtimeMs \}/,
    'expect 없이 격리하면 계획을 세운 뒤 바뀐 파일을 그대로 가져간다')
})

test('★ 지우는 동안 말을 한다 — 여기가 통째로 조용했다', () => {
  const body = applySweepCase(engine())
  assert.match(body, /progress\(\{ t: 'sweep'/, '삭제 진행 상황을 안 보낸다')
  assert.match(body, /etaSec/, '남은 시간을 안 보낸다')

  const sweep = read('src/sweep.ts')
  assert.match(sweep, /onProgress\?\.\(/, 'applySweep이 진행 상황을 알리지 않는다')
  // 통째로 한 번에 넘기면 끝날 때까지 아무 말도 못 한다.
  assert.match(sweep, /requests\.slice\(i, i \+ CHUNK\)/, '묶음으로 나눠 돌지 않는다')
})

test('★ 남은 시간은 잰 속도로만 말한다 — 지어내지 않는다', () => {
  const body = applySweepCase(engine())
  // done이 0이면 속도를 모른다. 그때 숫자를 만들어내면 거짓말이 된다.
  assert.match(body, /done > 0 \?/, '아무것도 처리하기 전에 남은 시간을 계산하고 있다')
})
