/**
 * 윈도우가 자기 몫으로 잡아둔 공간 — 가상 메모리 · 시스템 복원
 *
 * hiberfil과 같은 계열이다. 파일 목록에는 안 보이거나 열 수도 없는데 수십~수백 GB를
 * 차지한다. 실측 PC에서 이랬다:
 *
 *   pagefile.sys (가상 메모리)   65.4GB
 *   시스템 복원                  최대 155GB까지 잡혀 있음
 *
 * ── 우리는 건드리지 않는다 ───────────────────────────────────
 * 둘 다 **윈도우 설정 창에서 바꾸는 것**이고, 잘못 만지면 부팅·복구가 깨진다.
 * 그래서 여기서 하는 일은 "있다는 사실 + 얼마나 + 정식 창 열어주기"까지다.
 * (types.ts 규약: 되돌리는 명령이 없으면 SystemAction으로 만들지 않는다)
 *
 * ── 시스템 복원은 물어보고 잰다 ──────────────────────────────
 * 크기를 읽으려면 관리자 권한이 필요하다. 권한 없이 부르면 빈 결과가 오는데,
 * 그걸 "0"으로 보고하면 안 된다 — "없다"와 "못 봤다"는 완전히 다른 말이다.
 *
 * ★ 그렇다고 "못 쟀습니다"로 끝내는 것도 틀렸다(2026-08-20).
 *   여태 화면엔 "권한이 있어야 볼 수 있어서 저희가 못 쟀습니다"만 떠 있었다.
 *   숨은 공간 중 가장 큰 항목이고 100GB가 잡혀 있을 수도 있는데,
 *   **물어보지도 않고 모른다고 한 것**이다. 권한이 필요하면 권한을 물어보면 된다.
 *
 *   그래서 못 쟀을 때는 measure 통로를 함께 낸다(types.ts의 MeasureAction).
 *   누르면 관리자 확인 창이 한 번 뜨고, 확인하면 그 자리에서 진짜 숫자가 나온다.
 *   이 통로는 **읽기만 한다** — 복원 지점은 여전히 우리가 안 지운다.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Finding } from '../types.ts'

const exec = promisify(execFile)

const GB = 1024 ** 3
const MB = 1024 ** 2
const size = (n: number) => (n >= GB ? `${(n / GB).toFixed(1)}GB` : `${Math.round(n / MB)}MB`)

/** 이보다 작으면 보고하지 않는다 — 화면을 아끼는 게 사용자를 아끼는 것이다. */
export const SYSTEM_FLOOR_BYTES = 4 * GB

export interface PageFileFacts {
  path: string
  /** 잡아둔 크기 */
  bytes: number
  /** 실제로 쓰고 있는 양 */
  usedBytes: number
}

/*
 * 가상 메모리 크기는 관리자 권한 없이도 읽힌다(실측 확인).
 * 출력은 숫자만 담은 JSON이라 한국어 윈도우에서도 그대로 파싱된다.
 */
const PAGEFILE_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$p = Get-CimInstance Win32_PageFileUsage | Select-Object -First 1
if ($p) {
  [PSCustomObject]@{ path = $p.Name; mb = [int]$p.AllocatedBaseSize; usedMb = [int]$p.CurrentUsage } | ConvertTo-Json -Compress
} else { '{}' }
`

export async function gatherPageFile(): Promise<PageFileFacts | null> {
  if (process.platform !== 'win32') return null
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PAGEFILE_SCRIPT], {
    windowsHide: true,
    maxBuffer: 1 << 20,
  })
  const raw = JSON.parse(stdout || '{}')
  if (!raw.path || !raw.mb) return null
  return { path: raw.path, bytes: Number(raw.mb) * MB, usedBytes: Number(raw.usedMb ?? 0) * MB }
}

/**
 * 가상 메모리(pagefile.sys).
 *
 * 존 C다. 우리가 지울 수도 없고 지워서도 안 된다 — 크기를 바꾸는 건 윈도우 설정이다.
 */
export function probePageFile(f: PageFileFacts): Finding | null {
  if (f.bytes < SYSTEM_FLOOR_BYTES) return null
  const spare = f.bytes - f.usedBytes

  return {
    id: 'win.pagefile',
    title: '가상 메모리 (pagefile.sys)',
    bytes: f.bytes,
    zone: 'LOCKED',
    explain: {
      what:
        `메모리가 모자랄 때 윈도우가 대신 쓰려고 잡아둔 자리예요. ${f.path}에 ${size(f.bytes)}를 잡아뒀고, ` +
        `지금 실제로 쓰는 건 ${size(f.usedBytes)}입니다.`,
      why:
        '윈도우가 메모리 크기에 맞춰 알아서 잡습니다. 메모리가 큰 PC일수록 이 파일도 커져요. ' +
        `지금은 잡아둔 것 중 ${size(spare)}가 놀고 있습니다.`,
      usedBy: [
        '윈도우 전체 — 메모리가 꽉 찼을 때 여기로 밀어냅니다. 없으면 프로그램이 강제 종료됩니다.',
        '큰 작업(영상 편집·AI·게임) — 순간적으로 메모리를 넘길 때 이 자리가 버텨줍니다.',
      ],
      ifRemoved: [
        '크기를 줄이면 그만큼 바로 빕니다. 메모리가 넉넉하면 대개 문제없어요.',
        '★ 너무 줄이거나 없애면 메모리가 꽉 찰 때 프로그램이 갑자기 꺼질 수 있습니다.',
      ],
      recovery: 'one-command',
      recoveryNote:
        '설정 창에서 언제든 다시 늘릴 수 있어요(재시작 필요). 저희가 직접 바꾸진 않습니다 — ' +
        '값을 잘못 잡으면 부팅 뒤에 프로그램이 꺼지는데, 그건 되돌리기 전까지 원인도 안 보입니다.',
      ifKept: `아무 문제 없어요. ${size(f.bytes)}를 계속 쓸 뿐입니다.`,
    },
    assist: {
      label: '가상 메모리 설정 열기',
      command: 'open-virtual-memory',
      irreversible: false,
      note:
        '관리자 확인 창이 한 번 뜰 수 있어요. ' +
        '“고급 → 가상 메모리 → 변경”에서 크기를 정하시면 됩니다. ' +
        '외장하드로 옮기는 건 권하지 않아요 — 안 꽂혀 있으면 문제가 생깁니다. 다른 내장 드라이브면 괜찮습니다.',
    },
  }
}

/* ────────────────────────────────────────────────────────────
   시스템 복원 — 우리가 못 재는 것
   ──────────────────────────────────────────────────────────── */

export interface RestoreFacts {
  /** 잰 값이 있나. 권한이 없으면 false */
  measured: boolean
  usedBytes: number
  allocatedBytes: number
  /** 최대 얼마까지 쓰도록 잡혀 있나 */
  maxBytes: number
}

/**
 * 값을 `$json`에 담기까지가 공통이다. 어디로 내보내느냐만 다르다:
 *   · 권한 없이 부를 때  → 그대로 stdout (아래 gatherRestore)
 *   · 권한을 받아 부를 때 → 파일로 (engine-cli의 restore-measure)
 *     승격된 파워셸은 **다른 프로세스**라 stdout이 우리 쪽으로 안 온다.
 *
 * ★ 스크립트는 고정 문자열이다. 사용자·레지스트리에서 온 값을 이어붙이지 않는다
 *   (startup.ts·main.rs와 같은 원칙 — 이어붙이는 순간 주입 통로가 된다).
 */
export const VSS_QUERY = `
$ErrorActionPreference = 'SilentlyContinue'
$s = Get-CimInstance Win32_ShadowStorage | Select-Object -First 1
$json = if ($s) {
  [PSCustomObject]@{ used = [double]$s.UsedSpace; alloc = [double]$s.AllocatedSpace; max = [double]$s.MaxSpace } | ConvertTo-Json -Compress
} else { '{}' }
`

const VSS_SCRIPT = VSS_QUERY + `$json`

/**
 * 파워셸이 뱉은 JSON 한 줄을 사실로 바꾼다. 권한 있는 쪽·없는 쪽이 같이 쓴다.
 *
 * ★ max가 터무니없이 크면 '무제한'이다. 윈도우는 한도를 안 걸었을 때
 *   UINT64 최대값을 그대로 준다(18,446,744,073,709,551,615 ≈ 16EB).
 *   그걸 "최대 16777216.0GB까지 잡혀 있습니다"라고 쓰면 화면이 고장난 것처럼 보인다.
 */
export function parseRestore(stdout: string): RestoreFacts {
  const none: RestoreFacts = { measured: false, usedBytes: 0, allocatedBytes: 0, maxBytes: 0 }
  let raw: any
  try { raw = JSON.parse(stdout || '{}') } catch { return none }
  if (!raw || !raw.max) return none
  return {
    measured: true,
    usedBytes: Number(raw.used ?? 0),
    allocatedBytes: Number(raw.alloc ?? 0),
    maxBytes: Number(raw.max ?? 0),
  }
}

/** 한도를 안 건 상태인가 — 이 위로는 숫자가 아니라 '제한 없음'이라고 써야 한다. */
export const UNBOUNDED_BYTES = 1024 ** 5 // 1PB. 이보다 큰 한도를 건 사람은 없다.

export async function gatherRestore(): Promise<RestoreFacts> {
  const none: RestoreFacts = { measured: false, usedBytes: 0, allocatedBytes: 0, maxBytes: 0 }
  if (process.platform !== 'win32') return none
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', VSS_SCRIPT], {
      windowsHide: true,
      maxBuffer: 1 << 20,
    })
    return parseRestore(stdout)
  } catch {
    return none
  }
}

/**
 * 시스템 복원이 잡아둔 공간.
 *
 * 실측 PC에서 최대 155GB까지 잡혀 있었다 — 웬만한 파일 정리를 다 합친 것보다 크다.
 * 그런데 못 재는 경우가 많아서(권한), 그때는 숫자 없이 "확인해 보세요"로 낸다.
 */
export function probeRestore(f: RestoreFacts, driveTotalBytes = 0): Finding | null {
  // 잰 값이 있는데 작으면 굳이 안 띄운다. 못 쟀으면 크기를 모르니 일단 알린다.
  if (f.measured && f.allocatedBytes < SYSTEM_FLOOR_BYTES) return null

  const known = f.measured
  const capHint = driveTotalBytes ? `이 드라이브 기준으로는 최대 ${size(driveTotalBytes * 0.15)} 정도까지 잡히는 게 보통이에요.` : ''
  /* ★ 한도를 안 걸었으면 윈도우가 UINT64 최대값을 준다(≈16EB).
     그걸 그대로 쓰면 "최대 16777216.0GB까지"가 되어 화면이 고장난 것처럼 보인다.
     숫자가 아니라 상태를 말해야 하는 자리다. */
  const capText = f.maxBytes >= UNBOUNDED_BYTES
    ? '한도를 따로 안 걸어두셔서 드라이브가 허락하는 만큼 늘어납니다'
    : `최대 ${size(f.maxBytes)}까지 쓰도록 잡혀 있습니다`

  return {
    id: 'win.systemrestore',
    title: '시스템 복원이 잡아둔 공간',
    // ★ 못 쟀으면 0으로 둔다. 화면은 이걸 '확인 필요'로 그린다 — 지어낸 숫자를 넣지 않는다.
    bytes: known ? f.allocatedBytes : 0,
    zone: 'LOCKED',
    explain: {
      what: known
        ? `문제가 생겼을 때 되돌아갈 지점을 저장해두는 자리예요. 지금 ${size(f.usedBytes)}를 쓰고 있고, ` +
          `${capText}.`
        : '문제가 생겼을 때 되돌아갈 지점을 저장해두는 자리예요. ' +
          '얼마나 잡혀 있는지는 **관리자 권한이 있어야 읽을 수 있습니다.** ' +
          '아래 “권한 확인하고 재기”를 누르시면 확인 창이 한 번 뜨고, 확인하시면 바로 재서 알려드려요. ' +
          `숨은 공간 중 가장 큰 경우가 많아요 — 수십 GB에서 100GB를 넘기도 합니다. ${capHint}`,
      why:
        '윈도우 업데이트나 프로그램 설치 전에 자동으로 저장 지점을 만듭니다. ' +
        '한도를 넉넉히 잡아두면 오래된 지점이 계속 쌓여요.',
      usedBy: [
        '시스템 복원 — "이전 상태로 되돌리기"가 이 자료를 씁니다.',
        '파일 이전 버전 — 실수로 덮어쓴 파일을 되살릴 때도 여기서 꺼냅니다.',
      ],
      ifRemoved: [
        '한도를 줄이면 오래된 저장 지점부터 지워지고 그만큼 바로 빕니다.',
        '★ 지운 지점으로는 되돌아갈 수 없습니다. 최근 지점 하나는 남겨두는 게 안전해요.',
      ],
      recovery: 'none',
      recoveryNote:
        '지워진 저장 지점은 못 되살립니다. 그래서 저희가 직접 건드리지 않아요. ' +
        '한도만 줄이면(예: 20GB) 최근 지점은 남으면서 오래된 것만 정리됩니다.',
      ifKept: '아무 문제 없어요. 잡아둔 만큼 계속 쓸 뿐이고, 되돌릴 지점이 더 많이 남습니다.',
    },
    /* ★ 못 쟀을 때만 낸다. "권한이 필요해서 못 쟀습니다"로 끝내지 않기 위한 통로다.
       읽기만 한다 — 복원 지점은 여전히 우리가 안 지운다(recovery: 'none'이니까). */
    measure: known
      ? undefined
      : {
          label: '권한 확인하고 재기',
          run: 'restore-measure',
          needsAdmin: true,
          note: '관리자 확인 창이 한 번 뜹니다. 읽기만 하고 아무것도 바꾸지 않아요.',
        },
    assist: {
      label: '시스템 보호 설정 열기',
      command: 'open-system-protection',
      irreversible: false,
      note:
        '관리자 확인 창이 한 번 뜰 수 있어요. ' +
        '“구성”을 누르면 지금 쓰는 양과 최대 크기 막대가 나옵니다. 거기서 20GB쯤으로 줄이시면 ' +
        '최근 복원 지점은 남기면서 오래된 것만 정리돼요.',
    },
  }
}
