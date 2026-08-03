/**
 * 기본 스캔 대상 테스트
 *
 * 여기서 겨냥하는 건 하나다: **같은 파일을 두 번 세지 않는가.**
 * %TEMP%는 보통 AppData\Local\Temp라, 둘 다 목록에 넣으면 "정리 가능 용량"이
 * 부풀려진다. 삭제 도구가 용량을 부풀리면 그건 그냥 거짓말이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultRoots, dropNested, type PresetRoot } from './presets.ts'

const p = (path: string, label = path): PresetRoot => ({ label, path })

test('상위 폴더가 목록에 있으면 그 안쪽은 뺀다', () => {
  const got = dropNested([
    p('C:\\Users\\me\\AppData\\Local'),
    p('C:\\Users\\me\\AppData\\Local\\Temp'),
    p('C:\\Users\\me\\Downloads'),
  ])
  assert.deepEqual(got.map((r) => r.path), [
    'C:\\Users\\me\\AppData\\Local',
    'C:\\Users\\me\\Downloads',
  ])
})

test('대소문자·구분자가 달라도 같은 곳으로 본다 (윈도우 경로의 함정)', () => {
  const got = dropNested([p('C:\\Users\\Me\\AppData\\Local'), p('c:/users/me/appdata/local/temp')])
  assert.equal(got.length, 1)
})

test('이름만 비슷한 형제 폴더는 지우지 않는다', () => {
  // Local 과 LocalLow 는 별개다. startsWith만 보면 LocalLow가 지워진다.
  const got = dropNested([p('C:\\Users\\me\\AppData\\Local'), p('C:\\Users\\me\\AppData\\LocalLow')])
  assert.equal(got.length, 2)
})

test('완전히 같은 경로는 하나만 남는다', () => {
  const got = dropNested([p('C:\\Temp', '임시'), p('C:\\Temp', '임시 폴더')])
  assert.deepEqual(got.map((r) => r.label), ['임시'])
})

test('윈도우 기본 목록 — 사용자 폴더와 AppData를 훑고, %TEMP%는 흡수된다', () => {
  const roots = defaultRoots({
    platform: 'win32',
    home: 'C:\\Users\\me',
    temp: 'C:\\Users\\me\\AppData\\Local\\Temp',
  })
  const paths = roots.map((r) => r.path)
  assert.ok(paths.includes('C:\\Users\\me\\Downloads'))
  assert.ok(paths.includes('C:\\Users\\me\\AppData\\Local'))
  assert.ok(!paths.includes('C:\\Users\\me\\AppData\\Local\\Temp'), 'AppData\\Local에 이미 포함된다')
})

test('%TEMP%가 홈 밖에 있으면 따로 훑는다', () => {
  const roots = defaultRoots({ platform: 'win32', home: 'C:\\Users\\me', temp: 'D:\\Temp' })
  assert.ok(roots.some((r) => r.path === 'D:\\Temp'))
})

test('★ C:\\Windows 는 기본 목록에 없다 — 파일 삭제로 다룰 곳이 아니다', () => {
  const roots = defaultRoots({ platform: 'win32', home: 'C:\\Users\\me' })
  assert.ok(!roots.some((r) => /windows/i.test(r.path)))
})

test('맥에서는 맥 경로를 쓴다', () => {
  const roots = defaultRoots({ platform: 'darwin', home: '/Users/me' })
  assert.ok(roots.some((r) => r.path === '/Users/me/Library/Caches'))
  assert.ok(!roots.some((r) => r.path.includes('\\')))
})
