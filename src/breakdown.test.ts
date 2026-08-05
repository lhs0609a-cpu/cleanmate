/**
 * 묶음 해부 테스트
 *
 * ★ 이 숫자가 틀리면 사용자가 잘못된 근거로 파일을 지운다.
 *   "어디에 있나"가 틀리면 어떤 프로그램 것인지 오판하고,
 *   "얼마나 오래됐나"가 틀리면 "오래된 자료"라는 말 자체가 거짓이 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  folderOf, groupByFolder, groupByExt, ageSpan, buildBreakdown, fmt,
} from './breakdown.ts'

const BS = String.fromCharCode(92)
const p = (...seg: string[]) => seg.join(BS)
const item = (path: string, size: number, ageDays?: number) => ({ path, size, ageDays })

test('경로에서 폴더만 뽑는다', () => {
  assert.equal(folderOf(p('C:', 'a', 'b', 'c.txt')), p('C:', 'a', 'b'))
  assert.equal(folderOf('/home/me/x.log'), '/home/me')
})

test('★ 깊은 경로를 읽을 수 있는 깊이에서 묶는다', () => {
  // 12만 개 경로를 그대로 늘어놓으면 목록이 12만 줄이 된다.
  const items = Array.from({ length: 5 }, (_, i) =>
    item(p('C:', 'Users', 'me', 'AppData', 'Local', 'Google', 'Chrome', `f${i}.tmp`), 100))
  const g = groupByFolder(items, 4)
  assert.equal(g.length, 1, '같은 조상으로 묶여야 한다')
  assert.equal(g[0].key, p('C:', 'Users', 'me', 'AppData'))
  assert.equal(g[0].count, 5)
  assert.equal(g[0].bytes, 500)
})

test('폴더 묶음은 용량 큰 순 — 목록 위에서부터 중요한 게 보여야 한다', () => {
  const g = groupByFolder([
    item(p('C:', 'a', 'x.bin'), 10),
    item(p('C:', 'b', 'y.bin'), 900),
  ], 2)
  assert.deepEqual(g.map((x) => x.key), [p('C:', 'b'), p('C:', 'a')])
})

test('확장자별로 묶고, 확장자가 없으면 그렇게 표시한다', () => {
  const g = groupByExt([
    item('a.LOG', 10), item('b.log', 20), item('noext', 5),
  ])
  const byKey = Object.fromEntries(g.map((x) => [x.key, x]))
  assert.equal(byKey['.log'].count, 2, '대소문자를 구분하면 같은 종류가 갈라진다')
  assert.equal(byKey['(확장자 없음)'].count, 1)
})

test('★ "오래됐다"는 말에 근거를 붙인다', () => {
  const a = ageSpan([item('a', 1, 400), item('b', 1, 30), item('c', 1, 800)])!
  assert.equal(a.oldestDays, 800)
  assert.equal(a.newestDays, 30)
  assert.equal(a.overYearPercent, 67, '1년 넘은 비율이 근거다')
})

test('나이 정보가 없으면 없다고 한다 — 지어내지 않는다', () => {
  assert.equal(ageSpan([item('a', 1)]), null)
})

test('해부 결과에 목록·분포·나이가 함께 담긴다', () => {
  const items = [
    item(p('C:', 'Users', 'me', 'Downloads', 'big.zip'), 5_000_000, 400),
    item(p('C:', 'Users', 'me', 'Downloads', 'small.txt'), 1_000, 10),
  ]
  const b = buildBreakdown(items)
  assert.equal(b.count, 2)
  assert.equal(b.bytes, 5_001_000)
  assert.equal(b.samples[0].path.endsWith('big.zip'), true, '큰 것부터 보여준다')
  assert.ok(b.folders.length && b.exts.length && b.age)
})

test('크기 표기는 한 곳에서만 만든다 — 화면과 엔진이 달라지면 안 된다', () => {
  assert.equal(fmt(1024 ** 3 * 2.5), '2.5GB')
  assert.equal(fmt(1024 ** 2 * 7), '7MB')
  assert.equal(fmt(2048), '2KB')
})
