/**
 * 엔진 IPC 창구 — UI와 엔진을 잇는 유일한 통로
 *
 * 데스크톱 앱(Tauri)은 이걸 사이드카로 품고, "명령 + 인자"를 주면
 * JSON 한 줄을 돌려받는다. 검증된 엔진(scan/classify/sweep/quarantine/probe)을
 * 그대로 재사용한다 — 재작성 0. (docs/배포-아키텍처.md §2)
 *
 * 이 파일은 '배선'만 한다. 판단·격리·복구는 이미 테스트된 모듈이 한다.
 *
 * 규약: stdout에 JSON 한 줄만 낸다(그래야 Rust가 파싱하기 쉽다).
 *   성공 → {"ok":true,"data":...}
 *   실패 → {"ok":false,"error":"사람이 읽을 메시지"}  + exit 1
 *   진행 로그·경고는 전부 stderr로 (stdout을 오염시키지 않는다).
 *
 * 사용: teraclean-engine <command> [json-args]
 *   default-roots                    이 PC에서 기본으로 훑을 폴더 목록
 *   scan-plan      <path...>         스캔(여러 곳 가능) → 3-존 + 정리 계획 + 질문
 *   apply-sweep    <path...>         존 A 자동 정리 — 곧바로 지운다
 *   quar-list                        지우다 남은 것 목록 (+ 옛 버전 보관함에 남은 것)
 *   restore        <id|--all>        남은 것을 원래 자리로 되돌리기
 *   purge                            남은 것 중 30일 지난 것 삭제 (옛 약속의 만료분)
 *   probe                            숨은 공간(hiberfil·휴지통·업데이트 캐시)
 *   answer-plan    <unknown> [path...]        그 질문에 걸린 항목 미리보기
 *   answer-apply   <unknown> <outcome> [path...] 답변 실행 — 정리는 곧바로 삭제
 *   quarantine-paths <path...>       고른 파일만 삭제 (묶음이 아니라 낱개)
 *   quarantine-folders <path...>     폴더째 삭제 (.venv·node_modules 같은 결정 단위)
 *   proposal-apply <id>              정리 목록의 카드 하나를 삭제 (스캔 때 적어둔 목록)
 *   startup                          시작프로그램 목록 + 판정
 *   startup-tasks                    로그온 예약작업 개수 (느려서 목록과 분리)
 *   startup-set    <id> <on|off>     시작프로그램 켜기/끄기 (되돌릴 수 있음)
 *   empty-recycle-bin                휴지통 비우기(윈도우 공식 명령, 되돌리기 없음)
 *   hibernate-off | hibernate-on     최대 절전 끄기·켜기 (관리자 확인 후, 되돌릴 수 있음)
 *   open-system-protection           시스템 복원 설정 창 열기
 *   restore-measure                  시스템 복원이 잡아둔 공간을 관리자 권한으로 재기 (읽기만)
 *   open-virtual-memory              가상 메모리 설정 창 열기
 *   open-cleanmgr                    윈도우 디스크 정리 도구 띄우기
 *   relocate-scan                    옮길 만한 것 자동 탐색 + 대상 드라이브 목록
 *   relocate-plan  <path> <destRoot> 다른 드라이브로 옮길 계획(미리보기)
 *   relocate-apply <path> <destRoot> 실제 이동
 *   relocate-paths-plan  <destRoot> <path...> 고른 파일만 옮길 계획(미리보기)
 *   relocate-paths-apply <destRoot> <path...> 고른 파일만 실제 이동
 *   relocate-folder-plan  <destRoot> <folder> 폴더째 옮기고 바로가기 남기기(미리보기)
 *   relocate-folder-apply <destRoot> <folder> 폴더째 이동 + 원래 자리에 정션
 *   drives                           붙어 있는 드라이브와 남은 공간 (파일은 안 봄)
 *   dupes-scan     [path...]         같은 파일이 여러 벌 있는 것 (크기→내용 대조)
 *   model-roots                      AI 모델이 사는 폴더 자동 탐색
 *   dupes-link     <남길 것> <사본...>  사본 자리를 하드링크로 — 지우지 않고 합친다
 *   merge-list                       합쳐둔 것 목록
 *   merge-undo     <id|--all>        합친 것을 다시 따로 떼기(용량을 도로 씀)
 *   backup-check   <path...>         이 파일들이 클라우드에도 있나 (하루 캐시)
 *   relocate-list  <destRoot>        옮긴 목록
 *   relocate-undo  <destRoot> <id|--all>  이동 되돌리기
 *   programs                         오래 안 쓴 설치 프로그램 (제안만)
 *
 * ★ 프로그램 '제거'는 여기 없다. 정식 언인스톨러를 띄우는 건 셸(Tauri)이 한다 —
 *   엔진은 파일도 프로그램도 임의로 지우지 않는다.
 *
 * ★ 보관함(30일 격리)은 없앴다. 같은 드라이브 안으로 옮기는 것이라 그동안
 *   용량이 하나도 안 빴기 때문이다. 격리 모듈은 그대로 쓰지만 **삭제의 앞 단계**로만
 *   쓴다(deleteNow) — 옮기고 나서 곧바로 지운다. quar-list·restore·purge가 남아
 *   있는 건 옛 버전이 보관해둔 것을 되돌리거나 마저 지우기 위해서다.
 */

import { stat, readFile, writeFile, mkdir, appendFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { parseArgv } from "./argv.ts"
import { join, dirname, basename } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { scan } from './scanner.ts'
import { classifyOne, isAutoEligible } from './classify.ts'
import { run as runEngine, actionFor } from './engine.ts'
import { planSweep, applySweep } from './sweep.ts'
import {
  readManifest,
  restore,
  isExpired,
  listQuarantineRoots,
  purgeExpired,
  purgeNow,
  purgeEntries,
  GRACE_DAYS,
} from './quarantine.ts'
import { defaultRoots } from './presets.ts'
import { buildBreakdown } from './breakdown.ts'
import { groupByKind, describeMix, kindOf } from './kinds.ts'
import { ownerOf, ownerHeadline } from './owners.ts'
import { computeProgress, type RootWeight } from './progress.ts'
import { analyze, type AnalyzeFile } from './analyze.ts'
import { UNKNOWN_EXPLAIN } from './content/unknowns.ts'
import { gatherFacts } from './probes/facts.ts'
import { probeHiberfil } from './probes/hiberfil.ts'
import { gatherReclaimFacts, probeRecycleBin, probeUpdateCache } from './probes/reclaim.ts'
import { gatherBulkFacts, probeBulk } from './probes/bulk.ts'
import {
  gatherPageFile, probePageFile, gatherRestore, probeRestore, parseRestore, VSS_QUERY,
} from './probes/system-space.ts'
import { probeStartup, countLogonTasks, setStartupEnabled } from './probes/startup.ts'
import {
  planFolderTidy,
  applyFolderTidy,
  undoFolderTidy,
  readFolderEntries,
  tidyFolderName,
  type FolderEntry,
} from './tidyfolder.ts'
import { quarantine, type QuarantineRequest } from './quarantine.ts'
import {
  isPhoto,
  groupBySize,
  contentHash,
  buildDupGroups,
  planPhotos,
  type PhotoFile,
} from './photos.ts'
import {
  ROUTINES,
  emptyState,
  markDone,
  undoDone,
  planToday,
  todayISO,
  type TidyState,
} from './content/tidy.ts'
import {
  probePrograms, detectSilentUninstall, uninstallCommandFor, needsElevation, isStillInstalled,
} from './probes/programs.ts'
import {
  isRelocatable,
  relocateBlockReason,
  junctionBlockReason,
  moveFolderWithJunction,
  measureFolder,
  destinationFor,
  ledgerPathFor,
  isSameVolume,
  type RelocateEntry,
  planRelocate,
  applyRelocate,
  readRelocateLedger,
  undoRelocate,
  movedFolderOn,
  relocateRoots,
  listDrives,
  freeSpaceOn,
  hasEnoughSpace,
  type RelocateItem,
} from './relocate.ts'
import { stampMtime } from './quarantine.ts'
import { findDuplicates, findInstallCauses, isModelFile, DUP_MIN_BYTES } from './dupes.ts'
import {
  mergeIntoLink,
  mergeBlockReason,
  appendMergeLedger,
  readMergeLedger,
  splitLink,
  linkStillAlive,
  type MergeEntry,
} from './link.ts'
import {
  foldIntoUnits,
  folderCandidates,
  lastTouched,
  noteSourceFile,
  attachActivity,
  activitySentence,
  looksLikeOneShot,
  type SourceDirs,
} from './units.ts'
import {
  cloudRoots,
  buildBackupIndex,
  checkBackup,
  GOOGLE_DRIVE_FOLDERS,
  type BackupIndex,
  type CloudRoot,
} from './backup.ts'
import type { Classified, FileEntry, Outcome } from './types.ts'

/** 이보다 작은 파일은 옮겨봐야 체감이 없다 — 목록만 길어진다. */
const RELOCATE_MIN_BYTES = 100 * 1024 * 1024 // 100MB

/**
 * 목록에 올릴 파일 하나를 사람이 읽을 수 있게 만든다.
 *
 * 종류(kind)만 붙이던 자리다. `torch_cuda.dll · 개발 중간 산출물 · 1.2GB`로는
 * 아무도 결정을 못 내린다 — 뭐가 깨지는지를 말하지 않으니까. 그래서 소유자
 * 판별(owners.ts)을 함께 실어 보낸다: 누구 것이고, 지우면 무슨 일이 생기고,
 * 어디까지 영향을 주는지. 판단은 화면이 아니라 여기서 끝난다.
 */
function withOwner<T extends { path: string }>(x: T) {
  const owner = ownerOf(x.path)
  /**
   * "지울까요?" 옆에 "옮길 수도 있어요"를 같이 붙인다.
   *
   * ★ 왜 목록에 싣나: 큰 파일 앞에서 사람이 멈추는 이유는 "지우긴 아까운데
   *   자리는 차지한다"이고, 그 답은 삭제가 아니라 이동이다. 그런데 여태 이동은
   *   별도 화면에서 **다른 폴더를 다시 훑는** 기능이라, 지금 보고 있는 이 파일을
   *   옮길 수 있는지는 화면 어디에도 없었다. 판단에 필요한 정보를 판단하는
   *   자리에 둔다 — 옮기면 깨지는 것은 이유까지 함께.
   */
  const blocked = relocateBlockReason(x.path)
  return {
    ...x,
    kind: kindOf(x.path).label,
    owner,
    headline: ownerHeadline(owner),
    move: blocked ? { ok: false, why: blocked } : { ok: true, why: '' },
  }
}

/**
 * stat 결과 하나를 스캐너와 **같은 모양의** FileEntry로 만든다.
 *
 * 낱개 경로를 다시 분류할 때 쓴다(quarantine-paths). 여기서 모양이 어긋나면
 * 같은 파일을 스캔 경로와 낱개 경로가 다르게 판정하게 된다 — 그러면
 * "목록에선 지워도 된다더니 고르니까 거절한다"가 나온다.
 * 그래서 scanner.ts의 생성부와 한 글자씩 맞춘다.
 */
function fileEntryOf(path: string, st: import('node:fs').Stats): FileEntry {
  const name = path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1)
  return {
    path,
    size: st.size,
    mtime: st.mtime,
    atime: st.atime,
    ext: name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '',
    ageDays: Math.floor((Date.now() - st.mtime.getTime()) / 86_400_000),
  }
}

/**
 * 옮길 후보를 고른다. 스캔 → 옮겨도 되는 것만 → 큰 것만.
 * 계획 단계라 아무것도 건드리지 않는다.
 */
async function relocateCandidates(path: string): Promise<{ items: RelocateItem[]; refused: { path: string; reason: string }[] }> {
  const scanned = await scan(path)
  const items: RelocateItem[] = []
  const refused: { path: string; reason: string }[] = []

  for (const f of scanned.files) {
    if (f.size < RELOCATE_MIN_BYTES) continue
    const c = classifyOne(f)
    const ok = isRelocatable(c)
    if (!ok.ok) {
      refused.push({ path: f.path, reason: ok.reason ?? '옮길 수 없습니다' })
      continue
    }
    items.push({
      path: f.path,
      size: f.size,
      meaning: c.verdict.meaning,
      reason: c.verdict.reason,
      mtimeMs: stampMtime(f.mtime.getTime()),
    })
  }
  return { items, refused }
}

/* ────────────────────────────────────────────────────────────
   AI 모델이 사는 자리 찾기

   폴더 이름으로 알아본다. 깊이는 2단계까지만 — 여기서 전체를 훑으면
   "찾는 데 몇 분"이 되고, 그러면 찾아주는 값어치가 없다.
   ──────────────────────────────────────────────────────────── */

/** 이 이름이 들어간 폴더는 AI 모델을 담고 있을 가능성이 높다. */
const MODEL_FOLDER = /comfyui|stable[-_ ]?diffusion|automatic1111|forge|fooocus|invokeai|webui|ollama|lm[-_ ]?studio|koboldcpp|text[-_ ]?generation|huggingface|^ai$|^models$/i

/**
 * 이름은 걸렸지만 모델이 사는 자리가 아닌 것들.
 * 실측에서 걸린 것: `node_modules\@huggingface`(그냥 부품), `Programs\Ollama`(프로그램
 * 본체), `Microsoft\Office\AI`(오피스 기능). 이런 걸 목록에 올리면 사용자는
 * "왜 이게 뜨지?"부터 묻게 되고, 그 순간 나머지 결과도 못 믿는다.
 */
const NOT_MODEL_ROOT = /[\\/]node_modules[\\/]|[\\/]appdata[\\/]local[\\/]programs[\\/]|[\\/]microsoft[\\/]/i

async function findModelRoots(): Promise<{ label: string; path: string }[]> {
  const { readdir } = await import('node:fs/promises')
  const home = homedir()
  const found: { label: string; path: string }[] = []
  const add = (p: string) => {
    if (!found.some((f) => f.path.toLowerCase() === p.toLowerCase())) {
      found.push({ label: p.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? p, path: p })
    }
  }

  /** dir 아래를 depth 단계까지 보며 이름이 걸리는 폴더를 모은다. */
  async function look(dir: string, depth: number): Promise<void> {
    if (depth <= 0) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const full = join(dir, e.name)
      if (NOT_MODEL_ROOT.test(full + '\\')) continue
      if (MODEL_FOLDER.test(e.name)) {
        add(full)
        continue // 걸린 폴더 안은 더 안 판다 — 그 안이 통째로 대상이다
      }
      await look(full, depth - 1)
    }
  }

  // 드라이브 뿌리(C:\AI 같은 것), 홈, 그리고 프로그램이 자기 자료를 넣는 자리.
  for (const d of await listDrives()) await look(d.root, 2)
  await look(home, 2)
  for (const p of [join(home, 'AppData', 'Local'), join(home, 'AppData', 'Roaming')]) await look(p, 3)
  return found
}

/**
 * 고른 파일만 옮길 계획을 세운다 — **폴더가 아니라 낱개.**
 *
 * ── 왜 필요했나 ──────────────────────────────────────────────
 * 이동은 여태 '폴더 단위'였다(relocate-plan <폴더> <드라이브>). 그런데 사용자가
 * 큰 파일을 마주하는 자리는 질문 목록이고, 거기서 "옮길래요"를 고르면 화면은
 * **전혀 다른 폴더를 다시 훑는** 이동 화면으로 보냈다. 방금 보던 40개는 사라지고
 * 다운로드·영상 폴더의 목록이 떴다. 삭제 쪽은 이미 낱개 통로가 있는데
 * (quarantine-paths) 이동만 없어서 생긴 비대칭이다.
 *
 * ── 밖에서 온 경로를 그냥 믿지 않는다 ────────────────────────
 * quarantine-paths와 같은 규칙이다. 경로마다 지금 다시 stat하고 다시 분류해서
 * 존 C면 거절한다. 이동은 삭제보다 되돌리기가 번거로워서 오히려 더 엄격하다.
 */
async function relocatePathsPlan(destRoot: string, paths: string[]) {
  const items: RelocateItem[] = []
  const refused: { path: string; reason: string }[] = []

  for (const p of paths) {
    let st
    try {
      st = await stat(p)
    } catch {
      refused.push({ path: p, reason: '파일을 찾지 못했어요' })
      continue
    }
    if (!st.isFile()) {
      refused.push({ path: p, reason: '파일이 아니에요 — 폴더는 낱개로 다루지 않습니다' })
      continue
    }
    const c = classifyOne(fileEntryOf(p, st))
    const ok = isRelocatable(c)
    if (!ok.ok) {
      refused.push({ path: p, reason: ok.reason ?? '옮길 수 없습니다' })
      continue
    }
    items.push({
      path: p,
      size: st.size,
      meaning: c.verdict.meaning,
      reason: `목록에서 직접 고르신 것 — ${c.verdict.meaning}`,
      mtimeMs: stampMtime(st.mtimeMs),
    })
  }

  const plan = planRelocate(items, destRoot)
  return { plan, refused, destination: await checkDestination(destRoot, plan.bytes) }
}

/* ────────────────────────────────────────────────────────────
   백업 색인 — 클라우드 폴더를 하루 한 번만 훑는다
   ──────────────────────────────────────────────────────────── */

const BACKUP_INDEX_VERSION = 1
const BACKUP_INDEX_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * 이 PC의 클라우드 폴더를 모은다.
 *
 * 홈 폴더 아래(OneDrive·Dropbox)는 순수 함수가 답하지만, 구글 드라이브는
 * **드라이브 문자로 붙는다**(G:\내 드라이브). 그건 실제로 있는지 봐야 알 수
 * 있어서 여기서 확인한다 — 판단은 backup.ts, 확인은 여기.
 */
async function presentCloudRoots(): Promise<CloudRoot[]> {
  const roots = cloudRoots({ home: homedir(), vars: process.env as Record<string, string | undefined> })
  const present: CloudRoot[] = []
  for (const r of roots) {
    try {
      if ((await stat(r.path)).isDirectory()) present.push(r)
    } catch {
      /* 그 클라우드를 안 쓰는 PC다 */
    }
  }
  for (const d of await listDrives()) {
    for (const name of GOOGLE_DRIVE_FOLDERS) {
      const p = join(d.root, name)
      try {
        if ((await stat(p)).isDirectory()) present.push({ label: '구글 드라이브', path: p })
      } catch {
        /* 없으면 없는 대로 */
      }
    }
  }
  return present
}

async function loadBackupIndex(
  refresh = false
): Promise<{ index: BackupIndex; roots: CloudRoot[]; builtAt: number; partial: boolean }> {
  const roots = await presentCloudRoots()
  const file = appDataFile('backup-index.json')

  if (!refresh) {
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'))
      if (
        raw.version === BACKUP_INDEX_VERSION &&
        Date.now() - raw.builtAt < BACKUP_INDEX_MAX_AGE_MS &&
        // 클라우드 구성이 바뀌었으면 남의 색인이다.
        JSON.stringify(raw.roots) === JSON.stringify(roots.map((r) => r.path))
      ) {
        return {
          index: new Map(raw.entries as [string, string][]),
          roots,
          builtAt: raw.builtAt,
          partial: !!raw.partial,
        }
      }
    } catch {
      /* 없거나 낡았으면 새로 만든다 */
    }
  }

  const index: BackupIndex = new Map()
  let partial = false
  // 전체 예산 60초. 백업 확인은 **없어도 되는 부가 정보**다 — 이걸 위해
  // 사용자를 몇 분 기다리게 하면 그건 기능이 아니라 방해다. 덜 훑으면 못 찾을
  // 뿐이고, 우리는 "있다"만 말하지 "없다"고는 말하지 않으므로 틀린 말이 안 된다.
  const deadlineMs = Date.now() + 60_000
  for (const [i, r] of roots.entries()) {
    progress({ t: 'backup-index', rootIndex: i, rootCount: roots.length, root: r.path, label: r.label })
    try {
      // 깊이도 제한한다 — 백업본은 대개 얕은 자리에 있다.
      const scanned = await scan(r.path, { maxDepth: 8, deadlineMs })
      if (scanned.truncated) partial = true
      buildBackupIndex(scanned.files, r.label, index)
    } catch {
      continue
    }
  }

  const builtAt = Date.now()
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(
      file,
      JSON.stringify({
        version: BACKUP_INDEX_VERSION,
        builtAt,
        partial,
        roots: roots.map((r) => r.path),
        entries: [...index],
      }),
      'utf8'
    )
  } catch {
    /* 색인을 못 남겼다고 결과를 버릴 이유는 없다. 다음에 다시 만들 뿐이다. */
  }
  return { index, roots, builtAt, partial }
}

/** 대상 드라이브에 넣을 수 있는지 확인한다. 못 넣으면 이유를 준다. */
async function checkDestination(destRoot: string, needBytes: number) {
  const free = await freeSpaceOn(destRoot)
  if (free === null) return { ok: false as const, reason: '대상 드라이브의 남은 공간을 확인할 수 없어요' }
  if (!hasEnoughSpace(free, needBytes)) {
    return {
      ok: false as const,
      reason: '대상 드라이브에 여유가 부족해요. 꽉 채우면 그 드라이브가 다음 문제가 됩니다.',
      freeBytes: free,
    }
  }
  return { ok: true as const, freeBytes: free }
}

/**
 * PowerShell 한 줄 실행. 명령은 이 파일 안에 하드코딩된 것만 들어온다 —
 * 밖에서 받은 문자열을 셸에 넘기는 통로를 만들지 않는다.
 */
async function runPowerShell(command: string): Promise<void> {
  await promisify(execFile)(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { windowsHide: true }
  )
}

/**
 * 승격해서 여는 통로. **엔진 안에 하드코딩된 것만** 연다 —
 * 밖에서 온 문자열을 파워셸에 넘기는 자리를 만들지 않는다(SystemAction과 같은 원칙).
 *
 * $ErrorActionPreference='Stop'이 반드시 있어야 한다. 없으면 사용자가 관리자
 * 확인 창에서 '아니오'를 눌러도 파워셸이 0으로 끝나서, 우리는 열린 줄 안다.
 */
const ELEVATED_OPEN: Record<string, string> = {
  'SystemPropertiesProtection.exe':
    "$ErrorActionPreference='Stop'; $p = Start-Process SystemPropertiesProtection.exe -Verb RunAs -PassThru; " +
    "Start-Sleep -Milliseconds 1200; if ($p.HasExited) { exit 3 }",
  'SystemPropertiesPerformance.exe':
    "$ErrorActionPreference='Stop'; $p = Start-Process SystemPropertiesPerformance.exe -Verb RunAs -PassThru; " +
    "Start-Sleep -Milliseconds 1200; if ($p.HasExited) { exit 3 }",
}

/** 사람이 화면에서 찾을 이름. "SystemPropertiesPerformance.exe를 닫으세요"는 안내가 아니다. */
const TOOL_NAME: Record<string, string> = {
  'SystemPropertiesProtection.exe': '시스템 속성',
  'SystemPropertiesPerformance.exe': '성능 옵션',
  'cleanmgr.exe': '디스크 정리',
}

/**
 * 창이 떴는지 판정할 시간.
 *
 * 이 도구들은 **창을 띄우는 stub**이라, 창이 살아 있는 동안 프로세스도 같이 산다.
 * 곧바로 종료되면 창을 안 띄웠다는 뜻이다. 실측(2026-08-21):
 *   [성능 옵션]이 떠 있는 상태에서 다시 띄우면 →  둘 다 종료코드 0으로 즉시 종료, 창 없음
 *   아무것도 안 떠 있을 때                    →  살아 있고 [성능 옵션] 창이 보임(True)
 */
const WINDOW_CHECK_MS = 1200
/** 창이 안 뜬 이유가 하나뿐이라 그걸 그대로 말한다. 실측으로 확인한 것이다. */
const EXIT_WINDOW_GONE = 3
function windowGoneMessage(exe: string): string {
  return `${TOOL_NAME[exe] ?? exe} 창이 안 떴어요. 윈도우는 이 창을 한 번에 하나만 띄웁니다 — ` +
    '"시스템 속성"이나 "성능 옵션" 창이 이미 열려 있으면 새 창이 안 떠요. ' +
    '열려 있는 창을 찾아 닫고 다시 눌러주세요.'
}

/**
 * 윈도우의 정식 도구를 띄운다 — **열렸는지 보고** 답한다.
 *
 * ★ 실물에서 터졌다(2026-08-21). "가상 메모리 설정 열기"를 눌렀더니 아무 창도
 *   안 뜨고 버튼만 "열었어요"로 바뀌었다. 잘못이 두 겹이었다.
 *
 *   ① spawn은 실패를 **나중에** 'error' 이벤트로 알린다. 그런데 우리는 곧바로
 *      out({opened:true})를 부르고 process.exit(0)로 죽었다. 실패가 도착할
 *      자리가 아예 없었던 것이다 — 무슨 일이 있어도 "열었어요"라고 답했다.
 *
 *   ② 실패 이유는 EACCES였다. 파일이 없는 게(ENOENT) 아니라 CreateProcess가
 *      "이건 관리자로 띄워야 한다"고 거절한 것이다
 *      (ERROR_ELEVATION_REQUIRED 740을 libuv가 EACCES로 옮긴다). 실측:
 *        SystemPropertiesPerformance.exe   거절: EACCES
 *        SystemPropertiesProtection.exe    거절: EACCES
 *        cleanmgr.exe                      실행됨
 *
 * CreateProcess는 UAC를 안 띄우고 그냥 거절한다. ShellExecute(=Start-Process)는
 * 그 자리에서 UAC를 띄운다. 그래서 **거절당했을 때만** 그쪽으로 다시 띄운다 —
 * 권한이 필요 없는 PC에 괜히 확인 창을 띄우지 않는다.
 * (main.rs가 제거 창을 740일 때만 승격하는 것과 같은 판단)
 */
async function openTool(exe: string, args: string[] = []): Promise<{ elevated: boolean }> {
  let child: ReturnType<typeof spawn> | null = null
  try {
    child = await new Promise<ReturnType<typeof spawn>>((resolve, reject) => {
      const c = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false })
      c.once('error', reject)
      // 'spawn'이 와야 진짜 떴다. 여기서 unref하면 우리가 먼저 죽어 창이 못 뜬다.
      c.once('spawn', () => resolve(c))
    })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'EACCES') {
      fail(`창을 열지 못했어요(${code ?? '알 수 없는 오류'}). 시작 메뉴에서 "${TOOL_NAME[exe] ?? exe}"를 직접 열어보실 수 있어요.`)
    }
    const elevate = ELEVATED_OPEN[exe]
    if (!elevate) fail(`이 창은 관리자 권한이 필요한데, 저희가 올려서 띄우는 통로가 없어요: ${exe}`)
    try {
      await runPowerShell(elevate)
    } catch (e) {
      if ((e as { code?: number }).code === EXIT_WINDOW_GONE) fail(windowGoneMessage(exe))
      fail('관리자 확인이 취소돼서 창을 못 열었어요 — 다시 눌러 "예"를 선택해 주세요.')
    }
    return { elevated: true }
  }

  // 권한 없이 떴다면, 그게 **창을 띄운 것**인지 곧바로 끝난 것인지 확인한다.
  await new Promise((r) => setTimeout(r, WINDOW_CHECK_MS))
  if (child.exitCode !== null) fail(windowGoneMessage(exe))
  child.unref()
  return { elevated: false }
}

/**
 * 시스템 복원이 잡아둔 공간을 **관리자 권한으로** 잰다.
 *
 * ★ 왜 파일로 받나. Start-Process -Verb RunAs는 승격된 **별도 프로세스**를 띄운다.
 *   그쪽 stdout은 우리 파이프로 안 온다 — 그래서 여기서 결과를 못 읽는다.
 *   승격된 쪽이 파일에 적고, 우리가 그 파일을 읽는다.
 *
 * ★ 왜 -EncodedCommand인가. 스크립트를 -Command 인자로 넘기면 따옴표가
 *   파워셸을 두 번 지나며 망가진다(바깥 파워셸 → Start-Process → 안쪽 파워셸).
 *   base64(UTF-16LE)는 그 사이를 그대로 통과한다. -File을 쓰면 실행 정책에
 *   막히는 PC가 있어서 그쪽도 안 쓴다.
 *
 * ★ 이 통로는 읽기만 한다. 스크립트는 고정 문자열이고(VSS_QUERY), 밖에서 온
 *   값이 섞이는 자리는 결과 파일 경로뿐인데 그건 우리가 만든 임시 경로다.
 */
async function measureRestoreElevated(): Promise<{ facts: ReturnType<typeof parseRestore>; cancelled: boolean }> {
  const outPath = join(tmpdir(), `teraclean-vss-${process.pid}-${Date.now()}.json`)
  // 경로에 작은따옴표가 낄 일은 없지만, 스크립트에 값을 넣는 유일한 자리라 막아둔다.
  const literal = outPath.replace(/'/g, "''")
  const child = `${VSS_QUERY}
[System.IO.File]::WriteAllText('${literal}', $json)`
  const encoded = Buffer.from(child, 'utf16le').toString('base64')

  try {
    await runPowerShell(
      "Start-Process powershell -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','" +
        encoded +
        "' -Verb RunAs -Wait -WindowStyle Hidden"
    )
  } catch {
    // 확인 창에서 '아니오'를 누르면 Start-Process가 던진다 — 취소와 실패를 갈라서 말한다.
    return { facts: parseRestore(''), cancelled: true }
  }

  let raw = ''
  try { raw = await readFile(outPath, 'utf8') } catch { /* 승격은 됐는데 못 읽었다 */ }
  try { await rm(outPath, { force: true }) } catch { /* 임시 파일 청소 실패는 삼킨다 */ }
  return { facts: parseRestore(raw), cancelled: false }
}

function out(data: unknown): never {
  process.stdout.write(JSON.stringify({ ok: true, data }))
  process.exit(0)
}
function fail(message: string): never {
  process.stdout.write(JSON.stringify({ ok: false, error: message }))
  process.exit(1)
}

/* ── 진행 상황 중계 ────────────────────────────────────────────
   stdout은 결과 JSON 한 줄만 쓴다(규약). 그래서 진행 상황은 stderr로 흘린다 —
   Rust(main.rs)가 한 줄씩 읽어 창으로 이벤트를 보내고, 화면이 그린다.

   ★ 왜 필요했나: 엔진이 결과를 한 번에 돌려주는 구조라 화면은 경과 시간만
     보여줄 수 있었다. 7분이 지나도 반이나 왔는지 알 수 없었다. */

/** stderr에 한 줄. 실패해도 스캔을 멈추지 않는다 — 진행 표시가 본 작업을 막으면 안 된다. */
function progress(data: unknown): void {
  try {
    process.stderr.write(JSON.stringify(data) + '\n')
  } catch {
    /* 파이프가 닫혔을 뿐이다. 스캔은 계속한다. */
  }
}

/** 앱 데이터 폴더의 파일 하나. 서버에 안 올린다 — 무엇도 기기를 떠나지 않는다. */
function appDataFile(name: string): string {
  const base =
    process.env.APPDATA ??
    process.env.XDG_DATA_HOME ??
    join(homedir(), '.local', 'share')
  return join(base, 'TeraClean', name)
}

/* ── 폴더별 파일 수 기록 ───────────────────────────────────────
   진행률(%)의 근거다. 폴더를 훑기 전에는 파일이 몇 개인지 알 수 없으니,
   지난번 스캔의 개수를 총량으로 쓴다. 파일 수는 하루 만에 크게 변하지 않는다.
   첫 스캔에는 이 기록이 없어서 폴더 개수로만 세고, 화면이 그렇다고 밝힌다. */

/* ── 정리 계획 캐시 ────────────────────────────────────────────
   ★ 왜 필요한가 (실물에서 잰 것): "지금 정리하기"를 누르면 **방금 끝낸 스캔을
     처음부터 다시** 돌렸다. 이 PC 기준 14만 개에 7분이다. 화면은 이미 "10.1GB
     정리 가능"이라고 숫자까지 보여준 뒤인데, 누르면 그 7분을 다시 기다렸다.

     그런데 scanPlan은 그 7분 동안 모든 파일을 분류하면서 isAutoEligible까지
     이미 계산한다. 즉 지울 목록은 **이미 만들어졌다가 버려지고 있었다.**
     버리지 말고 적어두면 두 번째 스캔이 통째로 사라진다.

   ★ 그래도 다시 확인한다: 캐시는 '무엇을 지울지'의 후보일 뿐이고, 실제 삭제는
     파일마다 크기·수정일을 대조한 뒤에만 한다(quarantine의 expect).
     캐시가 낡았으면 그 파일들이 조용히 건너뛰어질 뿐, 엉뚱한 게 지워지지 않는다.

   ★ 사유 문자열은 사전으로 접는다. 9만 개 항목이 같은 문장 수십 개를 나눠 쓰므로
     그대로 적으면 파일이 수십 MB가 된다. 규칙 수만큼만 적고 번호로 가리킨다. */

const PLAN_CACHE_VERSION = 2 // v2: 2순위 목록을 같은 파일에 함께 적는다
/** 이보다 오래된 계획은 안 쓴다. 오래 묵은 목록으로 지우기 시작하면 안 된다. */
const PLAN_CACHE_MAX_AGE_MS = 60 * 60 * 1000

interface CachedPlan {
  version: number
  createdAt: number
  roots: string[]
  /** [meaning, reason] 쌍 — 항목이 번호로 가리킨다 */
  kinds: [string, string][]
  /** 1순위 — [path, size, mtimeMs, kindIndex] */
  items: [string, number, number, number][]
  /**
   * 2순위 — 같은 형식, 같은 파일.
   *
   * 왜 파일을 따로 안 만드나: 두 목록은 **같은 스캔에서 나온 한 벌**이다.
   * 파일을 나누면 1순위만 새것이고 2순위는 헌것인 상태가 생기는데, 그때 화면은
   * 그 차이를 알 방법이 없다. 같이 쓰고 같이 만료시킨다.
   */
  tier2?: [string, number, number, number][]
}

async function writePlanCache(roots: string[], items: SweepItem[], tier2: SweepItem[] = []): Promise<void> {
  const kindIds = new Map<string, number>()
  const kinds: [string, string][] = []
  const encode = (list: SweepItem[]): CachedPlan['items'] => list.map((i) => {
    const key = i.meaning + ' ' + i.reason
    let id = kindIds.get(key)
    if (id === undefined) {
      id = kinds.length
      kinds.push([i.meaning, i.reason])
      kindIds.set(key, id)
    }
    return [i.path, i.size, i.mtimeMs, id]
  })
  const payload: CachedPlan = {
    version: PLAN_CACHE_VERSION,
    createdAt: Date.now(),
    roots,
    kinds,
    items: encode(items),
    tier2: encode(tier2),
  }
  try {
    const file = appDataFile('sweep-plan.json')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(payload), 'utf8')
  } catch {
    /* 캐시를 못 써도 정리는 된다 — 그때는 예전처럼 다시 훑을 뿐이다. */
  }
}

/**
 * 같은 폴더들에 대한 신선한 계획이 있으면 돌려준다. 없으면 null.
 *
 * @param roots 훑었던 폴더들. null이면 '신선하기만 하면 쓴다' — 순위 실행은 방금
 *              본 그 화면에서 바로 누르는 것이라, 화면이 폴더 목록을 다시 들고
 *              오게 만들지 않는다.
 * @param tier  1이면 자동 정리 목록, 2면 '한 번만 보고 지우세요' 목록.
 */
async function readPlanCache(roots: string[] | null, tier: 1 | 2 = 1): Promise<SweepItem[] | null> {
  try {
    const raw = JSON.parse(await readFile(appDataFile('sweep-plan.json'), 'utf8')) as CachedPlan
    if (raw.version !== PLAN_CACHE_VERSION) return null
    if (Date.now() - raw.createdAt > PLAN_CACHE_MAX_AGE_MS) return null
    // 훑은 폴더가 다르면 남의 계획이다. 순서까지 같아야 한다고 하진 않는다.
    if (roots) {
      const a = [...raw.roots].sort().join('|')
      const b = [...roots].sort().join('|')
      if (a !== b) return null
    }
    const rows = tier === 2 ? (raw.tier2 ?? []) : raw.items
    return rows.map(([path, size, mtimeMs, k]) => ({
      path,
      size,
      mtimeMs,
      meaning: raw.kinds[k]?.[0] ?? '캐시·임시 파일',
      reason: raw.kinds[k]?.[1] ?? '규칙 DB가 확증한 자동 정리 대상',
    }))
  } catch {
    return null
  }
}

/* ── 제안 카드 캐시 ──────────────────────────────────────────
   카드 하나가 곧 실행 단위다. 그런데 카드가 들고 있는 경로가 14만 개라
   화면으로 보낼 수도, 명령줄 인자로 넘길 수도 없다. 그래서 스캔할 때 적어두고
   실행할 때 id로 되짚는다 — apply-sweep이 계획을 쓰는 방식과 같다. */
const PROPOSAL_CACHE_VERSION = 1

interface CachedProposals {
  version: number
  createdAt: number
  roots: string[]
  /* [path, size, mtimeMs] — 크기·시각까지 적는 이유는 실행할 때 대조하기 위해서다.
     경로만 적어두면 계획을 세운 뒤 바뀐 파일을 그대로 가져간다(TOCTOU). */
  cards: { id: string; title: string; tier: number; action: string; bytes: number; items: [string, number, number][] }[]
}

async function writeProposalCache(roots: string[], cards: CachedProposals['cards']): Promise<void> {
  try {
    const file = appDataFile('proposals.json')
    await mkdir(dirname(file), { recursive: true })
    const payload: CachedProposals = {
      version: PROPOSAL_CACHE_VERSION,
      createdAt: Date.now(),
      roots,
      cards,
    }
    await writeFile(file, JSON.stringify(payload), 'utf8')
  } catch {
    /* 못 적어도 스캔 결과는 그대로 쓴다 — 카드 실행만 안 될 뿐이다. */
  }
}

async function readProposalCache(): Promise<CachedProposals | null> {
  try {
    const raw = JSON.parse(await readFile(appDataFile('proposals.json'), 'utf8')) as CachedProposals
    if (raw.version !== PROPOSAL_CACHE_VERSION) return null
    // 오래된 목록으로 지우기 시작하면 안 된다 — 계획 캐시와 같은 유효기간.
    if (Date.now() - raw.createdAt > PLAN_CACHE_MAX_AGE_MS) return null
    return raw
  } catch {
    return null
  }
}

/** 다 쓴 계획은 지운다. 이미 지운 파일 목록을 들고 있어봐야 혼란만 만든다. */
async function removePlanCache(): Promise<void> {
  try {
    const { unlink } = await import('node:fs/promises')
    await unlink(appDataFile('sweep-plan.json'))
  } catch {
    /* 없으면 없는 대로 */
  }
}

async function readScanStats(): Promise<RootWeight[]> {
  try {
    const parsed = JSON.parse(await readFile(appDataFile('scan-stats.json'), 'utf8'))
    return Array.isArray(parsed?.roots) ? (parsed.roots as RootWeight[]) : []
  } catch {
    return [] // 기록이 없으면 없는 대로 간다. 첫 스캔이 실패하면 안 된다.
  }
}

async function writeScanStats(roots: RootWeight[]): Promise<void> {
  try {
    const file = appDataFile('scan-stats.json')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ roots }), 'utf8')
  } catch {
    /* 기록을 못 남겼다고 스캔 결과를 버릴 이유는 없다. 다음 스캔이 거칠어질 뿐이다. */
  }
}

/* ── 생활 정리 진행 기록 ───────────────────────────────────────
   읽기 실패는 빈 상태로 넘어간다. 기록을 못 읽었다고 앱이 멈추면 안 된다. */
function tidyFile(): string {
  return appDataFile('tidy.json')
}

async function readTidy(): Promise<TidyState> {
  try {
    const raw = await readFile(tidyFile(), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed.done === 'object' ? (parsed as TidyState) : emptyState()
  } catch {
    return emptyState()
  }
}

async function writeTidy(state: TidyState): Promise<void> {
  const file = tidyFile()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(state), 'utf8')
}

/* ── 콘텐츠가 시키는 일을 앱이 대신 한다 ───────────────────────
   생활 정리의 '바탕화면 정리'·'다운로드 폴더 비우기' 단계를 실제로 실행한다.
   글만 주면 대부분 안 한다. */

/** 정리할 수 있는 폴더 — 임의 경로를 받지 않는다(실수로 시스템 폴더를 정리하는 사고 방지) */
function tidyTargetPath(target: string): string | null {
  const home = homedir()
  switch (target) {
    case 'desktop': return join(home, 'Desktop')
    case 'downloads': return join(home, 'Downloads')
    default: return null
  }
}

/**
 * 바로가기(.lnk)가 가리키는 대상이 아직 있는지 확인한다.
 *
 * 왜 PowerShell인가: .lnk는 셸 링크 바이너리라 경로가 파일 안에 그대로 있지 않다.
 * WScript.Shell이 윈도우 공식 해석기다. 실패하면 '모른다'로 두고 안 건드린다 —
 * 못 읽었다고 깨진 것으로 단정하면 멀쩡한 바로가기를 치운다.
 */
async function markBrokenLinks(entries: FolderEntry[]): Promise<FolderEntry[]> {
  const links = entries.filter((e) => !e.isDir && e.name.toLowerCase().endsWith('.lnk'))
  if (!links.length || process.platform !== 'win32') return entries

  const script = `
    $ErrorActionPreference = 'SilentlyContinue'
    $sh = New-Object -ComObject WScript.Shell
    $out = @()
    foreach ($p in ($env:TC_LINKS -split '\\|')) {
      if (-not $p) { continue }
      $t = $sh.CreateShortcut($p).TargetPath
      $out += [PSCustomObject]@{ path = $p; target = "$t"; broken = ($t -and -not (Test-Path $t)) }
    }
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($out | ConvertTo-Json -Compress -Depth 3)))
  `
  try {
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, env: { ...process.env, TC_LINKS: links.map((l) => l.path).join('|') } }
    )
    const parsed = JSON.parse(Buffer.from(stdout.trim(), 'base64').toString('utf8'))
    const rows: any[] = Array.isArray(parsed) ? parsed : [parsed]
    const byPath = new Map(rows.map((r) => [r.path, r]))
    return entries.map((e) => {
      const hit = byPath.get(e.path)
      return hit ? { ...e, linkTarget: hit.target, linkBroken: !!hit.broken } : e
    })
  } catch {
    return entries // 못 읽으면 아무것도 깨진 것으로 치지 않는다
  }
}

/**
 * 사진 폴더를 훑어 스크린샷·중복 후보를 만든다.
 *
 * 중복 확정은 '크기가 같은 것'만 해시한다. 사진 수만 장을 전부 해시하면
 * 몇 분이 걸리는데, 크기가 겹치지 않는 파일은 애초에 중복일 수 없다.
 */
async function scanPhotos(roots: string[]) {
  const files: PhotoFile[] = []
  for (const root of roots) {
    if (!(await isDir(root))) continue
    const scanned = await scan(root)
    for (const f of scanned.files) {
      if (!isPhoto(f.path)) continue
      files.push({
        path: f.path,
        name: basename(f.path),
        size: f.size,
        mtimeMs: stampMtime(f.mtime.getTime()),
      })
    }
  }

  const hashed: { file: PhotoFile; hash: string }[] = []
  for (const group of groupBySize(files)) {
    for (const f of group) {
      try {
        hashed.push({ file: f, hash: await contentHash(f.path, f.size) })
      } catch {
        /* 못 읽는 파일은 중복 후보에서 뺀다 — 확신 없으면 건드리지 않는다 */
      }
    }
  }

  return { files, dupGroups: buildDupGroups(hashed) }
}

/** 사진이 있을 만한 곳. 임의 경로는 받지 않는다. */
function photoRoots(): string[] {
  const home = homedir()
  return [join(home, 'Pictures'), join(home, 'OneDrive', 'Pictures'), join(home, 'Desktop')]
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

/** 이 PC에서 기본으로 훑을 곳 중 '실제로 있는 것'만. */
async function presentDefaultRoots() {
  const roots = defaultRoots({
    platform: process.platform,
    home: homedir(),
    temp: process.env.TEMP || process.env.TMPDIR,
  })
  const present = []
  for (const r of roots) if (await isDir(r.path)) present.push(r)
  return present
}

/**
 * 스캔 → 분류 → 정리 계획 + 질문. 데스크톱이라 실제 경로 규칙이 온전히 작동한다.
 *
 * 경로를 여러 개 받는 이유: 기본 스캔은 '이 PC의 주요 폴더 여러 곳'이다.
 * 질문(클러스터링)은 전부 모아놓고 계산해야 의미가 있다 — 폴더마다 따로
 * 물어보면 같은 질문이 5번 나온다.
 */
async function scanPlan(paths: string[]) {
  let safeB = 0, safeC = 0, ambB = 0, ambC = 0, lockB = 0, lockC = 0
  let autoB = 0, autoC = 0, inferB = 0
  let scannedFiles = 0, elapsedMs = 0
  const ambig: Classified[] = []
  /** 자동 정리 대상 — 그대로 캐시해서 '지금 정리하기'가 재스캔 없이 쓴다. */
  const autoItems: SweepItem[] = []
  /* 관측 패스가 쓸 전체 목록.
     ★ 존별로 나눠 담은 것만으로는 부족하다 — 크기 트리·반복 구조·판정은
       **모든 파일**을 한 번에 봐야 한다. 42만 개 기준 메모리가 붙지만,
       스캔 결과를 두 번 만드는 것보다 싸다(스캔은 4분, 이건 3.5초). */
  const allFiles: AnalyzeFile[] = []
  const keptMap = new Map<string, number>()
  /** 존C의 개수도 센다 — 순위 화면이 "몇 개를 지켰나"를 말하려면 용량만으론 부족하다. */
  const keptCount = new Map<string, number>()
  /** 어디를 봤는지도 돌려준다 — "어디까지 봤나"를 숨기면 신뢰가 안 생긴다. */
  const roots: { path: string; files: number; bytes: number }[] = []
  /** 폴더별 활동 장부 — '아직 쓰는 프로젝트인가'의 관측 근거(units.ts) */
  const sourceDirs: SourceDirs = new Map()

  /* 진행률의 근거 — 지난번 이 폴더들에 파일이 몇 개였나. 없으면 폴더 개수로 센다. */
  const weights = await readScanStats()
  const started = Date.now()
  let doneFiles = 0
  let lastEmit = 0

  for (const [rootIndex, path] of paths.entries()) {
    /**
     * 훑는 도중에 진행 상황을 내보낸다.
     *
     * 0.25초에 한 번으로 눌러둔다. 폴더마다 부르면 초당 수백 줄이 나가고,
     * 그걸 받아 그리는 화면이 스캔보다 느려진다 — 진행 표시가 본 작업을
     * 느리게 만들면 안 된다.
     */
    const onProgress = (count: number, currentDir: string) => {
      const now = Date.now()
      if (now - lastEmit < 250) return
      lastEmit = now
      const view = computeProgress({
        rootIndex, rootCount: paths.length, rootFiles: count, doneFiles,
        elapsedMs: now - started, weights, paths,
      })
      progress({ t: 'scan', ...view, rootIndex, rootCount: paths.length, root: path, dir: currentDir })
    }

    const scanned = await scan(path, { onProgress })
    doneFiles += scanned.files.length
    scannedFiles += scanned.files.length
    elapsedMs += scanned.elapsedMs
    roots.push({ path, files: scanned.files.length, bytes: scanned.totalBytes })

    for (const f of scanned.files) {
      /* ★ 지나가는 김에 '이 프로젝트를 아직 쓰나'를 센다.
         .venv 파일의 수정일은 '쓴 날'이 아니라 '설치한 날'이라, 그것만 보면
         "26일 전에 손댔어요"가 "26일 전에 pip install 했다"는 뜻이 된다.
         진짜 신호는 표시 폴더 **바깥의 소스**가 언제 바뀌었나다. */
      noteSourceFile(sourceDirs, f.path, f.ageDays)

      const c = classifyOne(f)
      const z = c.verdict.zone
      allFiles.push({
        path: f.path,
        size: f.size,
        mtimeMs: f.mtime.getTime(),
        ino: f.ino, // 하드링크를 두 번 세지 않으려고 — 스캐너가 공짜로 준다
        zone: z,
        ruleBacked: c.verdict.ruleBacked,
        meaning: c.verdict.meaning,
        ruleId: c.verdict.ruleId,
      })

      if (z === 'LOCKED') {
        lockB += f.size; lockC++
        keptMap.set(c.verdict.meaning, (keptMap.get(c.verdict.meaning) ?? 0) + f.size)
        keptCount.set(c.verdict.meaning, (keptCount.get(c.verdict.meaning) ?? 0) + 1)
      } else if (z === 'AMBIG') {
        ambB += f.size; ambC++; ambig.push(c)
        /* ★ 2순위 목록을 여기서 같이 만든다. buildTiers가 나중에 또 ownerOf를
           부르긴 하지만, 그건 집계용이고 이건 실행용 경로다. 나중에 다시 훑으면
           그 사이 바뀐 파일을 지우게 된다 — 판단한 순간의 목록을 그대로 들고 간다. */
        const o2 = ownerOf(f.path)
        // 사다리(verdict.ts)가 쓸 수 있게 판정을 실어준다.
        const mine = allFiles[allFiles.length - 1]
        if (mine && mine.path === f.path) {
          mine.ownerSafe = o2.verdict === 'safe'
          mine.ownerRole = o2.role
        }
      } else {
        safeB += f.size; safeC++
        if (isAutoEligible(c)) {
          autoB += f.size; autoC++
          // ★ 여기서 만든 목록을 버리지 않는다. 이게 곧 '지금 정리하기'가 지울
          //   목록이고, 버리면 그때 가서 똑같은 스캔을 처음부터 다시 해야 한다.
          autoItems.push({
            path: f.path,
            size: f.size,
            meaning: c.verdict.meaning,
            reason: c.verdict.reason,
            mtimeMs: stampMtime(f.mtime.getTime()),
          })
        } else inferB += f.size
      }
    }
  }

  /* 다음 스캔의 진행률을 위해 이번 개수를 남긴다. 이번 스캔 결과에는 영향이 없다. */
  await writeScanStats(roots.map((r) => ({ path: r.path, files: r.files })))
  /* 지울 목록을 적어둔다 — '지금 정리하기'가 이걸 쓰면 재스캔이 통째로 사라진다. */
  await writePlanCache(paths, autoItems)

  /* 분류·질문 계산이 남았다 — 파일이 14만 개면 이 구간도 몇 초 걸린다.
     여기서 막대가 멈추면 "다 됐는데 왜 안 뜨나"가 된다. 그래서 마지막 단계를 알린다. */
  progress({ t: 'plan', pct: 99, etaSec: null, basis: 'learned', files: scannedFiles })

  /* ── 관측 네 패스 ───────────────────────────────────────────
     스캔 한 번 위에 얹는다. 디스크를 다시 안 읽으므로(해시 후보 몇십 개 제외)
     비용이 거의 없다 — 실측 42만 개에 6초. */
  progress({ t: 'plan', pct: 97, etaSec: null, basis: 'learned', files: scannedFiles })
  let analysis: Awaited<ReturnType<typeof analyze>> | null = null
  try {
    analysis = await analyze(allFiles, roots.reduce((n, r) => n + r.bytes, 0))
    /* 제안 카드의 '경로 목록'은 캐시에만 적는다.
       ★ 화면으로 보내면 안 된다 — 카드 하나가 14만 경로를 들고 있어서 JSON이
         수십 MB가 된다. 화면은 개수·용량·예시만 있으면 결정할 수 있고,
         실행할 때 카드 id로 캐시를 되짚으면 된다. */
    /* 카드에 크기·수정시각을 붙여서 적는다 — 실행 직전 대조(expect)에 쓴다. */
    const stampOf = new Map<string, [number, number]>()
    for (const f of allFiles) stampOf.set(f.path, [f.size, stampMtime(f.mtimeMs)])
    await writeProposalCache(
      paths,
      analysis.proposals.map((p) => ({
        id: p.id,
        title: p.title,
        tier: p.tier,
        action: p.action,
        bytes: p.bytes,
        items: p.paths.map((fp) => {
          const st = stampOf.get(fp) ?? [0, 0]
          return [fp, st[0], st[1]] as [string, number, number]
        }),
      }))
    )
  } catch (err) {
    /* 관측이 실패해도 기존 결과(존·질문)는 그대로 나가야 한다. 새 기능 하나
       때문에 되던 것까지 못 쓰게 만들지 않는다. */
    progress({ t: 'analyze-failed', reason: err instanceof Error ? err.message : String(err) })
  }

  const report = runEngine(ambig)

  /* ★ 근거를 질문에 붙여서 함께 보낸다.
     전에는 답을 고른 뒤에야 근거를 보여줬다 — 판단하려고 정보가 필요한데
     정보를 보려면 먼저 결정해야 하는 구조였다. 순서가 거꾸로였다.
     게다가 그때마다 전체를 다시 스캔했다(이 PC 기준 330초).
     이미 분류하면서 다 본 파일들이니, 그 자리에서 집계해 함께 보낸다. */
  const questions = report.questions.map((q) => {
    const mine = ambig
      .filter((c) => c.verdict.unknown === q.unknown)
      .map((c) => ({ path: c.path, size: c.size, ageDays: c.ageDays }))
    // ★ 예시를 40개까지 싣는다(기본 8). 8개는 "이런 것들입니다"엔 충분하지만,
    //   '하나씩 골라 지우기'에는 턱없다 — 고를 게 8개뿐이면 고른다고 할 수 없다.
    const b = buildBreakdown(mine, 40)
    const kinds = groupByKind(mine)
    /* ★ 결정 단위를 함께 싣는다.
       14만 개를 낱개 체크박스로 고르라는 건 질문이 아니다. 개발 산출물의 단위는
       파일이 아니라 폴더고(units.ts), 그렇게 접으면 14만 개가 카드 몇 장이 된다. */
    const folded = foldIntoUnits(mine)
    /* 표시가 없어도 큰 게 몰려 있는 폴더는 '옮기기' 후보로 올린다.
       낱개로는 못 옮기는 것(앱 데이터)이 폴더째로는 옮겨진다 — 그 사실을
       화면이 말하지 않으면 사용자에겐 그냥 '안 됨'으로만 보인다.
       정션으로도 건드리면 안 되는 곳은 여기서 걸러낸다(relocate.ts가 판단). */
    const moveCards = folderCandidates(mine).filter((u) => junctionBlockReason(u.path) === null)
    return {
      ...q,
      evidence: {
        kinds,
        mix: describeMix(kinds, b.bytes),
        folders: b.folders,
        exts: b.exts,
        age: b.age,
        // 문장은 여기서 만든다 — 화면이 "몇 개월"을 다시 계산하게 두면
        // 같은 숫자가 두 곳에서 다르게 읽힌다(units.ts의 lastTouched).
        units: attachActivity([...folded.units, ...moveCards], sourceDirs).map((u) => ({
          ...u,
          lastTouched: lastTouched(u.newestDays),
          // 문장은 여기서 만든다 — 화면이 %를 다시 계산하면 두 곳에서 달라진다.
          activityNote: activitySentence(u.activity),
          /* '지금 쓰는 중'의 판단도 여기서 한다. 화면이 "며칠 이내면 빨강"으로
             다시 계산하면 설치 한 번(하루에 몰린 것)까지 빨강이 된다 — 정확히
             우리가 방금 가른 그 차이를 화면에서 도로 뭉개는 셈이다. */
          activeNow: !!u.activity && !looksLikeOneShot(u.activity) && u.activity.spreadDays >= 3,
        })),
        looseCount: folded.looseCount,
        looseBytes: folded.looseBytes,
        samples: b.samples.map(withOwner),
        explain: (UNKNOWN_EXPLAIN as any)[q.unknown] ?? null,
      },
    }
  })

  const kept = [...keptMap.entries()]
    .map(([meaning, bytes]) => ({ meaning, bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 6)

  return {
    roots,
    scannedFiles,
    elapsedMs,
    zones: {
      safe: { bytes: safeB, count: safeC },
      ambig: { bytes: ambB, count: ambC },
      locked: { bytes: lockB, count: lockC },
    },
    plan: {
      autoBytes: autoB, autoCount: autoC,
      askBytes: ambB, askCount: ambC,
      lockBytes: lockB, lockCount: lockC,
      inferredBytes: inferB,
    },
    /* ★ 제안 카드 — 42만 개의 판정을 사람이 볼 수 있는 몇 장으로.
       경로 배열은 뺀다(캐시에 있다). 화면은 개수·용량·예시로 결정한다. */
    proposals: (analysis?.proposals ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      where: p.where,
      bytes: p.bytes,
      count: p.count,
      action: p.action,
      recovery: p.recovery,
      effort: p.effort,
      because: p.because,
      tier: p.tier,
      samples: p.samples,
    })),
    proposalRest: analysis?.rest ?? { bytes: 0, count: 0, cards: 0 },
    /** 모든 파일에 답이 붙었나 — 합계가 전체와 맞는지 화면이 확인할 수 있게 */
    verdictSummary: analysis?.summary ?? null,
    hotspots: analysis?.hotspots ?? [],
    questions,
    kept,
  }
}

/**
 * 지운다 — **보관하지 않는다.**
 *
 * ── 왜 보관함이 없어졌나 ────────────────────────────────────
 * 보관함(격리)은 같은 드라이브 안 `.teraclean` 폴더로 파일을 **옮기는** 것이라,
 * 그것만으로는 용량이 1바이트도 안 빈다. 용량이 없어서 이 앱을 연 사람에게
 * "30일 뒤에 12.7GB가 빕니다"는 답이 아니었다. 같은 항의를 여러 번 들었고
 * 매번 맞는 말이었다. 그래서 이제 모든 정리는 **지금 지운다.**
 *
 * ── 그래도 지름길은 내지 않는다 ─────────────────────────────
 * 새 삭제 루틴을 따로 파지 않고 quarantine()을 그대로 지난다. 안전장치가 전부
 * 거기 들어 있기 때문이다 — 실행 직전 재확인(expect: 크기·수정시각이 그대로인가),
 * 잠금(존 C) 거절, 드라이브별 장부. 그 검사를 다 지난 뒤 **방금 옮긴 것만**
 * 지운다(purgeEntries). purgeNow를 쓰면 옛 버전이 남긴 것까지 함께 사라진다.
 *
 * ── 못 지운 것은 없어진 척하지 않는다 ───────────────────────
 * 옮기기는 됐는데 지우다 실패한 것(대개 다른 프로그램이 잡고 있는 파일)은 장부에
 * 그대로 남는다. leftover로 세어서 돌려주고, 화면은 '남은 것' 칸에서 되돌리기나
 * 다시 지우기를 준다. 조용히 사라진 셈 치면 그 파일은 영영 안 보이는 용량이 된다.
 */
/**
 * 지우기 전 재확인 — **밖에서 온 경로를 그냥 믿지 않는다.**
 *
 * ── 왜 함수로 뽑았나 (2026-08-19) ──────────────────────────
 * 이 검사는 원래 quarantine-paths 안에만 있었다. 그래서 카드 실행(proposal-apply)을
 * 새로 만들면서 **통째로 빠뜨렸다.** 그 통로는 zone을 'AMBIG'으로 박아 넣고
 * 재분류 없이 지웠다 — 카드 목록 파일(proposals.json)만 건드리면 시스템 파일도
 * 지워지는 상태였다.
 *
 * 안전장치가 한 통로 안에 적혀 있으면, 통로가 늘 때 따라오지 않는다.
 * 그래서 지우는 길은 전부 이 문을 지나게 한다.
 *
 * ── 무엇을 보나 ────────────────────────────────────────────
 *   · 지금 실제로 있는 파일인가 (stat)
 *   · 파일인가 (폴더를 낱개로 지우지 않는다)
 *   · **지금 다시 분류해서** 잠금(존 C)이면 거절
 *   · 계획 시점과 크기·수정시각이 같은가 (expect — quarantine이 대조한다)
 *
 * 화면이 뭐라고 했든, 목록에 뭐라고 적혀 있든 여기서 다시 본다.
 * 거절한 것은 숨기지 않고 이유와 함께 돌려준다 — 왜 안 됐는지가 신뢰의 근거다.
 */
async function recheckForDelete(
  paths: string[],
  reasonFor: (meaning: string) => string
): Promise<{ requests: QuarantineRequest[]; refused: { path: string; reason: string }[] }> {
  const requests: QuarantineRequest[] = []
  const refused: { path: string; reason: string }[] = []
  for (const p of paths) {
    let st
    try {
      st = await stat(p)
    } catch {
      refused.push({ path: p, reason: '파일을 찾지 못했어요' })
      continue
    }
    if (!st.isFile()) {
      refused.push({ path: p, reason: '파일이 아니에요 — 폴더는 낱개로 다루지 않습니다' })
      continue
    }
    const c = classifyOne(fileEntryOf(p, st))
    if (c.verdict.zone === 'LOCKED') {
      // 화면이 보여준 적 없는 경로가 들어왔거나, 그 사이 판단이 바뀐 것이다.
      refused.push({ path: p, reason: `잠근 항목이라 건드리지 않았어요 (${c.verdict.meaning})` })
      continue
    }
    requests.push({
      path: p,
      reason: reasonFor(c.verdict.meaning),
      zone: c.verdict.zone,
      expect: { size: st.size, mtimeMs: stampMtime(st.mtimeMs) },
    })
  }
  return { requests, refused }
}

async function deleteNow(
  requests: QuarantineRequest[],
  onProgress?: (done: number, total: number, bytes: number) => void
) {
  /* 두 걸음(옮기기 → 지우기)을 하나의 진행률로 보여준다. 사용자에게는 '지우는
     중' 한 가지 일이라, 0~100%가 두 번 도는 걸 보여주면 더 헷갈린다.
     앞 걸음을 절반, 뒤 걸음을 나머지 절반으로 친다. */
  const half = (base: number) => (d: number, t: number, b: number) =>
    onProgress?.(Math.round(base * requests.length + (d / Math.max(1, t)) * requests.length * 0.5), requests.length, b)

  const q = await quarantine(requests, { onProgress: onProgress ? half(0) : undefined })
  const gone = q.quarantined.length
    ? await purgeEntries(q.quarantined, { onProgress: onProgress ? half(0.5) : undefined })
    : null
  const deletedCount = gone?.purged.length ?? 0
  return {
    deletedCount,
    deletedBytes: gone?.bytes ?? 0,
    /** 옮기긴 했는데 못 지운 것. 장부에 남아 있고 '남은 것' 칸에서 처리한다. */
    leftover: q.quarantined.length - deletedCount,
    failed: q.failed,
  }
}

/**
 * 명령·인자를 argv에서 뽑는다.
 * ★ 실물에서 터진 버그(2026-08-03): 설치된 앱의 모든 기능이 죽어 있었다.
 *   엔진을 어떤 명령으로 부르든 "알 수 없는 명령: D:\...\teraclean-engine.exe"만 돌아왔다.
 *
 *   원인: SEA일 때 slice(1)로 잡았는데, 실제 SEA 런타임의 argv는
 *     [exe, exe, command, ...args]   ← 스크립트 자리에 exe 경로가 한 번 더 들어간다
 *   라서 명령 자리에 exe 경로가 들어왔다. 문서만 보고 짐작한 형태와 달랐다.
 *
 *   그래서 '개수'가 아니라 '내용'으로 판단한다 — argv[1]이 자기 자신이거나
 *   스크립트 파일이면 건너뛴다. 두 실행 방식 모두에서 성립한다.
 *
 * 일반 node 실행:  [node, engine-cli.ts, command, ...args]
 * SEA 단일 exe:    [exe, exe, command, ...args]
 */
function readArgs(): string[] {
  return parseArgv(process.argv, process.execPath)
}

async function main() {
  const [command, ...args] = readArgs()

  try {
    switch (command) {
      case 'default-roots': {
        out({ roots: await presentDefaultRoots() })
        break
      }
      /**
       * 디스크 상태 — 화면 맨 위에서 "지금 얼마나 위험한가"를 보여주는 데 쓴다.
       * 정리 도구를 여는 사람이 제일 먼저 알고 싶은 건 정리 가능 용량이 아니라
       * "내 디스크가 지금 어떤 상태인가"다.
       */
      case 'disk': {
        const { statfs } = await import('node:fs/promises')
        const drive = process.env.SystemDrive ? process.env.SystemDrive + '\\' : '/'
        const fs = await statfs(drive)
        const total = Number(fs.blocks) * Number(fs.bsize)
        const free = Number(fs.bavail) * Number(fs.bsize)
        out({ drive, total, free, used: total - free, usedPercent: total ? Math.round(((total - free) / total) * 100) : 0 })
        break
      }
      case 'scan-plan': {
        // 인자가 없으면 '이 PC 기본 스캔'이다. 폴더를 못 고르는 사람을 위한 기본값.
        const paths = args.length ? args : (await presentDefaultRoots()).map((r) => r.path)
        if (!paths.length) fail('훑을 폴더를 찾지 못했습니다.')
        out(await scanPlan(paths))
        break
      }
      case 'apply-sweep': {
        /**
         * **곧바로 지운다** — 용량이 지금 빈다.
         *
         * 격리에서 멈추던 게 기본이었는데, 격리함은 같은 드라이브에 있어서
         * 용량이 하나도 안 줬다. "지금 정리 가능 7.0GB"를 보고 누른 사람에게
         * "용량은 아직 그대로입니다"는 버튼이 약속을 깬 것이다.
         *
         * 보관에서 멈추던 갈래는 없앴다. 보관은 이제 이 앱의 동작이 아니다.
         */
        const rest = args.filter((a) => !a.startsWith('--'))
        const paths = rest.length ? rest : (await presentDefaultRoots()).map((r) => r.path)
        if (!paths.length) fail('정리할 폴더를 찾지 못했습니다.')

        /**
         * ★ 방금 만든 계획이 있으면 다시 훑지 않는다.
         *
         *   전에는 여기서 폴더마다 planSweep()을 불렀고, 그건 곧 전체 재스캔이다
         *   (이 PC 기준 7분). 화면은 이미 "10.1GB 정리 가능"을 보여준 뒤인데
         *   누르면 그 7분을 다시 기다리게 했다. 그 목록은 스캔할 때 이미
         *   만들어졌다 — 이제 적어두고(writePlanCache) 여기서 꺼내 쓴다.
         *
         *   캐시가 없거나 낡았으면 예전처럼 훑는다. 다만 이번엔 말을 하면서 훑는다.
         */
        let items = await readPlanCache(paths)
        if (items) {
          progress({ t: 'sweep-plan', cached: true, total: items.length })
        } else {
          items = []
          const started = Date.now()
          let lastEmit = 0
          const weights = await readScanStats()
          let doneFiles = 0
          for (const [rootIndex, path] of paths.entries()) {
            const onProgress = (count: number, currentDir: string) => {
              const now = Date.now()
              if (now - lastEmit < 250) return
              lastEmit = now
              const view = computeProgress({
                rootIndex, rootCount: paths.length, rootFiles: count, doneFiles,
                elapsedMs: now - started, weights, paths,
              })
              progress({ t: 'scan', ...view, rootIndex, rootCount: paths.length, root: path, dir: currentDir })
            }
            const plan = await planSweep(path, { onProgress })
            doneFiles += plan.scannedFiles
            // 펼치지 않고 하나씩 — 캐시 목록은 십수만 개가 될 수 있다
            for (const it of plan.items) items.push(it)
          }
        }

        /* 지우는 동안에도 말한다 — 여기가 통째로 조용했다. */
        const total = items.length
        const startedApply = Date.now()
        const result = await applySweep(
          { items, bytes: items.reduce((s, i) => s + i.size, 0), scannedFiles: 0, elapsedMs: 0,
            skipped: { locked: { count: 0, bytes: 0 }, needsAsking: { count: 0, bytes: 0 }, inferredNotAuto: { count: 0, bytes: 0 } } },
          {
            purge: true,
            onProgress: (done, all, bytes) => {
              const elapsed = Date.now() - startedApply
              // 남은 시간은 지금까지의 속도로만 잰다 — 지어내지 않는다.
              const etaSec = done > 0 ? Math.round(((elapsed / done) * (all - done)) / 1000) : null
              progress({ t: 'sweep', done, total: all, bytes, etaSec, pct: all ? Math.round((done / all) * 100) : 100 })
            },
          }
        )

        // 계획을 다 썼으면 지운다. 이미 지운 파일 목록을 들고 있어봐야
        // 다음에 "이건 왜 안 지워지지"만 만든다.
        await removePlanCache()

        out({
          deletedCount: result.purgedCount,
          deletedBytes: result.bytesAfterGrace,
          // 옮기긴 했는데 못 지운 것 — '남은 것' 칸이 이걸 받아 처리한다.
          leftover: result.quarantinedCount - result.purgedCount,
          failed: result.failed,
          planned: total,
        })
        break
      }
      /**
       * 제안 카드 하나를 실행한다 — 화면의 카드에 달린 버튼의 뒷면.
       *
       * 카드가 곧 실행 단위다. 경로는 스캔할 때 적어둔 것을 쓴다(재스캔 없음) —
       * 다시 훑으면 화면이 보여준 목록과 지우는 목록이 달라진다.
       *
       * ★ action이 'delete'인 카드만 실행한다. 'ask' 카드는 사용자가 필요한지
       *   답해야 하는 것이라, 버튼 한 번으로 지우면 그게 무단 삭제다.
       *
       * ★ 이 명령을 한 번 잃어버린 적이 있다 (v0.17.1). 중복된 순위 체계를
       *   걷어내면서 'tier-apply 시작 ~ quar-list'를 통째로 잘랐는데, 그 사이에
       *   이 블록이 끼어 있었다. 화면은 멀쩡히 카드를 그렸고 누르니 "알 수 없는
       *   명령"이 떴다 — 타입도 테스트도 안 잡는 종류라, 아래 test가 못 박는다.
       */
      case 'proposal-apply': {
        const id = args[0]
        if (!id) fail('실행할 카드가 필요합니다.')
        const cache = await readProposalCache()
        if (!cache) fail('정리 목록이 없거나 오래됐어요. 검사를 다시 하면 목록이 새로 만들어집니다.')
        const card = cache.cards.find((c) => c.id === id)
        if (!card) fail('그 카드를 찾지 못했어요. 검사를 다시 해주세요.')
        if (card.action !== 'delete') {
          fail('이 카드는 여쭤보고 정하는 것이라 한 번에 지우지 않습니다.')
        }
        if (!card.items.length) {
          out({ id, title: card.title, deletedCount: 0, deletedBytes: 0, leftover: 0, failed: [] })
          break
        }

        const started = Date.now()
        progress({ t: 'proposal', id, total: card.items.length, done: 0, pct: 0, etaSec: null })

        /* ★ 목록에 적힌 대로 지우지 않는다 — **지금 다시 본다.**
           카드 목록은 파일(proposals.json)이고, 스캔한 지 시간이 지났을 수도,
           밖에서 손댔을 수도 있다. 재분류·잠금 거절을 여기서 다시 지난다.
           expect는 계획 시점의 크기·시각을 쓰므로 그 사이 바뀐 파일은 건너뛴다. */
        const { requests, refused } = await recheckForDelete(
          card.items.map(([p]) => p),
          () => `정리 목록에서 고르신 것 — ${card.title}`
        )
        const stampFor = new Map(card.items.map(([p, size, mtimeMs]) => [p, { size, mtimeMs }]))
        for (const q of requests) {
          const st = stampFor.get(q.path)
          if (st) q.expect = st // 계획 시점의 값으로 대조한다
        }
        if (!requests.length) {
          out({ id, title: card.title, deletedCount: 0, deletedBytes: 0, leftover: 0, failed: [], refused })
          break
        }

        /* 진행 보고는 눌러 담는다 — 파일마다 한 줄씩 내보내면 초당 수천 줄이 되고,
           그걸 받아 그리는 화면이 삭제보다 느려진다(스캔 쪽과 같은 이유). */
        let lastEmit = 0
        const r = await deleteNow(
          requests,
          (done, total, bytes) => {
            const now = Date.now()
            if (now - lastEmit < 250) return
            lastEmit = now
            const elapsed = now - started
            // 남은 시간은 지금까지의 속도로만 잰다 — 지어내지 않는다.
            const etaSec = done > 0 ? Math.round(((elapsed / done) * (total - done)) / 1000) : null
            progress({ t: 'proposal', id, done, total, bytes, etaSec, pct: total ? Math.round((done / total) * 100) : 100 })
          }
        )
        progress({ t: 'proposal', id, total: requests.length, done: requests.length, pct: 100, etaSec: 0 })
        out({ id, title: card.title, ...r, refused, planned: card.items.length, elapsedMs: Date.now() - started })
        break
      }
      case 'quar-list': {
        // 드라이브마다 격리함이 따로 있다(원본과 같은 드라이브에 만든다).
        // 전부 모아서 보여주지 않으면 D에서 정리한 파일이 화면에서 사라진 것처럼 보인다.
        const roots = await listQuarantineRoots()
        const items = []
        let totalBytes = 0
        for (const root of roots) {
          for (const e of await readManifest(root)) {
            items.push({
              id: e.id,
              root,
              originalPath: e.originalPath,
              size: e.size,
              reason: e.reason,
              quarantinedAt: e.quarantinedAt,
              expired: isExpired(e),
            })
            totalBytes += e.size
          }
        }
        items.sort((a, b) => a.quarantinedAt - b.quarantinedAt)
        out({ graceDays: GRACE_DAYS, roots, items, totalBytes })
        break
      }
      case 'restore': {
        if (!args[0]) fail('되돌릴 id 또는 --all 이 필요합니다.')
        let restoredCount = 0, restoredBytes = 0
        const failed: { path: string; reason: string }[] = []
        for (const root of await listQuarantineRoots()) {
          const manifest = await readManifest(root)
          const ids = args[0] === '--all'
            ? manifest.map((e) => e.id)
            : manifest.filter((e) => e.id.startsWith(args[0])).map((e) => e.id)
          if (!ids.length) continue
          const r = await restore(ids, root)
          restoredCount += r.restored.length
          restoredBytes += r.restored.reduce((s, e) => s + e.size, 0)
          for (const f of r.failed) failed.push({ path: f.entry.originalPath, reason: f.reason })
        }
        out({ restoredCount, restoredBytes, failed })
        break
      }
      /**
       * **옛 보관함의 만료분만** 지운다. 앱이 켜질 때 조용히 돈다.
       *
       * 보관은 없앴지만, 예전 버전이 30일 약속으로 맡아둔 것은 남의 디스크에
       * 그대로 있다. 그 약속은 지킨다 — 30일이 지난 것만 여기서 실제로 지운다.
       * 판단(30일 지났나)은 purgeExpired 안에 갇혀 있어서 여기서 앞당길 방법이
       * 없다. 새로 보관되는 것은 없으므로 이 목록은 시간이 지나면 저절로 빈다.
       */
      case 'purge': {
        let purgedCount = 0, bytes = 0
        const failed: { path: string; reason: string }[] = []
        for (const root of await listQuarantineRoots()) {
          const r = await purgeExpired(root)
          purgedCount += r.purged.length
          bytes += r.bytes
          for (const f of r.failed) failed.push({ path: f.entry.originalPath, reason: f.reason })
        }
        out({ purgedCount, bytes, graceDays: GRACE_DAYS, failed })
        break
      }
      /**
       * 장부에 남은 것을 지금 전부 지운다. **되돌릴 수 없다.**
       *
       * 여기 남는 건 두 가지다 — 지우려다 사용 중이라 못 지운 것, 그리고 옛
       * 버전이 보관해둔 것. 둘 다 원래 자리엔 없는데 용량은 그대로라, 안 지우면
       * 영영 안 보이는 용량이 된다. UI가 명시적으로 확인을 받은 뒤에만 부른다.
       */
      case 'quar-purge-now': {
        let purgedCount = 0, bytes = 0
        const failed: { path: string; reason: string }[] = []
        for (const root of await listQuarantineRoots()) {
          const r = await purgeNow(root)
          purgedCount += r.purged.length
          bytes += r.bytes
          for (const f of r.failed) failed.push({ path: f.entry.originalPath, reason: f.reason })
        }
        out({ purgedCount, bytes, failed })
        break
      }
      case 'probe': {
        const facts = await gatherFacts()
        const findings = [probeHiberfil(facts)]
        // 휴지통·업데이트 캐시는 별도 조회다. 실패해도 hiberfil 결과까지
        // 통째로 날리지 않는다 — 한쪽이 안 된다고 다른 쪽을 못 보여줄 이유가 없다.
        try {
          const rec = await gatherReclaimFacts()
          findings.push(probeRecycleBin(rec), probeUpdateCache(rec))
        } catch (err) {
          process.stderr.write(`회수 프로브 실패: ${(err as Error).message}\n`)
        }
        /* 윈도우가 자기 몫으로 잡아둔 공간(가상 메모리·시스템 복원).
           실측에서 pagefile 65GB, 시스템 복원 최대 155GB가 나왔다 — 파일 정리를
           다 합친 것보다 크다. 여기 없으면 사용자는 이게 있는 줄도 모른다. */
        try {
          const pf = await gatherPageFile()
          const pfFinding = pf && probePageFile(pf)
          if (pfFinding) findings.push(pfFinding)
        } catch (err) {
          process.stderr.write(`가상 메모리 프로브 실패: ${(err as Error).message}\n`)
        }
        try {
          const rs = probeRestore(await gatherRestore())
          if (rs) findings.push(rs)
        } catch (err) {
          process.stderr.write(`시스템 복원 프로브 실패: ${(err as Error).message}\n`)
        }
        // 큰 덩어리(WSL·Docker·Windows.old)도 같은 이유로 따로 감싼다.
        try {
          // 스프레드로 넘기지 않는다 — 배열 길이만큼 인자를 만드는 자리를 안 만든다(breakdown.ts 머리말)
          for (const f of probeBulk(await gatherBulkFacts())) findings.push(f)
        } catch (err) {
          process.stderr.write(`큰 덩어리 프로브 실패: ${(err as Error).message}\n`)
        }
        out({
          facts: {
            ramBytes: facts.ramBytes,
            isLaptop: facts.isLaptop,
            laptopSignals: facts.laptopSignals,
            fastStartupEnabled: facts.fastStartupEnabled,
          },
          findings: findings.filter(Boolean).sort((a, b) => b!.bytes - a!.bytes),
        })
        break
      }
      /**
       * 휴지통 비우기 — 윈도우 공식 명령을 부른다. 되돌릴 수 없다.
       * 우리가 $Recycle.Bin의 파일을 직접 지우는 경로는 만들지 않는다.
       * 비운 양은 전후 실측 차이로 보고한다(추정치를 지어내지 않는다).
       */
      case 'empty-recycle-bin': {
        const before = await gatherReclaimFacts()
        await runPowerShell('Clear-RecycleBin -Force -Confirm:$false -ErrorAction Stop')
        const after = await gatherReclaimFacts()
        out({
          freedBytes: Math.max(0, before.recycleBytes - after.recycleBytes),
          freedCount: Math.max(0, before.recycleCount - after.recycleCount),
          remainingBytes: after.recycleBytes,
        })
        break
      }
      /**
       * 시작프로그램 — 이 제품에서 유일하게 '삭제가 아닌 정리'다.
       * 원본(Run 값·바로가기)은 그대로 두고 사용/해제 상태만 바꾸므로
       * 되돌리기가 즉시다. 그래서 격리를 거치지 않는다.
       */
      /**
       * 질문에 답한 결과를 실제로 실행한다 — 여태 비어 있던 마지막 조각.
       *
       *   answer-plan  <unknown> [paths...]            무엇이 걸리는지 보여주기만
       *   answer-apply <unknown> <outcome> [paths...]  실행
       *
       * ★ 보존을 뜻하는 답(KEEP·REVIEW)은 파일을 건드리지 않는다. 그 판단은
       *   engine.ts의 actionFor에 있고 테스트로 잠겨 있다 — 여기서 다시
       *   해석하지 않는다(두 곳에서 해석하면 언젠가 어긋난다).
       */
      case 'answer-plan':
      case 'answer-apply': {
        const unknown = args[0]
        if (!unknown) fail('어떤 질문인지(unknown)가 필요합니다.')
        const isApply = command === 'answer-apply'
        const outcome = isApply ? (args[1] as Outcome) : 'CANDIDATE'
        if (isApply && !['CANDIDATE', 'MOVE', 'KEEP', 'REVIEW_ONE_BY_ONE'].includes(outcome)) {
          fail(`모르는 답변입니다: ${args[1]}`)
        }
        const paths = (isApply ? args.slice(2) : args.slice(1)).filter(Boolean)
        const roots = paths.length ? paths : (await presentDefaultRoots()).map((r) => r.path)

        // 그 질문에 걸린 항목만 다시 모은다. 스캔 결과를 들고 다니지 않는 이유:
        // 사용자가 답하는 사이 파일이 바뀔 수 있어서, 실행 직전 상태를 다시 본다.
        const items: { path: string; size: number; mtimeMs: number; meaning: string; reason: string; ageDays: number }[] = []
        for (const root of roots) {
          const scanned = await scan(root)
          for (const f of scanned.files) {
            const c = classifyOne(f)
            if (c.verdict.zone !== 'AMBIG' || c.verdict.unknown !== unknown) continue
            items.push({
              path: f.path,
              size: f.size,
              mtimeMs: stampMtime(f.mtime.getTime()),
              meaning: c.verdict.meaning,
              reason: c.verdict.reason,
              ageDays: f.ageDays,
            })
          }
        }
        items.sort((a, b) => b.size - a.size)
        const bytes = items.reduce((s, i) => s + i.size, 0)

        if (!isApply) {
          // ★ '지울까요?'만 묻지 않는다. 어디에 있고, 무슨 파일이고, 얼마나 오래됐고,
          //    지우면 어떻게 되는지를 함께 준다. 근거 없는 질문은 그냥 강요다.
          const b = buildBreakdown(items.map((i) => ({ path: i.path, size: i.size, ageDays: i.ageDays })))
          const kinds = groupByKind(items)
          out({
            unknown,
            count: b.count,
            bytes: b.bytes,
            kinds,
            mix: describeMix(kinds, b.bytes),
            folders: b.folders,
            exts: b.exts,
            age: b.age,
            samples: b.samples.map(withOwner),
            explain: (UNKNOWN_EXPLAIN as any)[unknown] ?? null,
            items: items.slice(0, 200),
          })
          break
        }

        const action = actionFor(outcome)
        if (action === 'keep' || action === 'review') {
          // 아무것도 안 한다. 무엇을 안 했는지는 말해준다.
          out({ unknown, action, count: items.length, bytes, touched: 0, items: action === 'review' ? items.slice(0, 200) : [] })
        }
        if (action === 'move') {
          // 옮기기는 대상 드라이브가 필요하다 — 여기서 임의로 정하지 않는다.
          out({ unknown, action, count: items.length, bytes, needsDestination: true, items: items.slice(0, 200) })
        }

        const r = await deleteNow(
          items.map((i) => ({
            path: i.path,
            reason: `질문에 "정리해도 된다"고 답하신 것 — ${i.meaning}`,
            zone: 'AMBIG' as const,
            expect: { size: i.size, mtimeMs: i.mtimeMs },
          }))
        )
        out({ unknown, action, ...r })
        break
      }
      /**
       * 고른 파일만 지운다 — **묶음이 아니라 낱개.**
       *
       * ── 왜 필요했나 ────────────────────────────────────────────
       * 여태 실행 단위는 항상 '묶음 전체'였다(answer-apply는 unknown 하나에 걸린
       * 걸 전부 격리한다). 그런데 화면은 파일을 낱개로 보여준다. 그래서 사용자는
       * 낱개로 판단하는데 버튼은 전부-아니면-전무만 준다 —
       * **판단의 해상도와 실행의 해상도가 안 맞았다.**
       * 낱개로 보여주면 낱개로 지울 수 있어야 한다 — 그 비대칭을 여기서 없앤다.
       *
       * ── 밖에서 온 경로를 그냥 믿지 않는다 ──────────────────────
       * 이건 파일을 지우는 명령이라 경로를 받는 것 자체가 위험 통로다. 그래서
       * 받은 경로마다 **지금 다시 분류한다.** 화면이 뭐라고 했든, 잠금(존 C)이면
       * 거절한다. 화면의 판단을 엔진이 재확인 없이 집행하지 않는다.
       * (같은 이유·같은 방식 — probes/programs.ts의 isStillInstalled)
       */
      case 'quarantine-paths': {
        /* 이름은 옛날 것 그대로지만 하는 일은 **삭제**다(deleteNow).
           보관은 없앴다 — 옛 화면이 아직 --purge를 붙여 부를 수 있으니 받아만 주고
           버린다. 안전장치(재분류·잠금 거절·expect)는 하나도 안 건너뛴다. */
        const paths = args.filter((a) => a && !a.startsWith('--'))
        if (!paths.length) fail('지울 파일 경로가 필요합니다.')

        const { requests, refused } = await recheckForDelete(
          paths,
          (meaning) => `목록에서 직접 고르신 것 — ${meaning}`
        )

        if (!requests.length) {
          out({ deletedCount: 0, deletedBytes: 0, leftover: 0, failed: [], refused })
          break
        }
        // 지우다 실패한 것은 장부에 그대로 남는다 — 없어진 척하지 않고 leftover로 센다.
        out({ ...(await deleteNow(requests)), refused })
        break
      }
      case 'startup': {
        out(await probeStartup())
        break
      }
      /**
       * 로그온 예약작업 개수 — 각주 한 줄이지만 세는 데 몇 초~몇 분이 걸린다.
       * 목록과 같은 명령에 묶어두면 각주가 본문을 막는다(probes/startup.ts LOGON_TASKS 머리말).
       */
      case 'startup-tasks': {
        out({ logonTaskCount: await countLogonTasks() })
        break
      }
      /* ── 생활 정리 ─────────────────────────────────────────────
         PC 정리만으로는 로드맵의 다음 단계(집 청소·정리정돈)로 이어지지 않는다.
         콘텐츠는 데이터이고, 판단(오늘 뭘 할 때가 됐나)은 전부 순수 함수다. */
      case 'tidy-list': {
        const state = await readTidy()
        const today = args[0] ?? todayISO()
        out({ today, ...planToday(state, today), total: ROUTINES.length })
        break
      }
      /**
       * 바탕화면·다운로드 정리 — 미리보기가 기본이다.
       * tidy-folder-plan  <desktop|downloads>  무엇을 옮길지 보여주기만 한다
       * tidy-folder-apply <desktop|downloads>  실제로 옮긴다(깨진 바로가기는 삭제)
       * tidy-folder-undo  <desktop|downloads>  전부 원래 자리로
       */
      case 'tidy-folder-plan':
      case 'tidy-folder-apply': {
        const folder = tidyTargetPath(args[0] ?? '')
        if (!folder) fail('정리할 곳은 desktop 또는 downloads 입니다.')
        if (!(await isDir(folder))) fail(`폴더를 찾지 못했어요: ${folder}`)

        const entries = await markBrokenLinks(await readFolderEntries(folder))
        const plan = planFolderTidy(entries, { folder, keepDays: args[1] ? +args[1] : undefined })

        if (command === 'tidy-folder-plan') {
          out({
            folder,
            destFolder: plan.destFolder,
            moves: plan.moves.slice(0, 200),
            moveCount: plan.moves.length,
            bytes: plan.bytes,
            broken: plan.broken,
            keepCount: plan.keep.length,
          })
          break
        }

        const moved = await applyFolderTidy(plan)
        // 깨진 바로가기는 옮겨봐야 쓰레기가 이동할 뿐이라 지운다. 가리키던 대상이
        // 이미 없어서 되살릴 것도 없다 — 보관할 이유가 애초에 없던 종류다.
        /* 깨진 바로가기도 재확인 문을 지난다. 좁은 통로라 위험이 작아 보여도,
           '이건 안전하니까 건너뛰자'가 쌓이면 결국 문이 없는 것과 같아진다. */
        const broken = plan.broken.length
          ? await recheckForDelete(plan.broken.map((b) => b.path), () => '대상이 사라진 바로가기')
          : { requests: [], refused: [] as { path: string; reason: string }[] }
        const q = broken.requests.length
          ? await deleteNow(broken.requests)
          : { deletedCount: 0, failed: [] as { path: string; reason: string }[] }
        for (const r of broken.refused) moved.failed.push(r)

        out({
          folder,
          destFolder: moved.destFolder,
          movedCount: moved.movedCount,
          movedBytes: moved.movedBytes,
          brokenDeleted: q.deletedCount,
          failed: [...moved.failed, ...q.failed],
        })
        break
      }
      /**
       * 사진 정리 — 스크린샷과 '내용이 완전히 같은 사본'만 다룬다.
       * "비슷한 사진 골라주기"는 하지 않는다. 뭘 남길지 우리가 알 수 없고,
       * 잘못 고르면 되돌릴 수 없는 종류의 손해다.
       */
      case 'photos-plan': {
        const { files, dupGroups } = await scanPhotos(photoRoots())
        const plan = planPhotos(files, dupGroups)
        out({
          roots: photoRoots(),
          scanned: plan.scanned,
          oldScreenshots: plan.oldScreenshots.slice(0, 100),
          screenshotCount: plan.oldScreenshots.length,
          screenshotBytes: plan.screenshotBytes,
          recentScreenshots: plan.recentScreenshots,
          dupGroups: plan.dupGroups.slice(0, 50),
          dupGroupCount: plan.dupGroups.length,
          dupBytes: plan.dupBytes,
        })
        break
      }
      /**
       * 실행 —
       *   스크린샷은 지우지 않고 사진 폴더 안 '정리-YYYY-MM'으로 옮긴다(장부로 되돌리기).
       *   중복 사본은 지운다. **원본은 절대 건드리지 않는다** — 그게 되돌리기 대신이다.
       */
      case 'photos-apply': {
        const what = args[0] ?? 'all' // screenshots | duplicates | all
        const { files, dupGroups } = await scanPhotos(photoRoots())
        const plan = planPhotos(files, dupGroups)

        let movedCount = 0, movedBytes = 0, destFolder = ''
        const failed: { path: string; reason: string }[] = []

        if ((what === 'all' || what === 'screenshots') && plan.oldScreenshots.length) {
          // 스크린샷은 원래 있던 폴더 기준으로 정리 폴더를 만든다
          const byFolder = new Map<string, typeof plan.oldScreenshots>()
          for (const s of plan.oldScreenshots) {
            const dir = dirname(s.path)
            const arr = byFolder.get(dir)
            if (arr) arr.push(s)
            else byFolder.set(dir, [s])
          }
          for (const [dir, shots] of byFolder) {
            const sub = planFolderTidy(
              shots.map((s) => ({ name: s.name, path: s.path, size: s.size, mtimeMs: s.mtimeMs, isDir: false })),
              { folder: dir, keepDays: 0 }
            )
            const r = await applyFolderTidy(sub)
            movedCount += r.movedCount
            movedBytes += r.movedBytes
            for (const f of r.failed) failed.push(f)
            destFolder = r.destFolder
          }
        }

        let deletedCount = 0, deletedBytes = 0
        if ((what === 'all' || what === 'duplicates') && plan.dupGroups.length) {
          /* ★ 사본이라도 지우기 전에 재확인 문을 지난다.
             클라우드 동기화 폴더의 사진은 여기서 지우면 클라우드에서도 지워진다 —
             그건 존 C라 거절돼야 한다. 사진이라는 이유로 문을 건너뛰지 않는다. */
          const { requests: dupReqs, refused: dupRefused } = await recheckForDelete(
            plan.dupGroups.flatMap((g) => g.copies.map((c) => c.path)),
            () => '같은 사진이 여러 벌 — 원본은 그대로 뒀어요'
          )
          for (const r of dupRefused) failed.push(r)
          const q = await deleteNow(dupReqs)
          deletedCount = q.deletedCount
          deletedBytes = q.deletedBytes
          for (const f of q.failed) failed.push(f)
        }

        out({ movedCount, movedBytes, destFolder, deletedCount, deletedBytes, failed })
        break
      }
      case 'tidy-folder-undo': {
        const folder = tidyTargetPath(args[0] ?? '')
        if (!folder) fail('되돌릴 곳은 desktop 또는 downloads 입니다.')
        const dest = join(folder, args[1] ?? tidyFolderName())
        out({ destFolder: dest, ...(await undoFolderTidy(dest)) })
        break
      }
      case 'tidy-done':
      case 'tidy-undo': {
        if (!args[0]) fail('항목 id가 필요합니다.')
        if (!ROUTINES.some((r) => r.id === args[0])) fail(`모르는 항목입니다: ${args[0]}`)
        const today = args[1] ?? todayISO()
        const state = await readTidy()
        const next = command === 'tidy-done'
          ? markDone(state, args[0], today)
          : undoDone(state, args[0], today)
        await writeTidy(next)
        out({ today, ...planToday(next, today), total: ROUTINES.length })
        break
      }
      case 'startup-set': {
        if (!args[0] || !args[1]) fail('항목 id와 on|off가 필요합니다.')
        if (args[1] !== 'on' && args[1] !== 'off') fail("두 번째 인자는 on 또는 off여야 합니다.")
        out(await setStartupEnabled(args[0], args[1] === 'on'))
        break
      }
      /** 윈도우 디스크 정리를 띄우기만 한다. 우리가 고르지 않는다. */
      /**
       * 시스템 보호(시스템 복원) 설정 창.
       *
       * 여기서 사용자는 지금 쓰는 양을 보고 최대 크기를 막대로 줄일 수 있다.
       * 우리가 vssadmin을 대신 치지 않는 이유: 지운 복원 지점은 못 되살린다.
       * 되돌릴 수 없는 걸 대신 실행하지 않는다(types.ts 규약).
       */
      case 'open-system-protection': {
        out({ opened: true, ...(await openTool('SystemPropertiesProtection.exe')) })
        break
      }
      /** 가상 메모리(pagefile) 크기를 정하는 정식 창 — 성능 옵션 → 고급. */
      case 'open-virtual-memory': {
        out({ opened: true, ...(await openTool('SystemPropertiesPerformance.exe')) })
        break
      }
      /**
       * 최대 절전 끄기/켜기 — **되돌리는 명령이 있어서** 우리가 실행할 수 있는 유일한 계열.
       *
       * ★ 여태 화면엔 "실행(관리자 권한)은 다음 업데이트에서 연결됩니다"만 떠 있었다.
       *   12.7GB짜리를 찾아놓고 사용자에게 직접 powercfg를 치라고 한 셈이다.
       *   명령은 여기 하드코딩돼 있고, 화면은 이름만 보낸다.
       *
       * 관리자 확인(UAC)은 윈도우가 띄운다. 취소하면 아무 일도 안 일어난다.
       */
      case 'hibernate-off':
      case 'hibernate-on': {
        const on = command === 'hibernate-on'
        const before = await gatherFacts()
        try {
          // Start-Process -Verb RunAs가 UAC를 띄운다. -Wait로 끝날 때까지 기다린다.
          await runPowerShell(
            `Start-Process powercfg -ArgumentList '/hibernate','${on ? 'on' : 'off'}' -Verb RunAs -Wait -WindowStyle Hidden`
          )
        } catch {
          fail('관리자 확인이 취소됐거나 실행하지 못했어요. 아무것도 바뀌지 않았습니다.')
        }
        // 실제로 바뀌었는지 다시 재서 답한다 — "했다"는 말만 하지 않는다.
        const after = await gatherFacts()
        out({
          hibernateEnabled: after.fastStartupEnabled,
          freedBytes: Math.max(0, (before.hiberfilBytes ?? 0) - (after.hiberfilBytes ?? 0)),
          bytesNow: after.hiberfilBytes ?? 0,
        })
        break
      }
      /**
       * 시스템 복원이 잡아둔 공간 재기 — **읽기만 한다.**
       *
       * ★ 여태 화면엔 "권한이 있어야 볼 수 있어서 저희가 못 쟀습니다"만 떠 있었다.
       *   숨은 공간 중 가장 큰 항목이고 100GB가 잡혀 있을 수도 있는데, 물어보지도
       *   않고 모른다고 한 것이다. 권한이 필요하면 권한을 물어보면 된다.
       *
       * 재고 나서 항목을 **다시 만들어** 돌려준다. 화면이 숫자를 받아 제 나름대로
       * 문장을 짓지 않게 하기 위해서다 — 그러면 두 곳의 말이 언젠가 갈린다.
       * (v0.18.0에서 같은 이유로 화면이 판정을 다시 하지 않게 만들었다)
       */
      case 'restore-measure': {
        if (process.platform !== 'win32') fail('윈도우에서만 확인할 수 있어요.')
        const { facts, cancelled } = await measureRestoreElevated()
        if (cancelled) fail('관리자 확인이 취소됐어요. 아무것도 바뀌지 않았습니다 — 다시 눌러 "예"를 선택해 주세요.')
        if (!facts.measured) {
          fail('권한은 받았는데 값을 읽지 못했어요. 시스템 복원이 꺼져 있으면 잡아둔 공간도 없습니다 — "시스템 보호 설정 열기"로 확인해 보세요.')
        }
        out({ ...facts, finding: probeRestore(facts) })
        break
      }
      case 'open-cleanmgr': {
        const drive = process.env.SystemDrive ?? 'C:'
        // 실측에선 권한 없이 열렸다. 그래도 같은 문으로 보낸다 —
        // "이건 안 그러니까 건너뛰자"가 쌓이면 문이 없는 것과 같아진다(v0.18.1).
        out({ opened: true, drive, ...(await openTool('cleanmgr.exe', ['/d', drive])) })
        break
      }
      /**
       * 옮길 만한 것을 **알아서** 찾는다 — 폴더를 고르라고 하지 않는다.
       *
       * 어느 폴더에 큰 게 있는지 아는 사람이면 이 기능이 필요 없다.
       * 그래서 사람이 만든 큰 덩어리가 사는 곳(relocateRoots)을 훑어
       * 옮겨도 되는 것만 폴더별로 묶어 준다. 대상 드라이브도 함께 나열한다.
       */
      case 'relocate-scan': {
        const roots = relocateRoots({ platform: process.platform, home: homedir() })
        const groups: {
          label: string; path: string; count: number; bytes: number
          items: { path: string; size: number; meaning: string }[]
        }[] = []
        let totalBytes = 0
        let totalCount = 0
        let refusedCount = 0

        for (const [i, r] of roots.entries()) {
          progress({ t: 'relocate-scan', rootIndex: i, rootCount: roots.length, root: r.path, label: r.label })
          let candidates
          try {
            candidates = await relocateCandidates(r.path)
          } catch {
            continue // 그 폴더가 없거나 못 읽으면 건너뛴다 — 나머지로 계속 간다
          }
          refusedCount += candidates.refused.length
          if (!candidates.items.length) continue

          candidates.items.sort((a, b) => b.size - a.size)
          const bytes = candidates.items.reduce((s, it) => s + it.size, 0)
          totalBytes += bytes
          totalCount += candidates.items.length
          groups.push({
            label: r.label,
            path: r.path,
            count: candidates.items.length,
            bytes,
            items: candidates.items.slice(0, 30).map((it) => ({
              path: it.path, size: it.size, meaning: it.meaning,
            })),
          })
        }

        groups.sort((a, b) => b.bytes - a.bytes)
        out({
          roots: roots.map((r) => r.label),
          groups,
          totalCount,
          totalBytes,
          refusedCount,
          minBytes: RELOCATE_MIN_BYTES,
          drives: await listDrives(),
        })
        break
      }
      case 'relocate-plan': {
        if (!args[0] || !args[1]) fail('경로와 옮길 드라이브가 필요합니다.')
        const { items, refused } = await relocateCandidates(args[0])
        const plan = planRelocate(items, args[1])
        const dest = await checkDestination(args[1], plan.bytes)
        out({
          destFolder: plan.destFolder,
          bytes: plan.bytes,
          count: plan.items.length,
          items: plan.items.slice(0, 200).map(({ item, dest: to }) => ({
            path: item.path, size: item.size, meaning: item.meaning, dest: to,
          })),
          skipped: plan.skipped,
          refused: refused.slice(0, 50),
          refusedCount: refused.length,
          destination: dest,
        })
        break
      }
      case 'relocate-apply': {
        if (!args[0] || !args[1]) fail('경로와 옮길 드라이브가 필요합니다.')
        const { items } = await relocateCandidates(args[0])
        const plan = planRelocate(items, args[1])
        // 실행 직전에 다시 확인한다. 계획을 세운 뒤 다른 게 대상 드라이브를 채웠을 수 있다.
        const dest = await checkDestination(args[1], plan.bytes)
        if (!dest.ok) fail(dest.reason)
        const r = await applyRelocate(plan)
        out(r)
        break
      }
      /**
       * 고른 파일만 옮긴다 — 질문 목록에서 곧바로.
       *   relocate-paths-plan  <destRoot> <path...>   미리보기(아무것도 안 건드림)
       *   relocate-paths-apply <destRoot> <path...>   실제 이동
       */
      case 'relocate-paths-plan':
      case 'relocate-paths-apply': {
        const destRoot = args[0]
        const paths = args.slice(1).filter(Boolean)
        if (!destRoot) fail('옮길 드라이브가 필요합니다.')
        if (!paths.length) fail('옮길 파일 경로가 필요합니다.')

        const { plan, refused, destination } = await relocatePathsPlan(destRoot, paths)

        if (command === 'relocate-paths-plan') {
          out({
            destFolder: plan.destFolder,
            bytes: plan.bytes,
            count: plan.items.length,
            items: plan.items.slice(0, 200).map(({ item, dest }) => ({
              path: item.path, size: item.size, meaning: item.meaning, dest,
            })),
            skipped: plan.skipped,
            refused,
            destination,
          })
          break
        }

        if (!plan.items.length) {
          out({ movedCount: 0, movedBytes: 0, failed: [], refused, skipped: plan.skipped, ledgerPath: '' })
          break
        }
        // 실행 직전에 다시 확인한다 — 미리보기를 본 뒤 대상 드라이브가 찼을 수 있다.
        if (!destination.ok) fail(destination.reason)
        const r = await applyRelocate(plan)
        out({ ...r, refused, skipped: plan.skipped })
        break
      }
      /**
       * 폴더를 통째로 정리한다 — **낱개가 아니라 결정 단위.**
       *
       * ── 왜 필요했나 ────────────────────────────────────────────
       * 낱개 격리(quarantine-paths)는 경로를 인자로 받는다. 그런데 .venv 하나가
       * 12,000개면 인자 12,000개를 넘겨야 하고, 그건 명령줄 길이 제한에 걸린다.
       * 무엇보다 그건 **사용자가 내린 결정을 잘못 옮긴 것**이다 — 사용자는
       * "이 폴더"라고 결정했지 파일 12,000개를 하나하나 고른 게 아니다.
       *
       * ── 여기서도 화면 말을 그냥 믿지 않는다 ────────────────────
       * 받은 폴더 안을 지금 다시 훑고, 파일마다 다시 분류한다. 존 C가 섞여 있으면
       * 그것만 빼고 나머지를 격리한다 — 폴더째라고 해서 잠근 것까지 가져가지 않는다.
       */
      case 'quarantine-folders': {
        const folders = args.filter(Boolean)
        if (!folders.length) fail('정리할 폴더 경로가 필요합니다.')

        const requests = []
        const refused: { path: string; reason: string }[] = []
        for (const folder of folders) {
          try {
            const st = await stat(folder)
            if (!st.isDirectory()) {
              refused.push({ path: folder, reason: '폴더가 아니에요' })
              continue
            }
          } catch {
            refused.push({ path: folder, reason: '폴더를 찾지 못했어요' })
            continue
          }

          const scanned = await scan(folder)
          for (const f of scanned.files) {
            const c = classifyOne(f)
            if (c.verdict.zone === 'LOCKED') {
              refused.push({ path: f.path, reason: `잠근 항목이라 건드리지 않았어요 (${c.verdict.meaning})` })
              continue
            }
            requests.push({
              path: f.path,
              reason: `폴더째 정리하기로 고르신 것 — ${folder}`,
              zone: c.verdict.zone,
              expect: { size: f.size, mtimeMs: stampMtime(f.mtime.getTime()) },
            })
          }
        }

        if (!requests.length) {
          out({ deletedCount: 0, deletedBytes: 0, leftover: 0, failed: [], refused, refusedCount: refused.length })
          break
        }
        out({
          ...(await deleteNow(requests)),
          // 폴더째면 거절이 수천 개일 수 있다. 개수는 정확히 주고 목록은 앞부분만.
          refused: refused.slice(0, 20),
          refusedCount: refused.length,
        })
        break
      }
      /**
       * 같은 파일이 여러 벌 있는 것을 찾는다.
       *
       * 훑는 곳은 이동과 같은 '사람이 만든 큰 덩어리가 사는 자리'다(relocateRoots).
       * AppData·프로그램 폴더는 애초에 안 본다 — 거기 같은 파일이 여러 벌 있는 건
       * 정상이고, 지우면 그냥 고장이다(dupes.ts의 NOT_DUPLICATES).
       */
      case 'dupes-scan': {
        /* ★ 모델 폴더를 기본으로 함께 훑는다 (2026-08-18 실측에서 나온 구멍)
         *
         *   여태 기본 범위는 relocateRoots(다운로드·영상·사진·문서)뿐이었다.
         *   그래서 이 PC를 훑었을 때 2,538개만 보고 "중복 0.16GB"라고 했다.
         *   실제로는 AI 모델이 ComfyUI 4벌·Ollama 2곳에 흩어져 있었고, 그중
         *   Ollama 쪽만 해도 19.7GB가 진짜 중복이었다.
         *
         *   찾는 함수는 이미 있었다(findModelRoots — model-roots 명령이 쓴다).
         *   화면에서 사용자가 직접 골라 넣어야만 보이는 상태였을 뿐이다.
         *   사용자가 "AI 모델이 어디 있는지" 알아내서 눌러줘야 하는 기능은
         *   있는 것과 없는 것의 중간이다.
         *
         *   AppData 안의 모델도 여기서 걸린다 — dupes.ts의 NOT_DUPLICATES가
         *   모델 파일에는 modelOk로 길을 열어두고 있다. */
        const roots = args.length
          ? args.map((p) => ({ label: p, path: p }))
          : [
              ...relocateRoots({ platform: process.platform, home: homedir() }),
              ...(await findModelRoots()),
            ]
        const files: { path: string; name: string; size: number; mtimeMs: number }[] = []
        /* 같은 파일을 두 번 담지 않는다.
           기본 범위에 모델 폴더가 들어오면서 범위가 겹칠 수 있게 됐다(예: 다운로드
           폴더 안의 models). 같은 파일이 두 줄로 들어가면 **자기 자신과 중복**으로
           잡혀서 "6.46GB 낭비"라는 유령이 생긴다. */
        const seenPath = new Set<string>()

        for (const [i, r] of roots.entries()) {
          progress({ t: 'dupes-scan', rootIndex: i, rootCount: roots.length, root: r.path, label: r.label })
          try {
            const scanned = await scan(r.path)
            for (const f of scanned.files) {
              const key = f.path.toLowerCase()
              if (seenPath.has(key)) continue
              seenPath.add(key)
              files.push({
                path: f.path,
                name: f.path.slice(Math.max(f.path.lastIndexOf('\\'), f.path.lastIndexOf('/')) + 1),
                size: f.size,
                mtimeMs: f.mtime.getTime(),
              })
            }
          } catch {
            continue // 그 폴더가 없거나 못 읽으면 나머지로 계속 간다
          }
        }

        const r = await findDuplicates(files)
        out({
          scanned: files.length,
          candidates: r.candidates,
          hashed: r.hashed,
          excluded: r.excluded,
          wastedBytes: r.wastedBytes,
          groupCount: r.groups.length,
          minBytes: DUP_MIN_BYTES,
          roots: roots.map((x) => x.label),
          /* ★ 원인까지 같이 준다. "사본을 지울까요"보다 "이 프로그램이 6곳에
             깔려 있어요"가 사용자가 실제로 내려야 할 결정에 가깝다. */
          causes: findInstallCauses(r.groups),
          // 화면에 다 그릴 수 없으니 낭비가 큰 것부터. 개수는 위에서 따로 말한다.
          groups: r.groups.slice(0, 60).map((g) => ({
            keeper: { path: g.keeper.path, name: g.keeper.name, size: g.keeper.size },
            keeperReason: g.keeperReason,
            copies: g.copies.map((c) => ({
              path: c.path,
              name: c.name,
              size: c.size,
              /* 합칠 수 있는지는 사본마다 다르다(드라이브가 다르면 못 합친다).
                 버튼에 적힌 숫자가 거짓말하지 않으려면 여기서 갈라둬야 한다. */
              mergeBlocked: mergeBlockReason(g.keeper.path, c.path),
            })),
            wastedBytes: g.wastedBytes,
            // 받아온 자료(AI 모델 등)는 지우기보다 합치기가 맞는 답이다.
            isModel: isModelFile(g.keeper.path),
          })),
        })
        break
      }
      /**
       * 고른 파일들이 클라우드에도 있는지 확인한다.
       *
       * ★ 왜 별도 명령인가: 클라우드 폴더를 훑는 일이라 스캔에 끼워 넣으면 스캔이
       *   느려진다. 화면은 목록을 **먼저 그리고** 이걸 나중에 불러서 줄만 채운다 —
       *   백업 확인이 늦어도 목록은 이미 쓸 수 있다.
       *
       * 색인은 하루 동안 재사용한다. 클라우드 폴더는 자주 바뀌지 않고, 매번
       * 다시 훑으면 네트워크 드라이브에서 몇 분씩 걸린다.
       */
      case 'backup-check': {
        const paths = args.filter((a) => a !== '--refresh')
        const { index, roots, builtAt, partial } = await loadBackupIndex(args.includes('--refresh'))

        const results = []
        for (const p of paths) {
          let size = 0
          try {
            size = (await stat(p)).size
          } catch {
            results.push({ path: p, found: false, where: '', note: '' })
            continue
          }
          results.push({ path: p, ...checkBackup({ path: p, size }, index, roots) })
        }
        out({
          results,
          roots: roots.map((r) => r.label),
          indexedAt: builtAt,
          indexSize: index.size,
          // 다 못 훑었으면 그렇다고 말한다. "못 찾았다"를 "없다"로 읽으면 안 된다.
          partial,
        })
        break
      }
      /**
       * 폴더째 옮기고 원래 자리에 바로가기(정션)를 남긴다.
       *
       *   relocate-folder-plan  <destRoot> <folder>  미리보기 (아무것도 안 건드림)
       *   relocate-folder-apply <destRoot> <folder>  실제 이동 + 정션
       *
       * ★ 이게 "옮기면 깨져요"라고 막아둔 것들의 답이다. AppData의 앱 데이터,
       *   게임, 가상환경 — 프로그램이 원래 경로를 그대로 열면 윈도우가 실물로
       *   이어준다. 관리자 권한이 필요 없다.
       */
      case 'relocate-folder-plan':
      case 'relocate-folder-apply': {
        const destRoot = args[0]
        const folder = args[1]
        if (!destRoot || !folder) fail('옮길 드라이브와 폴더가 필요합니다.')

        const blocked = junctionBlockReason(folder)
        const destFolder = movedFolderOn(destRoot)
        const dest = destinationFor(folder, destFolder)
        const sameVolume = isSameVolume(folder, destFolder)
        const measured = blocked ? { files: 0, bytes: 0 } : await measureFolder(folder)
        const destination = await checkDestination(destRoot, measured.bytes)

        if (command === 'relocate-folder-plan') {
          out({
            folder,
            dest,
            files: measured.files,
            bytes: measured.bytes,
            blocked,
            sameVolume,
            destination,
            // 화면이 그대로 쓸 수 있는 문장. 여기서 안 만들면 화면마다 달라진다.
            note:
              blocked ??
              (sameVolume
                ? '같은 드라이브라 옮겨도 용량이 늘지 않아요.'
                : '옮긴 뒤 원래 자리에 바로가기를 남겨서, 프로그램은 그대로 찾아갑니다.'),
          })
          break
        }

        if (blocked) fail(blocked)
        if (sameVolume) fail('같은 드라이브라 옮겨도 용량이 늘지 않아요.')
        if (!destination.ok) fail(destination.reason)

        const r = await moveFolderWithJunction(folder, dest)
        if (r.movedTo) {
          // 실물이 옮겨졌으면 성공 여부와 무관하게 장부에 적는다 —
          // 적지 않으면 되돌릴 방법이 사라진다.
          const entry: RelocateEntry = {
            id: randomUUID(),
            originalPath: folder,
            movedTo: r.movedTo,
            size: r.copiedBytes,
            mtimeMs: 0,
            movedAt: Date.now(),
            reason: '폴더째 옮기고 바로가기를 남긴 것',
            kind: 'folder',
            files: r.copiedFiles,
          }
          await mkdir(destFolder, { recursive: true })
          await appendFile(ledgerPathFor(destFolder), JSON.stringify(entry) + '\n', 'utf8')
        }
        if (!r.ok) fail(r.reason ?? '옮기지 못했어요')
        out({ folder, movedTo: r.movedTo, linked: r.linked, files: r.copiedFiles, bytes: r.copiedBytes })
        break
      }
      /**
       * AI 모델이 사는 자리를 찾아준다 — "폴더를 고르세요"를 없애기 위해.
       *
       * ★ 왜 필요했나: 같은 모델 6.46GB가 6벌 있는 걸 찾아내려면 그 6곳을 훑어야
       *   하는데, 기본으로 훑는 곳은 다운로드·영상·사진뿐이라 하나도 안 걸렸다.
       *   그렇다고 "폴더를 고르세요"로 시작하면, 어디 있는지 아는 사람만 쓸 수 있다.
       *   그 사람은 이 기능이 필요 없다.
       */
      case 'model-roots': {
        out({ roots: await findModelRoots() })
        break
      }
      /**
       * 사본 자리를 원본의 하드링크로 바꾼다 — **지우지 않고** 중복을 없앤다.
       *   dupes-link <남길 파일> <합칠 사본...>
       *
       * 6벌이 전부 필요한 경우(같은 모델을 6개 프로그램이 각자 씀)의 답이다.
       * 경로는 6개 다 살아 있고 디스크는 한 벌만 쓴다.
       */
      case 'dupes-link': {
        const keeper = args[0]
        const copies = args.slice(1).filter(Boolean)
        if (!keeper || !copies.length) fail('남길 파일과 합칠 사본이 필요합니다.')

        const dir = appDataFile('') // 장부는 앱 데이터 폴더에 둔다
        const merged: MergeEntry[] = []
        const failed: { path: string; reason: string }[] = []
        let bytes = 0

        for (const copy of copies) {
          const r = await mergeIntoLink(keeper, copy)
          if (!r.ok) {
            failed.push({ path: copy, reason: r.reason ?? '합치지 못했어요' })
            continue
          }
          if (r.already) continue // 이미 같은 실물이었다 — 조용히 넘어간다
          const entry: MergeEntry = {
            id: randomUUID(),
            keeper,
            linked: copy,
            size: r.bytes,
            mergedAt: Date.now(),
          }
          await appendMergeLedger(dir, entry)
          merged.push(entry)
          bytes += r.bytes
        }
        out({ mergedCount: merged.length, bytes, failed })
        break
      }
      /** 합쳐둔 것 목록 — 되돌리기(따로 떼기) 화면이 쓴다. */
      case 'merge-list': {
        const dir = appDataFile('')
        const entries = await readMergeLedger(dir)
        const items = []
        for (const e of entries) items.push({ ...e, alive: await linkStillAlive(e) })
        out({
          items: items.filter((i) => i.alive).slice(0, 200),
          count: items.filter((i) => i.alive).length,
          bytes: items.filter((i) => i.alive).reduce((s, i) => s + i.size, 0),
        })
        break
      }
      /**
       * 합친 것을 다시 따로 떼어놓는다.
       * ★ '되돌리기'가 아니라 '따로 떼기'다 — 되돌리면 그만큼 용량을 도로 쓴다.
       *   이름을 정확히 불러야 사용자가 놀라지 않는다.
       */
      case 'merge-undo': {
        if (!args[0]) fail('따로 뗄 id(또는 --all)가 필요합니다.')
        const dir = appDataFile('')
        const entries = await readMergeLedger(dir)
        const wanted = args[0] === '--all' ? entries : entries.filter((e) => e.id.startsWith(args[0]))
        const done = []
        const failed: { path: string; reason: string }[] = []
        for (const e of wanted) {
          const r = await splitLink(e)
          if (r.ok) done.push(e)
          else failed.push({ path: e.linked, reason: r.reason ?? '따로 떼지 못했어요' })
        }
        out({ splitCount: done.length, bytes: done.reduce((s, e) => s + e.size, 0), failed })
        break
      }
      /** 붙어 있는 드라이브만 훑는다 — 파일은 안 본다(이동 화면의 전체 스캔과 분리). */
      case 'drives': {
        out({ drives: await listDrives() })
        break
      }
      /**
       * 되돌릴 수 있는 것 전부 — 격리한 것과 옮긴 것을 한 목록으로.
       *
       * ★ 왜 합치나: 사용자에게는 "내가 이 도구로 건드린 것"이 하나다. 그런데
       *   되돌리기가 격리함 화면과 '드라이브 옮기기' 화면으로 갈려 있어서,
       *   옮긴 걸 되돌리려면 어느 드라이브로 옮겼는지를 **기억해서** 그 화면을
       *   찾아가야 했다. 기억해야 하는 되돌리기는 되돌리기가 아니다.
       */
      case 'undo-list': {
        const roots = await listQuarantineRoots()
        const quarantined = []
        for (const root of roots) {
          for (const e of await readManifest(root)) {
            quarantined.push({ ...e, root, kind: 'quarantine' as const })
          }
        }

        const moved = []
        for (const d of await listDrives()) {
          const folder = movedFolderOn(d.root)
          for (const e of await readRelocateLedger(folder)) {
            moved.push({ ...e, destRoot: d.root, kind: e.kind === 'folder' ? ('folder' as const) : ('file' as const) })
          }
        }

        out({
          quarantined: quarantined.sort((a, b) => b.quarantinedAt - a.quarantinedAt).slice(0, 200),
          quarantinedCount: quarantined.length,
          quarantinedBytes: quarantined.reduce((s, e) => s + e.size, 0),
          moved: moved.sort((a, b) => b.movedAt - a.movedAt).slice(0, 200),
          movedCount: moved.length,
          movedBytes: moved.reduce((s, e) => s + e.size, 0),
          graceDays: GRACE_DAYS,
        })
        break
      }
      case 'relocate-list': {
        if (!args[0]) fail('드라이브가 필요합니다.')
        const folder = movedFolderOn(args[0])
        const entries = await readRelocateLedger(folder)
        out({
          destFolder: folder,
          items: entries,
          totalBytes: entries.reduce((s, e) => s + e.size, 0),
        })
        break
      }
      case 'relocate-undo': {
        if (!args[0] || !args[1]) fail('드라이브와 되돌릴 id(또는 --all)가 필요합니다.')
        const folder = movedFolderOn(args[0])
        const entries = await readRelocateLedger(folder)
        const ids = args[1] === '--all'
          ? entries.map((e) => e.id)
          : entries.filter((e) => e.id.startsWith(args[1])).map((e) => e.id)
        const r = await undoRelocate(ids, folder)
        out({
          restoredCount: r.restored.length,
          restoredBytes: r.restored.reduce((s, e) => s + e.size, 0),
          failed: r.failed.map((f) => ({ path: f.entry.originalPath, reason: f.reason })),
        })
        break
      }
      case 'programs': {
        // 제안만 한다. 제거는 셸이 정식 언인스톨러를 호출해서 한다.
        const r = await probePrograms()
        out({
          totalScanned: r.totalScanned,
          suggestibleBytes: r.suggestibleBytes,
          suggestions: await Promise.all(r.suggestions.map(async (s) => ({
            key: s.key,
            keyPath: s.keyPath,
            name: s.name,
            publisher: s.publisher,
            version: s.version,
            bytes: s.estimatedBytes,
            unusedDays: s.unusedDays,
            runCount: s.runCount,
            reason: s.verdict.reason,
            uninstallString: uninstallCommandFor(s),
            // 있으면 앱 안에서 끝난다. 없으면 화면이 "마법사가 열린다"고 말해야 한다.
            // ★ 레지스트리에 QuietUninstallString이 없어도 포기하지 않는다 —
            //   언인스톨러 파일을 열어 NSIS인지 확인하고, 맞으면 규격 스위치를 쓴다.
            //   (detectSilentUninstall 머리말 — 추측이 아니라 확인이다)
            silentUninstall: await detectSilentUninstall(s),
            // 컴퓨터 전체에 설치된 것 — 승격해서 실행해야 UAC가 정상적으로 뜬다.
            needsAdmin: needsElevation(s),
            installLocation: s.installLocation,
          }))),
          // 안 건드린 것도 보여준다 — "무엇을 제외했는지"가 신뢰의 근거다.
          excluded: r.excluded.slice(0, 60),
          excludedCount: r.excluded.length,
        })
        break
      }
      /**
       * 제거가 **진짜** 끝났는지 레지스트리에 다시 물어본다.
       * 언인스톨러의 종료 코드는 못 믿는다(probes/programs.ts isStillInstalled 머리말).
       * 화면은 이 대답을 받고 나서야 "제거됐어요"라고 말한다.
       */
      case 'program-installed': {
        if (!args[0]) fail('확인할 레지스트리 경로가 필요합니다.')
        out({ installed: await isStillInstalled(args[0]) })
        break
      }
      default:
        fail(`알 수 없는 명령: ${command ?? '(없음)'}`)
    }
  } catch (err) {
    fail((err as Error).message ?? String(err))
  }
}

main()
