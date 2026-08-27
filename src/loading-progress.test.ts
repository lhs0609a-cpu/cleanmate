/**
 * 로딩 자리 — 기다리게 할 거면 얼마나 남았는지 말한다
 *
 * ★ 왜 필요한가 (실제로 겪은 일)
 *   '안 쓴 프로그램' 화면은 "설치된 프로그램과 실행 기록을 읽는 중…" 한 줄만
 *   띄운 채 버텼다. 멈춘 건지 도는 건지 알 수 없는 화면이다. 스캔에는 진행률이
 *   있었는데 나머지 화면에는 없었다 — **자리마다 문자열이 손으로 박혀 있었기**
 *   때문이다. 한 곳에 진행률을 붙여도 나머지 여섯 곳은 그대로였다.
 *
 *   로고가 다섯 군데에 따로 그려져 있어서 똑같은 사달이 났었다(brand-mark.test.ts).
 *   같은 실수를 같은 방식으로 잠근다: 통로를 하나로 모으고, 여기서 그 약속을 지킨다.
 *
 * ── 지켜야 하는 것 ──────────────────────────────────────────
 *   1. 오래 걸리는 엔진 명령은 전부 진행을 흘린다 (withTaskProgress)
 *   2. 그 명령을 부르는 화면은 전부 진행을 그린다 (startPanel)
 *   3. 켠 진행 표시는 반드시 끈다 (finally) — 안 그러면 타이머가 남는다
 *   4. 로딩 자리에 맨 문자열을 다시 박지 않는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const app = read('web/src/app.ts')
const cli = read('src/engine-cli.ts')

/**
 * 화면 하나를 채우느라 사용자를 기다리게 하는 명령들.
 *
 * ★ 여기 이름을 추가하면 테스트가 그 명령의 진행 표시를 요구한다.
 *   새 화면을 만들 때 로딩 표시를 빠뜨리지 않게 하는 게 이 목록의 목적이다.
 */
const SLOW_COMMANDS = [
  'programs',       // 설치 목록 + 폴더 크기 실측 (제일 느리다)
  'probe',          // 숨은 공간 다섯 군데 조사
  'startup',        // 시작프로그램 (파워셸)
  'startup-tasks',  // 로그온 예약작업 세기 (몇 초~몇 분)
  'quar-list',      // 되돌릴 수 있는 것
  'relocate-scan',  // 옮겨도 되는 것 찾기
  'relocate-plan',  // 옮길 계획
  'photos-plan',    // 사진 정리 (수천 장이면 몇 분)
  'tidy-folder-plan', // 폴더 정리 미리보기
]

/** startPanel을 안 쓰는 명령과 그 이유 — 예외는 근거를 적어야 남길 수 있다. */
const NO_PANEL: Record<string, string> = {
  // 각주다. 목록을 다 그린 뒤에 조용히 채워지고, 그동안 화면을 막지 않는다.
  // 기다리는 자리가 없으므로 그릴 진행 표시도 없다.
  'startup-tasks': '본문을 막지 않는 각주라 기다리는 자리가 없다',
}

test('★ 오래 걸리는 명령은 전부 진행을 흘린다', () => {
  for (const cmd of SLOW_COMMANDS) {
    assert.ok(
      cli.includes(`withTaskProgress('${cmd}'`),
      `엔진의 '${cmd}'이 진행을 안 흘린다 — 화면이 그릴 게 없다`
    )
  }
})

test('★ 그 명령을 부르는 화면은 전부 진행을 그린다', () => {
  for (const cmd of SLOW_COMMANDS) {
    if (NO_PANEL[cmd]) continue
    assert.ok(
      app.includes(`startPanel(`) && new RegExp(`startPanel\\([^)]*'${cmd}'`).test(app),
      `'${cmd}' 화면이 진행 표시를 안 그린다`
    )
  }
})

test('화면이 그리는 진행은 엔진이 실제로 보내는 것이다 — 이름이 어긋나면 영원히 안 뜬다', () => {
  // startPanel(host, 'cmd', …)의 두 번째 인자를 전부 뽑는다.
  const used = [...app.matchAll(/startPanel\([^,]+,\s*'([^']+)'/g)].map((m) => m[1])
  assert.ok(used.length >= 8, `진행 표시를 그리는 자리가 ${used.length}곳뿐이다 — 배선이 빠졌다`)
  for (const cmd of used) {
    assert.ok(
      cli.includes(`withTaskProgress('${cmd}'`),
      `화면은 '${cmd}' 진행을 기다리는데 엔진이 그 이름으로 안 보낸다`
    )
  }
})

test('★ 켠 진행 표시는 반드시 끈다 — 안 끄면 타이머가 화면 뒤에서 계속 돈다', () => {
  /* startPanel이 돌려주는 stop()을 안 부르면 setInterval이 영원히 남는다.
     화면을 여닫을 때마다 하나씩 쌓이고, 결국 죽은 노드를 그리려 든다. */
  const sites = [...app.matchAll(/const stop = .*startPanel\(/g)]
  assert.ok(sites.length >= 8, `startPanel 호출부가 ${sites.length}곳뿐이다`)

  for (const m of sites) {
    // 이 호출부가 든 함수의 본문 — 다음 최상위 함수 선언 전까지
    const rest = app.slice(m.index!)
    const end = rest.search(/\n(?:async )?function /)
    const body = end > 0 ? rest.slice(0, end) : rest
    assert.match(body, /finally\s*\{[^}]*stop\(\)/,
      `진행 표시를 켜고 finally에서 안 끄는 자리가 있다:\n  ${m[0]}`)
  }
})

test('★ 기다리게 하는 자리에는 반드시 막대가 있다 — 맨 문자열만 박지 않는다', () => {
  /* ★ 이게 원래 문제의 형태였다. 자리마다 이런 줄이 따로 박혀 있었다:
       host.innerHTML = `<div class="empty">…읽는 중…</div>`
     한 줄이라 짜기 쉽고, 그래서 일곱 군데에 따로 생겼고, 진행률을 붙일 때
     여섯 군데를 빠뜨렸다. 다시 생기면 여기서 잡는다.

     ★ 규칙은 "startPanel을 써라"가 아니라 **"막대를 보여줘라"**다.
       같은 파일 찾기(loadDupes)는 훑기와 안을 펼쳐 확인하기가 따로 진행돼서
       제 나름의 두 단계 막대를 갖고 있다 — 그건 통과시켜야 한다.
       하나의 구현을 강요하는 게 목적이 아니라, 기다리는 사람에게 아무것도
       안 보여주는 자리를 막는 게 목적이다. */
  const bad: string[] = []
  // innerHTML에 붙는 템플릿 문자열을 통째로 떠서, 로딩 문구가 있으면 막대도 있는지 본다.
  for (const m of app.matchAll(/innerHTML\s*=\s*`((?:[^`\\]|\\.)*)`/g)) {
    const tpl = m[1]
    if (!/(?:읽는|찾는|확인하는|세는)\s*중\s*[….]/.test(tpl)) continue
    if (tpl.includes('class="prog"')) continue // 제 나름의 막대가 있다
    bad.push(tpl.replace(/\s+/g, ' ').slice(0, 100))
  }
  assert.equal(
    bad.length, 0,
    `막대 없이 "…중…"만 띄우는 자리가 남아 있다:\n${bad.map((b) => '  ' + b).join('\n')}`
  )
})

test('진행률은 화면에서도 뒤로 가지 않게 잠근다', () => {
  // 엔진이 뒤로 안 보내는 것과 별개로 화면에서도 한 번 더 잠근다 —
  // 두 명령의 진행이 겹쳐 들어오는 경우가 실제로 있다(각주가 늦게 온다).
  const panel = app.slice(app.indexOf('function startPanel'))
  assert.match(panel.slice(0, 3000), /shownPct = Math\.max\(shownPct/, 'startPanel이 진행률을 안 잠근다')
})

test('★ 진행률을 모를 때 0%를 띄우지 않는다 — 멈춘 것으로 읽힌다', () => {
  const panel = app.slice(app.indexOf('function startPanel'))
  // pct가 null이면 무한 막대를 유지하고 경과 시간만 말하는 갈래가 있어야 한다.
  assert.match(panel.slice(0, 3000), /p\.pct === null/, 'pct가 null인 경우를 안 가른다')
})

test('진행 표시가 지난 실행의 100%를 물려받지 않는다', () => {
  // 안 지우면 화면을 다시 열자마자 "100%"가 떠 있다 — 다 된 줄 알고 기다린다.
  const panel = app.slice(app.indexOf('function startPanel'))
  assert.match(panel.slice(0, 1500), /taskProgress\.delete\(cmd\)/, '이전 진행을 안 비운다')
})
