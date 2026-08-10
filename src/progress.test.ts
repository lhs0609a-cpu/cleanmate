/**
 * 진행률 테스트
 *
 * 진행 표시가 틀리는 방식은 정해져 있다: 뒤로 가거나, 100에서 멈추거나,
 * 남은 시간이 늘었다 줄었다 한다. 셋 다 "앱이 고장났다"로 읽힌다.
 * 그래서 값이 맞는지보다 **성질**을 잠근다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeProgress, fmtDuration, type RootWeight } from './progress.ts'

const PATHS = ['C:\\다운로드', 'C:\\바탕화면', 'C:\\AppData']
const W: RootWeight[] = [
  { path: 'C:\\다운로드', files: 1_000 },
  { path: 'C:\\바탕화면', files: 1_000 },
  { path: 'C:\\AppData', files: 138_000 }, // 실측: 앱 데이터가 압도적이다
]

const at = (rootIndex: number, rootFiles: number, doneFiles: number, elapsedMs = 60_000) =>
  computeProgress({ rootIndex, rootFiles, doneFiles, elapsedMs, rootCount: 3, paths: PATHS, weights: W })

test('지난번 기록이 있으면 파일 수 기준으로 센다', () => {
  const v = at(2, 69_000, 2_000)
  assert.equal(v.basis, 'learned')
  // 2000 + 69000 = 71000 / 140000 ≈ 50%
  assert.equal(v.pct, 50)
  assert.equal(v.files, 71_000)
})

test('★ 폴더 크기가 100배 다른 걸 반영한다 — 작은 폴더 둘을 끝내도 얼마 안 왔다', () => {
  // 다운로드·바탕화면(각 1천개)을 다 끝냈지만 전체로는 1.4%뿐이다.
  // 폴더 개수로 셌다면 66%라고 거짓말을 했을 것이다.
  const v = at(2, 0, 2_000)
  assert.equal(v.pct, 1)
})

test('★ 진행률은 절대 뒤로 가지 않는다', () => {
  let prev = -1
  for (const [i, rf, df] of [[0, 0, 0], [0, 500, 0], [1, 0, 1000], [1, 900, 1000],
                             [2, 0, 2000], [2, 50_000, 2000], [2, 137_000, 2000]] as const) {
    const p = at(i, rf, df).pct
    assert.ok(p >= prev, `${i}/${rf}: ${p}%가 이전 ${prev}%보다 작다`)
    prev = p
  }
})

test('★ 100%에 닿지 않는다 — 끝나지도 않았는데 끝난 것처럼 보이면 안 된다', () => {
  // 기록보다 파일이 훨씬 늘어난 경우(총량 추정이 작았던 경우)
  const v = at(2, 400_000, 2_000)
  assert.equal(v.pct, 99)
})

test('파일이 기록보다 늘어도 막대가 튀어나가지 않는다', () => {
  // 마지막 폴더에서 기록의 3배가 나왔다 → 그래도 99가 최대
  for (const rf of [138_000, 200_000, 999_999]) {
    assert.ok(at(2, rf, 2_000).pct <= 99)
  }
})

test('남은 시간은 지금 속도로 계산한다', () => {
  // 절반(70,000/140,000)을 60초에 했으면 남은 절반도 대략 60초
  const v = at(2, 68_000, 2_000, 60_000)
  assert.ok(v.etaSec !== null)
  assert.ok(v.etaSec! > 45 && v.etaSec! < 75, `남은 시간이 이상하다: ${v.etaSec}초`)
})

test('시작 직후에는 남은 시간을 내지 않는다 — 표본이 없으면 숫자가 요동친다', () => {
  assert.equal(at(0, 3, 0, 500).etaSec, null)
})

/* ── 첫 스캔: 기록이 없을 때 ─────────────────────────────── */

test('★ 기록이 없으면 폴더 개수로 세고, 그렇다고 밝힌다', () => {
  const v = computeProgress({
    rootIndex: 1, rootCount: 7, rootFiles: 500, doneFiles: 1_200,
    elapsedMs: 60_000, paths: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  })
  assert.equal(v.basis, 'roots')
  assert.equal(v.pct, 14) // 7곳 중 두 번째를 하는 중 = 1/7
  assert.equal(v.etaSec, null, '근거가 거친데 남은 시간까지 말하면 거짓말이 된다')
})

test('★ 폴더 한 곳만 훑는 첫 스캔은 "모른다"고 한다 — 0%를 7분간 띄우면 멈춘 것처럼 보인다', () => {
  const v = computeProgress({
    rootIndex: 0, rootCount: 1, rootFiles: 8_000, doneFiles: 0,
    elapsedMs: 120_000, paths: ['C:\\고른폴더'],
  })
  assert.equal(v.pct, null)
  assert.equal(v.basis, 'unknown')
  assert.equal(v.files, 8_000, '진행률을 몰라도 파일 수는 보여줄 수 있다')
})

test('폴더 한 곳이어도 기록이 있으면 진행률을 낸다', () => {
  const v = computeProgress({
    rootIndex: 0, rootCount: 1, rootFiles: 500, doneFiles: 0, elapsedMs: 30_000,
    paths: ['C:\\고른폴더'], weights: [{ path: 'C:\\고른폴더', files: 1_000 }],
  })
  assert.equal(v.pct, 50)
  assert.equal(v.basis, 'learned')
  assert.ok(v.etaSec !== null)
})

test('기록이 반쪽이면 쓰지 않는다 — 그 폴더에 닿는 순간 진행률이 튄다', () => {
  const v = computeProgress({
    rootIndex: 0, rootCount: 3, rootFiles: 10, doneFiles: 0, elapsedMs: 60_000,
    paths: PATHS,
    weights: [W[0], W[1]], // AppData 기록이 없다
  })
  assert.equal(v.basis, 'roots')
})

test('폴더가 하나도 없어도 죽지 않는다', () => {
  const v = computeProgress({
    rootIndex: 0, rootCount: 0, rootFiles: 0, doneFiles: 0, elapsedMs: 0, paths: [],
  })
  assert.equal(v.pct, null)
  assert.equal(v.files, 0)
})

test('기록이 반쪽이어도 여러 폴더면 폴더 개수로 센다', () => {
  const v = computeProgress({
    rootIndex: 2, rootCount: 3, rootFiles: 10, doneFiles: 2_000, elapsedMs: 60_000,
    paths: PATHS, weights: [W[0]],
  })
  assert.equal(v.basis, 'roots')
  assert.equal(v.pct, 66)
})

/* ── 시간 표기 ───────────────────────────────────────────── */

test('시간은 초까지 보여준다 — "약 2분"으로는 기다릴 계획을 못 세운다', () => {
  assert.equal(fmtDuration(7), '7초')
  assert.equal(fmtDuration(59), '59초')
  assert.equal(fmtDuration(60), '1분 0초')
  assert.equal(fmtDuration(436), '7분 16초') // 스크린샷에 찍힌 값
  assert.equal(fmtDuration(3_600), '1시간 0분')
  assert.equal(fmtDuration(5_400), '1시간 30분')
})

test('음수·소수를 넣어도 이상한 문자열이 안 나온다', () => {
  assert.equal(fmtDuration(-5), '0초')
  assert.equal(fmtDuration(7.4), '7초')
})
