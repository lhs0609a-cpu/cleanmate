/**
 * 드라이브 옮기기 자동 목록 안전장치
 *
 * ★ 이 화면은 여태 '옮길 폴더 고르기'부터 시작했다. 그런데 어느 폴더에 큰 게
 *   들어 있는지 아는 사람이면 이 기능이 필요 없다 — 용량이 부족한 사람은
 *   어디를 봐야 할지 몰라서 부족한 거다. 그래서 알아서 찾게 바꿨고,
 *   여기서 잠그는 건 그 '알아서'가 위험한 곳까지 손대지 않는 것이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { relocateRoots, isRelocatable } from './relocate.ts'
import type { Classified } from './types.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const WIN = { platform: 'win32' as NodeJS.Platform, home: 'C:\\Users\\me' }

test('★ 자동 탐색은 AppData를 안 본다 — 지워도 되는 것과 옮겨도 되는 건 다르다', () => {
  const paths = relocateRoots(WIN).map((r) => r.path.toLowerCase())
  // 앱 데이터는 캐시라 '지우는' 건 되지만, 옮기면 앱이 그 경로를 못 찾아 깨진다.
  // 파일이 살아 있어도 프로그램이 고장나면 똑같이 사고다.
  for (const p of paths) {
    assert.doesNotMatch(p, /appdata/, `자동 탐색 대상에 AppData가 있다: ${p}`)
  }
  // 스캔 기본 목록(presets)과 일부러 다르다는 걸 못 박는다.
  const presets = read('src/presets.ts')
  assert.match(presets, /AppData/, 'presets는 AppData를 본다 — 이 테스트의 전제가 깨졌다')
})

test('사람이 만든 큰 덩어리가 사는 곳을 본다', () => {
  const labels = relocateRoots(WIN).map((r) => r.label)
  for (const want of ['다운로드', '동영상', '사진', '문서']) {
    assert.ok(labels.includes(want), `${want}를 안 본다`)
  }
})

/** isRelocatable에 넘길 최소 형태 */
const classified = (path: string, zone: Classified['verdict']['zone'] = 'SAFE'): Classified =>
  ({ path, size: 1, verdict: { zone, meaning: '테스트', reason: '테스트' } }) as any

test('★ 자동으로 찾아도 옮기면 안 되는 곳은 그대로 거절한다', () => {
  // 자동 탐색은 '어디를 볼까'만 바꾼 것이다. '무엇을 옮겨도 되나'는 안 바뀐다.
  assert.equal(isRelocatable(classified('C:\\Program Files\\App\\x.dll')).ok, false)
  assert.equal(isRelocatable(classified('C:\\Users\\me\\AppData\\Roaming\\App\\x.dat')).ok, false)
  assert.equal(isRelocatable(classified('C:\\Users\\me\\OneDrive\\a.mp4')).ok, false)
  assert.equal(isRelocatable(classified('C:\\Users\\me\\p\\node_modules\\a.bin')).ok, false)
  assert.equal(isRelocatable(classified('C:\\Users\\me\\Videos\\big.mp4', 'LOCKED')).ok, false)
  // 평범한 사용자 파일은 통과한다
  assert.equal(isRelocatable(classified('C:\\Users\\me\\Videos\\big.mp4')).ok, true)
})

test('★ 대상 드라이브를 자동으로 고르지 않는다', () => {
  const app = read('web/src/app.ts')
  const start = app.indexOf('async function loadMove()')
  assert.ok(start > 0, 'loadMove를 찾지 못했다')
  const body = app.slice(start, app.indexOf('\nasync function planMove', start))

  // 여유 공간만 보고 고르면 클라우드 동기화 마운트를 집을 수 있다 —
  // 구글 드라이브 G:는 여유 2048GB로 보고한다. 그리로 옮기면 통째로 업로드된다.
  // HTML에 checked를 박아두면 미리 선택된다. (r.checked = true 는 사용자가
  // 이전에 고른 걸 되살리는 것뿐이라 해당 없음 — 태그 안만 본다.)
  assert.doesNotMatch(body, /<input type="radio"[^>]*\bchecked\b/, '대상 드라이브가 미리 선택돼 있다')
  assert.match(body, /input type="radio"/, '대상을 고르는 수단이 없다')
  assert.match(body, /업로드/, '클라우드로 올라갈 수 있다는 경고가 없다')
  // 시스템 드라이브로 옮기면 용량이 안 는다.
  assert.match(body, /!v\.isSystem/, '시스템 드라이브를 대상에서 안 뺀다')
})

test('★ 대상을 안 고르면 옮기기 버튼이 안 눌린다', () => {
  const app = read('web/src/app.ts')
  const start = app.indexOf('async function loadMove()')
  const body = app.slice(start, app.indexOf('\nasync function planMove', start))
  assert.match(body, /b\.disabled = !moveDest/, '대상 없이도 버튼이 살아 있다')
})

test('★ 계획을 그려도 위쪽 선택지가 살아 있다', () => {
  const app = read('web/src/app.ts')
  const start = app.indexOf('async function planMove(')
  const body = app.slice(start, app.indexOf('\n/* ── 격리함', start))
  // host 전체를 다시 그리면 드라이브 선택지·폴더 버튼의 리스너가 통째로 날아가서
  // 한 번 계획을 본 뒤에는 다른 폴더를 못 고르게 된다.
  assert.doesNotMatch(body, /host\.innerHTML = prev/, '계획을 그리면서 화면 전체를 다시 그린다')
  assert.match(body, /getElementById\('mv-plan'\)/, '전용 칸에 그리지 않는다')
})
