/**
 * 사진 정리 테스트
 *
 * 사진은 되돌릴 수 없는 개인 자산이다. 그래서 여기서 잠그는 건
 * "잘 찾는가"가 아니라 **"엉뚱한 걸 건드리지 않는가"**다.
 *   1) 사진을 스크린샷으로 오인하지 않는가
 *   2) 크기만 같은 다른 사진을 중복으로 몰지 않는가
 *   3) 원본을 치우고 사본을 남기지 않는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isPhoto,
  isScreenshot,
  groupBySize,
  contentHash,
  pickKeeper,
  buildDupGroups,
  planPhotos,
  SCREENSHOT_KEEP_DAYS,
  type PhotoFile,
} from './photos.ts'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 7, 3)

const f = (name: string, over: Partial<PhotoFile> = {}): PhotoFile => ({
  path: `C:\\Users\\me\\Pictures\\${name}`,
  name,
  size: 1024,
  mtimeMs: NOW - 30 * DAY,
  ...over,
})

/* ── 스크린샷 판별 ── */

test('여러 기기·언어의 스크린샷 이름을 알아본다', () => {
  for (const n of [
    'Screenshot 2026-08-03 121500.png',
    'Screen Shot 2026-08-03 at 12.15.00.png',
    '스크린샷 2026-08-03 121500.png',
    '화면 캡처 2026-08-03 121500.png',
    '캡처_001.png',
    'ShareX_2026.png',
    'clipboard1.png',
  ]) {
    assert.ok(isScreenshot(n), `${n}을 스크린샷으로 못 봤다`)
  }
})

test('★ 사진을 스크린샷으로 오인하지 않는다 — 오인하면 추억이 정리 폴더로 간다', () => {
  for (const n of [
    'IMG_4821.jpg',
    'DSC00123.JPG',
    '2026-07 제주도.jpg',
    '아이 첫걸음마.mp4',
    'screen-printing-poster.jpg', // 'screen'으로 시작하지만 스크린샷이 아니다
    '캡처본을 인쇄한 사진.jpg', // '캡처'가 들어가지만 앞이 아니다
  ]) {
    assert.equal(isScreenshot(n), false, `${n}을 스크린샷으로 잘못 봤다`)
  }
})

test('사진 확장자만 본다', () => {
  assert.ok(isPhoto('a.JPG') && isPhoto('b.heic') && isPhoto('c.mp4'))
  assert.equal(isPhoto('문서.pdf'), false)
  assert.equal(isPhoto('설치파일.exe'), false)
})

/* ── 중복 판정 ── */

test('크기가 같은 것만 후보로 좁힌다 (혼자면 중복일 수 없다)', () => {
  const groups = groupBySize([
    f('a.jpg', { size: 100 }),
    f('b.jpg', { size: 100 }),
    f('c.jpg', { size: 200 }),
    f('빈파일.jpg', { size: 0 }),
  ])
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].map((x) => x.name), ['a.jpg', 'b.jpg'])
})

test('★ 크기가 같아도 내용이 다르면 중복이 아니다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tc-photo-'))
  try {
    const p1 = join(dir, 'one.jpg')
    const p2 = join(dir, 'two.jpg')
    await writeFile(p1, 'A'.repeat(5000))
    await writeFile(p2, 'B'.repeat(5000)) // 크기는 같고 내용은 다르다
    const h1 = await contentHash(p1, 5000)
    const h2 = await contentHash(p2, 5000)
    assert.notEqual(h1, h2, '다른 사진을 같은 것으로 봤다 — 지우면 되돌릴 수 없다')

    const same = join(dir, 'one-copy.jpg')
    await writeFile(same, 'A'.repeat(5000))
    assert.equal(await contentHash(same, 5000), h1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('큰 파일도 앞뒤만 읽어 판정한다 (통째로 읽으면 수천 장에서 몇 분)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tc-photo-'))
  try {
    const size = 900 * 1024
    const a = join(dir, 'big-a.jpg')
    const b = join(dir, 'big-b.jpg')
    // 앞부분은 같고 꼬리가 다르다 — 꼬리를 안 읽으면 같은 파일로 오판한다
    await writeFile(a, Buffer.concat([Buffer.alloc(size - 10, 1), Buffer.from('AAAAAAAAAA')]))
    await writeFile(b, Buffer.concat([Buffer.alloc(size - 10, 1), Buffer.from('BBBBBBBBBB')]))
    assert.notEqual(await contentHash(a, size), await contentHash(b, size))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/* ── 무엇을 남길지 ── */

test('★ 사본 표시가 있는 쪽을 치운다 — 원본을 지우면 사고다', () => {
  const orig = f('여행.jpg', { mtimeMs: NOW - 10 * DAY })
  const copy = f('여행 (1).jpg', { mtimeMs: NOW - 20 * DAY }) // 사본이 더 오래됐어도
  const { keeper, reason } = pickKeeper([copy, orig])
  assert.equal(keeper.name, '여행.jpg')
  assert.match(reason, /사본 표시가 없어서/)
})

test('한글·영문 사본 표시를 모두 알아본다', () => {
  for (const copyName of ['사진 - 복사본.jpg', 'photo copy.jpg', 'photo (2).jpg', 'photo-copy2.jpg']) {
    const { keeper } = pickKeeper([f(copyName), f('photo.jpg', { mtimeMs: NOW - 1 * DAY })])
    assert.equal(keeper.name, 'photo.jpg', `${copyName}을 원본으로 골랐다`)
  }
})

test('표시가 없으면 가장 먼저 만들어진 것을 원본으로 본다', () => {
  const older = f('a.jpg', { mtimeMs: NOW - 50 * DAY })
  const newer = f('b.jpg', { mtimeMs: NOW - 5 * DAY })
  const { keeper, reason } = pickKeeper([newer, older])
  assert.equal(keeper.name, 'a.jpg')
  assert.match(reason, /먼저 만들어진/)
})

test('중복 그룹은 사본만 치우고 원본은 항상 남긴다', () => {
  const groups = buildDupGroups([
    { file: f('a.jpg', { size: 500, mtimeMs: NOW - 9 * DAY }), hash: 'h1' },
    { file: f('a (1).jpg', { size: 500 }), hash: 'h1' },
    { file: f('a (2).jpg', { size: 500 }), hash: 'h1' },
    { file: f('혼자.jpg'), hash: 'h2' },
  ])
  assert.equal(groups.length, 1, '혼자인 해시는 그룹이 아니다')
  assert.equal(groups[0].keeper.name, 'a.jpg')
  assert.equal(groups[0].copies.length, 2)
  assert.equal(groups[0].wastedBytes, 1000)
  assert.ok(!groups[0].copies.some((c) => c.path === groups[0].keeper.path), '원본이 사본 목록에 들어갔다')
})

/* ── 계획 ── */

test('최근 스크린샷은 아직 쓰는 중으로 본다', () => {
  const plan = planPhotos(
    [
      f('스크린샷 오래된.png', { mtimeMs: NOW - 60 * DAY }),
      f('스크린샷 어제.png', { mtimeMs: NOW - 1 * DAY }),
      f('IMG_1234.jpg', { mtimeMs: NOW - 60 * DAY }),
    ],
    [],
    { now: NOW }
  )
  assert.deepEqual(plan.oldScreenshots.map((s) => s.name), ['스크린샷 오래된.png'])
  assert.equal(plan.recentScreenshots, 1)
  assert.ok(plan.oldScreenshots.every((s) => isScreenshot(s.name)))
})

test('일반 사진은 옮길 목록에 절대 들어가지 않는다', () => {
  const photos = [f('IMG_1.jpg'), f('DSC_2.jpg'), f('가족사진.png')].map((p) => ({
    ...p,
    mtimeMs: NOW - 999 * DAY,
  }))
  const plan = planPhotos(photos, [], { now: NOW })
  assert.equal(plan.oldScreenshots.length, 0, '오래됐다고 사진을 치우면 안 된다')
  assert.equal(plan.screenshotBytes, 0)
})

test('보관 기간은 기본 14일', () => {
  assert.equal(SCREENSHOT_KEEP_DAYS, 14)
  const shot = f('스크린샷.png', { mtimeMs: NOW - 13 * DAY })
  assert.equal(planPhotos([shot], [], { now: NOW }).oldScreenshots.length, 0)
})
