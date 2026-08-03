/**
 * 데스크톱 셸 설정 테스트
 *
 * ★ 실물에서 터진 사고를 잠근다:
 *   설치하고 앱을 켰더니 **마케팅 랜딩 페이지**가 떠 있었다.
 *   "Windows용 다운로드" 버튼이 있는 홈페이지가 앱인 척 창에 들어앉은 것이다.
 *
 *   원인: vite가 페이지를 둘 굽는다 — index.html(랜딩) + app.html(앱 화면).
 *   Tauri는 frontendDist 루트의 index.html을 기본으로 연다. 그래서 앱을 켜면
 *   랜딩이 떴다. 이건 빌드해서 눈으로 보기 전까지 아무도 모르는 종류의 버그다
 *   (로컬에 Rust 툴체인이 없어서 실물 확인이 계속 밀렸다).
 *
 * 이 테스트는 Rust 없이도 그 설정을 검사한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const conf = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'))

test('★ 앱 창은 앱 화면(app.html)을 띄운다 — 랜딩이 아니다', () => {
  const win = conf.app?.windows?.[0]
  assert.ok(win, '창 설정이 없다')
  assert.equal(win.url, 'app.html', '기본값(index.html)이면 마케팅 랜딩이 앱으로 뜬다')
})

test('그 파일이 실제로 있다 — 없으면 빈 창이 뜬다', () => {
  assert.ok(existsSync(join(root, 'web/app.html')), 'web/app.html이 없다')
})

test('vite가 그 페이지를 실제로 굽는다', () => {
  // 입력 목록에서 빠지면 dist에 app.html이 안 생기고, 앱은 빈 화면이 된다.
  const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8')
  assert.match(vite, /web\/app\.html/, 'vite 입력에 app.html이 없다')
  assert.match(vite, /web\/index\.html/, 'vite 입력에 index.html이 없다')
})

test('창 제목과 제품 이름이 테라클린이다', () => {
  assert.equal(conf.app.windows[0].title, '테라클린')
  assert.equal(conf.productName, 'TeraClean')
  assert.equal(conf.identifier, 'com.teraclean.app')
})

test('앱 화면에서 엔진을 부를 수 있어야 한다 (withGlobalTauri)', () => {
  // app.ts가 window.__TAURI__로 데스크톱 여부를 판단하고 run_engine을 부른다.
  assert.equal(conf.app.withGlobalTauri, true)
})
