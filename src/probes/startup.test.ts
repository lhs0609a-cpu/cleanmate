/**
 * 시작프로그램 판정 테스트
 *
 * 겨냥하는 것:
 *   1) 모르는 항목을 "꺼도 된다"고 넘겨짚지 않는가 (이 프로브의 존재 이유)
 *   2) 끄면 손해 보는 것(보안·동기화)을 제안하지 않는가
 *   3) 회사 이름으로 성격을 판단하지 않는가 (실측에서 잡은 오분류)
 *   4) 끄기/켜기 값이 작업관리자와 같은 형식인가 — 다르면 되돌리기가 깨진다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  judgeStartup, approvalBytes, scriptArgOf, fileLabel, shortLabel, signatureNote,
  withRo, withGa, withEun,
  type StartupEntry, type StartupIdentity,
} from './startup.ts'

const entry = (name: string, over: Partial<StartupEntry> = {}): StartupEntry => ({
  id: `hkcu-run|${name}`,
  name,
  command: '',
  source: 'hkcu-run',
  enabled: true,
  canToggle: true,
  ...over,
})

test('★ 모르는 항목은 끄자고 제안하지 않는다', () => {
  const v = judgeStartup(entry('GVF-Node'))
  assert.equal(v.suggestible, false)
  assert.equal(v.zone, 'AMBIG')
  /* ★ 여기서 "모르겠어요"라는 **문구**를 검사하고 있었다. 그게 문구를 고정시켰다 —
     정작 고쳐야 할 것은 "왜 모르는지, 그럼 뭘 할 수 있는지"를 안 말하는 것이었는데,
     테스트는 모른다고 말하기만 하면 통과시켰다.
     이제 원칙을 검사한다: 넘겨짚지 않되(suggestible=false),
     **끄기가 되돌릴 수 있다는 사실은 반드시 말한다**(사용자가 할 수 있는 게 있어야 한다). */
  assert.match(v.ifDisabled, /되돌릴 수 있습니다/, '모른다고만 하고 사용자를 세워두면 안 된다')
})

test('보안 프로그램은 잠근다', () => {
  for (const n of ['SecurityHealth', 'V3 Lite', '알약 실시간 감시']) {
    const v = judgeStartup(entry(n))
    assert.equal(v.zone, 'LOCKED', `${n}이 잠기지 않았다`)
    assert.equal(v.suggestible, false)
  }
})

test('★ 회사 이름이 아니라 역할로 나눈다 — AhnLab Safe Transaction은 백신이 아니다', () => {
  // 실측에서 'ahnlab'이 백신 규칙에 먼저 걸려 "끄면 보호가 안 됩니다"로 잘못 설명됐다.
  // 은행 사이트용 모듈이라 성격이 완전히 다르다.
  const v = judgeStartup(entry('AhnLab Safe Transaction Application'))
  assert.equal(v.meaning, '금융·공공기관 보안 모듈')
  assert.equal(v.zone, 'AMBIG')
  // 반대로 진짜 백신은 여전히 잠겨야 한다
  assert.equal(judgeStartup(entry('AhnLab V3 Lite')).zone, 'LOCKED')
})

test('클라우드 동기화는 보여주되 먼저 권하지 않는다', () => {
  for (const n of ['OneDrive', 'GoogleDriveFS', 'Dropbox']) {
    const v = judgeStartup(entry(n))
    assert.equal(v.suggestible, false, `${n}을 끄자고 제안했다`)
    assert.match(v.ifDisabled, /동기화/)
  }
})

test('메신저는 제안하되 알림을 못 받는다는 손해를 먼저 말한다', () => {
  const v = judgeStartup(entry('KakaoTalk'))
  assert.equal(v.suggestible, true)
  assert.match(v.ifDisabled, /알림을 못 받습니다/)
})

test('브라우저 자동 시작은 브라우저 자체와 구분한다', () => {
  const v = judgeStartup(entry('GoogleChromeAutoLaunch_2CF9AD0FE25C1CD4'))
  assert.equal(v.meaning, '브라우저 자동 시작')
  assert.equal(v.suggestible, true)
  assert.match(v.ifDisabled, /직접 열면/)
})

test('이미 꺼진 항목·못 끄는 항목은 제안하지 않는다', () => {
  assert.equal(judgeStartup(entry('KakaoTalk', { enabled: false })).suggestible, false)
  assert.equal(judgeStartup(entry('KakaoTalk', { canToggle: false })).suggestible, false)
})

test('이름이 애매해도 명령줄로 판단한다', () => {
  const v = judgeStartup(entry('ALNotify', { command: 'C:\\Program Files\\ESTsoft\\ALNotify.exe' }))
  assert.equal(v.meaning, '자동 업데이트 도우미')
})

test('★ 끄기 값은 작업관리자와 같은 형식이다 — 다르면 되돌리기가 깨진다', () => {
  const on = approvalBytes(true)
  assert.equal(on.length, 12)
  assert.equal(on[0], 2, '사용 = 첫 바이트 2')
  assert.ok(on.slice(1).every((b) => b === 0), '사용 상태에는 시각을 적지 않는다')

  const off = approvalBytes(false, Date.UTC(2026, 7, 3))
  assert.equal(off.length, 12)
  assert.equal(off[0], 3, '해제 = 첫 바이트 3')
  assert.ok(
    off.slice(4).some((b) => b !== 0),
    '해제 시각(FILETIME)이 들어가야 작업관리자가 같은 상태로 읽는다'
  )
  assert.ok(off.every((b) => Number.isInteger(b) && b >= 0 && b <= 255), '전부 유효한 바이트')
})

test('모든 판정에는 끄면 뭐가 달라지는지가 반드시 붙는다', () => {
  for (const n of ['OneDrive', 'KakaoTalk', 'SecurityHealth', '정체불명', 'Steam']) {
    const v = judgeStartup(entry(n))
    assert.ok(v.ifDisabled.length > 10, `${n}에 결과 설명이 없다`)
    assert.ok(v.meaning && v.reason)
  }
})

/* ══════════════════════════════════════════════════════════════
   "다 뭔지 모르겠다고 하면 어떻게 해" — 2026-08-21 실물

   목록의 절반이 "알 수 없는 시작프로그램 / 이게 뭔지 확실히 모르겠어요"였다.
   그런데 그 파일들은 자기 이름을 또박또박 적어두고 있었다:

     ShareX.lnk               → ShareX          (ShareX Team)
     메가로드글로벌 에이전트.lnk  → 메가로드글로벌 에이전트 (SellerOS)
     teraclean.exe            → TeraClean       (teraclean)   ← 우리 앱이다

   판정이 이름과 명령줄 **문자열만** 봤기 때문이다. 유명한 프로그램을 모른다고 하면
   나머지 판정도 못 믿는다. 모르는 것과 안 본 것은 다르다.
   ══════════════════════════════════════════════════════════════ */

const withId = (name: string, id: Partial<StartupIdentity>, over: Partial<StartupEntry> = {}) =>
  entry(name, {
    ...over,
    identity: { description: '', product: '', company: '', path: '', ...id },
  })

test('★ 실행 파일이 밝힌 신원을 쓴다 — ShareX를 "모르겠다"고 하지 않는다', () => {
  const v = judgeStartup(
    withId('ShareX.lnk', {
      description: 'ShareX',
      product: 'ShareX',
      company: 'ShareX Team',
      path: 'C:\\Program Files\\ShareX\\ShareX.exe',
    })
  )
  assert.equal(v.meaning, 'ShareX')
  assert.match(v.reason, /ShareX Team/, '만든 곳을 안 말한다 — 신뢰의 대부분이 거기 있다')
  assert.doesNotMatch(v.meaning, /알 수 없는/)
})

test('★ 우리 앱을 알아본다 — 자기 것만 모른다고 하는 제품은 못 믿는다', () => {
  const v = judgeStartup(
    withId('TeraClean', {
      description: 'TeraClean',
      company: 'teraclean',
      path: 'D:\\CleanMate\\teraclean.exe',
    })
  )
  assert.match(v.meaning, /테라클린/)
  assert.equal(v.suggestible, true, '우리가 뭘 하는지는 우리가 안다 — 끌지 물어볼 수 있어야 한다')
  assert.match(v.ifDisabled, /직접 열면/, '끄면 뭐가 달라지는지 정확히 말해야 한다')
})

test('★ 실행기의 신원을 그 항목의 신원으로 쓰지 않는다', () => {
  /* 실측: "Microsoft Corporation가 만든 Windows Command Processor"(= cmd.exe),
     "Python Software Foundation가 만든 Python". 전부 사용자가 만든 스크립트인데
     실행기의 이름표를 붙였다. 신뢰를 쌓는 게 아니라 깎는다. */
  const v = judgeStartup(
    withId('MusicFactoryAgent', {
      description: 'Windows Command Processor',
      company: 'Microsoft Corporation',
      path: 'C:\\Windows\\system32\\cmd.exe',
    }, { command: '"C:\\Windows\\system32\\cmd.exe" /c start "" /min /d "C:\\X" "C:\\X\\mfa.exe" run' })
  )
  assert.doesNotMatch(v.reason, /Microsoft/, '사용자 스크립트를 마이크로소프트가 만들었다고 한다')
  assert.match(v.reason, /mfa\.exe/, '무엇이 실행되는지를 안 보여준다')
})

test('★ start의 빈 제목("")에 속지 않는다 — 폴더를 실행 파일로 오해하면 안 된다', () => {
  /* cmd /c start "" /min /d "폴더" "진짜.exe" 에서 첫 따옴표 쌍은 start의 빈 제목이다.
     "따옴표로 묶인 첫 인자"를 고르면 " /min /d "가 잡혔다(실측). */
  const got = scriptArgOf(
    '"C:\\Windows\\system32\\cmd.exe" /c start "" /min /d "C:\\Users\\me\\App" "C:\\Users\\me\\App\\real.exe" run',
    'C:\\Windows\\system32\\cmd.exe'
  )
  assert.equal(got, 'C:\\Users\\me\\App\\real.exe')
})

test('★ 폴더 없이 이름만 적힌 실행기도 떼어낸다', () => {
  // 'wscript.exe "...\\x.vbs"' — 안 떼면 wscript.exe 자신이 "실행되는 파일"이 된다.
  const got = scriptArgOf('wscript.exe "C:\\Users\\me\.agent\\launch.vbs"', 'C:\\WINDOWS\\system32\\wscript.exe')
  assert.equal(got, 'C:\\Users\\me\.agent\\launch.vbs')
})

test('★ 런타임으로 포장된 exe를 "런타임이 만든 것"이라고 하지 않는다', () => {
  /* 실측: 당근PT-폰브리지.exe 의 회사가 "Node.js"였다. Node로 exe를 만들면
     런타임의 버전 정보가 그대로 박히기 때문이다. 만든 건 이 사용자다. */
  const v = judgeStartup(
    withId('DanggeunPtPhoneBridge', {
      description: 'Node.js JavaScript Runtime',
      company: 'Node.js',
      path: 'D:\\dev\\dist\\당근PT-폰브리지.exe',
    })
  )
  assert.equal(v.meaning, '당근PT-폰브리지', '런타임 이름을 항목 이름으로 쓴다')
  assert.match(v.reason, /만든 곳은 알 수 없어요/, '런타임을 제작사로 둔갑시킨다')
})

test('★ 신원이 하나도 없어도 "모릅니다"로 끝내지 않는다 — 본 것은 말한다', () => {
  const v = judgeStartup(
    withId('Ollama.lnk', { path: 'C:\\Users\\me\\Programs\\Ollama\\ollama app.exe' })
  )
  assert.match(v.reason, /ollama app/, '파일 이름조차 안 말한다')
  assert.match(v.reason, /Ollama/, '폴더 이름조차 안 말한다')
  assert.match(v.reason, /이름은 누구나 붙일 수 있으니/, '이름을 확인된 신원처럼 말하면 안 된다')
})

test('★ 끄기가 되돌릴 수 있다는 사실을 모르는 항목에서 반드시 말한다', () => {
  /* "모르겠으니 손대지 마세요"로 끝내면 사용자가 할 수 있는 게 없다.
     시작프로그램 끄기는 완전히 되돌릴 수 있다 — 그게 이 화면의 전제다. */
  const v = judgeStartup(withId('AdPT-Agent', { path: 'C:\\X\\AdPT-Agent-Windows.exe' }))
  assert.match(v.ifDisabled, /되돌릴 수 있습니다/)
})

test('★ 따옴표가 이름에 붙지 않는다', () => {
  // 실측에서 'AdPT-Agent-Windows.exe"' 가 꼬리표로 떴다.
  assert.equal(fileLabel('"C:\\X\\AdPT-Agent-Windows.exe"'), 'AdPT-Agent-Windows')
})

test('★ 꼬리표가 문단이 되지 않는다', () => {
  /* 실측: FileDescription이 "메가로드 도우미 — 로컬 실행 프로그램(썸네일 GPU·광고
     자동화·향후 추가)을 모듈로 통합한 단일 Electron 데스크탑 앱."이었다. */
  const long = '메가로드 도우미 — 로컬 실행 프로그램(썸네일 GPU·광고 자동화·향후 추가)을 모듈로 통합한 단일 Electron 데스크탑 앱.'
  const label = shortLabel({ description: long, product: 'MegaloadDesktop', company: 'Megaload', path: '' })
  assert.equal(label, 'MegaloadDesktop', '설명이 길면 제품 이름으로 넘어가야 한다')
  assert.ok(shortLabel({ description: long, product: '', company: '', path: '' }).length <= 40)
})

test('★ 조사를 받침에 맞춘다 — 한 글자가 틀리면 문장 전체가 기계 티가 난다', () => {
  // 실측에서 "파이썬로", "파이썬가", "Node.js은"이 나왔다.
  assert.equal(withRo('파이썬'), '파이썬으로')
  assert.equal(withRo('명령 프롬프트'), '명령 프롬프트로')
  assert.equal(withRo('파워셸'), '파워셸로', 'ㄹ받침은 "로"다')
  assert.equal(withGa('파이썬'), '파이썬이')
  assert.equal(withGa('명령 프롬프트'), '명령 프롬프트가')
  assert.equal(withEun('Node.js'), 'Node.js는', '영문 끝은 받침 없음으로 읽는다')
})

test('★ 아직 안 본 서명을 "없다"고 하지 않는다', () => {
  /* 서명 확인은 느려서 나중에 채워진다(실측 21개 5.5초). 채워지기 전에
     "디지털 서명은 없어요"라고 쓰면, 서명된 프로그램을 서명 없다고 말하는 셈이다. */
  assert.equal(signatureNote({ description: 'X', product: '', company: '', path: '' }), '')
  assert.match(
    signatureNote({ description: 'X', product: '', company: '', path: '', signed: true, signer: 'Microsoft' }),
    /Microsoft/
  )
  assert.match(
    signatureNote({ description: 'X', product: '', company: '', path: '', signed: false }),
    /서명은 없어요/
  )
})
