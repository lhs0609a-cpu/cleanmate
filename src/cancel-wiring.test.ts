/**
 * 배선 — '여기까지만 보기'가 정말 엔진까지 닿는가
 *
 * ★ 왜 필요한가
 *   멈춤은 네 겹을 지나야 한다: 화면 버튼 → Rust(cancel_engine) → 자식의 stdin
 *   → 엔진의 AbortSignal → 스캐너. 한 겹만 끊겨도 증상은 똑같다 — 버튼을 눌렀는데
 *   아무 일도 안 일어난다. 그리고 그건 취소가 없던 때보다 나쁘다. 없으면 포기라도
 *   하는데, 있는데 안 먹으면 고장 난 프로그램이 된다.
 *
 *   여기서는 겹과 겹 **사이**를 본다(wiring.test.ts와 같은 취지). 로컬에 Rust
 *   툴체인이 없어 main.rs는 컴파일로 검증할 수 없다 — 그래서 더더욱 이름이라도
 *   맞는지 여기서 잠근다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

test('화면이 부르는 취소 명령이 Rust에 등록돼 있다', () => {
  const app = read('web/src/app.ts')
  const rs = read('src-tauri/src/main.rs')

  const called = [...app.matchAll(/invoke\('([a-z_]+)'/g)].map((m) => m[1])
  assert.ok(called.includes('cancel_engine'), '화면이 cancel_engine을 안 부른다')

  assert.match(rs, /async fn cancel_engine\(/, 'Rust에 cancel_engine이 없다')
  // generate_handler에 안 넣으면 함수가 있어도 화면에서는 "명령 없음"이 된다.
  assert.match(
    rs.slice(rs.indexOf('generate_handler!')),
    /cancel_engine/,
    '★ cancel_engine이 generate_handler에 안 실렸다 — 있는데 안 불리는 상태다'
  )
})

test('Rust가 자식의 stdin을 붙잡아 두고 거기로 흘려보낸다', () => {
  const rs = read('src-tauri/src/main.rs')

  assert.match(rs, /\.stdin\(/, '엔진의 stdin을 파이프로 안 연다 — 말을 걸 통로가 없다')
  assert.match(rs, /child\.stdin\.take\(\)/, '손잡이를 안 챙겨둔다')
  assert.match(rs, /write_all\(b"cancel/, 'stdin에 cancel을 안 쓴다')
  // 끝난 일감을 안 지우면 다음 스캔이 죽은 손잡이를 물려받는다.
  assert.match(rs, /map\.remove\(name\)/, '끝난 일감을 장부에서 안 지운다')
})

test('엔진이 stdin의 cancel을 신호로 바꿔 스캐너까지 넘긴다', () => {
  const eng = read('src/engine-cli.ts')

  assert.match(eng, /function cancelSignal\(\): AbortSignal/, '엔진에 취소 통로가 없다')
  assert.match(eng, /process\.stdin\.on\('data'/, 'stdin을 안 읽는다')
  assert.match(eng, /includes\('cancel'\)/, 'cancel이라는 말을 안 알아듣는다')
  // ★ unref가 없으면 stdin이 열려 있다는 이유로 엔진이 안 끝난다.
  //   결과 JSON을 다 쓰고도 앱이 영원히 기다린다.
  assert.match(eng, /process\.stdin\.unref\(\)/, '★ unref가 빠지면 엔진이 안 끝난다')
  assert.match(eng, /scanPlan\(paths, cancelSignal\(\)\)/, 'scan-plan에 신호를 안 넘긴다')
  assert.match(eng, /await scan\(path, \{ onProgress, \.\.\.\(signal/, '스캐너까지 신호가 안 내려간다')
})

test('멈춘 스캔은 결과에 그 사실을 달고 나온다', () => {
  const eng = read('src/engine-cli.ts')
  const app = read('web/src/app.ts')

  assert.match(eng, /truncated: true, stoppedBy/, '엔진이 덜 훑었다는 사실을 안 보낸다')
  // 화면이 그 값을 읽지 않으면 "정리 가능 1.9GB"가 전부인 척하게 된다.
  assert.match(app, /stoppedBy === 'cancel'/, '★ 화면이 중단 사실을 무시한다')
  assert.match(app, /여기까지만 훑었어요/, '중단을 사용자에게 안 알린다')
})

test('멈춤 버튼이 화면에 있고, 세울 수 있을 때만 뜬다', () => {
  const html = read('web/app.html')
  const app = read('web/src/app.ts')

  assert.match(html, /id="prog-stop"/, '멈춤 버튼이 없다')
  assert.match(html, /여기까지만 보기/, '버튼 문구가 없다')
  // hidden으로 시작해야 한다 — 스캔 전에 떠 있으면 뭘 멈추라는 건지 알 수 없다.
  assert.match(html, /id="prog-stop" hidden/, '스캔 전에도 버튼이 떠 있다')
  // 세울 수 없는 작업에 멈춤 버튼을 보여주면 그건 거짓 약속이다.
  assert.match(app, /stop\.hidden = !onStop/, '세울 수 없는 작업에도 버튼이 뜬다')
})

test('스캔마다 새 일감 이름을 만든다', () => {
  const app = read('web/src/app.ts')
  // 이름을 고정하면 지난 스캔의 이름으로 엉뚱한 걸 세우게 된다.
  assert.match(app, /const job = `scan-\$\{Date\.now\(\)\}`/, '일감 이름이 스캔마다 새로 안 만들어진다')
  assert.match(app, /engine\('scan-plan', paths, job\)/, 'scan-plan에 일감 이름을 안 넘긴다')
})
