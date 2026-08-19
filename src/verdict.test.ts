/**
 * 판정 사다리 — 빈칸 없이 답하되, 근거 없이 지우지 않는다
 *
 * 여기서 지키는 건 두 가지고 서로 반대 방향이다.
 *   ① 모든 파일에 답이 붙는다 — "모르겠어요"라는 칸이 없다
 *   ② 그렇다고 근거 없이 'delete'가 되지 않는다
 *
 * ②를 놓치면 19GB짜리 사고가 난다(repeats.ts 머리말 참조).
 * ①만 놓치면 236GB가 "여쭤보고 정합니다"에 묻힌다. 둘 다 지켜야 한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judge, summarize } from './verdict.ts'
import type { VerdictFile } from './verdict.ts'
import type { RepeatFamily } from './repeats.ts'

const file = (path: string, over: Partial<VerdictFile> = {}): VerdictFile => ({
  path,
  size: 1000,
  zone: 'AMBIG',
  ruleBacked: false,
  meaning: '무엇인지 더 봐야 하는 파일',
  ...over,
})

test('★ 모든 파일에 답이 붙는다 — "모르겠어요" 칸이 없다', () => {
  const v = judge({
    files: [
      file('C:/x/cache/a.bin', { zone: 'SAFE', ruleBacked: true }),
      file('C:/Windows/b.dll', { zone: 'LOCKED' }),
      file('C:/me/처음보는것.xyz'),
    ],
  })
  assert.equal(v.length, 3, '판정이 빠진 파일이 있다')
  assert.ok(v.every((x) => x.action && x.because), '판정이나 근거가 빈 파일이 있다')
  assert.deepEqual(v.map((x) => x.action), ['delete', 'keep', 'ask'])
})

test('★ 근거를 못 찾으면 delete가 아니라 ask다 — 모르는 걸 지우지 않는다', () => {
  const [v] = judge({ files: [file('D:/뭔가/알수없는파일.xyz')] })
  assert.equal(v.action, 'ask', '되살릴 근거가 없는데 지워도 된다고 했다')
  assert.equal(v.recovery, 'none')
  assert.match(v.because, /다시 만들 수 없/, '되살릴 수 없다는 사실을 안 말한다')
})

test('★ 잠금이 사다리 맨 위다 — 아래 근거가 아무리 강해도 시스템 파일은 안 지운다', () => {
  const [v] = judge({
    files: [file('C:/Windows/System32/x.dll', { zone: 'LOCKED' })],
    // 사본이 있다는 강한 근거를 줘도 판정이 바뀌면 안 된다
    copyOf: new Map([['C:/Windows/System32/x.dll', 'D:/backup/x.dll']]),
    backedUp: new Set(['C:/Windows/System32/x.dll']),
  })
  assert.equal(v.action, 'keep', '잠금보다 아래 근거가 이겼다')
})

test('규칙이 확증한 캐시는 물어보지 않고 지운다', () => {
  const [v] = judge({ files: [file('C:/x/cache/a.bin', { zone: 'SAFE', ruleBacked: true })] })
  assert.equal(v.action, 'delete')
  assert.equal(v.recovery, 'regenerates')
})

test('추론으로 SAFE가 된 것(ruleBacked=false)은 자동 삭제 대상이 아니다', () => {
  // classify.ts의 R1 안전장치와 같은 선. 규칙이 확증한 것만 자동이다.
  const [v] = judge({ files: [file('C:/x/y.bin', { zone: 'SAFE', ruleBacked: false })] })
  assert.notEqual(v.action, 'delete', '"아마 캐시일 것"을 지워도 된다고 했다')
})

test('내용이 같은 사본은 지워도 된다 — 원본이 남으니까', () => {
  const [v] = judge({
    files: [file('C:/a/copy.bin')],
    copyOf: new Map([['C:/a/copy.bin', 'C:/b/original.bin']]),
  })
  assert.equal(v.action, 'delete')
  assert.equal(v.recovery, 'copy-elsewhere')
  assert.match(v.because, /그쪽은 남습니다/)
})

test('★ 다시 빌드하면 되는 것은 "몰라요"가 아니라 "지워도 됨"이다', () => {
  /* 이 칸이 없어서 빌드 산출물 7.5GB와 node_modules 4.1GB가 "물어볼 것"에
     묻혀 있었다. 되살릴 수 있느냐(예)와 공짜냐(아니오)는 다른 질문이다. */
  const v = judge({
    files: [
      file('C:/proj/node_modules/x/index.js', { ruleId: 'dev.node_modules' }),
      file('C:/proj/dist/bundle.js', { ruleId: 'dev.build' }),
    ],
  })
  assert.ok(v.every((x) => x.action === 'delete'), '다시 만들 수 있는 걸 물어보고 있다')
  assert.ok(v.every((x) => x.recovery === 'rebuildable'))
  assert.ok(v.every((x) => x.effort === 'takes-time'), '공짜가 아니라는 걸 안 말한다')
  assert.match(v[0].because, /시간이 걸/, '품이 든다는 사실을 안 말한다')
})

test('★ 규칙이 확증한 것만 "다시 빌드하면 된다"고 한다 — 이름만 보고 넣지 않는다', () => {
  /* 경로에 build가 들어갔다고 넣으면 사람이 만든 build 폴더를 삼킨다.
     paths.ts가 id로 확증한 것만 이 갈래를 탄다. */
  const [v] = judge({ files: [file('D:/내작업/build/원본.psd')] }) // ruleId 없음
  assert.equal(v.action, 'ask', '규칙이 확증하지 않은 build 폴더를 지워도 된다고 했다')
})

test('되살리는 품이 판정마다 붙는다 — 순서를 매기려면 필요하다', () => {
  const v = judge({
    files: [
      file('C:/x/cache/a.bin', { zone: 'SAFE', ruleBacked: true }),
      file('C:/proj/dist/b.js', { ruleId: 'dev.build' }),
    ],
  })
  assert.equal(v[0].effort, 'free', '알아서 다시 생기는 것에 품이 든다고 했다')
  assert.equal(v[1].effort, 'takes-time')
})

/* ── 반복 구조와 엮이는 자리 ──────────────────────────────── */

function famWithShared(dirs: string[], rel: string, incomplete: string[] = []): RepeatFamily {
  return {
    parent: 'C:/app/work',
    dirs,
    count: dirs.length,
    totalBytes: 1,
    entries: [
      { rel, present: dirs.length, presence: 1, bytes: 1, avgSize: 1, ageRank: 0.5, role: 'shared', because: '' },
    ],
    incomplete,
  }
}

test('★ 폴더마다 복사된 것은 한 벌을 남긴다 — 233벌이 전부 사본이 되면 원본이 사라진다', () => {
  const dirs = ['C:/app/work/j1', 'C:/app/work/j2', 'C:/app/work/j3']
  const v = judge({
    files: dirs.map((d) => file(`${d}/subfonts/x.ttf`)),
    repeats: [famWithShared(dirs, 'subfonts/x.ttf')],
  })
  const del = v.filter((x) => x.action === 'delete')
  assert.equal(del.length, 2, `한 벌은 남아야 하는데 ${del.length}개만 지운다고 했다`)
  assert.ok(v.some((x) => x.action !== 'delete'), '원본으로 남길 것이 하나도 없다')
})

test('★ 미완성 작업 폴더는 어떤 근거가 걸려도 자동 삭제로 안 보낸다', () => {
  /* 실측에서 렌더링이 끊긴 폴더 6개가 여기 걸렸다. 거기 파일은 그 작업의
     유일한 흔적이라, 사본이 있다는 근거가 있어도 사람이 봐야 한다. */
  const dirs = ['C:/app/work/j1', 'C:/app/work/j2', 'C:/app/work/j3']
  const v = judge({
    files: [file('C:/app/work/j3/subfonts/x.ttf'), file('C:/app/work/j3/gen.wav')],
    repeats: [famWithShared(dirs, 'subfonts/x.ttf', ['C:/app/work/j3'])],
    copyOf: new Map([['C:/app/work/j3/gen.wav', 'C:/elsewhere/gen.wav']]),
  })
  assert.ok(v.every((x) => x.action === 'ask'), '미완성 폴더의 파일을 자동 삭제 대상으로 봤다')
  assert.match(v[0].because, /아직 안 끝난/, '왜 보호했는지 안 말한다')
})

test('★ 잠금은 미완성 보호보다도 위다 — 순서가 뒤집히면 안 된다', () => {
  const dirs = ['C:/app/work/j1', 'C:/app/work/j2', 'C:/app/work/j3']
  const [v] = judge({
    files: [file('C:/app/work/j3/sys.dll', { zone: 'LOCKED' })],
    repeats: [famWithShared(dirs, 'sys.dll', ['C:/app/work/j3'])],
  })
  assert.equal(v.action, 'keep')
})

test('클라우드에도 있으면 지워도 된다 — 그쪽에 남는다', () => {
  const [v] = judge({
    files: [file('C:/me/사진.jpg')],
    backedUp: new Set(['C:/me/사진.jpg']),
  })
  assert.equal(v.action, 'delete')
  assert.equal(v.recovery, 'backed-up')
})

/* ── 합계 ─────────────────────────────────────────────────── */

test('★ 합계가 전체와 맞는다 — 어디로 샌 바이트가 없어야 믿을 수 있다', () => {
  const v = judge({
    files: [
      file('C:/x/cache/a.bin', { zone: 'SAFE', ruleBacked: true, size: 100 }),
      file('C:/Windows/b.dll', { zone: 'LOCKED', size: 200 }),
      file('C:/me/c.xyz', { size: 300 }),
    ],
  })
  const s = summarize(v)
  assert.equal(s.total.bytes, 600)
  assert.equal(s.deletable.bytes + s.ask.bytes + s.keep.bytes, s.total.bytes, '바이트가 샜다')
  assert.equal(s.deletable.count + s.ask.count + s.keep.count, s.total.count, '개수가 샜다')
})

test('★ 하드링크된 파일을 두 번 세지 않는다 — 6.46GB가 38GB로 부푼 적이 있다', () => {
  /* 실측: sd_xl_base_1.0.safetensors 6.46GB가 6개 경로에 있었는데 전부 같은
     실물이었다. 그냥 더하면 38.76GB지만 디스크가 쓰는 건 6.46GB고, 하나를
     지워도 1바이트도 안 빈다. "38GB 지울 수 있어요"는 거짓말이 된다. */
  const v = judge({
    files: [
      file('C:/a/model.bin', { size: 1000, ino: 'vol:7' }),
      file('C:/b/model.bin', { size: 1000, ino: 'vol:7' }),
      file('C:/c/model.bin', { size: 1000, ino: 'vol:7' }),
      file('C:/d/other.bin', { size: 500 }),
    ],
  })
  const s = summarize(v)
  assert.equal(s.total.bytes, 1500, `같은 실물을 여러 번 셌다: ${s.total.bytes}`)
})

test('신원이 없으면(링크 하나) 그냥 더한다 — 대부분의 파일이 그렇다', () => {
  const v = judge({ files: [file('C:/a/x', { size: 100 }), file('C:/b/y', { size: 200 })] })
  assert.equal(summarize(v).total.bytes, 300)
})

test('합계는 근거별로 나눈다 — "왜 지워도 되는지"가 숫자마다 붙어야 한다', () => {
  const v = judge({
    files: [
      file('C:/x/cache/a.bin', { zone: 'SAFE', ruleBacked: true, size: 100 }),
      file('C:/a/copy.bin', { size: 50 }),
    ],
    copyOf: new Map([['C:/a/copy.bin', 'C:/b/orig.bin']]),
  })
  const s = summarize(v)
  assert.equal(s.deletable.byRecovery.length, 2, '근거별로 안 나눴다')
  assert.ok(s.deletable.byRecovery.every((g) => g.key && g.bytes > 0))
})
