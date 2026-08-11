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
  return {
    zone: 'AMBIG',
    meaning: '알 수 없는 시작프로그램',
    reason: '이게 뭔지 확실히 모르겠어요. 그래서 끄자고 제안하지 않습니다.',
    suggestible: false,
    ifDisabled: '무엇이 달라지는지 저희가 모릅니다. 정체를 아시는 것만 직접 꺼주세요.',
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
    [void]$entries.Add([PSCustomObject]@{
      name = $v.Name; command = [string]$v.Value; source = $source; enabled = $on
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
    $target = ''
    if ($item.Extension -eq '.lnk') { $target = $shell.CreateShortcut($item.FullName).TargetPath }
    $on = $true
    if ($approvedFolder.ContainsKey($item.Name)) { $on = $approvedFolder[$item.Name] }
    [void]$entries.Add([PSCustomObject]@{
      name = $item.Name; command = "$target"; source = $f.source; enabled = $on
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
