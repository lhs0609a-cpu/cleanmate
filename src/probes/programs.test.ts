/**
 * 설치 프로그램 프로브 테스트
 *
 * 여기서 잠그는 건 "안 쓴 지 오래됐다"는 신호를 **함부로 믿지 않는 것**이다.
 * 백신은 화면에 안 떠도 돌고 있고, 런타임은 다른 앱이 부를 때만 쓴다.
 * "내가 안 열었다 = 안 쓴다"가 성립하지 않는 것들을 제안하면,
 * 사용자는 시킨 대로 지우고 시스템이 깨진다. 되돌릴 수도 없다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseRegQuery,
  parseInstallDate,
  daysSince,
  judgeProgram,
  uninstallCommandFor,
  silentUninstallCommand,
  needsElevation,
  isStillInstalled,
  rot13,
  filetimeToMs,
  parseUserAssist,
  matchRunRecord,
  normalizeName,
  estimateUsage,
  type ProgramUsage,
} from './programs.ts'

const DAY = 86_400_000

function usage(over: Partial<ProgramUsage> = {}): ProgramUsage {
  return {
    key: '{TEST}',
    name: '테스트 프로그램',
    uninstallString: '"C:\\Program Files\\Test\\uninstall.exe"',
    estimatedBytes: 500 * 1024 * 1024,
    lastUsedMs: Date.now() - 400 * DAY,
    unusedDays: 400,
    runCount: 5,
    source: 'userassist',
    evidence: '실행 기록 기준',
    ...over,
  }
}

/* ── 레지스트리 파싱 ────────────────────────────────────────── */

const SAMPLE = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{A1B2}
    DisplayName    REG_SZ    오래된 게임런처
    DisplayVersion    REG_SZ    2.1.0
    Publisher    REG_SZ    Example Corp
    InstallLocation    REG_SZ    C:\\Program Files\\Old Launcher
    UninstallString    REG_SZ    "C:\\Program Files\\Old Launcher\\uninst.exe"
    EstimatedSize    REG_DWORD    0x186a0
    InstallDate    REG_SZ    20240115

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{NONAME}
    DisplayVersion    REG_SZ    1.0.0

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{SYSCOMP}
    DisplayName    REG_SZ    숨은 시스템 조각
    SystemComponent    REG_DWORD    0x1

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{CHILD}
    DisplayName    REG_SZ    어떤 앱의 업데이트
    ParentKeyName    REG_SZ    {A1B2}
`

test('레지스트리 출력에서 프로그램을 뽑아낸다', () => {
  const list = parseRegQuery(SAMPLE)
  const 런처 = list.find((p) => p.name === '오래된 게임런처')
  assert.ok(런처, '이름 있는 항목은 잡혀야 한다')
  assert.equal(런처!.version, '2.1.0')
  assert.equal(런처!.publisher, 'Example Corp')
  assert.equal(런처!.installLocation, 'C:\\Program Files\\Old Launcher')
  assert.equal(런처!.estimatedBytes, 0x186a0 * 1024, 'EstimatedSize는 KB라 바이트로 환산해야 한다')
})

test('사용자에게 보여줄 게 아닌 항목은 걸러낸다', () => {
  const names = parseRegQuery(SAMPLE).map((p) => p.name)
  assert.ok(!names.includes(undefined as never), '이름 없는 항목 제외')
  assert.ok(!names.includes('숨은 시스템 조각'), 'SystemComponent 제외')
  assert.ok(!names.includes('어떤 앱의 업데이트'), '다른 앱의 하위 항목 제외')
  assert.equal(names.length, 1)
})

test('값에 공백이 있어도 끝까지 읽는다', () => {
  const list = parseRegQuery(SAMPLE)
  assert.equal(list[0].installLocation, 'C:\\Program Files\\Old Launcher')
})

test('설치일 파싱 — 형식이 아니면 null', () => {
  assert.equal(parseInstallDate('20240115'), Date.UTC(2024, 0, 15))
  assert.equal(parseInstallDate('2024-01-15'), null)
  assert.equal(parseInstallDate(''), null)
  assert.equal(parseInstallDate(undefined), null)
  assert.equal(parseInstallDate('20241399'), null, '말도 안 되는 월/일은 거절')
})

test('경과일은 음수가 되지 않는다', () => {
  const now = Date.now()
  assert.equal(daysSince(now + 10 * DAY, now), 0, '미래 시각이 와도 음수 금지')
  assert.equal(daysSince(now - 30 * DAY, now), 30)
})

/* ── 판정: 여기가 핵심 ──────────────────────────────────────── */

test('★보안 프로그램은 오래 안 열었어도 제안하지 않는다', () => {
  for (const name of ['알약 (ALYac)', 'V3 Lite', 'Windows Defender', 'Kaspersky Total Security', '안랩 V3']) {
    const v = judgeProgram(usage({ name, unusedDays: 900 }))
    assert.equal(v.suggestible, false, `제안하면 안 됨: ${name}`)
    assert.match(v.reason, /보안/)
  }
})

test('★런타임·드라이버는 제안하지 않는다 — 다른 프로그램이 부른다', () => {
  const names = [
    'Microsoft Visual C++ 2015-2022 Redistributable (x64)',
    '.NET Runtime 8.0.0',
    'Java 8 Update 411',
    'NVIDIA Graphics Driver',
    'Realtek High Definition Audio Driver',
    'Microsoft Edge WebView2 Runtime',
  ]
  for (const name of names) {
    assert.equal(judgeProgram(usage({ name, unusedDays: 900 })).suggestible, false, `제안하면 안 됨: ${name}`)
  }
})

test('★정식 제거 방법을 모르면 손대지 않는다', () => {
  const v = judgeProgram(usage({ uninstallString: undefined, unusedDays: 900 }))
  assert.equal(v.suggestible, false)
  assert.match(v.reason, /정식 제거 방법/)
})

test('★실행 기록이 없으면 제외한다 — "기록 없음"은 "안 쓴다"가 아니다', () => {
  // 실측에서 Git이 "12개월째 미사용"으로 잡혔다. 매일 쓰는 도구인데,
  // 터미널로만 실행해서 UserAssist에 안 남은 것이었다.
  // 설치 폴더 시각을 근거로 쓰면 이런 오탐이 계속 난다.
  const v = judgeProgram(usage({ lastUsedMs: null, unusedDays: null, source: 'none' }))
  assert.equal(v.suggestible, false)
  assert.match(v.reason, /실행 기록을 찾지 못해/)
})

test('★설치 폴더 시각만으로는 절대 제안하지 않는다', () => {
  // source가 userassist가 아니면 unusedDays가 아무리 커도 제안 금지.
  const v = judgeProgram(usage({ source: 'none', unusedDays: 3650 }))
  assert.equal(v.suggestible, false)
})

test('최근에 쓴 프로그램은 제안하지 않는다', () => {
  assert.equal(judgeProgram(usage({ unusedDays: 30 })).suggestible, false)
  assert.equal(judgeProgram(usage({ unusedDays: 179 })).suggestible, false, '문턱 바로 아래')
  assert.equal(judgeProgram(usage({ unusedDays: 180 })).suggestible, true, '문턱')
})

test('오래 안 쓴 평범한 프로그램은 제안하고, 근거를 함께 준다', () => {
  const v = judgeProgram(usage({ name: '오래된 게임런처', unusedDays: 400 }))
  assert.equal(v.suggestible, true)
  assert.match(v.reason, /개월째/, '몇 개월인지 말해준다')
  assert.match(v.reason, /실행 기록/, '무슨 근거로 그렇게 판단했는지 밝힌다')
})

/* ── 실행 기록(UserAssist) 파싱 ─────────────────────────────── */

test('ROT13 복호화 — 왕복하면 원래대로', () => {
  assert.equal(rot13('Uryyb'), 'Hello')
  assert.equal(rot13(rot13('C:\\Program Files\\Git\\git.exe')), 'C:\\Program Files\\Git\\git.exe')
  assert.equal(rot13('카카오톡.lnk'), '카카오톡.yax', '한글은 그대로 두고 영문만 돌린다')
})

test('FILETIME 변환 — 말도 안 되는 값은 거절', () => {
  const 알려진값 = 133000000000000000n // 2022년 무렵
  const ms = filetimeToMs(알려진값)
  assert.ok(ms && new Date(ms).getUTCFullYear() === 2022)
  assert.equal(filetimeToMs(0n), null, '0은 실행 기록 없음')
  assert.equal(filetimeToMs(-1n), null)
  assert.equal(filetimeToMs(1n), null, '1601년 값은 깨진 것으로 본다')
})

test('UserAssist 출력에서 실행 기록을 뽑는다', () => {
  // 실행횟수 3, 마지막 실행 시각이 offset 60에 들어간 72바이트 구조
  const buf = Buffer.alloc(72)
  buf.writeUInt32LE(3, 4)
  buf.writeBigUInt64LE(133000000000000000n, 60)
  const 인코딩된이름 = rot13('C:\\Program Files\\Old App\\app.exe')
  const out = `    ${인코딩된이름}    REG_BINARY    ${buf.toString('hex').toUpperCase()}\n`

  const recs = parseUserAssist(out)
  assert.equal(recs.length, 1)
  assert.equal(recs[0].path, 'C:\\Program Files\\Old App\\app.exe')
  assert.equal(recs[0].runCount, 3)
})

test('실행 시각이 없는 항목(0)은 기록으로 치지 않는다', () => {
  const buf = Buffer.alloc(72) // 전부 0 → lastRun 없음
  const out = `    ${rot13('C:\\X\\never.exe')}    REG_BINARY    ${buf.toString('hex')}\n`
  assert.equal(parseUserAssist(out).length, 0)
})

test('★.lnk 기록도 읽는다 — GUI 앱은 대부분 여기 남는다', () => {
  const buf = Buffer.alloc(72)
  buf.writeUInt32LE(1, 4)
  buf.writeBigUInt64LE(133000000000000000n, 60)
  const out = `    ${rot13('{GUID}\\Programs\\Steam.lnk')}    REG_BINARY    ${buf.toString('hex')}\n`
  assert.equal(parseUserAssist(out).length, 1, '.lnk를 버리면 시작메뉴 실행을 전부 놓친다')
})

test('이름 정규화 — 버전·연도·괄호를 떼고 비교한다', () => {
  assert.equal(normalizeName('Adobe Photoshop 2026'), normalizeName('Adobe Photoshop 2026.lnk'.replace('.lnk', '')))
  assert.equal(normalizeName('Notion 7.26.0'), normalizeName('Notion'))
  assert.equal(normalizeName('한컴오피스 한글 2010'), normalizeName('한컴오피스 한글'))
})

test('설치 폴더로 매칭한다', () => {
  const recs = [{ path: '{GUID}\\Old Launcher\\launch.exe', runCount: 2, lastRunMs: 1_700_000_000_000 }]
  const hit = matchRunRecord(
    { key: 'k', name: '오래된 게임런처', estimatedBytes: 0, installLocation: 'C:\\Program Files\\Old Launcher' },
    recs
  )
  assert.ok(hit, '설치 폴더명이 경로에 있으면 매칭돼야 한다')
})

test('바로가기 이름으로도 매칭한다', () => {
  const recs = [{ path: '{GUID}\\Programs\\Steam.lnk', runCount: 9, lastRunMs: 1_700_000_000_000 }]
  const hit = matchRunRecord({ key: 'k', name: 'Steam', estimatedBytes: 0 }, recs)
  assert.ok(hit, '설치 폴더 정보가 없어도 이름으로 이어져야 한다')
})

test('엉뚱한 프로그램에 남의 기록을 붙이지 않는다', () => {
  const recs = [{ path: '{GUID}\\Programs\\Steam.lnk', runCount: 9, lastRunMs: 1_700_000_000_000 }]
  assert.equal(matchRunRecord({ key: 'k', name: 'Photoshop', estimatedBytes: 0 }, recs), null)
})

test('기록이 없으면 source가 none이고 미사용일수를 만들어내지 않는다', () => {
  const u = estimateUsage({ key: 'k', name: 'Git', estimatedBytes: 0, installLocation: 'C:\\Program Files\\Git' }, [])
  assert.equal(u.source, 'none')
  assert.equal(u.unusedDays, null, '모르는 걸 숫자로 지어내면 안 된다')
})

test('★제거 명령은 등록된 언인스톨러 그대로다 — 파일 경로를 만들어내지 않는다', () => {
  const cmd = uninstallCommandFor({
    key: '{X}',
    name: 'X',
    estimatedBytes: 0,
    uninstallString: '"C:\\Program Files\\X\\uninst.exe" /S',
  })
  assert.equal(cmd, '"C:\\Program Files\\X\\uninst.exe" /S')

  // 없으면 만들어내지 않고 null을 준다. 임의 삭제 경로가 생기면 안 된다.
  assert.equal(
    uninstallCommandFor({ key: '{Y}', name: 'Y', estimatedBytes: 0, installLocation: 'C:\\Program Files\\Y' }),
    null
  )
})

/* ────────────────────────────────────────────────────────────
   앱 안에서 끝내는 제거 — 무엇을 '무인'으로 볼 것인가

   여기서 잠그는 건 **추측한 스위치를 남의 프로그램에 던지지 않는 것**이다.
   "/S 붙이면 대충 되더라"는 대부분 맞고 가끔 틀린다. 가끔 틀리면 마법사가
   그냥 열리거나(사용자는 우리가 멈춘 줄 안다) 인자가 파일명으로 해석된다.
   그래서 근거가 있는 두 가지만 통과시킨다.
   ──────────────────────────────────────────────────────────── */

const KEY_PATH = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{X}'

test('★제조사가 등록한 무인 명령이 있으면 그걸 쓴다', () => {
  assert.equal(
    silentUninstallCommand({
      key: '{X}', keyPath: KEY_PATH, name: 'X', estimatedBytes: 0,
      uninstallString: '"C:\\Program Files\\X\\unins000.exe"',
      quietUninstallString: '"C:\\Program Files\\X\\unins000.exe" /SILENT /NORESTART',
    }),
    '"C:\\Program Files\\X\\unins000.exe" /SILENT /NORESTART'
  )
})

test('★무인 스위치를 지어내지 않는다 — 등록돼 있지 않으면 null', () => {
  // /S를 붙이면 "대체로" 되지만 대체로는 근거가 아니다. 마법사로 보낸다.
  assert.equal(
    silentUninstallCommand({
      key: '{X}', keyPath: KEY_PATH, name: 'X', estimatedBytes: 0,
      uninstallString: '"C:\\Program Files\\X\\uninst.exe"',
    }),
    null
  )
})

test('MSI는 규격이라 /qn을 붙여도 된다 — 제품 코드로 대상이 확정된다', () => {
  const cmd = silentUninstallCommand({
    key: '{X}', keyPath: KEY_PATH, name: 'X', estimatedBytes: 0,
    uninstallString: 'MsiExec.exe /X{0FE30B5F-1234-4321-ABCD-0123456789AB}',
  })
  assert.equal(cmd, '"MsiExec.exe" /X{0FE30B5F-1234-4321-ABCD-0123456789AB} /qn /norestart')
  assert.match(cmd!, /\/norestart/, '우리가 사용자 컴퓨터를 재부팅시키지 않는다')
})

test('MSI 설치 명령(/I)도 제거(/X)로 바꿔 부른다', () => {
  assert.equal(
    silentUninstallCommand({
      key: '{X}', keyPath: KEY_PATH, name: 'X', estimatedBytes: 0,
      uninstallString: '"C:\\Windows\\System32\\msiexec.exe" /I {0FE30B5F-1234-4321-ABCD-0123456789AB}',
    }),
    '"C:\\Windows\\System32\\msiexec.exe" /X{0FE30B5F-1234-4321-ABCD-0123456789AB} /qn /norestart'
  )
})

test('★확인할 레지스트리 경로가 없으면 무인 제거를 제안하지 않는다', () => {
  // 끝났는지 물어볼 데가 없으면 "제거됐어요"라고 말할 근거도 없다.
  assert.equal(
    silentUninstallCommand({
      key: '{X}', name: 'X', estimatedBytes: 0,
      quietUninstallString: '"C:\\X\\unins000.exe" /SILENT',
    }),
    null
  )
})

test('★컴퓨터 전체에 설치된 것(HKLM)은 승격해서 부른다', () => {
  // msiexec은 권한이 없으면 UAC를 띄우지 않고 그냥 실패한다. 미리 알아야 한다.
  assert.equal(needsElevation({ key: '{X}', keyPath: KEY_PATH, name: 'X', estimatedBytes: 0 }), true)
})

test('내 계정에만 설치된 것(HKCU)은 괜히 UAC를 띄우지 않는다', () => {
  assert.equal(
    needsElevation({
      key: '{X}', name: 'X', estimatedBytes: 0,
      keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{X}',
    }),
    false
  )
})

test('★확인 조회는 제거 항목이 사는 곳 밖으로 나가지 않는다', async () => {
  await assert.rejects(
    () => isStillInstalled('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'),
    /레지스트리 경로/
  )
})

test('제거 명령 두 종류를 뭉개지 않고 따로 읽는다', () => {
  const [p] = parseRegQuery(
    'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{Z}\r\n' +
    '    DisplayName    REG_SZ    Z\r\n' +
    '    UninstallString    REG_SZ    "C:\\Z\\unins000.exe"\r\n' +
    '    QuietUninstallString    REG_SZ    "C:\\Z\\unins000.exe" /SILENT\r\n'
  )
  assert.equal(p.uninstallString, '"C:\\Z\\unins000.exe"', '마법사용 원시 명령')
  assert.equal(p.quietUninstallString, '"C:\\Z\\unins000.exe" /SILENT', '무인 명령')
  assert.equal(
    p.keyPath,
    'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{Z}',
    '끝났는지 확인하려면 전체 경로가 있어야 한다'
  )
})
