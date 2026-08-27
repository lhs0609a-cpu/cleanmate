/**
 * 진행률 테스트
 *
 * 진행 표시가 틀리는 방식은 정해져 있다: 뒤로 가거나, 100에서 멈추거나,
 * 남은 시간이 늘었다 줄었다 한다. 셋 다 "앱이 고장났다"로 읽힌다.
 * 그래서 값이 맞는지보다 **성질**을 잠근다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeProgress, fmtDuration, stepProgress, timeProgress, phaseProgress,
  type RootWeight,
} from './progress.ts'

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

/* ── 셀 수 있는 일 (stepProgress) ─────────────────────────────
   폴더 크기 실측처럼 할 일 목록이 먼저 정해지는 작업. */

test('몇 개 중 몇 개를 했는지로 센다', () => {
  const v = stepProgress(3, 12, 10_000)
  assert.equal(v.basis, 'counted')
  assert.equal(v.pct, 25)
})

test('★ 다 하기 전에는 100%가 안 된다 — 11/12도 99다', () => {
  assert.equal(stepProgress(11, 12, 10_000).pct, 91)
  // 끝에 몰려도 99를 안 넘는다
  assert.equal(stepProgress(999, 1000, 10_000).pct, 99)
})

test('총량을 모르면 진행률을 지어내지 않는다', () => {
  const v = stepProgress(5, 0, 10_000)
  assert.equal(v.pct, null)
  assert.equal(v.basis, 'unknown')
})

test('done이 total을 넘어도 막대가 튀어나가지 않는다', () => {
  assert.ok(stepProgress(50, 12, 10_000).pct! <= 99)
})

test('남은 시간은 지금 속도로 낸다', () => {
  // 10개 중 5개를 10초에 했으면 남은 5개도 대략 10초
  const v = stepProgress(5, 10, 10_000)
  assert.ok(v.etaSec! > 8 && v.etaSec! < 12, `남은 시간이 이상하다: ${v.etaSec}초`)
})

test('표본이 없으면 남은 시간을 안 낸다', () => {
  assert.equal(stepProgress(0, 10, 30_000).etaSec, null, '아무것도 안 했는데 속도를 알 수 없다')
  assert.equal(stepProgress(1, 10, 500).etaSec, null, '0.5초 표본으로 낸 숫자는 요동친다')
})

/* ── 셀 수 없는 일 (timeProgress) ─────────────────────────────
   ★ 이게 이번에 새로 생긴 근거다. 파워셸에 통째로 맡기는 조회는 안에서
     몇 개째인지 볼 수가 없다. 그래도 **지난번에 몇 초 걸렸는지**는 안다. */

test('★ 기록이 없으면 진행률을 안 낸다 — 첫 실행에는 아는 척하지 않는다', () => {
  const v = timeProgress(5_000)
  assert.equal(v.pct, null)
  assert.equal(v.basis, 'unknown')
  assert.equal(v.etaSec, null)
})

test('지난번 기록으로 진행률과 남은 시간을 낸다', () => {
  const v = timeProgress(5_000, 10_000) // 10초짜리 일의 절반
  assert.equal(v.basis, 'learned-time')
  assert.equal(v.pct, 45) // 절반이면 90%의 절반
  assert.equal(v.etaSec, 5)
})

test('★ 지난번과 똑같이 걸려도 100%가 아니다 — 90에서 멈춘다', () => {
  // 여기서 100을 주면, 조금이라도 더 걸리는 순간 "끝났는데 안 끝났다"가 된다.
  assert.equal(timeProgress(10_000, 10_000).pct, 90)
})

test('★ 지난번보다 오래 걸려도 멈춰 보이지 않고, 99에 닿지도 않는다', () => {
  let prev = 90
  for (const over of [1, 2, 5, 10, 60, 600]) {
    const v = timeProgress(10_000 + over * 1_000, 10_000)
    assert.ok(v.pct! >= prev, `${over}초 초과에서 ${v.pct}%가 이전 ${prev}%보다 작다`)
    assert.ok(v.pct! <= 99, `${over}초 초과에서 ${v.pct}%가 99를 넘었다`)
    prev = v.pct!
  }
  // 아무리 오래 끌어도 99에서 멈춘다 — 끝났다고 말하지 않는다
  assert.equal(timeProgress(10_000_000, 10_000).pct, 99)
})

test('★ 기록을 넘긴 뒤에는 남은 시간을 말하지 않는다 — 근거가 빗나갔으면 침묵이 맞다', () => {
  assert.equal(timeProgress(15_000, 10_000).etaSec, null)
})

test('★ 진행률은 시간이 흘러도 뒤로 가지 않는다', () => {
  let prev = -1
  for (let ms = 0; ms <= 40_000; ms += 250) {
    const p = timeProgress(ms, 10_000).pct!
    assert.ok(p >= prev, `${ms}ms에서 ${p}%가 이전 ${prev}%보다 작다`)
    prev = p
  }
})

test('남은 시간도 줄어들기만 한다 — 늘어나면 고장난 걸로 읽힌다', () => {
  let prev = Infinity
  for (let ms = 0; ms < 10_000; ms += 250) {
    const e = timeProgress(ms, 10_000).etaSec!
    assert.ok(e <= prev, `${ms}ms에서 남은 시간이 ${prev}초→${e}초로 늘었다`)
    prev = e
  }
})

test('기록이 0이거나 음수면 없는 것으로 친다', () => {
  assert.equal(timeProgress(5_000, 0).pct, null)
  assert.equal(timeProgress(5_000, -1).pct, null)
})

/* ── 단계만 아는 일 (phaseProgress) ───────────────────────── */

test('단계 수로 센다', () => {
  assert.equal(phaseProgress(2, 5).pct, 40)
  assert.equal(phaseProgress(0, 5).pct, 0)
})

test('단계가 하나뿐이면 셀 수가 없다 — 0% 아니면 100%다', () => {
  assert.equal(phaseProgress(0, 1).pct, null)
  assert.equal(phaseProgress(0, 0).pct, null)
})

test('단계 기준으로는 남은 시간을 안 낸다 — 단계마다 길이가 100배씩 다르다', () => {
  assert.equal(phaseProgress(2, 5).etaSec, null)
})

test('마지막 단계여도 100%가 아니다', () => {
  assert.equal(phaseProgress(5, 5).pct, 99)
})
