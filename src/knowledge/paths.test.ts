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

test('★ 윈도우 폴더 바로 아래 파일도 잠근다 — 하위 폴더만 보면 뚫린다', () => {
  /* 실측(2026-08-19): win.system이 system32·boot·fonts '하위'만 봐서
     C:/Windows/explorer.exe가 AMBIG였다. 조작된 목록으로 지우게 해봤더니
     잠금에 안 걸렸고, 막아준 건 TOCTOU 검사였다 — 그건 우연한 방어지
     설계된 방어가 아니다. 값을 맞춰 넣으면 통과한다. */
  expectZone('C:/Windows/explorer.exe', 'LOCKED', '로그인 셸')
  expectZone('C:/Windows/notepad.exe', 'LOCKED', '윈도우 기본 프로그램')
  expectZone('C:/Windows/regedit.exe', 'LOCKED', '레지스트리 편집기')
})

test('★ 그렇다고 Windows\Temp까지 잠그지 않는다 — 규칙을 넓히다 정리할 것을 막으면 안 된다', () => {
  // 루트 '파일'만 잠근다. 하위 폴더는 원래 규칙들이 그대로 판단한다.
  expectZone('C:/Windows/Temp/x.tmp', 'SAFE', '임시 파일')
  expectZone('C:/Windows/Logs/CBS/CBS.log', 'SAFE', '로그')
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

/* ────────────────────────────────────────────────────────────
   점 하나 때문에 37.6GB를 못 봤다 (2026-08-18, 실측)

   실물 경로:
     AppData/Local/MusicFactory/ACE-Step-1.5/.cache/acestep/tmp/api_audio/*.wav
   여기 WAV 633개(37.6GB)가 7월부터 쌓여 있었다. 작업 폴더의 gen.src.wav와
   SHA-256까지 같은 완전 중복이었는데, app.cache 규칙이 /cache/만 봐서
   /.cache/는 안 걸렸다. 디스크가 99% 찬 PC에서 가장 확실한 한 방이
   "물어봐야 할 것" 285GB 더미에 묻혀 있었다.

   경로는 슬래시로 적는다 — normalizePath가 구분자를 정규화하므로 결과가 같고,
   역슬래시 이스케이프를 세다가 틀리는 일이 없다.
   ──────────────────────────────────────────────────────────── */

test('★ 앞에 점이 붙은 캐시 폴더도 캐시다 — .cache / .npm 은 관례다', () => {
  expectZone('C:/Users/me/AppData/Local/App/.cache/blob/x.bin', 'SAFE', '점 붙은 캐시')
  expectZone('C:/Users/me/AppData/Local/App/.caches/x.bin', 'SAFE', '복수형도')
  // 점 없는 원래 경우가 깨지지 않았는지도 같이 본다.
  expectZone('C:/Users/me/AppData/Local/App/Cache/x.bin', 'SAFE', '점 없는 캐시')
})

test('★ 앱이 자기 폴더에 판 tmp도 임시다 — Temp 두 곳만 보면 놓친다', () => {
  // 실물에서 37.6GB가 쌓여 있던 바로 그 자리.
  expectZone(
    'C:/Users/me/AppData/Local/MusicFactory/ACE-Step-1.5/.cache/acestep/tmp/api_audio/a.wav',
    'SAFE',
    '앱이 만든 임시 파일'
  )
  expectZone('C:/Users/me/AppData/Roaming/App/temp/y.dat', 'SAFE', 'Roaming 아래 temp')
})

test('★ 그래도 사람이 만든 tmp 폴더는 건드리지 않는다 — 규칙을 넓히다 삼키면 안 된다', () => {
  /* /tmp/를 무턱대고 SAFE로 잡으면 이런 게 "지워도 됩니다"가 된다.
     되돌릴 수 없는 손해라서, appdata 밖의 tmp는 여전히 물어봐야 한다. */
  const c1 = classifyOne(entry('D:/projects/myapp/tmp/작업본.psd'))
  assert.notEqual(c1.verdict.zone, 'SAFE', '사용자 폴더의 tmp를 자동 삭제 대상으로 본다')
  const c2 = classifyOne(entry('C:/Users/me/Documents/tmp/초안.docx'))
  assert.notEqual(c2.verdict.zone, 'SAFE', '문서 폴더의 tmp를 자동 삭제 대상으로 본다')
})

test('모르는 파일은 절대 SAFE로 추측하지 않는다 — R1 안전장치', () => {
  const c = classifyOne(entry('D:\\뭔가\\알수없는파일.xyz'))
  assert.equal(c.verdict.zone, 'AMBIG', '모르면 물어본다')
  assert.equal(c.verdict.ruleBacked, false, '추론이므로 자동 처리 자격 없음')
})

test('OneDrive는 로컬 삭제가 클라우드 삭제 — 잠근다', () => {
  expectZone('C:\\Users\\me\\OneDrive\\문서\\중요.docx', 'LOCKED', '양방향 동기화')
})
