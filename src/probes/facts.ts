/**
 * 시스템 사실 수집 — 판단하지 않는다. 스캐너와 같은 원칙.
 *
 * ── 실측에서 배운 함정 두 개 (둘 다 설계를 바꿨다) ──────────────
 *
 * 1) node의 stat()으로는 hiberfil.sys를 못 읽는다. EPERM으로 튕긴다.
 *    시스템이 파일을 독점 잠금해서 열 수 없기 때문이다. stat()은 파일을
 *    열어야 하지만, 디렉토리 열거는 열지 않고도 크기를 얻는다
 *    (Get-ChildItem = FindFirstFile → WIN32_FIND_DATA에 크기가 들어있다).
 *    → 그래서 여기만 PowerShell을 거친다. 최종 Rust 코어는 MFT를 직접
 *      읽으므로 이 우회가 통째로 사라진다.
 *
 * 2) powercfg /a 출력은 지역화된다("최대 절전 모드"). 파싱하면 다른 언어
 *    윈도우에서 통째로 깨진다.
 *    → 언어 무관 신호만 쓴다: 파일 존재 여부 + 레지스트리 값 + WMI 숫자.
 *    → hiberfil.sys의 '존재' 자체가 최대절전이 켜져 있다는 증거다.
 *      끄면 윈도우가 파일을 지운다. powercfg를 물어볼 필요가 없다.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export interface SystemFacts {
  ramBytes: number
  systemDrive: string
  /** hiberfil.sys 크기. 0 = 최대절전이 이미 꺼져 있음(파일 자체가 없다) */
  hiberfilBytes: number
  pagefileBytes: number
  /** 빠른 시작(Fast Startup) — hiberfil을 쓰는 '숨은' 소비자. 대부분 모른다. */
  fastStartupEnabled: boolean
  /** 사용자가 크기를 직접 지정했나. 0 = 기본값(RAM의 40%) */
  hiberFileSizePercent: number
  isLaptop: boolean
  /** 노트북 판정 근거 — 왜 그렇게 봤는지 사용자에게 보여줄 수 있어야 한다 */
  laptopSignals: string[]
}

/* 섀시 타입 → 노트북 계열. WMI Win32_SystemEnclosure.ChassisTypes 표준값.
   3=데스크톱, 8~14=휴대형/노트북/랩톱, 30~32=태블릿/컨버터블 */
const LAPTOP_CHASSIS = new Set([8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32])

/* 한 번의 PowerShell 호출로 전부 가져온다. 출력은 순수 ASCII JSON이라
   한국어 윈도우의 CP949 인코딩 문제를 피해간다. */
const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$drive = $env:SystemDrive
$files = Get-ChildItem "$drive\\" -Force -File
$hiber = $files | Where-Object { $_.Name -eq 'hiberfil.sys' }
$page  = $files | Where-Object { $_.Name -eq 'pagefile.sys' }
$hb    = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power' -Name HiberbootEnabled).HiberbootEnabled
$pct   = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power' -Name HiberFileSizePercent).HiberFileSizePercent
[PSCustomObject]@{
  ramBytes      = [int64](Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
  systemDrive   = $drive
  hiberfilBytes = [int64]$(if ($hiber) { $hiber.Length } else { 0 })
  pagefileBytes = [int64]$(if ($page)  { $page.Length }  else { 0 })
  fastStartup   = [int]$(if ($null -ne $hb) { $hb } else { 0 })
  hiberPercent  = [int]$(if ($null -ne $pct) { $pct } else { 0 })
  chassis       = @((Get-CimInstance Win32_SystemEnclosure).ChassisTypes)
  batteries     = [int]@(Get-CimInstance Win32_Battery).Count
} | ConvertTo-Json -Compress
`

export async function gatherFacts(): Promise<SystemFacts> {
  if (process.platform !== 'win32') {
    throw new Error('숨은 공간 프로브는 지금 Windows만 지원합니다. (macOS는 purgeable/APFS 스냅샷 — 기획서 17.1)')
  }

  const { stdout } = await exec(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],
    { windowsHide: true, maxBuffer: 1 << 20 }
  )

  const raw = JSON.parse(stdout)

  // 노트북 판정은 신호 두 개를 독립적으로 본다. 하나만 믿지 않는다 —
  // 섀시 타입을 엉터리로 보고하는 메인보드가 흔하다.
  const chassis: number[] = Array.isArray(raw.chassis) ? raw.chassis : [raw.chassis]
  const signals: string[] = []
  if (chassis.some((c) => LAPTOP_CHASSIS.has(c))) signals.push('섀시 타입이 휴대형')
  if (raw.batteries > 0) signals.push('배터리가 있음')

  return {
    ramBytes: raw.ramBytes,
    systemDrive: raw.systemDrive,
    hiberfilBytes: raw.hiberfilBytes,
    pagefileBytes: raw.pagefileBytes,
    fastStartupEnabled: raw.fastStartup === 1,
    hiberFileSizePercent: raw.hiberPercent,
    isLaptop: signals.length > 0,
    laptopSignals: signals,
  }
}
