/**
 * 엔진 인자 파싱 테스트
 *
 * ★ 이 테스트가 있었으면 "설치했는데 아무 기능도 안 되는" 릴리스가 안 나갔다.
 *   SEA exe의 argv 형태를 문서만 보고 짐작했고, 실제와 달랐다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgv } from './argv.ts'

const BS = String.fromCharCode(92)
const EXE = `D:${BS}CleanMate${BS}teraclean-engine.exe`
const NODE = `C:${BS}Program Files${BS}nodejs${BS}node.exe`

test('★ SEA exe — argv에 자기 경로가 두 번 들어온다', () => {
  assert.deepEqual(parseArgv([EXE, EXE, 'purge'], EXE), ['purge'])
  assert.deepEqual(parseArgv([EXE, EXE, 'scan-plan', 'C:/x'], EXE), ['scan-plan', 'C:/x'])
})

test('일반 node 실행 — 스크립트 경로를 건너뛴다', () => {
  assert.deepEqual(parseArgv([NODE, 'src/engine-cli.ts', 'purge'], NODE), ['purge'])
  assert.deepEqual(parseArgv([NODE, '/app/engine.cjs', 'quar-list'], NODE), ['quar-list'])
})

test('exe가 한 번만 오는 형태도 처리한다 — 런타임이 바뀌어도 명령을 잃지 않는다', () => {
  assert.deepEqual(parseArgv([EXE, 'purge'], EXE), ['purge'])
})

test('★ 명령 자리에 실행 파일 경로가 절대 들어가지 않는다', () => {
  for (const argv of [[EXE, EXE], [EXE], [NODE, 'src/engine-cli.ts']]) {
    const got = parseArgv(argv, argv[0])
    assert.ok(!got.some((a) => /\.(exe|ts|js|cjs|mjs)$/i.test(a)), `명령 자리가 오염됐다: ${got[0]}`)
  }
})

test('명령 뒤 인자에 경로가 있어도 그대로 넘긴다', () => {
  assert.deepEqual(parseArgv([EXE, EXE, 'relocate-plan', 'C:/a.ts', 'D:/'], EXE), [
    'relocate-plan',
    'C:/a.ts',
    'D:/',
  ])
})
