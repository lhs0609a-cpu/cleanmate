/**
 * 결정 단위 테스트
 *
 * ★ 여기서 잠그는 건 **단위를 안쪽으로 잡지 않는 것**이다.
 *   `proj\.venv\Lib\site-packages\torch\lib\a.dll`에서 site-packages를 단위로
 *   잡으면 "가상환경의 일부만 지우기"가 된다 — 용량은 조금 줄고 프로젝트는
 *   똑같이 안 돌아가는, 정확히 이 기능이 없애려던 상황이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitUnit, foldIntoUnits, folderCandidates, lastTouched, UNIT_MIN_BYTES } from './units.ts'

const GB = 1024 ** 3
const TORCH = 'C:\\Users\\me\\AppData\\Local\\MusicFactory\\ACE-Step-1.5\\.venv\\Lib\\site-packages\\torch\\lib\\torch_cuda.dll'

test('★ 가장 바깥 표시가 단위다 — .venv 안의 site-packages를 단위로 잡지 않는다', () => {
  const s = splitUnit(TORCH)
  assert.ok(s)
  assert.equal(s.marker, '.venv')
  assert.equal(s.project, 'ACE-Step-1.5')
  assert.equal(s.unitPath, 'C:\\Users\\me\\AppData\\Local\\MusicFactory\\ACE-Step-1.5\\.venv')
})

test('프로젝트 이름은 경로에서 그대로 읽는다 — 대소문자를 살린다', () => {
  const s = splitUnit('D:\\Work\\MyApp\\node_modules\\react\\index.js')
  assert.equal(s?.project, 'MyApp')
  assert.equal(s?.label ?? `${s?.project} › ${s?.marker}`, 'MyApp › node_modules')
})

test('표시가 없으면 묶지 않는다 — 사용자 폴더를 통째로 지우게 만들지 않는다', () => {
  assert.equal(splitUnit('C:\\Users\\me\\Documents\\보고서\\2026\\최종.hwp'), null)
  assert.equal(splitUnit('C:\\Users\\me\\Videos\\trip.mp4'), null)
})

test('드라이브 뿌리 바로 아래면 프로젝트 이름을 지어내지 않는다', () => {
  assert.equal(splitUnit('C:\\node_modules\\a\\b.js'), null)
})

test('★ 14만 개가 카드 몇 장이 된다 — 그게 이 모듈의 존재 이유다', () => {
  const items = []
  for (let i = 0; i < 60_000; i++) {
    items.push({ path: `C:\\dev\\projA\\.venv\\Lib\\site-packages\\p${i % 400}\\f${i}.py`, size: 100 * 1024, ageDays: 200 })
  }
  for (let i = 0; i < 40_000; i++) {
    items.push({ path: `C:\\dev\\projB\\node_modules\\p${i % 300}\\f${i}.js`, size: 80 * 1024, ageDays: 30 })
  }
  const r = foldIntoUnits(items)
  assert.equal(r.units.length, 2, '10만 개가 카드 2장으로 접히지 않았다')
  assert.equal(r.units[0].label, 'projA › .venv', '큰 것이 먼저 와야 한다')
  assert.equal(r.units[0].count, 60_000)
  assert.equal(r.looseCount, 0)
})

test('작은 묶음은 카드가 아니라 낱개로 넘어간다 — 사라지지는 않는다', () => {
  const r = foldIntoUnits([
    { path: 'C:\\dev\\big\\.venv\\a.bin', size: 2 * GB, ageDays: 400 },
    { path: 'C:\\dev\\small\\node_modules\\a.js', size: 1024, ageDays: 10 },
  ])
  assert.equal(r.units.length, 1, '작은 묶음까지 카드로 만들면 다시 못 읽는 목록이 된다')
  assert.equal(r.looseCount, 1, '카드가 안 된 것이 조용히 사라졌다')
  assert.equal(r.looseBytes, 1024)
})

test('묶음의 나이는 "가장 최근에 손댄 것" 기준이다 — 하나라도 최근이면 쓰는 중이다', () => {
  const r = foldIntoUnits([
    { path: 'C:\\dev\\p\\.venv\\a.bin', size: UNIT_MIN_BYTES, ageDays: 400 },
    { path: 'C:\\dev\\p\\.venv\\b.bin', size: UNIT_MIN_BYTES, ageDays: 3 },
  ])
  assert.equal(r.units[0].newestDays, 3)
  assert.match(lastTouched(3), /최근/)
})

/* ── 표시가 없는 폴더 — 옮기기 후보 ────────────────────────── */

test('★ 낱개로는 못 옮기는 앱 데이터도 폴더째로는 옮길 수 있다고 말한다', () => {
  // 실측: AppData\Local\MusicFactory\releases에 17.6GB. 파일 하나하나는
  // "옮기면 앱이 못 찾아요"라 전부 이동 불가였다 — 폴더째면 되는데도.
  const items = Array.from({ length: 8 }, (_, i) => ({
    path: `C:\\Users\\me\\AppData\\Local\\MusicFactory\\releases\\track${i}.wav`,
    size: 300 * 1024 * 1024,
    ageDays: 100,
  }))
  const [c] = folderCandidates(items)
  assert.ok(c, '큰 게 몰려 있는 폴더를 후보로 안 올린다')
  assert.equal(c.path, 'C:\\Users\\me\\AppData\\Local\\MusicFactory\\releases')
  assert.equal(c.moveOnly, true, '안에 뭐가 있는지 모르는 폴더에 "통째로 정리"를 권하면 안 된다')
  assert.match(c.label, /MusicFactory › releases/, '어느 폴더인지 알아볼 수 있어야 한다')
})

test('표시가 있는 폴더는 옮기기 후보로 중복해서 올리지 않는다', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({
    path: `C:\\dev\\proj\\.venv\\Lib\\site-packages\\p${i}\\big.bin`,
    size: 500 * 1024 * 1024,
    ageDays: 10,
  }))
  assert.deepEqual(folderCandidates(items), [], '.venv가 카드 두 장으로 나온다')
})

test('작거나 흩어진 폴더는 후보가 아니다 — 카드가 늘어나면 아무도 안 읽는다', () => {
  assert.deepEqual(
    folderCandidates([{ path: 'C:\\Users\\me\\Videos\\a.mp4', size: 5 * 1024 ** 3, ageDays: 5 }]),
    [],
    '파일 하나짜리 폴더까지 카드로 만든다'
  )
})

test('나이를 모르면 모른다고 한다', () => {
  assert.match(lastTouched(null), /알 수 없/)
  assert.match(lastTouched(400), /년/)
  assert.match(lastTouched(90), /3개월/)
})
