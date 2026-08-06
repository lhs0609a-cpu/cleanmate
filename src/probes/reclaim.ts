/**
 * 회수 가능 공간 프로브 — 휴지통 · 윈도우 업데이트 캐시
 *
 * hiberfil과 같은 계열이다. 파일 스캔으로는 못 잡는데 용량은 큰 것들.
 * 다만 hiberfil과 결정적으로 다른 점이 하나 있다:
 *
 *   ★ 둘 다 '되돌리는 명령'이 없다.
 *
 * hiberfil은 powercfg /hibernate on 한 줄로 원상복구되니까 SystemAction으로
 * 만들 수 있었다. 휴지통을 비우면 끝이고, 업데이트 캐시도 우리가 지울 수단이
 * 없다(관리자 권한이 필요하고, 잘못 지우면 업데이트가 다시 받아진다).
 * types.ts의 규약대로 undo가 없으면 SystemAction으로 만들지 않는다.
 * 대신 assist로 '정식 도구를 대신 띄워주는' 경로만 제공한다:
 *   - 휴지통 → Clear-RecycleBin (윈도우 공식 명령)
 *   - 업데이트 캐시 → cleanmgr (윈도우 디스크 정리)
 * 우리가 그 폴더의 파일을 직접 지우는 코드는 없다.
 *
 * ── 왜 '작으면 아예 보고하지 않는가' ──────────────────────────
 * 200MB짜리 항목을 카드로 띄우면 화면만 길어지고, 사용자는 목록을 훑다가
 * 정작 큰 항목을 놓친다. 숨은 공간은 '몇 GB짜리 고레버리지 항목'만 있어야
 * 화면이 의미를 갖는다.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Finding } from '../types.ts'

const exec = promisify(execFile)

const GB = 1024 ** 3
const MB = 1024 ** 2
const gb = (n: number) => (n / GB).toFixed(1)
/** 사람이 읽을 크기. GB가 안 되면 MB로. */
const size = (n: number) => (n >= GB ? `${gb(n)}GB` : `${Math.round(n / MB)}MB`)

/** 이보다 작으면 보고하지 않는다 — 화면을 아끼는 게 사용자를 아끼는 것이다. */
export const REPORT_FLOOR_BYTES = 500 * MB

export interface ReclaimFacts {
  systemDrive: string
  /** 휴지통 안 실제 내용물($R 파일)의 합. 메타데이터($I)는 뺀다. */
  recycleBytes: number
  recycleCount: number
  /** Windows\SoftwareDistribution\Download — 다 쓴 업데이트 설치본이 남는 곳 */
  updateCacheBytes: number
}

/*
 * 한 번의 PowerShell 호출로 둘 다 가져온다. 출력은 순수 ASCII JSON이라
 * 한국어 윈도우의 CP949 인코딩 문제를 피해간다. (facts.ts와 같은 이유)
 *
 * ★ 휴지통을 Get-ChildItem으로 세는 이유: Shell.Application COM으로도 되지만
 *   COM은 세션·권한에 따라 조용히 실패한다. 휴지통은 드라이브마다
 *   $Recycle.Bin\<사용자SID>\ 아래에 $R(실물)·$I(메타)로 저장되므로,
 *   $R만 세면 '되살릴 수 있는 실제 용량'이 정확히 나온다.
 */
const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$drive = $env:SystemDrive
$bins = Get-ChildItem "$drive\\" -Force -Directory | Where-Object { $_.Name -eq '$Recycle.Bin' }
$items = @()
foreach ($b in $bins) {
  $items += Get-ChildItem $b.FullName -Force -Recurse -File | Where-Object { $_.Name -like '$R*' }
}
$rbSum = ($items | Measure-Object -Property Length -Sum).Sum
$dl = Join-Path $drive 'Windows\\SoftwareDistribution\\Download'
$dlSum = (Get-ChildItem $dl -Force -Recurse -File | Measure-Object -Property Length -Sum).Sum
[PSCustomObject]@{
  systemDrive      = $drive
  recycleBytes     = [int64]$(if ($rbSum) { $rbSum } else { 0 })
  recycleCount     = [int]@($items).Count
  updateCacheBytes = [int64]$(if ($dlSum) { $dlSum } else { 0 })
} | ConvertTo-Json -Compress
`

export async function gatherReclaimFacts(): Promise<ReclaimFacts> {
  if (process.platform !== 'win32') {
    throw new Error('휴지통·업데이트 캐시 프로브는 지금 Windows만 지원합니다.')
  }
  const { stdout } = await exec(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],
    { windowsHide: true, maxBuffer: 1 << 20 }
  )
  const raw = JSON.parse(stdout)
  return {
    systemDrive: raw.systemDrive ?? 'C:',
    recycleBytes: raw.recycleBytes ?? 0,
    recycleCount: raw.recycleCount ?? 0,
    updateCacheBytes: raw.updateCacheBytes ?? 0,
  }
}

/* ────────────────────────────────────────────────────────────
   휴지통

   존 B(애매)로 둔다. 시스템 파일이 아니라서 위험하지 않지만,
   '저 안에 되살릴 게 있는지'는 사용자만 안다 — 존 B의 정의 그대로다.
   비우는 순간 되돌릴 수 없으므로 자동 처리 대상이 될 수 없다.
   ──────────────────────────────────────────────────────────── */
export function probeRecycleBin(f: ReclaimFacts): Finding | null {
  if (f.recycleBytes < REPORT_FLOOR_BYTES) return null

  return {
    id: 'win.recyclebin',
    title: '휴지통',
    bytes: f.recycleBytes,
    zone: 'AMBIG',
    explain: {
      what:
        '지우신 파일들이 실제로는 아직 여기 남아 있어요. ' +
        `지금 ${f.recycleCount.toLocaleString()}개, ${size(f.recycleBytes)}가 들어 있습니다.`,
      why:
        '지운 게 아니라 문 앞에 내놓은 거예요. 되돌릴 수 있게요. ' +
        '그래서 “지웠는데 용량이 그대로”인 겁니다.',
      usedBy: [
        '되돌리기 — 실수로 지운 걸 제자리로 돌려놓는 기능이에요. 비우면 돌려놓을 게 없어집니다.',
      ],
      ifRemoved: [
        `${size(f.recycleBytes)}가 진짜로 비워집니다. 효과가 가장 확실한 항목이에요.`,
        '★ 되돌릴 수 없어요. 이건 문 앞이 아니라 수거차에 실어 보내는 겁니다.',
      ],
      recovery: 'none',
      recoveryNote:
        '아니요. 비우면 끝이에요. 그래서 알아서 비우지 않고, 안을 먼저 열어보시라고만 합니다.',
      ifKept: `아무 문제 없어요. ${size(f.recycleBytes)}를 계속 쓸 뿐이고, 그동안은 언제든 되돌립니다.`,
    },
    assist: {
      label: '휴지통 비우기',
      command: 'empty-recycle-bin',
      irreversible: true,
      note: '윈도우 공식 명령(Clear-RecycleBin)을 실행합니다. 되돌릴 수 없어요.',
    },
  }
}

/* ────────────────────────────────────────────────────────────
   윈도우 업데이트 캐시 (SoftwareDistribution\Download)

   존 C(잠금)다. 우리가 지울 수 있는 것도, 지워도 되는지 판단할 수 있는
   것도 아니다. 업데이트가 설치 중이면 여기 파일이 필요하고, 사용자 권한으론
   삭제도 안 된다. 그래서 '있다는 사실과 정식 도구'만 알려준다.
   ──────────────────────────────────────────────────────────── */
export function probeUpdateCache(f: ReclaimFacts): Finding | null {
  if (f.updateCacheBytes < REPORT_FLOOR_BYTES) return null

  return {
    id: 'win.updatecache',
    title: '윈도우 업데이트 캐시',
    bytes: f.updateCacheBytes,
    zone: 'LOCKED',
    explain: {
      what:
        '업데이트를 다 설치하고도 안 버린 포장재 같은 거예요. ' +
        `${f.systemDrive}\\Windows\\SoftwareDistribution\\Download 에 ${size(f.updateCacheBytes)}가 쌓여 있습니다.`,
      why:
        '설치가 실패하면 다시 쓰려고 남겨둡니다. 성공한 뒤에도 한동안 그대로라, ' +
        '업데이트를 많이 받은 PC일수록 커져요.',
      usedBy: [
        '윈도우 업데이트 — 설치 중이거나 되돌릴 때 이 파일을 씁니다.',
        '업데이트 재시도 — 실패한 걸 다시 시도할 때 여기 있는 걸 재사용해요.',
      ],
      ifRemoved: [
        '다음 업데이트 때 일부를 다시 내려받을 수 있어요(데이터를 그만큼 더 씁니다).',
        '업데이트를 되돌려야 하는 상황이면 그 자료가 사라집니다.',
      ],
      recovery: 'auto-regenerates',
      recoveryNote:
        '필요하면 윈도우가 다시 받아요. 다만 저희가 직접 지우진 않습니다 — ' +
        '관리자 권한이 필요하고, 업데이트가 쓰는 중일 수 있거든요.',
      ifKept: `아무 문제 없어요. ${size(f.updateCacheBytes)}를 계속 쓸 뿐입니다.`,
    },
    assist: {
      label: '윈도우 디스크 정리 열기',
      command: 'open-cleanmgr',
      irreversible: false,
      note:
        '윈도우가 만든 “디스크 정리”를 띄웁니다. 거기서 “Windows 업데이트 정리”를 고르시면 돼요. ' +
        '직접 안 건드리는 건, 지우다 실패하면 업데이트가 깨지기 때문입니다.',
    },
  }
}
