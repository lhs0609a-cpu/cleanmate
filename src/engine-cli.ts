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
 *   apply-sweep    <path...>         존 A 자동 정리(격리로 이동)
 *   quar-list                        격리함 목록 (전 드라이브)
 *   restore        <id|--all>        되돌리기
 *   purge                            유예 30일이 지난 것만 실제 삭제
 *   probe                            숨은 공간(hiberfil·휴지통·업데이트 캐시)
 *   answer-plan    <unknown> [path...]        그 질문에 걸린 항목 미리보기
 *   answer-apply   <unknown> <outcome> [path...] 답변 실행(정리는 격리로)
 *   startup                          시작프로그램 목록 + 판정
 *   startup-set    <id> <on|off>     시작프로그램 켜기/끄기 (되돌릴 수 있음)
 *   empty-recycle-bin                휴지통 비우기(윈도우 공식 명령, 되돌리기 없음)
 *   open-cleanmgr                    윈도우 디스크 정리 도구 띄우기
 *   relocate-plan  <path> <destRoot> 다른 드라이브로 옮길 계획(미리보기)
 *   relocate-apply <path> <destRoot> 실제 이동
 *   relocate-list  <destRoot>        옮긴 목록
 *   relocate-undo  <destRoot> <id|--all>  이동 되돌리기
 *   programs                         오래 안 쓴 설치 프로그램 (제안만)
 *
 * ★ 프로그램 '제거'는 여기 없다. 정식 언인스톨러를 띄우는 건 셸(Tauri)이 한다 —
 *   엔진은 파일도 프로그램도 임의로 지우지 않는다.
 */

import { stat, readFile, writeFile, mkdir } from 'node:fs/promises'
import { parseArgv } from "./argv.ts"
import { join, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
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
  GRACE_DAYS,
} from './quarantine.ts'
import { defaultRoots } from './presets.ts'
import { buildBreakdown } from './breakdown.ts'
import { groupByKind, describeMix, kindOf } from './kinds.ts'
import { ownerOf, ownerHeadline } from './owners.ts'
import { computeProgress, type RootWeight } from './progress.ts'
import { UNKNOWN_EXPLAIN } from './content/unknowns.ts'
import { gatherFacts } from './probes/facts.ts'
import { probeHiberfil } from './probes/hiberfil.ts'
import { gatherReclaimFacts, probeRecycleBin, probeUpdateCache } from './probes/reclaim.ts'
import { probeStartup, setStartupEnabled } from './probes/startup.ts'
import {
  planFolderTidy,
  applyFolderTidy,
  undoFolderTidy,
  readFolderEntries,
  tidyFolderName,
  type FolderEntry,
} from './tidyfolder.ts'
import { quarantine } from './quarantine.ts'
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
  probePrograms, silentUninstallCommand, uninstallCommandFor, needsElevation, isStillInstalled,
} from './probes/programs.ts'
import {
  isRelocatable,
  planRelocate,
  applyRelocate,
  readRelocateLedger,
  undoRelocate,
  movedFolderOn,
  freeSpaceOn,
  hasEnoughSpace,
  type RelocateItem,
} from './relocate.ts'
import { stampMtime } from './quarantine.ts'
import type { Classified, Outcome } from './types.ts'

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
  return { ...x, kind: kindOf(x.path).label, owner, headline: ownerHeadline(owner) }
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
  const keptMap = new Map<string, number>()
  /** 어디를 봤는지도 돌려준다 — "어디까지 봤나"를 숨기면 신뢰가 안 생긴다. */
  const roots: { path: string; files: number; bytes: number }[] = []

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
      const c = classifyOne(f)
      const z = c.verdict.zone
      if (z === 'LOCKED') {
        lockB += f.size; lockC++
        keptMap.set(c.verdict.meaning, (keptMap.get(c.verdict.meaning) ?? 0) + f.size)
      } else if (z === 'AMBIG') {
        ambB += f.size; ambC++; ambig.push(c)
      } else {
        safeB += f.size; safeC++
        if (isAutoEligible(c)) { autoB += f.size; autoC++ } else inferB += f.size
      }
    }
  }

  /* 다음 스캔의 진행률을 위해 이번 개수를 남긴다. 이번 스캔 결과에는 영향이 없다. */
  await writeScanStats(roots.map((r) => ({ path: r.path, files: r.files })))

  /* 분류·질문 계산이 남았다 — 파일이 14만 개면 이 구간도 몇 초 걸린다.
     여기서 막대가 멈추면 "다 됐는데 왜 안 뜨나"가 된다. 그래서 마지막 단계를 알린다. */
  progress({ t: 'plan', pct: 99, etaSec: null, basis: 'learned', files: scannedFiles })

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
    const b = buildBreakdown(mine)
    const kinds = groupByKind(mine)
    return {
      ...q,
      evidence: {
        kinds,
        mix: describeMix(kinds, b.bytes),
        folders: b.folders,
        exts: b.exts,
        age: b.age,
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
    questions,
    kept,
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
        const paths = args.length ? args : (await presentDefaultRoots()).map((r) => r.path)
        if (!paths.length) fail('정리할 폴더를 찾지 못했습니다.')
        let quarantinedCount = 0, bytesAfterGrace = 0
        const failed: { path: string; reason: string }[] = []
        for (const path of paths) {
          const plan = await planSweep(path)
          const result = await applySweep(plan)
          quarantinedCount += result.quarantinedCount
          bytesAfterGrace += result.bytesAfterGrace
          for (const f of result.failed) failed.push(f)
        }
        out({ quarantinedCount, bytesAfterGrace, failed })
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
       * 유예가 끝난 것만 실제로 지운다 — 이 제품이 파일을 영구히 없애는 유일한 명령.
       *
       * ★ 이게 없으면 격리는 '영원한 보관'이 된다. 옮기기만 했으니 용량은 그대로고,
       *   앱은 "30일 뒤 확보됩니다"라고 말해놓고 그 약속을 아무도 지키지 않는다.
       *   판단(30일 지났나)은 purgeExpired 안에 갇혀 있어서, 여기서 "지금 지워줘"라고
       *   요청할 방법은 없다.
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
       * 유예를 기다리지 않고 지금 비운다. **되돌릴 수 없다.**
       *
       * 격리 폴더는 같은 드라이브에 있어서 격리만으로는 용량이 하나도 안 준다.
       * 디스크가 꽉 찬 사람에게 "30일 뒤에 빕니다"는 답이 아니다.
       * UI가 명시적으로 확인을 받은 뒤에만 부른다.
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

        const q = await quarantine(
          items.map((i) => ({
            path: i.path,
            reason: `질문에 "정리해도 된다"고 답하신 것 — ${i.meaning}`,
            zone: 'AMBIG' as const,
            expect: { size: i.size, mtimeMs: i.mtimeMs },
          }))
        )
        out({
          unknown,
          action,
          quarantinedCount: q.quarantined.length,
          bytesAfterGrace: q.bytes,
          failed: q.failed,
        })
        break
      }
      case 'startup': {
        out(await probeStartup())
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
       * tidy-folder-apply <desktop|downloads>  실제로 옮긴다(깨진 바로가기는 격리)
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
        // 깨진 바로가기는 옮겨봐야 쓰레기가 이동할 뿐이라 격리로 보낸다(30일 되돌리기).
        const q = plan.broken.length
          ? await quarantine(
              plan.broken.map((b) => ({
                path: b.path,
                reason: '대상이 사라진 바로가기',
                zone: 'SAFE' as const,
                expect: { size: b.size, mtimeMs: b.mtimeMs },
              }))
            )
          : { quarantined: [], failed: [] as { path: string; reason: string }[] }

        out({
          folder,
          destFolder: moved.destFolder,
          movedCount: moved.movedCount,
          movedBytes: moved.movedBytes,
          brokenQuarantined: q.quarantined.length,
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
       * 실행. 둘 다 지우지 않는다 —
       *   스크린샷은 사진 폴더 안의 '정리-YYYY-MM'으로 옮기고(장부로 되돌리기),
       *   중복 사본은 격리로 보낸다(30일 되돌리기). 원본은 절대 건드리지 않는다.
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

        let quarantinedCount = 0, quarantinedBytes = 0
        if ((what === 'all' || what === 'duplicates') && plan.dupGroups.length) {
          const q = await quarantine(
            plan.dupGroups.flatMap((g) =>
              g.copies.map((c) => ({
                path: c.path,
                reason: `같은 사진이 여러 벌 — 원본(${basename(g.keeper.path)})은 그대로 뒀어요`,
                zone: 'SAFE' as const,
                expect: { size: c.size, mtimeMs: c.mtimeMs },
              }))
            )
          )
          quarantinedCount = q.quarantined.length
          quarantinedBytes = q.bytes
          for (const f of q.failed) failed.push(f)
        }

        out({ movedCount, movedBytes, destFolder, quarantinedCount, quarantinedBytes, failed })
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
      case 'open-cleanmgr': {
        const drive = process.env.SystemDrive ?? 'C:'
        spawn('cleanmgr.exe', ['/d', drive], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
        out({ opened: true, drive })
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
          suggestions: r.suggestions.map((s) => ({
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
            silentUninstall: silentUninstallCommand(s),
            // 컴퓨터 전체에 설치된 것 — 승격해서 실행해야 UAC가 정상적으로 뜬다.
            needsAdmin: needsElevation(s),
            installLocation: s.installLocation,
          })),
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
