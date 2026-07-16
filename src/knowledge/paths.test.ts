/**
 * 경로 지식 DB 회귀 테스트
 *
 * 여기 있는 케이스는 전부 '실제로 겪었거나 리서치로 확인된 사고'다.
 * 오탐 하나가 신뢰를 통째로 깨뜨리므로(CleanMyMac 사례), 한 번 잡은
 * 오탐은 규칙으로 못 박고 테스트로 잠근다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyOne } from '../classify.ts'
import type { FileEntry, Zone } from '../types.ts'

function entry(path: string, sizeMB = 100, ageDays = 400): FileEntry {
  const now = Date.now()
  const mtime = new Date(now - ageDays * 86_400_000)
  return {
    path,
    size: sizeMB * 1024 * 1024,
    mtime,
    atime: mtime,
    ext: path.includes('.') ? path.slice(path.lastIndexOf('.')).toLowerCase() : '',
    ageDays,
  }
}

function expectZone(path: string, zone: Zone, why: string, sizeMB = 100) {
  const v = classifyOne(entry(path, sizeMB)).verdict
  assert.equal(v.zone, zone, `${why}\n  경로: ${path}\n  기대: ${zone}, 실제: ${v.zone} (${v.meaning})`)
}

test('구글 드라이브 캐시 함정 — 옮기거나 지우면 동기화가 깨진다', () => {
  // 프로토타입이 실제로 저지른 오탐. 26.5GB를 "옮길까요?"라고 제안했다.
  expectZone(
    'C:\\Users\\me\\AppData\\Local\\Google\\DriveFS\\117761046954044398816\\metadata_sqlite_db',
    'LOCKED',
    '드라이브 메타데이터 DB를 평범한 큰 파일로 보면 안 된다',
    7800
  )
  expectZone(
    'C:\\Users\\me\\AppData\\Local\\Google\\DriveFS\\1177\\mirror_metadata_sqlite.db',
    'LOCKED',
    '미러 메타데이터도 마찬가지',
    6000
  )
})

test('WSL/Docker 가상 디스크 — 옮기면 환경이 깨진다', () => {
  expectZone(
    'C:\\Users\\me\\AppData\\Local\\Packages\\CanonicalGroupLimited.Ubuntu\\LocalState\\ext4.vhdx',
    'LOCKED',
    'vhdx는 삭제·이동이 아니라 compact 대상',
    20000
  )
  expectZone(
    'C:\\Users\\me\\AppData\\Local\\Docker\\wsl\\data\\ext4.vhdx',
    'LOCKED',
    'Docker 가상 디스크',
    12000
  )
})

test('설치된 앱 안의 node_modules는 사용자 프로젝트가 아니다', () => {
  // 프로토타입 오탐: AppData\Local의 node_modules를 사용자 프로젝트로 오인했다.
  expectZone(
    'C:\\Users\\me\\AppData\\Local\\Programs\\some-app\\resources\\app\\node_modules\\react\\index.js',
    'LOCKED',
    '앱의 일부다. 지우면 프로그램이 깨진다'
  )
})

test('사용자 프로젝트의 node_modules는 물어볼 대상이다', () => {
  const c = classifyOne(entry('D:\\work\\my-project\\node_modules\\react\\index.js'))
  assert.equal(c.verdict.zone, 'AMBIG')
  assert.equal(c.verdict.unknown, 'U2_PROJECT_ACTIVE', '프로젝트 활성 여부가 결정적 미지수')
})

test('앱 설정은 캐시처럼 보여도 잠근다 — 오삭제의 실제 피해 벡터', () => {
  // [R] CleanMyMac이 Alfred 워크플로·설정을 날린 사례
  expectZone('C:\\Users\\me\\AppData\\Roaming\\SomeApp\\settings.json', 'LOCKED', '설정 손실')
  expectZone('/Users/me/Library/Application Support/Alfred/workflows/x.plist', 'LOCKED', '워크플로 손실')
})

test('시스템 팽창 범인은 파일 삭제가 아니라 전용 경로로', () => {
  expectZone('C:\\Windows\\WinSxS\\amd64_something\\file.dll', 'LOCKED', '수동 삭제 시 부팅 불능')
  expectZone('C:\\hiberfil.sys', 'LOCKED', 'powercfg로만 제거 가능', 6000)
  expectZone('C:\\Windows\\Installer\\1a2b3c.msp', 'LOCKED', '고아 msp라도 맹목 삭제 금지')
})

test('확실한 캐시만 존 A로 — 자동 처리 자격', () => {
  expectZone('C:\\Users\\me\\AppData\\Local\\Temp\\x.tmp', 'SAFE', '임시 파일')
  expectZone('C:\\Users\\me\\AppData\\Local\\Chrome\\User Data\\Default\\Cache\\f_001', 'SAFE', '브라우저 캐시')
  expectZone('C:\\Users\\me\\proj\\logs\\app.log', 'SAFE', '로그')
})

test('모르는 파일은 절대 SAFE로 추측하지 않는다 — R1 안전장치', () => {
  const c = classifyOne(entry('D:\\뭔가\\알수없는파일.xyz'))
  assert.equal(c.verdict.zone, 'AMBIG', '모르면 물어본다')
  assert.equal(c.verdict.ruleBacked, false, '추론이므로 자동 처리 자격 없음')
})

test('OneDrive는 로컬 삭제가 클라우드 삭제 — 잠근다', () => {
  expectZone('C:\\Users\\me\\OneDrive\\문서\\중요.docx', 'LOCKED', '양방향 동기화')
})
