/**
 * 반복 구조 — 결정을 477번이 아니라 한 번 받기 위한 관측
 *
 * ★ 이 파일에서 제일 중요한 테스트는 "무엇을 찾나"가 아니라
 *   **"무엇을 지워도 된다고 말하지 않나"** 다.
 *
 *   처음 만들 때 수정시각 순서로 '결과물'과 '중간물'을 갈랐다. 실측에 걸었더니
 *   검수 대기 중인 결과물 19.36GB(348편)가 '중간물'로 찍혔다 — 그 폴더에서
 *   link.json이 뒤에 쓰였다는 이유 하나로. 믿고 지웠으면 되돌릴 수 없었다.
 *
 *   그럴듯한 추론은 화면에서 멀쩡해 보이고 타입도 통과한다. 그래서 여기서 막는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findRepeats } from './repeats.ts'

const MB = 1024 * 1024

/** 같은 모양의 형제 폴더 n개를 만든다. */
function family(n: number, files: [string, number][], opts: { base?: string; skew?: boolean } = {}) {
  const base = opts.base ?? 'C:/app/work'
  const out: { path: string; size: number; mtimeMs: number }[] = []
  for (let i = 0; i < n; i++) {
    files.forEach(([rel, size], k) => {
      out.push({
        path: `${base}/job${i}/${rel}`,
        size: opts.skew ? size + i : size,
        mtimeMs: 1000 + k * 10, // 배열 순서 = 만들어진 순서
      })
    })
  }
  return out
}

test('같은 모양이 반복되면 한 무리로 접는다 — 결정을 폴더 수만큼 받지 않는다', () => {
  const files = family(20, [['gen.wav', 60 * MB], ['out.mp4', 40 * MB]])
  const fams = findRepeats(files, { minBytes: 1 })
  assert.equal(fams.length, 1, '반복을 못 찾았다')
  assert.equal(fams[0].count, 20)
  assert.equal(fams[0].entries.length, 2, '이름별로 접히지 않았다')
  const gen = fams[0].entries.find((e) => e.rel === 'gen.wav')!
  assert.equal(gen.present, 20)
  assert.equal(gen.bytes, 20 * 60 * MB, '무리 전체 용량을 안 합쳤다')
})

test('★ 먼저 만들어졌다는 이유로 "지워도 된다"고 하지 않는다', () => {
  /* 실측 사고: releases/검수대기의 video.mp4 19.36GB가 link.json보다 먼저
     만들어졌다는 이유로 중간물이 됐다. 시간 순서는 파이프라인 순서지
     중요도 순서가 아니다. */
  const files = family(30, [['video.mp4', 60 * MB], ['link.json', 1]], { skew: true })
  const fams = findRepeats(files, { minBytes: 1 })
  const video = fams[0].entries.find((e) => e.rel === 'video.mp4')!
  assert.equal(video.role, 'unique', '먼저 만들어진 큰 결과물을 버려도 되는 것으로 봤다')
  assert.match(video.because, /되살릴 방법이 없/, '되살릴 수 없다는 사실을 안 말한다')
})

test('★ 형제마다 크기까지 같으면 복사본으로 본다 — 이건 증거가 있다', () => {
  // 같은 폰트가 폴더마다 복사된 실측 사례(233벌).
  const files = family(20, [['out.mp4', 40 * MB], ['subfonts/x.ttf', 10 * MB]], { skew: true })
  // skew는 out.mp4에도 걸리므로 폰트만 정확히 같게 다시 만든다
  const fixed = files.map((f) => (f.path.endsWith('x.ttf') ? { ...f, size: 10 * MB } : f))
  const fams = findRepeats(fixed, { minBytes: 1 })
  const font = fams[0].entries.find((e) => e.rel === 'subfonts/x.ttf')!
  assert.equal(font.role, 'shared', '폴더마다 복사된 같은 파일을 못 알아본다')
  assert.match(font.because, /한 벌은 남습니다/, '원본이 남는다는 사실을 안 말한다')
})

test('중첩된 상대 경로도 이름으로 잡는다 — subfonts/x.ttf가 따로 놀면 안 된다', () => {
  const files = family(10, [['a.bin', 5 * MB], ['sub/deep/b.bin', 5 * MB]], { skew: true })
  const fams = findRepeats(files, { minBytes: 1 })
  assert.ok(fams[0].entries.some((e) => e.rel === 'sub/deep/b.bin'), '중첩 경로를 못 접었다')
})

test('★ 모양이 덜 갖춰진 폴더는 따로 표시한다 — 거기 것은 유일본이다', () => {
  /* 실측에서 이게 사고를 막았다: 렌더링이 끊긴 폴더 6개에는 결과물이 없어서
     중간물이 그 작업의 유일한 흔적이었다. */
  const files = family(20, [['gen.wav', 60 * MB], ['out.mp4', 40 * MB]], { skew: true })
  const broken = files.filter((f) => !(f.path.includes('/job19/') && f.path.endsWith('out.mp4')))
  const fams = findRepeats(broken, { minBytes: 1 })
  assert.deepEqual(fams[0].incomplete, ['C:/app/work/job19'], '미완성 폴더를 못 골라냈다')
})

test('거의 모든 폴더가 가진 이름만 필수로 본다 — 아니면 전부 미완성이 된다', () => {
  /* 실측: 76%짜리 이름까지 필수로 봤더니 408개 중 228개가 미완성으로 찍혔다.
     "거의 다 미완성"은 아무 정보가 아니다. */
  const files = family(20, [['core.bin', 10 * MB]], { skew: true })
  // 절반에만 있는 이름을 더한다
  for (let i = 0; i < 10; i++) files.push({ path: `C:/app/work/job${i}/sometimes.bin`, size: 1 * MB, mtimeMs: 2000 })
  const fams = findRepeats(files, { minBytes: 1 })
  assert.equal(fams[0].incomplete.length, 0, '절반짜리 이름을 필수로 봐서 전부 미완성이 됐다')
})

test('형제가 몇 개뿐이면 반복으로 안 본다 — 우연을 구조라고 하지 않는다', () => {
  const files = family(3, [['a.bin', 100 * MB]], { skew: true })
  assert.deepEqual(findRepeats(files, { minBytes: 1 }), [])
})

test('작은 무리는 아예 안 올린다 — 목록만 길어진다', () => {
  const files = family(10, [['a.bin', 1024]], { skew: true })
  assert.deepEqual(findRepeats(files), [], '100MB도 안 되는 무리를 올렸다')
})
