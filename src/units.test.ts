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
import {
  splitUnit,
  foldIntoUnits,
  folderCandidates,
  lastTouched,
  noteSourceFile,
  activityForRoot,
  activitySentence,
  looksLikeOneShot,
  UNIT_MIN_BYTES,
  type SourceDirs,
} from './units.ts'

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

/* ── 실사용 신호 — 확률 대신 센 것 ───────────────────────────
   ★ 여기서 잠그는 건 **숫자가 거짓말하지 않는 것**이다. 실측에서 바로 걸렸다:
     소스 1,145개가 전부 '최근 30일'에 들어와 100%가 나왔는데, 실제로는
     27일 전 하루에 한꺼번에 깔린 것이었고 그 뒤로 고친 건 1개뿐이었다.
     설치 한 번과 매일 작업이 같은 숫자로 보이면 그건 신호가 아니다. */

const dirs = (files: { path: string; ageDays: number }[]) => {
  const m: SourceDirs = new Map()
  for (const f of files) noteSourceFile(m, f.path, f.ageDays)
  return m
}

test('★ 로그·산출물은 소스로 세지 않는다 — 안 그러면 모든 프로젝트가 "작업 중"이 된다', () => {
  const m = dirs([
    { path: 'C:\\dev\\p\\main.py', ageDays: 200 },
    { path: 'C:\\dev\\p\\logs\\run.log', ageDays: 0 },
    { path: 'C:\\dev\\p\\outputs\\a.wav', ageDays: 0 },
    { path: 'C:\\dev\\p\\output.wav', ageDays: 0 }, // 확장자가 소스가 아니다
  ])
  const a = activityForRoot(m, 'C:\\dev\\p')!
  assert.equal(a.sourceFiles, 1, '프로그램이 뱉은 것까지 소스로 셌다')
  assert.equal(a.recentSources, 0)
})

test('★ 하루에 몰린 건 "작업"이 아니라 "설치"라고 말한다', () => {
  const files = Array.from({ length: 300 }, (_, i) => ({ path: `C:\\dev\\p\\src\\f${i}.py`, ageDays: 27 }))
  files.push({ path: 'C:\\dev\\p\\src\\touched.py', ageDays: 0 })
  const a = activityForRoot(dirs(files), 'C:\\dev\\p')!

  assert.equal(a.recentPercent, 100, '센 값 자체는 100%가 맞다')
  assert.equal(looksLikeOneShot(a), true, '하루에 몰린 것을 못 알아본다')
  const s = activitySentence(a)
  assert.match(s, /27일 전 하루에 300개가 한꺼번에/, '설치 한 번이라는 사실을 안 말한다')
  assert.doesNotMatch(s, /작업 중인 프로젝트/, '설치를 작업으로 읽는다')
})

test('여러 날에 걸쳐 고친 건 작업 중이라고 말한다', () => {
  const files = Array.from({ length: 40 }, (_, i) => ({ path: `C:\\dev\\p\\src\\f${i}.ts`, ageDays: i % 12 }))
  const a = activityForRoot(dirs(files), 'C:\\dev\\p')!
  assert.equal(looksLikeOneShot(a), false)
  assert.match(activitySentence(a), /12일에 걸쳐 직접 고치셨어요/)
})

test('★ 퍼센트는 몇 개 중 몇 개인지 함께 쓴다 — 검증할 수 없는 숫자는 안 쓴다', () => {
  const a = activityForRoot(
    dirs([
      { path: 'C:\\dev\\p\\a.py', ageDays: 1 },
      { path: 'C:\\dev\\p\\b.py', ageDays: 400 },
      { path: 'C:\\dev\\p\\c.py', ageDays: 400 },
      { path: 'C:\\dev\\p\\d.py', ageDays: 400 },
    ]),
    'C:\\dev\\p'
  )!
  assert.equal(a.recentPercent, 25)
  // 분모와 분자가 문장에 있어야 사용자가 탐색기를 열어 확인할 수 있다.
  assert.match(activitySentence(a), /직접 만드신 파일 4개 중 최근 30일에 바뀐 것 1개 · 25%/)
})

test('셀 게 없으면 아무 말도 안 한다 — 빈칸을 지어내지 않는다', () => {
  assert.equal(activitySentence(undefined), '')
  assert.equal(activityForRoot(new Map(), 'C:\\dev\\p'), null)
})

test('데이터 폴더는 "쌓인다"로 말하고 결론이 반대다 — 옮기기 전에 닫으라고 한다', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    path: `C:\\Users\\me\\AppData\\Local\\app\\tmp\\api_audio\\a${i}.wav`,
    size: 200 * 1024 * 1024,
    ageDays: i % 10,
  }))
  const [c] = folderCandidates(items)
  assert.equal(c.activity?.scope, 'folder')
  assert.match(activitySentence(c.activity), /지금도 쌓이는 중이에요/)
  assert.match(activitySentence(c.activity), /먼저 닫아주세요/)
})

test('나이를 모르면 모른다고 한다', () => {
  assert.match(lastTouched(null), /알 수 없/)
  assert.match(lastTouched(400), /년/)
  assert.match(lastTouched(90), /3개월/)
})
