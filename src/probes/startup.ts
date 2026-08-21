/**
 * 시작프로그램 프로브 — "끄기는 삭제가 아니다"
 *
 * 이 프로브가 이 제품과 특히 잘 맞는 이유: **완전히 되돌릴 수 있다.**
 * 윈도우는 시작프로그램의 사용/해제 상태를 항목 자체와 분리해서
 * StartupApproved 레지스트리에 따로 들고 있다. 끄는 건 그 값 하나를 쓰는 것이고,
 * 되살리는 것도 값 하나다. 원본(Run 값·바로가기 파일)은 손대지 않는다.
 * 격리도, 30일 유예도 필요 없다 — 되돌리기가 즉시니까.
 *
 * ── 그래서 존 A(자동 처리)를 만들지 않는다 ────────────────────
 * 되돌리기가 쉽다고 마음대로 꺼도 되는 건 아니다. 아침에 켰는데 카톡이
 * 안 떠 있으면 그건 사고다. 전부 존 B(물어봄) 아니면 존 C(잠금)로만 간다.
 * 우리가 자동으로 끄는 항목은 없다.
 *
 * ── 무엇을 못 하는지 ─────────────────────────────────────────
 * 1) HKLM(모든 사용자) 항목은 관리자 권한이 있어야 끌 수 있다. 이 앱은 최저
 *    권한으로 설치되므로(installer PrivilegesRequired=lowest) 보여만 준다.
 * 2) 로그온 예약작업(이 PC에 27개)도 마찬가지다 — 대부분 시스템 소유라
 *    권한이 필요하다. 개수만 알려주고 건드리지 않는다.
 * 3) 작업관리자의 "시작 영향(높음/중간/낮음)"은 윈도우 내부 데이터라 못 읽는다.
 *    그래서 부팅 기여 시간을 숫자로 지어내지 않는다. 모르면 모른다고 쓴다.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Zone } from '../types.ts'

const exec = promisify(execFile)

export type StartupSource = 'hkcu-run' | 'hklm-run' | 'startup-folder' | 'common-startup-folder'

/**
 * 실행 파일이 **스스로 밝히는** 신원.
 *
 * ★ 이걸 안 읽고 있었다(2026-08-21 실물). 목록의 절반이 "알 수 없는 시작프로그램 /
 *   이게 뭔지 확실히 모르겠어요"였는데, 정작 그 파일들은 자기 이름을 또박또박
 *   적어두고 있었다:
 *
 *     ShareX.lnk               → ShareX                    (ShareX Team)
 *     메가로드글로벌 에이전트.lnk  → 메가로드글로벌 에이전트        (SellerOS)
 *     teraclean.exe            → TeraClean                 (teraclean)  ← 우리 앱이다
 *
 *   판정이 이름과 명령줄 **문자열만** 보고 있었기 때문이다. 유명한 프로그램을
 *   "모르겠다"고 하면 나머지 판정도 못 믿는다. 모르는 것과 안 본 것은 다르다.
 */
export interface StartupIdentity {
  /** 파일 설명. 사람에게 보여줄 첫 번째 후보다. */
  description: string
  product: string
  /** 만든 곳. "누가 만들었나"가 신뢰의 대부분이다. */
  company: string
  /** 신원을 읽어낸 실행 파일. 인터프리터인지 판정하는 근거이기도 하다. */
  path: string
  /** 디지털 서명의 주체. **나중에** 채워진다(느려서 따로 받는다) — 없는 것과 안 본 것은 다르다. */
  signer?: string
  signed?: boolean
}

export interface StartupEntry {
  /** 토글에 쓰는 안정적 식별자. '<source>|<name>' */
  id: string
  name: string
  /** 실제로 실행되는 것 — 이름만으로는 정체를 알 수 없을 때의 근거 */
  command: string
  source: StartupSource
  enabled: boolean
  /** 우리 권한(관리자 아님)으로 켜고 끌 수 있나 */
  canToggle: boolean
  /** 실행 파일에서 읽어낸 신원. 못 읽었으면 없다(없는 것과 안 본 것은 다르다). */
  identity?: StartupIdentity
}

export interface StartupVerdict {
  zone: Zone
  /** 이게 뭔지 */
  meaning: string
  /** 이 판정의 근거 한 줄 */
  reason: string
  /** 끄자고 제안해도 되는가. 모르면 false — 넘겨짚지 않는다. */
  suggestible: boolean
  /** 끄면 뭐가 달라지나. 손해를 반드시 포함한다(양면 정직). */
  ifDisabled: string
}

interface StartupRule {
  test: RegExp
  zone: Zone
  meaning: string
  reason: string
  suggestible: boolean
  ifDisabled: string
}

/* ────────────────────────────────────────────────────────────
   판정 규칙 — 위에서부터 첫 매치가 이긴다. 잠금이 먼저.

   ★ 이름이 아니라 '역할'로 나눈다. 기준은 하나다:
     "이걸 안 켜두면 사용자가 손해를 보는가, 아니면 필요할 때 열면 되는가."
   ──────────────────────────────────────────────────────────── */
const RULES: StartupRule[] = [
  {
    /* ★ 백신 규칙보다 먼저 와야 한다(실측에서 잡은 오분류).
       "AhnLab Safe Transaction"은 백신이 아니라 은행 보안 모듈인데, 백신 규칙의
       'ahnlab'에 먼저 걸려서 '끄면 보호가 안 됩니다'로 잘못 설명됐다.
       같은 회사가 성격이 다른 프로그램을 만든다 — 회사 이름으로 나누면 틀린다. */
    test: /veraport|wizvera|safe ?transaction|initech|inisafe|touchen|delfino|astx|nprotect|xecure|magicline|공인인증|금융인증/i,
    zone: 'AMBIG',
    meaning: '금융·공공기관 보안 모듈',
    reason: '은행이나 공공기관 사이트를 열 때 쓰는 프로그램입니다. 평소에는 하는 일이 없습니다.',
    suggestible: true,
    ifDisabled:
      '은행·공공기관 사이트를 열 때 다시 실행됩니다. 그때 처음 한 번은 조금 느릴 수 있어요. ' +
      '인터넷뱅킹이 자주 필요하시면 그대로 두셔도 됩니다.',
  },
  {
    test: /안랩|ahnlab|alyac|알약|v3 ?lite|v3 ?365|defender|antivirus|백신|kaspersky|avast|norton|mcafee|bitdefender|eset|securityhealth/i,
    zone: 'LOCKED',
    meaning: '보안 프로그램',
    reason: '실시간 감시는 부팅 때 켜져야 의미가 있습니다. 화면에 안 떠도 계속 일합니다.',
    suggestible: false,
    ifDisabled: '컴퓨터를 켠 뒤 보호가 시작되지 않습니다. 그래서 아예 잠급니다.',
  },
  {
    test: /realtek|nvidia|amd |intel\(r\)|audio|graphics|driver|드라이버|touchpad|synaptics|elan|hotkey|fn key/i,
    zone: 'LOCKED',
    meaning: '하드웨어 도우미',
    reason: '소리·화면·키보드 기능이 이걸 통해 동작합니다.',
    suggestible: false,
    ifDisabled: '단축키나 소리 설정 같은 하드웨어 기능이 안 먹을 수 있습니다.',
  },
  {
    test: /ime|input method|한글 입력|입력기|magnify|narrator|접근성|accessibility/i,
    zone: 'LOCKED',
    meaning: '입력기·접근성',
    reason: '글자 입력이나 화면 읽기처럼 컴퓨터를 쓰는 수단 자체입니다.',
    suggestible: false,
    ifDisabled: '입력이나 접근성 기능을 못 쓰게 될 수 있습니다.',
  },
  {
    // 끌 수는 있지만 우리가 먼저 권하지는 않는다. 동기화가 멈춘 걸 모르면
    // "백업된 줄 알았는데 아니었다"가 되고, 그건 용량 문제와 비교가 안 되는 손해다.
    test: /onedrive|googledrive|google drive|drivefs|dropbox|icloud|mybox|naver ?cloud|megasync|sync/i,
    zone: 'AMBIG',
    meaning: '클라우드 동기화',
    reason: '켜져 있어야 파일이 자동으로 백업됩니다.',
    suggestible: false,
    ifDisabled:
      '자동 동기화가 멈춥니다. 파일을 고쳐도 클라우드에 안 올라가요 — 백업으로 쓰고 계시면 끄지 마세요.',
  },
  {
    // 브라우저가 "컴퓨터 켤 때 자동 실행"으로 등록해 둔 것. 브라우저 자체와 별개다 —
    // 꺼도 브라우저는 그대로 있고, 부팅 때 안 뜰 뿐이다.
    test: /chromeautolaunch|edgeautolaunch|whaleautolaunch|browserautolaunch|autolaunch_/i,
    zone: 'AMBIG',
    meaning: '브라우저 자동 시작',
    reason: '컴퓨터를 켜면 브라우저가 저절로 뜨게 하는 항목입니다. 브라우저 자체가 아닙니다.',
    suggestible: true,
    ifDisabled: '부팅할 때 브라우저가 자동으로 안 뜹니다. 직접 열면 즐겨찾기·로그인 전부 그대로예요.',
  },
  {
    test: /update|updater|업데이트|autoupdate|swupdate|jusched|java update|acrotray|adobe.*update|googleupdate|edgeupdate|alnotify|download assistant/i,
    zone: 'AMBIG',
    meaning: '자동 업데이트 도우미',
    reason: '프로그램 새 버전을 확인하려고 항상 떠 있습니다. 프로그램 자체는 아닙니다.',
    suggestible: true,
    ifDisabled:
      '새 버전 알림이 늦어집니다. 프로그램을 실행할 때 대부분 스스로 확인하니 큰 문제는 없어요.',
  },
  {
    test: /steam|epic ?games|battle\.?net|riot|origin|ubisoft|gog ?galaxy|nexon|런처|launcher/i,
    zone: 'AMBIG',
    meaning: '게임 런처',
    reason: '게임을 시작할 때 필요하지만, 그때 직접 열어도 됩니다.',
    suggestible: true,
    ifDisabled: '게임을 켤 때 런처가 먼저 뜨느라 몇 초 더 걸립니다. 게임은 그대로 됩니다.',
  },
  {
    test: /kakaotalk|카카오|discord|slack|telegram|line\.exe|messenger|notion|todoist|evernote|dropbox ?paper/i,
    zone: 'AMBIG',
    meaning: '메신저·노트 앱',
    reason: '항상 떠 있어야 알림을 받습니다. 알림이 필요 없으면 직접 열어도 됩니다.',
    suggestible: true,
    ifDisabled:
      '★ 새 메시지 알림을 못 받습니다. 대화를 놓치면 안 되는 앱이면 그대로 두세요. ' +
      '직접 열었을 때는 평소처럼 다 동작합니다.',
  },
  {
    test: /printer|scanner|프린터|스캐너|epson|canon|hp ?(smart|scan)|brother|smart ?print/i,
    zone: 'AMBIG',
    meaning: '프린터·스캐너 도우미',
    reason: '인쇄나 스캔을 할 때만 쓰는 보조 프로그램입니다.',
    suggestible: true,
    ifDisabled: '인쇄는 그대로 됩니다. 스캔 같은 부가 기능은 프로그램을 직접 열어야 할 수 있어요.',
  },
]

/**
 * 이 항목을 어떻게 다룰지 판정한다.
 *
 * ★ 모르면 제안하지 않는다. programs.ts와 같은 원칙 —
 *   "이게 뭔지 모른다"는 "꺼도 된다"가 아니다.
 */
/**
 * 다른 파일을 대신 실행해주는 것들. 이들의 신원은 그 항목의 신원이 아니다.
 * (electron.exe는 넣지 않는다 — 앱이 자기 이름으로 이름을 바꿔 쓰는 게 보통이다)
 */
const INTERPRETERS: Record<string, string> = {
  'cmd.exe': '명령 프롬프트',
  'powershell.exe': '파워셸',
  'pwsh.exe': '파워셸',
  'wscript.exe': '윈도우 스크립트 호스트',
  'cscript.exe': '윈도우 스크립트 호스트',
  'mshta.exe': 'HTML 응용프로그램 호스트',
  'rundll32.exe': 'rundll32',
  'python.exe': '파이썬',
  'pythonw.exe': '파이썬',
  'node.exe': 'Node.js',
  'java.exe': '자바',
  'javaw.exe': '자바',
}

/** 이 실행 파일이 '실행기'인가. 맞으면 사람이 부르는 이름을 준다. */
export function interpreterOf(path: string | undefined): string | null {
  if (!path) return null
  const base = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  return INTERPRETERS[base] ?? null
}

/**
 * 런타임으로 **포장된** 프로그램인가.
 *
 * ★ 실측: D:\\dev\\danggeun\\dist\\bridge\\당근PT-폰브리지.exe 의 버전 정보가
 *   "Node.js / Node.js JavaScript Runtime"이었다. Node로 exe를 만들면 런타임의
 *   버전 정보가 그대로 박히기 때문이다(파이썬·Electron도 같다).
 *   그걸 그대로 쓰면 "Node.js가 만든 프로그램"이 되는데, 만든 건 이 사용자다.
 *   이럴 땐 **파일 이름이 회사 이름보다 정확하다.**
 */
const RUNTIME_VENDORS = /^(node\.js|python software foundation|github, ?inc\.?|electron)$/i

export function packagedRuntimeOf(id: StartupIdentity | undefined): string | null {
  if (!id) return null
  const company = (id.company || '').trim()
  if (!RUNTIME_VENDORS.test(company)) return null
  // 런타임 그 자체(node.exe 등)라면 실행기 쪽에서 이미 다룬다.
  if (interpreterOf(id.path)) return null
  return company
}

/** 확장자를 뗀 파일 이름. 신원이 없을 때 남는 마지막 단서다. */
export function fileLabel(path: string | undefined): string {
  if (!path) return ''
  // ★ 따옴표를 먼저 벗긴다. 안 벗기면 'AdPT-Agent-Windows.exe"'가 이름이 된다(실측).
  const clean = path.trim().replace(/^"+|"+$/g, '')
  const base = clean.split(/[\\/]/).pop() ?? ''
  return base.replace(/^"+|"+$/g, '').replace(/\.(exe|lnk|vbs|bat|cmd|js|ps1|py)$/i, '')
}

/**
 * 한국어 조사를 받침에 맞춰 고른다.
 *
 * ★ 실측에서 "파이썬로 실행되는 항목", "파이썬가 다른 파일을", "Node.js은 만든 도구"가
 *   나왔다. 조사 하나가 틀리면 문장 전체가 기계가 쓴 것처럼 보이고, 그러면 내용도
 *   덜 믿게 된다. 한글이 아닌 끝(영문·숫자)은 받침 없음으로 친다 —
 *   "Node.js는", "ShareX는"이 한국어에서 실제로 읽히는 방식이다.
 */
function hasJong(word: string): boolean {
  const last = word.trim().slice(-1)
  const code = last.charCodeAt(0)
  if (code < 0xac00 || code > 0xd7a3) return false
  return (code - 0xac00) % 28 !== 0
}
/** 받침이 ㄹ이면 '로'를 쓴다: 파워셸로, 서울로 */
function hasRieul(word: string): boolean {
  const last = word.trim().slice(-1)
  const code = last.charCodeAt(0)
  if (code < 0xac00 || code > 0xd7a3) return false
  return (code - 0xac00) % 28 === 8
}
export const withRo = (w: string) => `${w}${hasJong(w) && !hasRieul(w) ? '으로' : '로'}`
export const withGa = (w: string) => `${w}${hasJong(w) ? '이' : '가'}`
export const withEun = (w: string) => `${w}${hasJong(w) ? '은' : '는'}`

/**
 * 실행기가 **무엇을** 실행하는지. 명령줄에서 실행기 뒤의 첫 파일 경로를 찾는다.
 * 못 찾으면 빈 문자열 — 지어내지 않는다.
 */
const RUNNABLE = /\.(exe|vbs|vbe|js|jse|wsf|bat|cmd|ps1|py|pyw|jar|hta|lnk)$/i

export function scriptArgOf(command: string, exePath: string): string {
  if (!command) return ''
  let rest = command.trim()
  // 앞의 실행기 경로를 떼어낸다(따옴표가 있든 없든).
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1)
    if (end > 0) rest = rest.slice(end + 1)
  } else if (exePath && rest.toLowerCase().startsWith(exePath.toLowerCase())) {
    rest = rest.slice(exePath.length)
  } else {
    /* ★ 'wscript.exe "...\x.vbs"' 처럼 폴더 없이 이름만 적힌 경우.
       앞을 안 떼면 wscript.exe 자신이 "실행되는 파일"로 잡힌다(실측). */
    const base = exePath.split(/[\\/]/).pop()?.toLowerCase() ?? ''
    const first = rest.split(/\s+/)[0]?.toLowerCase() ?? ''
    if (base && first === base) rest = rest.slice(first.length)
  }

  /* ★ "따옴표로 묶인 첫 인자"를 고르면 안 된다(실측):
       cmd.exe /c start "" /min /d "C:\\...\\MusicFactory" "C:\\...\\mfa.exe" run
     여기서 첫 따옴표 쌍은 start의 빈 제목 ""이라, 그 뒤 따옴표까지 이어 붙어
     " /min /d "가 잡혔다. 게다가 /d 뒤의 것은 **폴더**지 실행되는 파일이 아니다.
     그러니 따옴표 여부가 아니라 **실행할 수 있는 확장자인가**로 고른다. */
  const tokens: string[] = []
  for (const m of rest.matchAll(/"([^"]*)"|(\S+)/g)) tokens.push(m[1] ?? m[2] ?? '')
  for (const tok of tokens) {
    if (!tok || tok.startsWith('-')) continue
    if (RUNNABLE.test(tok)) return tok
  }
  return ''
}

/**
 * 화면의 꼬리표로 쓸 짧은 이름.
 *
 * ★ FileDescription이 문단인 경우가 있다(실측: "메가로드 도우미 — 로컬 실행
 *   프로그램(썸네일 GPU·광고 자동화·향후 추가)을 모듈로 통합한 단일 Electron
 *   데스크탑 앱."). 그걸 꼬리표에 그대로 넣으면 목록이 무너진다.
 *   길면 ProductName으로 넘어가고, 그것도 길면 자른다.
 */
export function shortLabel(id: StartupIdentity | undefined): string {
  if (!id) return ''
  const desc = (id.description || '').trim()
  const prod = (id.product || '').trim()
  const pick = desc && desc.length <= 40 ? desc : prod || desc
  return pick.length > 40 ? pick.slice(0, 39) + '…' : pick
}

/**
 * 서명에 대해 할 말. **아직 안 봤으면 없다고 하지 않는다.**
 * 서명 확인은 느려서 나중에 채워지므로, 그 전에는 아무 말도 하지 않는 게 맞다.
 */
export function signatureNote(id: StartupIdentity | undefined): string {
  if (!id || id.signed === undefined) return ''
  if (id.signed && id.signer) return `${id.signer} 이름으로 서명돼 있어요.`
  return '디지털 서명은 없어요 — 서명이 없다고 나쁜 건 아니지만, 만든 곳을 확인할 방법도 없다는 뜻입니다.'
}

/**
 * 조각을 문장으로 잇는다. **빈 조각은 통째로 뺀다.**
 * 서명처럼 "아직 안 본 것"은 빈 문자열로 오는데, 그냥 이어붙이면
 * "알 수 없어요.  그래서"처럼 공백이 두 칸 생긴다 — 사람이 안 쓴 티가 난다.
 */
function sentence(parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).map((p) => String(p).trim()).filter(Boolean).join(' ')
}

export function judgeStartup(e: StartupEntry): StartupVerdict {
  const hay = `${e.name} ${e.command}`
  for (const r of RULES) {
    if (!r.test.test(hay)) continue
    return {
      zone: r.zone,
      meaning: r.meaning,
      reason: r.reason,
      // 이미 꺼져 있거나 우리가 못 끄는 건 제안하지 않는다
      suggestible: r.suggestible && e.enabled && e.canToggle,
      ifDisabled: r.ifDisabled,
    }
  }

  const id = e.identity
  const what = shortLabel(id)
  const who = (id?.company || '').trim()

  /* ★ 인터프리터의 신원은 그 항목의 신원이 아니다.
     실측에서 이렇게 나왔다:
       MusicFactoryAgent      → "Microsoft Corporation가 만든 Windows Command Processor"
       GVF-Node               → "Python Software Foundation가 만든 Python"
       DanggeunPtPhoneBridge  → "Node.js가 만든 Node.js JavaScript Runtime"
     전부 cmd·파이썬·Node가 **다른 파일을 실행**하는 항목인데, 실행기의 이름표를
     그 항목의 신원으로 붙였다. 사용자가 만든 스크립트에 "Microsoft가 만들었다"고
     쓰는 건 신뢰를 쌓는 게 아니라 깎는다. 무엇을 실행하는지를 말해야 한다. */
  const host = interpreterOf(id?.path)
  if (host) {
    const script = scriptArgOf(e.command, id?.path ?? '')
    return {
      zone: 'AMBIG',
      meaning: `${withRo(host)} 실행되는 항목`,
      reason: sentence([
        `${withGa(host)} **다른 파일을 실행**하는 항목이에요.`,
        script
          ? `무엇을 하는지는 ${withGa(host)} 아니라 실행되는 파일에 달려 있습니다: ${script}`
          : '무엇을 하는지는 실행되는 파일에 달려 있는데, 그 파일을 못 찾았습니다.',
        '그래서 끄자고 제안하지 않습니다.',
      ]),
      suggestible: false,
      ifDisabled:
        '끄면 무엇이 달라지는지는 저희가 몰라요. 다만 **끄기는 되돌릴 수 있습니다** — ' +
        '켤 때 따라 나오지 않을 뿐이라, 이상하면 다시 켜면 됩니다.',
    }
  }

  /* ★ 우리 자신은 알아본다.
     "이게 뭔지 확실히 모르겠어요"를 우리 앱에 대고 쓰고 있었다. 우리가 뭘 하는지는
     우리가 제일 잘 안다 — 그러니 여기서만큼은 끄면 뭐가 달라지는지도 정확히 말하고,
     끄자고 제안도 한다. 자기 것만 예외로 두는 제품은 못 믿는다. */
  if (/teraclean|테라클린/i.test(`${what} ${who} ${e.name} ${e.command}`)) {
    return {
      zone: 'AMBIG',
      meaning: '테라클린 (저희 프로그램)',
      reason: '컴퓨터를 켤 때 트레이에 조용히 떠서, 정리할 때가 되면 알려드리려고 등록돼 있어요.',
      suggestible: e.enabled && e.canToggle,
      ifDisabled:
        '켤 때 자동으로 안 뜹니다. 정리할 때가 됐다는 알림을 못 받고, 대신 직접 열면 ' +
        '평소처럼 전부 그대로 동작해요.',
    }
  }

  /* 규칙에 없더라도 **파일이 자기 이름을 밝히면 그건 아는 것이다.**
     다만 "이게 뭐냐"를 아는 것과 "꺼도 되냐"를 아는 것은 다르다.
     그래서 신원은 말하되 끄자고 제안하지는 않는다(programs.ts와 같은 선). */
  /* 런타임으로 포장된 exe — 회사 이름은 런타임의 것이지 만든 사람의 것이 아니다.
     이때는 파일 이름이 더 정확한 단서다. */
  const runtime = packagedRuntimeOf(id)
  if (runtime) {
    const label = fileLabel(id?.path) || e.name
    return {
      zone: 'AMBIG',
      meaning: label,
      reason: sentence([
        `${withRo(runtime)} 만들어진 프로그램이에요. 파일 이름은 "${label}"입니다.`,
        `${withEun(runtime)} 만든 도구일 뿐이라 만든 곳은 알 수 없어요.`,
        signatureNote(id),
        '그래서 끄자고 제안하지 않습니다.',
      ]),
      suggestible: false,
      ifDisabled:
        '끄면 무엇이 달라지는지는 저희가 몰라요. 다만 **끄기는 되돌릴 수 있습니다** — ' +
        '켤 때 따라 나오지 않을 뿐이라, 이상하면 다시 켜면 됩니다.',
    }
  }

  if (what || who) {
    return {
      zone: 'AMBIG',
      meaning: what || who,
      /* ★ "Microsoft Corporation가"처럼 조사를 붙이지 않는다. 영문 이름 뒤의 은/는·이/가는
         받침 판정이 안 돼서 반드시 어색해진다. 이름을 앞에 세우고 조사를 피한다. */
      reason: sentence([
        who && what && who !== what ? `${what} — 만든 곳은 ${who}입니다.` : `${what || who}입니다.`,
        signatureNote(id),
        '켤 때 무슨 일을 하는지까지는 저희가 몰라서, 끄자고 제안하지는 않습니다.',
      ]),
      suggestible: false,
      ifDisabled:
        '끄면 무엇이 달라지는지는 저희가 몰라요. 다만 **끄기는 되돌릴 수 있습니다** — ' +
        '프로그램은 그대로 있고 켤 때 따라 나오지 않을 뿐이라, 이상하면 다시 켜면 됩니다.',
    }
  }

  /* 정말 아무것도 안 밝히는 것. 그래도 "모릅니다"로 끝내지 않는다 —
     아는 것(어디 있는지, 서명이 없다는 것, 되돌릴 수 있다는 것)은 말한다. */
  /* ★ "모릅니다"로 끝내지 않는다.
     실행 파일이 자기 이름을 안 적어둬도, **파일 이름과 폴더 이름은 사실이다.**
     실측에서 Ollama.lnk가 이 자리로 떨어졌다 — 바로가기 이름도 'Ollama',
     설치 폴더도 ...\\Programs\\Ollama 인데 화면에는 "모르겠어요"만 떴다.
     추측이 아니라 우리가 본 것을 그대로 말한다. */
  const label = fileLabel(id?.path) || fileLabel(e.command) || fileLabel(e.name)
  const folder = (id?.path || e.command).replace(/"/g, '').split(/[\\/]/).slice(-2, -1)[0] ?? ''
  const clue = [
    label ? `파일 이름은 "${label}"` : '',
    folder && folder.toLowerCase() !== label.toLowerCase() ? `폴더는 "${folder}"` : '',
  ].filter(Boolean).join(', ')

  return {
    zone: 'AMBIG',
    meaning: label || '이름을 안 밝히는 시작프로그램',
    reason: sentence([
      '실행 파일이 만든 곳도 설명도 안 적어뒀어요.',
      clue
        ? `${clue}입니다 — 이름은 누구나 붙일 수 있으니 그것만으로는 확인이 안 됩니다.`
        : '실행되는 파일 경로조차 확인되지 않습니다.',
      signatureNote(id),
      '그래서 끄자고 제안하지 않습니다.',
    ]),
    suggestible: false,
    ifDisabled:
      '끄면 무엇이 달라지는지는 저희가 몰라요. 다만 **끄기는 되돌릴 수 있습니다** — ' +
      '프로그램은 그대로 있고 켤 때 따라 나오지 않을 뿐이라, 이상하면 다시 켜면 됩니다.',
  }
}

/* ────────────────────────────────────────────────────────────
   수집 (IO)

   출력은 base64(UTF-8 JSON)다. 한국어 윈도우의 콘솔 인코딩은 CP949라
   한글 프로그램 이름("메가로드 도우미")을 그대로 흘리면 깨진다.
   base64로 감싸면 콘솔 인코딩과 무관해진다.
   ──────────────────────────────────────────────────────────── */

const APPROVED_RUN = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
const APPROVED_FOLDER =
  'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder'

const GATHER = `
$ErrorActionPreference = 'SilentlyContinue'

# 명령줄에서 실제 실행 파일 경로만 뽑는다.
#   "C:\\Program Files\\ShareX\\ShareX.exe" /tray  →  C:\\Program Files\\ShareX\\ShareX.exe
# ★ 따옴표가 없으면서 경로에 공백이 있는 경우가 있다(D:\\My Tools\\a.exe -x).
#   그래서 앞에서부터 한 낱말씩 붙여가며 **실제로 있는 파일**을 찾는다.
function Get-ExePath($cmd) {
  if (-not $cmd) { return '' }
  $c = ([string]$cmd).Trim()
  if ($c.StartsWith('"')) {
    $end = $c.IndexOf('"', 1)
    if ($end -gt 0) { return $c.Substring(1, $end - 1) }
  }
  $acc = ''
  foreach ($part in ($c -split ' ')) {
    if ($acc) { $acc = "$acc $part" } else { $acc = $part }
    if (Test-Path -LiteralPath $acc -PathType Leaf) { return $acc }
  }
  # ★ 'wscript.exe "...\\x.vbs"' 처럼 폴더 없이 이름만 적힌 경우. PATH에서 찾아준다.
  #   안 그러면 실행기인 줄 몰라서 "이름을 안 밝히는 시작프로그램"으로 떨어진다(실측).
  $first = ($c -split ' ')[0]
  $cmd = Get-Command $first -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($cmd) { return $cmd.Source }
  return $first
}

# 실행 파일이 스스로 밝히는 신원. 이걸 안 읽어서 ShareX를 "모르겠다"고 했었다.
#
# ★ 서명 확인(Get-AuthenticodeSignature)은 여기 넣지 않는다. 실측했다:
#     VersionInfo 21개          34ms
#     AuthenticodeSignature 21개 5,545ms   ← 160배
#   신원은 본문이고 서명은 각주다. 각주가 본문을 막으면 안 된다
#   (예약작업 146초에서 배운 것과 같은 자리다). 서명은 startup-signatures로 따로 받는다.
function Get-Identity($path) {
  if (-not $path) { return $null }
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  $v = (Get-Item -LiteralPath $path).VersionInfo
  # ★ 버전 정보가 하나도 없어도 **경로는 돌려준다.** 예전엔 $null을 줘서 경로까지
  #   함께 잃었고, 그 결과 화면이 명령줄 전체를 이름 자리에 넣어
  #   'AdPT-Agent-Windows.exe"' 처럼 따옴표 붙은 이름이 떴다(실측).
  return [PSCustomObject]@{
    description = [string]$v.FileDescription
    product = [string]$v.ProductName
    company = [string]$v.CompanyName
    path = $path
  }
}

function Read-Approved($root, $sub) {
  $map = @{}
  $p = Get-ItemProperty "$($root):\\$sub"
  if ($p) {
    foreach ($v in $p.PSObject.Properties) {
      if ($v.Name -like 'PS*') { continue }
      $bytes = $v.Value
      # 첫 바이트: 2 또는 6 = 사용, 3 = 해제. 작업관리자가 쓰는 값과 같다.
      $map[$v.Name] = -not ($bytes -is [byte[]] -and $bytes.Length -gt 0 -and $bytes[0] -eq 3)
    }
  }
  return $map
}

$approvedRun     = Read-Approved 'HKCU' '${APPROVED_RUN}'
$approvedRunHKLM = Read-Approved 'HKLM' '${APPROVED_RUN}'
$approvedFolder  = Read-Approved 'HKCU' '${APPROVED_FOLDER}'

$entries = New-Object System.Collections.ArrayList

function Add-Run($hive, $source, $approved) {
  $p = Get-ItemProperty "$($hive):\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
  if (-not $p) { return }
  foreach ($v in $p.PSObject.Properties) {
    if ($v.Name -like 'PS*') { continue }
    $on = $true
    if ($approved.ContainsKey($v.Name)) { $on = $approved[$v.Name] }
    $cmd = [string]$v.Value
    [void]$entries.Add([PSCustomObject]@{
      name = $v.Name; command = $cmd; source = $source; enabled = $on
      identity = (Get-Identity (Get-ExePath $cmd))
    })
  }
}

Add-Run 'HKCU' 'hkcu-run' $approvedRun
Add-Run 'HKLM' 'hklm-run' $approvedRunHKLM

$shell = New-Object -ComObject WScript.Shell
$folders = @(
  @{ path = [Environment]::GetFolderPath('Startup');       source = 'startup-folder' },
  @{ path = [Environment]::GetFolderPath('CommonStartup'); source = 'common-startup-folder' }
)
foreach ($f in $folders) {
  foreach ($item in (Get-ChildItem $f.path -File)) {
    if ($item.Name -eq 'desktop.ini') { continue }
    # ★ 바로가기가 아니면 예전엔 command를 빈 문자열로 뒀다. 그래서 화면에
    #   "MegaSellingBackend.vbs — 이게 뭔지 모르겠어요"만 뜨고 **경로조차 안 보였다.**
    #   정체를 모르면 최소한 어디 있는 파일인지는 보여줘야 한다.
    $target = $item.FullName
    if ($item.Extension -eq '.lnk') {
      $t = $shell.CreateShortcut($item.FullName).TargetPath
      if ($t) { $target = $t }
    }
    $on = $true
    if ($approvedFolder.ContainsKey($item.Name)) { $on = $approvedFolder[$item.Name] }
    [void]$entries.Add([PSCustomObject]@{
      name = $item.Name; command = "$target"; source = $f.source; enabled = $on
      identity = (Get-Identity (Get-ExePath $target))
    })
  }
}

$out = [PSCustomObject]@{ entries = @($entries) } | ConvertTo-Json -Depth 4 -Compress
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($out))
`

/**
 * 로그온 예약작업 개수 — **목록과 따로 센다.**
 *
 * ★ 왜 떼어냈나 (실측): 이 한 줄이 목록 전체를 인질로 잡고 있었다.
 *   Get-ScheduledTask는 작업마다 트리거를 CIM으로 따로 가져오는데, 이 PC에서
 *   찬 상태로 **146초**, 데운 상태로도 7초가 걸렸다. 레지스트리를 읽는 나머지는
 *   전부 합쳐 1초도 안 된다. 그런데 같은 스크립트에 묶여 있어서, 화면은 각주 한 줄
 *   때문에 목록을 2분 넘게 못 보여줬다. 끄기를 누를 때마다 그 2분을 다시 기다렸다.
 *
 *   개수는 각주다. 각주가 본문을 막으면 안 된다. 그래서 별도 명령으로 빼고,
 *   화면은 목록을 먼저 그린 뒤 이 값이 오면 채운다.
 */
const LOGON_TASKS = `
$ErrorActionPreference = 'SilentlyContinue'
@(Get-ScheduledTask | Where-Object {
  $_.State -ne 'Disabled' -and $_.Triggers.CimClass.CimClassName -contains 'MSFT_TaskLogonTrigger'
}).Count
`

/**
 * 서명 확인 — **각주다.** 목록이 다 그려진 뒤에 따로 받는다.
 *
 * ★ 왜 따로인가 (실측 2026-08-21, 이 PC 21개 기준):
 *     VersionInfo             34ms
 *     AuthenticodeSignature 5,545ms   ← 160배
 *   서명은 파일을 통째로 해시하고 인증서 체인을 검증한다. 같은 명령에 묶어두면
 *   "누가 만든 프로그램인가"라는 본문이 각주 때문에 6초를 기다린다.
 *   (예약작업 146초에서 배운 것과 같은 자리 — LOGON_TASKS 머리말 참고)
 */
const SIGNATURES = `
$ErrorActionPreference = 'SilentlyContinue'
$paths = [Console]::In.ReadToEnd() -split "\`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }
$out = @{}
foreach ($p in $paths) {
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { continue }
  $signer = ''
  $valid = $false
  try {
    $s = Get-AuthenticodeSignature -LiteralPath $p
    $valid = ($s.Status -eq 'Valid')
    if ($valid -and $s.SignerCertificate) {
      $cn = ($s.SignerCertificate.Subject -split ',' | Where-Object { $_.Trim().StartsWith('CN=') }) -replace '^\\s*CN=', ''
      $signer = ([string]$cn -replace '"', '').Trim()
    }
  } catch { }
  $out[$p] = [PSCustomObject]@{ signer = $signer; signed = $valid }
}
$json = [PSCustomObject]$out | ConvertTo-Json -Depth 3 -Compress
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
`

/** 경로 → 서명 정보. 못 읽은 경로는 그냥 빠진다(모르는 것과 없는 것은 다르다). */
export async function gatherSignatures(paths: string[]): Promise<Record<string, { signer: string; signed: boolean }>> {
  const list = [...new Set(paths.filter(Boolean))]
  if (process.platform !== 'win32' || !list.length) return {}
  const child = exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SIGNATURES], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  })
  // ★ 경로를 명령줄이 아니라 stdin으로 넘긴다. 명령줄에 이어붙이면 길이 제한에 걸리고,
  //   무엇보다 파일 경로가 스크립트 본문에 섞이는 통로가 생긴다.
  child.child.stdin?.end(list.join('\n'))
  const { stdout } = await child
  try {
    return JSON.parse(Buffer.from(stdout.trim(), 'base64').toString('utf8'))
  } catch {
    return {}
  }
}

export interface StartupReport {
  entries: (StartupEntry & { verdict: StartupVerdict })[]
  enabledCount: number
  suggestibleCount: number
}

/**
 * 우리가 못 건드리는 영역도 숨기지 않는다 — 로그온 예약작업이 몇 개인지는 알려준다.
 * 다만 세는 데 몇 초에서 몇 분이 걸려서(LOGON_TASKS 머리말) 목록과 따로 부른다.
 */
export async function countLogonTasks(): Promise<number> {
  if (process.platform !== 'win32') return 0
  const { stdout } = await exec(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', LOGON_TASKS],
    { windowsHide: true }
  )
  const n = parseInt(stdout.trim(), 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export async function probeStartup(): Promise<StartupReport> {
  if (process.platform !== 'win32') {
    throw new Error('시작프로그램 프로브는 지금 Windows만 지원합니다.')
  }

  const { stdout } = await exec(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', GATHER],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
  )
  const raw = JSON.parse(Buffer.from(stdout.trim(), 'base64').toString('utf8'))
  const list: any[] = Array.isArray(raw.entries) ? raw.entries : raw.entries ? [raw.entries] : []

  const entries = list.map((e) => {
    const base: StartupEntry = {
      id: `${e.source}|${e.name}`,
      name: e.name,
      command: e.command ?? '',
      source: e.source,
      enabled: !!e.enabled,
      // HKLM과 공용 시작 폴더는 모든 사용자용이라 관리자 권한이 필요하다
      canToggle: e.source === 'hkcu-run' || e.source === 'startup-folder',
      // 실행 파일이 스스로 밝힌 신원. 하나도 못 읽었으면 아예 없다.
      identity: e.identity
        ? {
            description: String(e.identity.description ?? ''),
            product: String(e.identity.product ?? ''),
            company: String(e.identity.company ?? ''),
            path: String(e.identity.path ?? ''),
            // signer/signed는 여기서 안 채운다 — startup-signatures가 나중에 채운다.
          }
        : undefined,
    }
    return { ...base, verdict: judgeStartup(base) }
  })

  return {
    entries,
    enabledCount: entries.filter((e) => e.enabled).length,
    suggestibleCount: entries.filter((e) => e.verdict.suggestible).length,
  }
}

/* ────────────────────────────────────────────────────────────
   켜기 / 끄기

   원본은 절대 손대지 않는다. Run 값도, 바로가기 파일도 그대로 두고
   StartupApproved에 상태만 쓴다. 작업관리자가 하는 것과 같은 방식이라
   작업관리자에서도 똑같이 보이고, 거기서 되돌릴 수도 있다.
   ──────────────────────────────────────────────────────────── */

/** 해제 상태 값: 첫 바이트 3 + 해제한 시각(FILETIME). 사용은 2 + 0. */
export function approvalBytes(enabled: boolean, now = Date.now()): number[] {
  if (enabled) return [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  // FILETIME = 1601-01-01부터 100나노초 단위
  const filetime = BigInt(now + 11644473600000) * 10000n
  const stamp: number[] = []
  let v = filetime
  for (let i = 0; i < 8; i++) {
    stamp.push(Number(v & 0xffn))
    v >>= 8n
  }
  return [3, 0, 0, 0, ...stamp]
}

export interface ToggleResult {
  id: string
  enabled: boolean
}

/**
 * 시작프로그램을 켜거나 끈다.
 *
 * 이름을 셸 명령 문자열에 끼워 넣지 않는다 — 환경변수로 넘긴다.
 * 프로그램 이름에는 따옴표도 공백도 들어갈 수 있고, 그걸 명령줄에 붙이는 순간
 * 남의 이름으로 아무 명령이나 실행시킬 수 있는 통로가 된다.
 */
export async function setStartupEnabled(id: string, enabled: boolean): Promise<ToggleResult> {
  const sep = id.indexOf('|')
  const source = id.slice(0, sep)
  const name = id.slice(sep + 1)

  const sub =
    source === 'hkcu-run' ? APPROVED_RUN : source === 'startup-folder' ? APPROVED_FOLDER : null
  if (!sub) {
    throw new Error('이 항목은 모든 사용자용이라 관리자 권한이 필요합니다. 작업관리자에서 꺼주세요.')
  }

  const script = `
    $ErrorActionPreference = 'Stop'
    $key = 'HKCU:\\' + $env:TC_SUB
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    $bytes = [byte[]]($env:TC_BYTES -split ',')
    Set-ItemProperty -Path $key -Name $env:TC_NAME -Value $bytes -Type Binary
  `
  await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    env: {
      ...process.env,
      TC_SUB: sub,
      TC_NAME: name,
      TC_BYTES: approvalBytes(enabled).join(','),
    },
  })

  return { id, enabled }
}
