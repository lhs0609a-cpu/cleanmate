/**
 * 큰 덩어리 프로브 — 파일 하나가 수십 GB인 것들
 *
 * hiberfil·휴지통과 같은 계열이다. 파일 스캔으로는 잡아도 **뜻을 모르는** 것들.
 * 스캐너는 `ext4.vhdx 47GB`를 보고 '기타 파일'이라고 하고, 그러면 사용자는
 * 손을 못 댄다. 이런 건 파일이 아니라 **항목**으로 다뤄야 한다.
 *
 * ── 왜 이 셋인가 ─────────────────────────────────────────────
 *   WSL 배포판 디스크   개발자 PC에서 흔히 20~60GB. 안에서 지워도 안 줄어든다.
 *   Docker 데이터 디스크 위와 같은 물건. 이미지 몇 개면 30GB를 넘긴다.
 *   Windows.old        업그레이드 후 남는 이전 설치본. 20~30GB.
 * 셋 다 "있는 줄도 몰랐다"가 기본이고, 셋 다 우리가 함부로 못 지운다.
 *
 * ── 우리는 지우지 않는다 ─────────────────────────────────────
 * vhdx는 **가상 디스크 한 장이 그 환경 전부**다. 파일 하나 지우기가 곧
 * 리눅스 환경 통째로 날리기다. 그래서 여기서 하는 일은 딱 하나 —
 * 있다는 사실과 줄이는 정식 방법을 알려주는 것. 되돌리는 명령이 없으니
 * SystemAction으로 만들지 않는다(types.ts 규약).
 *
 * ── vhdx는 안에서 지워도 안 줄어든다 ─────────────────────────
 * 이게 사람들이 제일 많이 속는 지점이다. 리눅스 안에서 30GB를 지워도
 * 윈도우가 보는 파일 크기는 그대로다(동적 디스크는 커지기만 한다).
 * 줄이려면 안에서 비운 뒤 **압축**을 따로 해야 한다. 그 사실을 말해주지
 * 않으면 사용자는 "지웠는데 왜 그대로냐"에서 멈춘다.
 */

import type { Figure, Finding } from '../types.ts'
import { ps } from './shell.ts'

const GB = 1024 ** 3
const MB = 1024 ** 2
const size = (n: number) => (n >= GB ? `${(n / GB).toFixed(1)}GB` : `${Math.round(n / MB)}MB`)

/** 이보다 작으면 보고하지 않는다 — 화면을 아끼는 게 사용자를 아끼는 것이다. */
export const BULK_FLOOR_BYTES = 2 * GB

export type BulkKind = 'wsl' | 'docker' | 'windows-old'

export interface BulkItem {
  kind: BulkKind
  path: string
  bytes: number
  /** WSL 배포판 이름처럼 사람이 알아볼 이름. 모르면 빈 문자열 */
  label: string
}

/*
 * 와일드카드로 정확한 자리만 본다. `Get-ChildItem -Recurse`로 Packages 전체를
 * 훑으면 수십만 개를 걷는다 — 여기서 몇 분을 쓰면 프로브의 값어치가 없다.
 *
 * Windows.old만 재귀 합산이 필요하다(폴더라서). 이건 어쩔 수 없지만
 * 대개 한 번뿐이고 없으면 즉시 끝난다.
 */
const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$items = @()
$vhdPaths = @(
  "$env:LOCALAPPDATA\\Packages\\*\\LocalState\\*.vhdx",
  "$env:LOCALAPPDATA\\wsl\\*\\*.vhdx",
  "$env:LOCALAPPDATA\\Docker\\wsl\\*\\*.vhdx",
  "$env:LOCALAPPDATA\\Docker\\wsl\\*\\*\\*.vhdx",
  "$env:USERPROFILE\\.docker\\desktop\\*.vhdx"
)
foreach ($p in $vhdPaths) {
  foreach ($f in Get-ChildItem $p -Force -File) {
    $kind = if ($f.FullName -match '\\\\Docker\\\\') { 'docker' } else { 'wsl' }
    $items += [PSCustomObject]@{ kind = $kind; path = $f.FullName; bytes = [int64]$f.Length; label = $f.Directory.Parent.Name }
  }
}
$old = Join-Path $env:SystemDrive 'Windows.old'
if (Test-Path $old) {
  $sum = (Get-ChildItem $old -Force -Recurse -File | Measure-Object -Property Length -Sum).Sum
  if ($sum) { $items += [PSCustomObject]@{ kind = 'windows-old'; path = $old; bytes = [int64]$sum; label = '' } }
}
ConvertTo-Json -Compress -InputObject @($items)
`

export async function gatherBulkFacts(): Promise<BulkItem[]> {
  if (process.platform !== 'win32') return []
  const raw = JSON.parse((await ps(SCRIPT)) || '[]')
  const list: any[] = Array.isArray(raw) ? raw : [raw]
  return list
    .filter((r) => r && r.path && r.bytes)
    .map((r) => ({ kind: r.kind as BulkKind, path: r.path, bytes: Number(r.bytes), label: r.label ?? '' }))
}

/* ────────────────────────────────────────────────────────────
   항목 → 설명

   존을 나누는 기준은 "우리가 안전하게 지울 수 있나"가 아니라
   "사용자가 결정할 수 있나"다. vhdx는 사용자만 아는 것(존 B)이고,
   Windows.old는 윈도우의 정식 도구가 따로 있다(존 C + assist).
   ──────────────────────────────────────────────────────────── */

/**
 * 이 계열(WSL·Docker)에서 사람이 가장 안 믿는 한 마디.
 *
 * "안에서 지웠는데 왜 용량이 그대로냐"는 이 화면에 오는 가장 흔한 질문이고,
 * 문장으로는 아무리 써도 안 믿긴다. 같은 크기 상자 둘을 그리는 게 빠르다.
 * 문장은 그대로 둔다 — 터미널과 화면 낭독기에는 그림이 없다(types.ts 머리말).
 */
const GROWS_ONLY =
  '★ 그리고 이 파일은 커지기만 합니다 — 안에서 30GB를 지워도 윈도우가 보는 크기는 그대로예요.'
const DOCKER_GROWS_ONLY =
  '★ 이 파일도 커지기만 합니다 — Docker 안에서 지워도 윈도우가 보는 크기는 그대로예요.'

/**
 * 안이 달라져도 밖은 그대로 — 이 계열이 공유하는 그림.
 *
 * ★ 안에 얼마가 들었는지는 안 그린다. 우리는 그 값을 못 잰다.
 *   밖에서 보이는 건 파일 크기 하나뿐이라, 안쪽은 '못 잰 것'으로 그린다.
 *   여기에 그럴듯한 눈금을 그려 넣는 순간 이 그림이 거짓말이 된다.
 */
function onlyGrowsFigure(bytes: number, inside: string, replaced = GROWS_ONLY): Figure {
  return {
    kind: 'unchanged',
    bytes,
    beforeLabel: '지우기 전',
    afterLabel: '지운 뒤',
    betweenLabel: `${inside} 안에서 지워도`,
    insideNote: '안에 얼마나 들었는지는 밖에서 못 봅니다',
    alt:
      `${inside} 안에서 파일을 지워도 윈도우가 보는 이 파일 크기는 ` +
      `${size(bytes)} 그대로입니다. 이 파일은 커지기만 합니다.`,
    replaces: [replaced],
  }
}

function wslFinding(it: BulkItem): Finding {
  const who = it.label && !/^(LocalState|wsl|data|disk)$/i.test(it.label) ? it.label : '리눅스'
  return {
    id: `bulk.wsl.${it.path.toLowerCase()}`,
    title: `윈도우 안의 리눅스 저장소 — ${who}`,
    bytes: it.bytes,
    zone: 'AMBIG',
    explain: {
      what:
        `윈도우 안에 리눅스 컴퓨터가 하나 더 들어 있고, 그 컴퓨터의 저장소 전체가 파일 하나로 들어 있어요. 이 파일 하나가 ${size(it.bytes)}입니다.\n` +
        it.path,
      why: '리눅스 안에 설치한 것·받은 것이 전부 이 한 파일에 들어갑니다. ' + GROWS_ONLY,
      usedBy: [
        `${who} — 이 파일 하나가 곧 그 리눅스 전부예요. 안에 설치한 것·만든 것 모두.`,
        '개발용 프로그램을 이 리눅스에서 쓰신다면 그것들도 여기 들어 있습니다.',
      ],
      ifRemoved: [
        `★ 그 리눅스 환경이 통째로 사라집니다. 안에 있던 작업물도 함께입니다.`,
        `${size(it.bytes)}가 비지만, 되돌릴 방법이 없습니다.`,
      ],
      recovery: 'none',
      /**
       * ★ 명령어는 일부러 그대로 둔다.
       *   이건 사용자가 **직접 쳐야 하는 말**이라, 쉬운 말로 바꾸면 아예 쓸 수 없다.
       *   대신 "어디에 붙여넣는지"를 화면 그대로 적어준다 — 모르는 건 명령어가
       *   아니라 그 창을 어떻게 여는지다.
       */
      recoveryNote:
        '지우면 끝입니다. 그래서 저희는 건드리지 않아요.\n' +
        '용량만 줄이고 싶으시면 지우지 말고 쪼그라뜨리면 됩니다. 리눅스 안에서 필요 없는 걸 먼저 지우신 다음,\n' +
        '윈도우 검색창에 “PowerShell”을 치고 마우스 오른쪽 → “관리자 권한으로 실행”을 누른 뒤, 아래 두 줄을 그대로 붙여넣으세요:\n' +
        '  wsl --shutdown\n' +
        '  Optimize-VHD -Path "위에 적힌 경로" -Mode Full\n' +
        '안에서 지운 만큼 실제로 줄어듭니다.',
      ifKept: `아무 문제 없어요. ${size(it.bytes)}를 계속 쓸 뿐입니다.`,
    },
    figure: onlyGrowsFigure(it.bytes, '리눅스'),
  }
}

function dockerFinding(it: BulkItem): Finding {
  return {
    id: `bulk.docker.${it.path.toLowerCase()}`,
    title: 'Docker(개발용 프로그램)의 저장소',
    bytes: it.bytes,
    zone: 'AMBIG',
    explain: {
      what: `Docker(개발용 프로그램)가 받아둔 프로그램 묶음과 그 안에 저장한 자료를 담아두는 저장소예요. 파일 하나가 ${size(it.bytes)}입니다.\n${it.path}`,
      why:
        '한 번 받은 프로그램 묶음은 지우지 않는 한 계속 쌓입니다. 만들면서 생긴 임시 파일도 여기 들어가요. ' +
        DOCKER_GROWS_ONLY,
      usedBy: [
        'Docker — 받아둔 프로그램 묶음과 그 안에 만들어둔 것 전부입니다.',
        '여기에 자료를 저장하는 프로그램을 쓰셨다면 그 자료도 함께 들어 있습니다.',
      ],
      ifRemoved: [
        '★ 받아둔 프로그램 묶음과 그 안에 저장한 자료가 전부 사라집니다.',
        '프로그램 묶음은 다시 받을 수 있지만, 그 안에 저장한 자료는 되돌릴 수 없습니다.',
      ],
      recovery: 'none',
      recoveryNote:
        '파일을 지우는 대신 Docker에게 정리를 시키세요. 명령 창에 아래를 붙여넣으면 무엇을 지울지 먼저 보여줍니다:\n' +
        '  docker system prune -a --volumes\n' +
        '그다음 저장소 파일을 쪼그라뜨려야 윈도우 쪽 용량이 실제로 빕니다(위 리눅스 항목과 같은 방법).',
      ifKept: `아무 문제 없어요. ${size(it.bytes)}를 계속 쓸 뿐입니다.`,
    },
    figure: onlyGrowsFigure(it.bytes, 'Docker', DOCKER_GROWS_ONLY),
  }
}

function windowsOldFinding(it: BulkItem): Finding {
  return {
    id: 'bulk.windows-old',
    title: '이전 윈도우 설치본 (Windows.old)',
    bytes: it.bytes,
    zone: 'LOCKED',
    explain: {
      what: `윈도우를 업그레이드하기 전의 시스템이 통째로 남아 있어요. ${size(it.bytes)}입니다.`,
      why:
        '업그레이드가 마음에 안 들면 되돌릴 수 있게 윈도우가 남겨둡니다. ' +
        '보통 10일이 지나면 알아서 지워지는데, 그 전이면 그대로 있어요.',
      usedBy: [
        '이전 버전으로 되돌리기 — 설정의 복구 메뉴가 이 폴더를 씁니다.',
        '업그레이드 전에 쓰던 파일 찾기 — 예전 사용자 폴더가 이 안에 남아 있습니다.',
      ],
      ifRemoved: [
        `${size(it.bytes)}가 비워집니다. 숨은 공간 중 가장 큰 편이에요.`,
        '★ 이전 버전으로 되돌리기가 불가능해집니다.',
      ],
      recovery: 'none',
      recoveryNote:
        '되돌릴 수 없습니다. 그리고 저희가 직접 지우지 않아요 — 시스템 권한이 필요하고, ' +
        '잘못 건드리면 복구 기능이 깨집니다. 윈도우의 “디스크 정리”가 정식 통로입니다.',
      ifKept: '업그레이드 후 10일쯤 지나면 윈도우가 알아서 지웁니다. 기다리셔도 됩니다.',
    },
    assist: {
      label: '윈도우 디스크 정리 열기',
      command: 'open-cleanmgr',
      irreversible: true,
      note: '“이전 Windows 설치” 항목을 고르시면 됩니다. 지우면 이전 버전으로 되돌릴 수 없어요.',
    },
  }
}

/** 찾은 큰 덩어리를 설명이 붙은 항목으로. 작은 건 아예 보고하지 않는다. */
export function probeBulk(items: BulkItem[]): Finding[] {
  return items
    .filter((it) => it.bytes >= BULK_FLOOR_BYTES)
    .map((it) =>
      it.kind === 'docker' ? dockerFinding(it) : it.kind === 'windows-old' ? windowsOldFinding(it) : wslFinding(it)
    )
}
