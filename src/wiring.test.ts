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

/* ══════════════════════════════════════════════════════════════
   "열었어요"라고 답해놓고 아무 창도 안 뜬 자리 — 2026-08-21 실물

   ★ 무슨 일이 있었나.
     "가상 메모리 설정 열기"를 눌렀더니 버튼만 '열었어요'로 바뀌고 창은 안 떴다.
     잘못이 두 겹이었다.

       ① spawn은 실패를 나중에 'error' 이벤트로 알린다. 그런데 엔진은 곧바로
          out({opened:true})를 부르고 process.exit(0)로 죽었다 — 실패가 도착할
          자리가 아예 없었다. 무슨 일이 있어도 성공이라고 답한 셈이다.
       ② 실패 이유는 EACCES였다. 파일이 없는 게 아니라 CreateProcess가
          "관리자로 띄워야 한다"고 거절한 것이다(ERROR_ELEVATION_REQUIRED).
          CreateProcess는 UAC를 안 띄우고 그냥 거절한다.

   ①이 이 테스트가 지키는 것이다. ②는 언제든 다른 exe에서 또 나올 수 있고,
   그때 조용히 성공으로 답하지만 않으면 사용자가 우리에게 알려줄 수 있다.
   ══════════════════════════════════════════════════════════════ */

test('★ 창을 여는 통로가 spawn을 직접 부르지 않는다 — 열렸는지 보는 문을 지난다', () => {
  const src = read('src/engine-cli.ts')
  /* spawn 자체는 다른 데서도 쓴다(엔진 사이드카 등). 여기서 막는 건
     '창을 띄우는 exe'를 문을 안 지나고 부르는 것이다. */
  const raw = [...src.matchAll(/spawn\('([A-Za-z]+\.exe)'/g)].map((m) => m[1])
  assert.deepEqual(raw, [], `openTool을 안 지나고 직접 띄우는 창: ${raw.join(', ')}`)
  assert.match(src, /async function openTool\(/, '창을 여는 공용 문이 없다')
})

test('★ 열렸는지 보고 답한다 — spawn 직후 성공이라고 쓰지 않는다', () => {
  const src = read('src/engine-cli.ts')
  const i = src.indexOf('async function openTool(')
  const body = src.slice(i, src.indexOf('\n}', i))
  // 'spawn' 이벤트가 와야 진짜 뜬 것이다. 'error'도 받아야 실패를 안다.
  assert.match(body, /once\('spawn'/, "'spawn' 이벤트를 안 기다린다 — 뜨기 전에 성공이라고 답한다")
  assert.match(body, /once\('error'/, "'error' 이벤트를 안 받는다 — 실패가 도착할 자리가 없다")

  // ★ 떴다고 끝이 아니다. 창을 띄우는 stub은 창이 살아 있는 동안 같이 산다 —
  //   곧바로 끝났으면 창을 안 띄운 것이다(실측: 이미 열려 있으면 종료코드 0으로 즉시 종료).
  assert.match(body, /exitCode !== null/, '띄운 뒤 살아 있는지 안 본다 — 창 없이 끝나도 성공이라고 답한다')

  // 세 통로가 전부 그 문을 await 한다.
  for (const cmd of ['open-system-protection', 'open-virtual-memory', 'open-cleanmgr']) {
    const j = src.indexOf(`case '${cmd}':`)
    assert.ok(j > 0, `${cmd} 통로가 없다`)
    const block = src.slice(j, src.indexOf('break', j))
    assert.match(block, /await openTool\(/, `${cmd}가 열렸는지 안 보고 답한다`)
  }
})

test('★ 권한이 필요해 거절당하면 승격해서 다시 띄운다 — 거기서 포기하지 않는다', () => {
  /* 실측(2026-08-21): SystemPropertiesPerformance.exe·SystemPropertiesProtection.exe는
     권한 없이 부르면 EACCES로 거절당한다. cleanmgr.exe는 그냥 열린다. */
  const src = read('src/engine-cli.ts')
  const i = src.indexOf('const ELEVATED_OPEN')
  assert.ok(i > 0, '승격해서 여는 목록이 없다')
  const map = src.slice(i, src.indexOf('\n}', i))
  for (const exe of ['SystemPropertiesProtection.exe', 'SystemPropertiesPerformance.exe']) {
    assert.ok(map.includes(exe), `${exe}가 승격 목록에 없다 — 누르면 아무 창도 안 뜬다`)
  }
  // ★ 취소를 성공으로 읽지 않게 하는 한 줄. 없으면 '아니오'를 눌러도 0으로 끝난다.
  assert.ok(
    map.split('$ErrorActionPreference').length - 1 >= 2,
    "승격 명령에 $ErrorActionPreference='Stop'이 없다 — 확인 창에서 '아니오'를 눌러도 열린 줄 안다"
  )
})

test('★ 창이 안 떴으면 왜 안 떴는지 말한다 — "열었어요"로 덮지 않는다', () => {
  /* 실측(2026-08-21): 윈도우는 sysdm.cpl 계열 창을 한 번에 하나만 띄운다.
     [성능 옵션]이 떠 있는 상태에서 다시 띄우면 둘 다 종료코드 0으로 즉시 끝나고
     창이 안 생긴다. 사용자에게는 "눌렀는데 아무 일도 안 일어남"으로 보인다. */
  const src = read('src/engine-cli.ts')
  assert.match(src, /function windowGoneMessage\(/, '창이 안 떴을 때 할 말이 없다')
  const i = src.indexOf('function windowGoneMessage(')
  const msg = src.slice(i, src.indexOf('\n}', i))
  assert.match(msg, /한 번에 하나만/, '왜 안 떴는지 안 말한다 — 사용자는 고장으로 읽는다')
  assert.match(msg, /닫고 다시/, '무엇을 하면 되는지 안 말한다')

  // 승격 경로도 같은 판정을 해야 한다. 안 하면 승격했을 때만 거짓말이 남는다.
  const j = src.indexOf('const ELEVATED_OPEN')
  const map = src.slice(j, src.indexOf('\n}', j))
  assert.match(map, /HasExited/, '승격해서 띄운 창이 떴는지 안 본다')
  assert.match(map, /-PassThru/, '승격해서 띄운 프로세스를 안 잡아둔다 — 확인할 방법이 없다')

  // 사람이 화면에서 찾을 이름으로 말한다.
  assert.match(src, /const TOOL_NAME: Record<string, string>/, '창 이름을 사람 말로 옮기는 자리가 없다')
  assert.doesNotMatch(msg, /\.exe/, '"SystemPropertiesPerformance.exe를 닫으세요"는 안내가 아니다')
})
