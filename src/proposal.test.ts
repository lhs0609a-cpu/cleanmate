/**
 * 제안 — 42만 개의 판정을 카드 몇 장으로
 *
 * 여기서 지키는 건 "정확한가"가 아니라 **"사람이 볼 수 있는가"** 다.
 * 판정이 파일마다 정확해도 파일마다 물으면 아무도 못 쓴다. 실측 PC에서
 * 지워도 되는 것이 155,324개였다 — 체크박스 15만 개는 목록이 아니라 벽이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { propose, ownerLabel } from './proposal.ts'
import type { FileVerdict } from './verdict.ts'

const v = (path: string, size: number, over: Partial<FileVerdict> = {}): FileVerdict => ({
  path,
  size,
  action: 'delete',
  recovery: 'regenerates',
  effort: 'free',
  because: '다시 만들어져요.',
  meaning: '캐시',
  ...over,
})

const spot = (path: string) => ({ path, bytes: 1, files: 1, share: 1 })
const MB = 1024 * 1024

test('★ 같은 자리·같은 근거는 한 장으로 접는다 — 카드가 파일 수만큼 나오면 실패다', () => {
  const files = Array.from({ length: 500 }, (_, i) => v(`C:/app/cache/f${i}.bin`, 1 * MB))
  const { proposals } = propose(files, [spot('C:/app/cache')], { minBytes: 1 })
  assert.equal(proposals.length, 1, `500개가 카드 ${proposals.length}장이 됐다`)
  assert.equal(proposals[0].count, 500)
  assert.equal(proposals[0].bytes, 500 * MB)
})

test('★ 카드 수를 자르되 자른 사실을 말한다 — 조용히 자르면 그게 전부인 줄 안다', () => {
  const files = Array.from({ length: 30 }, (_, i) => v(`C:/app${i}/cache/f.bin`, 300 * MB))
  const spots = Array.from({ length: 30 }, (_, i) => spot(`C:/app${i}/cache`))
  const { proposals, rest } = propose(files, spots, { limit: 5, minBytes: 1 })
  assert.equal(proposals.length, 5, '상한을 안 지켰다')
  assert.equal(rest.cards, 25, '자른 카드 수를 안 알려준다')
  assert.equal(rest.count, 25, '자른 파일 수를 안 알려준다')
  assert.ok(rest.bytes > 0, '자른 용량을 안 알려준다')
})

test('★ 순위는 판정과 품에서 나온다 — 따로 매기면 언젠가 어긋난다', () => {
  const { proposals } = propose(
    [
      v('C:/a/x.bin', 300 * MB),
      v('C:/b/y.bin', 300 * MB, { recovery: 'rebuildable', effort: 'takes-time', because: '다시 빌드하면 됩니다.' }),
      v('C:/c/z.bin', 300 * MB, { action: 'ask', recovery: 'none', because: '되살릴 수 없어요.' }),
    ],
    [spot('C:/a'), spot('C:/b'), spot('C:/c')],
    { minBytes: 1 }
  )
  assert.deepEqual(proposals.map((p) => p.tier), [1, 2, 3], '순위가 판정·품과 어긋난다')
})

test('★ 안 건드리는 것은 제안에 안 올린다 — 목록에 있으면 지우라는 뜻으로 읽힌다', () => {
  const { proposals } = propose(
    [v('C:/win/a.dll', 500 * MB, { action: 'keep', because: '지우면 깨져요.' })],
    [spot('C:/win')],
    { minBytes: 1 }
  )
  assert.equal(proposals.length, 0, '안 건드리는 것을 제안 목록에 올렸다')
})

test('★ 예시는 큰 것부터 — 무작위면 판단에 못 쓴다', () => {
  const files = [
    v('C:/app/cache/small.bin', 1 * MB),
    v('C:/app/cache/huge.bin', 900 * MB),
    v('C:/app/cache/mid.bin', 100 * MB),
  ]
  const { proposals } = propose(files, [spot('C:/app/cache')], { minBytes: 1 })
  assert.equal(proposals[0].samples[0].path, 'C:/app/cache/huge.bin', '작은 것을 먼저 보여준다')
})

test('★ 카드 하나가 곧 실행 단위다 — 경로를 들고 있어야 누를 수 있다', () => {
  const files = [v('C:/app/cache/a.bin', 300 * MB), v('C:/app/cache/b.bin', 300 * MB)]
  const { proposals } = propose(files, [spot('C:/app/cache')], { minBytes: 1 })
  assert.deepEqual(proposals[0].paths.sort(), ['C:/app/cache/a.bin', 'C:/app/cache/b.bin'])
})

test('작은 묶음은 카드로 안 만든다 — 목록만 길어진다', () => {
  const { proposals, rest } = propose([v('C:/a/x.bin', 1024)], [spot('C:/a')], { minBytes: 100 * MB })
  assert.equal(proposals.length, 0)
  assert.equal(rest.count, 1, '뺀 것을 안 세었다')
})

test('★ 하드링크는 카드 사이에서도 한 번만 센다 — 세 장 다 지워도 한 벌만 빈다', () => {
  /* 실측: 같은 모델(하드링크)이 앱 세 곳에 있어서 "6.46GB" 카드가 세 장 나왔다.
     합치면 19.38GB지만 실제로 비는 건 6.46GB다. 눌러본 사람이 속는다. */
  const files = [
    v('C:/a/m.bin', 900 * MB, { ino: 'vol:9' }),
    v('C:/b/m.bin', 900 * MB, { ino: 'vol:9' }),
    v('C:/c/m.bin', 900 * MB, { ino: 'vol:9' }),
  ]
  const { proposals } = propose(files, [spot('C:/a'), spot('C:/b'), spot('C:/c')], { minBytes: 1 })
  const total = proposals.reduce((n, p) => n + p.bytes, 0)
  assert.equal(total, 900 * MB, `같은 실물을 여러 카드가 나눠 셌다: ${total / MB}MB`)
  /* ★ 그리고 링크 셋이 **한 카드에** 모여야 한다. 흩어두면 그 카드를 눌러도
     다른 링크가 남아서 1바이트도 안 빈다 — "900MB 지우기"가 거짓말이 된다. */
  assert.equal(proposals.length, 1, '링크가 여러 카드로 흩어졌다')
  assert.equal(proposals[0].paths.length, 3, '한 카드가 링크를 다 안 들고 있다')
})

/* ── 제목 ─────────────────────────────────────────────────── */

test('★ 제목이 누구 것인지 말한다 — "lib"만으로는 아무도 못 알아본다', () => {
  /* 실측에서 실제로 이렇게 나왔다: "lib — 다시 받거나 빌드하면 되는 것",
     "x86_64 — 되살릴 수 없는 것". 사용자는 이게 뭔지 알 방법이 없다. */
  assert.equal(
    ownerLabel('C:/Users/me/AppData/Local/MusicFactory/ACE-Step-1.5/.venv/Lib/site-packages/torch/lib'),
    'MusicFactory · lib'
  )
  assert.equal(
    ownerLabel('C:/Users/me/AppData/Local/Android/Sdk/system-images/android-37.1/x86_64'),
    'Android · x86_64'
  )
  assert.equal(ownerLabel('C:/Users/me/AppData/Roaming/megaload-desktop/engine'), 'megaload-desktop · engine')
})

test('주인과 마지막 칸이 같으면 한 번만 쓴다 — "MusicFactory · MusicFactory"는 안 된다', () => {
  assert.equal(ownerLabel('C:/Users/me/AppData/Local/MusicFactory'), 'MusicFactory')
})

test('사용자 폴더 바로 아래도 주인으로 본다', () => {
  assert.equal(ownerLabel('C:/Users/me/GVF-ComfyUI/models/checkpoints'), 'GVF-ComfyUI · checkpoints')
})
