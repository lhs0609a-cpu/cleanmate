/**
 * 시작프로그램 화면 안전장치 — "내가 안 누른 게 꺼졌다"를 막는다
 *
 * ★ 왜 소스를 직접 읽어 검사하나:
 *   여기서 터진 버그는 조용했다. 화면은 멀쩡히 그려지고, 버튼도 눌리고,
 *   토스트도 뜨고, 엔진도 성공을 돌려줬다. 다만 **엉뚱한 항목이 꺼졌다.**
 *
 *   원인: 목록을 suggest/others/off 세 묶음으로 걸러 각각 map을 돌리면서
 *   map의 두 번째 인자(그 묶음 안의 번호)를 버튼 번호로 썼다. 그러면 번호가
 *   묶음마다 0부터 다시 세어져서 원본 목록의 다른 항목을 가리킨다.
 *   실측에서 사용자가 누르지 않은 두 개(GVF-Node·AdPT-Agent)가 꺼졌다.
 *
 *   시작프로그램은 되돌리기가 즉시라 복구는 쉽다. 그래도 이건 이 앱이 절대
 *   하면 안 되는 일이다 — 뭘 건드릴지 정확히 말하고 그것만 건드린다는 게
 *   이 제품의 전부다. 타입도 테스트도 못 잡는 종류라 소스에서 못 박는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = () => readFileSync(join(root, 'web/src/app.ts'), 'utf8')

/** loadStartup 본문만 떼어낸다 — 다른 화면의 map까지 싸잡아 검사하지 않도록. */
function loadStartupBody(src: string): string {
  const start = src.indexOf('async function loadStartup(')
  assert.ok(start > 0, 'loadStartup을 찾지 못했다 — 이름이 바뀌었으면 이 테스트도 고쳐야 한다')
  const end = src.indexOf('\nasync function fillLogonTaskNote', start)
  assert.ok(end > start, 'loadStartup의 끝을 찾지 못했다')
  return src.slice(start, end)
}

test('★ 토글 버튼 번호는 걸러낸 묶음이 아니라 원본 목록 기준이다', () => {
  const body = loadStartupBody(app())

  // 행을 만드는 함수가 map의 인덱스를 받아쓰면 안 된다. 받는 순간
  // suggest/others/off 안에서 0부터 다시 세어진 번호가 들어온다.
  assert.doesNotMatch(
    body,
    /const row = \([^)]*,\s*\w+\s*:\s*number/,
    'row가 map의 인덱스를 인자로 받고 있다 — 걸러낸 묶음 안의 번호라 엉뚱한 항목을 가리킨다'
  )

  // 번호는 원본 배열에서 직접 찾아야 한다.
  assert.match(
    body,
    /entries\.indexOf\(e\)/,
    '버튼 번호를 entries에서 직접 찾지 않고 있다'
  )
})

test('★ 끄기는 누른 항목의 이름을 화면에 그대로 쓴다', () => {
  const body = loadStartupBody(app())
  // 무엇을 건드리는지 사용자가 눈으로 확인할 수 있어야 한다.
  // 엉뚱한 항목이 꺼지면 이 문구에서 바로 드러난다.
  assert.match(body, /끄는 중…/, '끄는 동안 어떤 항목인지 이름을 보여주지 않는다')
  assert.match(body, /e\.name/, '버튼 문구가 항목 이름을 담고 있지 않다')
})

test('★ 스위치 하나 내렸다고 화면을 처음으로 되돌리지 않는다', () => {
  const src = app()
  // quiet 모드 없이 다시 읽으면 목록이 "읽는 중…"으로 통째로 지워진다.
  // 그러면 펼쳐둔 목록도 접히고 사용자는 자기 자리를 잃는다.
  assert.match(
    src,
    /async function loadStartup\(quiet = false\)/,
    'loadStartup에 quiet 모드가 없다 — 토글할 때마다 화면이 통째로 지워진다'
  )
  assert.match(
    src,
    /await loadStartup\(true\)/,
    '토글 뒤 다시 읽을 때 quiet 모드를 안 쓰고 있다'
  )
})

test('★ 예약작업 개수는 목록을 막지 않는다', () => {
  const src = app()
  const startupTs = readFileSync(join(root, 'src/probes/startup.ts'), 'utf8')

  // 목록을 모으는 스크립트에 Get-ScheduledTask가 남아 있으면 안 된다.
  // 실측에서 이 한 줄이 찬 상태로 146초, 데운 상태로도 7초를 먹었다.
  // GATHER 템플릿 리터럴의 본문만 — 뒤에 오는 주석까지 끌어오면 주석 속 낱말에 걸린다.
  const from = startupTs.indexOf('const GATHER = `')
  const gather = startupTs.slice(from, startupTs.indexOf('\n`', from))
  assert.doesNotMatch(
    gather,
    /Get-ScheduledTask/,
    '목록 수집 스크립트가 예약작업을 세고 있다 — 각주 한 줄이 본문을 막는다'
  )

  // 화면은 목록을 먼저 그리고 개수는 나중에 채운다.
  assert.match(src, /fillLogonTaskNote\(\)/, '예약작업 개수를 따로 채우지 않는다')
  assert.match(src, /engine\('startup-tasks'\)/, 'startup-tasks 명령을 부르지 않는다')
})
