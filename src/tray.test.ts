/**
 * 트레이 상주 설정 테스트 (V3·알약 방식)
 *
 * ★ 실물에서 드러난 어긋남을 잠근다:
 *   설치 스크립트는 자동시작을 `--minimized`로 등록해두고 주석에
 *   "V3/알약처럼 트레이에 조용히 뜬다 — 앱이 이 인자를 해석한다"고 적어놨는데,
 *   정작 앱에는 트레이도 인자 처리도 없었다. 부팅할 때마다 창이 그냥 떴다.
 *
 * 로컬에 Rust 툴체인이 없어 컴파일로는 확인할 수 없다. 그래서 '약속과 코드가
 * 같은 말을 하는지'라도 여기서 검사한다 — 설치 스크립트가 넘기는 인자를
 * main.rs가 실제로 읽는지, 트레이에 필요한 것들이 갖춰져 있는지.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const mainRs = read('src-tauri/src/main.rs')
const cargo = read('src-tauri/Cargo.toml')
const iss = read('installer/teraclean.iss')

test('★ 설치 스크립트가 넘기는 인자를 앱이 실제로 읽는다', () => {
  assert.match(iss, /--minimized/, '설치 스크립트가 자동시작에 인자를 안 넘긴다')
  assert.match(mainRs, /"--minimized"/, 'main.rs가 --minimized를 해석하지 않는다')
  // 그 인자를 받으면 창을 숨겨야 한다. 안 숨기면 부팅마다 창이 뜬다.
  assert.match(mainRs, /--minimized[\s\S]{0,200}hide\(\)/, '--minimized인데 창을 숨기지 않는다')
})

test('트레이 아이콘이 실제 파일로 있다 — 없으면 컴파일이 깨진다', () => {
  const icon = join(root, 'src-tauri/icons/tray.png')
  assert.ok(existsSync(icon), 'src-tauri/icons/tray.png가 없다')
  const buf = readFileSync(icon)
  assert.equal(buf.slice(1, 4).toString(), 'PNG', 'PNG가 아니다')
  assert.ok(statSync(icon).size > 100, '아이콘이 비었다')
  assert.match(mainRs, /include_bytes!\("\.\.\/icons\/tray\.png"\)/, 'main.rs가 그 파일을 안 쓴다')
})

test('트레이에 필요한 기능이 Cargo에 켜져 있다', () => {
  assert.match(cargo, /features = \[[^\]]*"tray-icon"/, 'tray-icon 기능이 꺼져 있다')
  assert.match(cargo, /features = \[[^\]]*"image-png"/, 'PNG 아이콘을 못 만든다')
  assert.match(cargo, /tauri-plugin-single-instance/, '두 번 실행 방지가 없다')
})

test('★ 창을 닫아도 종료가 아니라 트레이로 내려간다', () => {
  assert.match(mainRs, /CloseRequested[\s\S]{0,200}prevent_close\(\)/, '닫으면 그냥 종료된다')
  assert.match(mainRs, /prevent_close\(\)[\s\S]{0,120}hide\(\)/, '닫기를 막기만 하고 숨기지 않는다')
})

test('완전히 종료할 길을 반드시 남긴다 — 못 끄는 프로그램은 악성코드다', () => {
  assert.match(mainRs, /"quit"[\s\S]{0,120}exit\(0\)/, '트레이 메뉴에 종료가 없다')
  assert.match(mainRs, /완전히 종료/, '종료 메뉴 이름이 사용자에게 보이지 않는다')
})

test('트레이에서 창을 다시 꺼낼 수 있다', () => {
  assert.match(mainRs, /"open"/, '트레이 메뉴에 열기가 없다')
  assert.match(mainRs, /fn show_main[\s\S]{0,300}set_focus\(\)/, '창을 앞으로 못 가져온다')
})
