/**
 * 설치된 프로그램 프로브 — "오래 안 쓴 프로그램"
 *
 * ── 왜 별도 프로브인가 ────────────────────────────────────────
 * 나머지 엔진은 전부 '파일'을 본다. 그런데 프로그램은 파일 트리로 판단할 수 없다.
 * 폴더 크기만 봐서는 그게 뭔지, 언제 마지막에 썼는지, 지워도 되는지 알 수 없고,
 * 무엇보다 **프로그램 폴더를 직접 지우면 안 된다** — 레지스트리·서비스·확장이
 * 남아서 시스템이 지저분해지고 재설치도 막힌다.
 * 그래서 hiberfil처럼 파일 스캔과 다른 경로로 간다. (probes/hiberfil.ts와 같은 이유)
 *
 * ── 이 프로브의 절대 규칙 ─────────────────────────────────────
 *   1. 제거는 **정식 언인스톨러(UninstallString)** 호출로만 한다. 파일 삭제 금지.
 *   2. 격리로 되돌릴 수 없다. 그래서 자동 처리 대상이 절대 아니다 —
 *      항상 사람이 하나씩 확인한다. 일괄 제거 API를 만들지 않는다.
 *   3. 모르면 제외한다. 보호 목록에 걸리거나 정보가 부족하면 후보에서 뺀다.
 *
 * 사실 수집은 `reg query`로 한다(의존성 0 원칙). 판단은 전부 순수 함수라 테스트된다.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'


const run = promisify(execFile)

/** 레지스트리에서 읽어낸 설치 항목 (판단 전) */
export interface InstalledProgram {
  /** 레지스트리 키 이름 — 고유 식별자로 쓴다 */
  key: string
  name: string
  publisher?: string
  version?: string
  installLocation?: string
  uninstallString?: string
  /** 레지스트리가 보고한 크기(KB 단위 값을 바이트로 환산). 없으면 0 — 믿을 수 없다. */
  estimatedBytes: number
  /** 설치일 (YYYYMMDD 문자열이 오는 경우가 많다) */
  installDate?: string
}

/**
 * 마지막 사용 시각의 출처. 이게 곧 신뢰도다.
 *
 *   userassist  실제 실행 기록(횟수 + 마지막 실행 시각). 믿을 수 있다.
 *   none        실행 기록을 못 찾음. **"안 썼다"는 뜻이 아니다** —
 *               명령줄로만 쓰는 도구(git 등)는 UserAssist에 안 잡힌다.
 *               설치 폴더 시각은 '마지막 실행'이 아니라 '마지막 설치·업데이트'라서
 *               사용 여부의 근거로 쓰지 않는다.
 */
export type UsageSource = 'userassist' | 'none'

/** 마지막 사용 시각 추정까지 끝난 항목 */
export interface ProgramUsage extends InstalledProgram {
  /** 마지막으로 실행한 시각. 못 구하면 null. */
  lastUsedMs: number | null
  /** 며칠째 안 썼나. lastUsedMs가 없으면 null. */
  unusedDays: number | null
  /** 실행 횟수 (UserAssist 기준) */
  runCount: number | null
  source: UsageSource
  /** 추정 근거 — 사용자에게 그대로 보여준다. 근거 없이 "안 쓰신다"고 하지 않는다. */
  evidence: string
}

/** 제거 후보 판정 결과 */
export interface ProgramVerdict {
  /** 제거를 '제안'할 수 있는가. 실행이 아니라 제안이다. */
  suggestible: boolean
  /** 왜 제안하는지 / 왜 제외했는지 */
  reason: string
}

/* ────────────────────────────────────────────────────────────
   보호 목록 — 건드리면 안 되는 것들

   "안 쓴 지 오래됐다"는 신호는 프로그램 종류에 따라 뜻이 완전히 다르다.
   백신은 안 열어봐도 계속 돌고 있고, 런타임은 다른 앱이 부를 때만 쓴다.
   "내가 안 열었다 = 안 쓴다"가 성립하지 않는 것들을 먼저 걷어낸다.
   ──────────────────────────────────────────────────────────── */
const PROTECTED = [
  { test: /안랩|alyac|이스트시큐리티|v3 |defender|antivirus|백신|kaspersky|avast|norton|mcafee|bitdefender|eset/i,
    why: '보안 프로그램 — 화면에 안 떠도 계속 동작합니다' },
  { test: /visual c\+\+|\.net|dotnet|redistributable|runtime|framework|webview|java\b|jre\b|jdk\b/i,
    why: '런타임 — 다른 프로그램이 필요할 때 부릅니다. 지우면 그 프로그램이 깨져요' },
  { test: /driver|드라이버|nvidia|amd |intel\(r\)|realtek|chipset|graphics|audio/i,
    why: '드라이버 — 하드웨어가 동작하려면 필요합니다' },
  { test: /windows (sdk|kit|installer|app)|microsoft edge|onedrive|update/i,
    why: '윈도우 구성 요소' },
  { test: /security update|보안 업데이트|hotfix|kb\d{6,}/i,
    why: '보안 업데이트' },
]

/** 이 프로그램을 제거 후보로 '제안'해도 되는가. 모르면 제외한다. */
export function judgeProgram(p: ProgramUsage, minUnusedDays = 180): ProgramVerdict {
  const name = p.name ?? ''
  for (const rule of PROTECTED) {
    if (rule.test.test(name)) return { suggestible: false, reason: rule.why }
  }
  if (!p.uninstallString) {
    // 정식 제거 방법을 모르면 손대지 않는다. 파일을 직접 지우는 건 이 프로브의 금기다.
    return { suggestible: false, reason: '정식 제거 방법이 등록돼 있지 않아 손대지 않습니다' }
  }
  // ★ 양성 신호가 있을 때만 제안한다.
  //   "실행 기록을 못 찾았다"는 "안 쓴다"가 아니다. 명령줄로만 쓰는 도구는
  //   UserAssist에 안 잡힌다 — 실측에서 Git이 "12개월째 미사용"으로 잡혔다.
  //   매일 쓰는 도구인데. 모르면 제외한다.
  if (p.source !== 'userassist' || p.unusedDays === null) {
    return { suggestible: false, reason: '실행 기록을 찾지 못해 판단하지 않습니다' }
  }
  if (p.unusedDays < minUnusedDays) {
    return { suggestible: false, reason: `${p.unusedDays}일 전에 실행하셨습니다` }
  }
  const 개월 = Math.floor(p.unusedDays / 30)
  const 횟수 = p.runCount ? `, 지금까지 ${p.runCount}번 실행` : ''
  return { suggestible: true, reason: `${개월}개월째 실행하지 않으셨습니다 (${p.evidence}${횟수})` }
}

/* ────────────────────────────────────────────────────────────
   실행 기록 (UserAssist) — 관리자 권한 없이 읽을 수 있는 유일한 신호

   Prefetch(C:\Windows\Prefetch)가 더 정확하지만 관리자 권한이 필요하다.
   이 앱은 최소 권한으로 설치되므로(installer의 PrivilegesRequired=lowest)
   쓸 수 없다. UserAssist는 HKCU라 현재 사용자 권한으로 읽힌다.

   한계: 탐색기·시작메뉴로 실행한 것만 기록된다. 터미널에서 부르는 CLI 도구는
   안 잡힌다. 그래서 '기록 없음'을 '미사용'으로 해석하지 않는다.
   ──────────────────────────────────────────────────────────── */

export interface RunRecord {
  /** 복호화된 실행 파일 경로 */
  path: string
  runCount: number
  lastRunMs: number
}

/** UserAssist의 값 이름은 ROT13으로 인코딩돼 있다. */
export function rot13(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base)
  })
}

/** FILETIME(1601년 기준 100ns) → 유닉스 ms. 범위를 벗어나면 null. */
export function filetimeToMs(ft: bigint): number | null {
  if (ft <= 0n) return null
  const ms = Number(ft / 10000n) - 11644473600000
  // 1990년 이전이나 현재보다 훨씬 미래면 깨진 값으로 본다
  if (ms < 631152000000 || ms > Date.now() + 86400000) return null
  return ms
}

/**
 * `reg query <UserAssist> /s` 출력에서 실행 기록을 뽑는다.
 *
 * 값 데이터는 REG_BINARY 72바이트 구조:
 *   offset  4  실행 횟수 (DWORD)
 *   offset 60  마지막 실행 시각 (FILETIME)
 */
export function parseUserAssist(output: string): RunRecord[] {
  const records: RunRecord[] = []
  for (const line of output.split(/\r?\n/)) {
    // ★ 값 '이름'이 경로라서 공백이 들어간다("…\Adobe Photoshop 2026.lnk").
    //   \S+ 로 잡으면 공백 있는 항목을 통째로 놓친다 — 실제로 절반 가까이 놓치고 있었다.
    //   그래서 이름은 비탐욕적으로 받고 REG_BINARY 토큰을 기준으로 자른다.
    const m = line.match(/^\s+(.+?)\s+REG_BINARY\s+([0-9A-Fa-f]+)\s*$/)
    if (!m) continue
    const path = rot13(m[1])
    // .exe = 직접 실행, .lnk = 시작메뉴·바탕화면 바로가기로 실행.
    // GUI 프로그램은 대부분 .lnk 쪽에 기록이 남는다 — 이걸 빼면 대부분을 놓친다.
    if (!/\.(exe|lnk)$/i.test(path)) continue
    const hex = m[2]
    if (hex.length < 136) continue // 68바이트 미만이면 구조가 아니다
    try {
      const buf = Buffer.from(hex, 'hex')
      const runCount = buf.readUInt32LE(4)
      const lastRunMs = filetimeToMs(buf.readBigUInt64LE(60))
      if (lastRunMs === null) continue
      records.push({ path, runCount, lastRunMs })
    } catch {
      /* 깨진 항목은 건너뛴다 */
    }
  }
  return records
}

/**
 * 설치 항목과 실행 기록을 잇는다.
 *
 * UserAssist 경로는 표준 폴더를 GUID로 쓴다({GUID}\Git\bin\git.exe).
 * 그래서 전체 경로 비교가 안 되고, 설치 폴더의 마지막 폴더명으로 맞춘다.
 */
export function matchRunRecord(p: InstalledProgram, records: RunRecord[]): RunRecord | null {
  let best: RunRecord | null = null
  const take = (r: RunRecord) => {
    if (!best || r.lastRunMs > best.lastRunMs) best = r
  }

  // ① 설치 폴더로 매칭 — 그 폴더 안의 exe를 실행한 기록
  const leaf = p.installLocation?.replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.toLowerCase()
  if (leaf && leaf.length >= 3) {
    const needle = `\\${leaf}\\`
    for (const r of records) {
      if (r.path.toLowerCase().includes(needle)) take(r)
    }
  }
  if (best) return best

  // ② 바로가기 이름으로 매칭 — 시작메뉴에서 실행한 기록(.lnk)
  const wanted = normalizeName(p.name)
  if (wanted.length >= 3) {
    for (const r of records) {
      const base = r.path.split(/[\\/]/).pop() ?? ''
      if (normalizeName(base.replace(/\.(exe|lnk)$/i, '')) === wanted) take(r)
    }
  }
  return best
}

/**
 * 이름 비교용 정규화. "Adobe Photoshop 2026" 과 "Adobe Photoshop 2026.lnk"가
 * 같은 것으로 잡히게 한다. 버전·연도·괄호는 표기가 제각각이라 떼어낸다.
 */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\bv?\d+(\.\d+)*\b/g, ' ') // 버전·연도
    .replace(/[^a-z0-9가-힣]+/g, '')
}

/* ────────────────────────────────────────────────────────────
   레지스트리 파싱 — 순수 함수 (테스트 가능)
   ──────────────────────────────────────────────────────────── */

/** `reg query ... /s` 출력에서 KB 단위 EstimatedSize를 바이트로. */
function kbToBytes(raw: string | undefined): number {
  if (!raw) return 0
  // REG_DWORD는 0x1234 형태로 온다
  const n = raw.startsWith('0x') ? parseInt(raw, 16) : parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n * 1024 : 0
}

/**
 * `reg query <root> /s` 출력을 항목 배열로 파싱한다.
 *
 * 출력 형태:
 *   HKEY_LOCAL_MACHINE\...\Uninstall\{GUID}
 *       DisplayName    REG_SZ    프로그램 이름
 *       EstimatedSize  REG_DWORD 0x1234
 *   (빈 줄)
 *
 * 한국어 윈도우에서도 값 '이름'은 영문이라 파싱이 지역화에 흔들리지 않는다.
 * (powercfg 출력이 한국어라 파싱을 포기했던 것과 대비 — probes/hiberfil.ts 참고)
 */
export function parseRegQuery(output: string): InstalledProgram[] {
  const blocks = output.split(/\r?\n(?=HKEY_)/)
  const programs: InstalledProgram[] = []

  for (const block of blocks) {
    const lines = block.split(/\r?\n/)
    const keyLine = lines[0]?.trim()
    if (!keyLine?.startsWith('HKEY_')) continue

    const values = new Map<string, string>()
    for (const line of lines.slice(1)) {
      // "    DisplayName    REG_SZ    값" — 값에 공백이 있을 수 있다
      const m = line.match(/^\s+(\S+)\s+(REG_\w+)\s+(.*)$/)
      if (m) values.set(m[1], m[3].trim())
    }

    const name = values.get('DisplayName')
    if (!name) continue // 이름 없는 항목은 시스템 조각인 경우가 대부분
    // 시스템 컴포넌트로 표시된 건 사용자에게 보여줄 프로그램이 아니다
    if (values.get('SystemComponent') === '0x1') continue
    // 다른 프로그램의 업데이트 항목
    if (values.get('ParentKeyName')) continue

    programs.push({
      key: keyLine.split('\\').pop() ?? keyLine,
      name,
      publisher: values.get('Publisher'),
      version: values.get('DisplayVersion'),
      installLocation: values.get('InstallLocation') || undefined,
      uninstallString: values.get('QuietUninstallString') || values.get('UninstallString') || undefined,
      estimatedBytes: kbToBytes(values.get('EstimatedSize')),
      installDate: values.get('InstallDate'),
    })
  }

  return programs
}

/** 레지스트리 InstallDate(YYYYMMDD) → ms. 형식이 아니면 null. */
export function parseInstallDate(raw: string | undefined): number | null {
  if (!raw || !/^\d{8}$/.test(raw)) return null
  const y = +raw.slice(0, 4)
  const m = +raw.slice(4, 6)
  const d = +raw.slice(6, 8)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return Date.UTC(y, m - 1, d)
}

/** 며칠 지났나. 미래 시각이면 0으로 눌러 음수가 안 나오게 한다. */
export function daysSince(ms: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - ms) / 86_400_000))
}

/* ────────────────────────────────────────────────────────────
   수집 (IO)
   ──────────────────────────────────────────────────────────── */

const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
]

/** 레지스트리에서 설치 목록을 모은다. 윈도우가 아니면 빈 배열. */
export async function collectInstalled(): Promise<InstalledProgram[]> {
  if (process.platform !== 'win32') return []

  const all = new Map<string, InstalledProgram>()
  for (const key of UNINSTALL_KEYS) {
    try {
      const { stdout } = await run('reg', ['query', key, '/s'], {
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      })
      for (const p of parseRegQuery(stdout)) {
        // 32/64비트 양쪽에 같은 항목이 잡히기도 한다 — 이름+버전으로 중복 제거
        all.set(`${p.name}|${p.version ?? ''}`, p)
      }
    } catch {
      /* 이 키가 없거나 권한이 없으면 건너뛴다 — 나머지로 계속 간다 */
    }
  }
  return [...all.values()]
}

/**
 * 마지막 사용 시각을 추정한다.
 *
 * 완벽한 방법이 없다. Prefetch는 관리자 권한이 필요하고 꺼져 있을 수 있으며,
 * UserAssist는 ROT13으로 인코딩된 비공식 포맷이다. 그래서 **설치 폴더의 최근
 * 접근/수정 시각**을 쓴다 — 프로그램이 실행되면 로그·설정·캐시가 갱신되므로
 * 대체로 함께 움직인다.
 *
 * ★ 추정이라는 걸 숨기지 않는다. evidence에 근거를 적어 그대로 보여준다.
 *   근거 없이 "6개월째 안 쓰셨네요"라고 단정하면, 틀렸을 때 신뢰가 통째로 깨진다.
 */
export function estimateUsage(p: InstalledProgram, records: RunRecord[], now = Date.now()): ProgramUsage {
  const hit = matchRunRecord(p, records)
  if (hit) {
    return {
      ...p,
      lastUsedMs: hit.lastRunMs,
      unusedDays: daysSince(hit.lastRunMs, now),
      runCount: hit.runCount,
      source: 'userassist',
      evidence: '실행 기록 기준',
    }
  }
  // 설치 폴더 시각은 '마지막 실행'이 아니라 '마지막 설치·업데이트'다.
  // 사용 여부의 근거로 쓰면 매일 쓰는 도구가 미사용으로 잡힌다(실측: Git).
  return {
    ...p,
    lastUsedMs: null,
    unusedDays: null,
    runCount: null,
    source: 'none',
    evidence: '실행 기록 없음 — 터미널에서만 쓰는 도구는 기록이 안 남습니다',
  }
}

export interface ProgramsReport {
  /** 제거를 제안할 만한 것 — 큰 것부터 */
  suggestions: (ProgramUsage & { verdict: ProgramVerdict })[]
  /** 제외한 것과 그 이유. "안 건드린 것"도 보여준다. */
  excluded: { name: string; reason: string }[]
  totalScanned: number
  suggestibleBytes: number
}

/** UserAssist에서 실행 기록을 읽는다. 실패하면 빈 배열 — 그러면 아무것도 제안되지 않는다. */
export async function collectRunRecords(): Promise<RunRecord[]> {
  if (process.platform !== 'win32') return []
  try {
    const { stdout } = await run(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\UserAssist', '/s'],
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true }
    )
    return parseUserAssist(stdout)
  } catch {
    return []
  }
}

/**
 * 설치 폴더의 실제 크기를 잰다. 레지스트리의 EstimatedSize는 없거나 틀린 경우가 많다.
 *
 * 제안된 것에만 쓴다 — 88개 전부 걸어 재면 느리다.
 * 파일 수 상한을 둬서 거대한 폴더에서 오래 붙잡히지 않게 한다.
 */
export async function measureFolder(dir: string, maxEntries = 20000): Promise<number> {
  let total = 0
  let seen = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    let entries
    try {
      entries = await readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (++seen > maxEntries) return total
      const full = join(cur, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.isFile()) {
        try {
          total += (await stat(full)).size
        } catch {
          /* 잠긴 파일은 건너뛴다 */
        }
      }
    }
  }
  return total
}

/** 설치 목록을 모아 제거 후보를 고른다. 아무것도 실행하지 않는다. */
export async function probePrograms(minUnusedDays = 180, now = Date.now()): Promise<ProgramsReport> {
  const [installed, records] = await Promise.all([collectInstalled(), collectRunRecords()])
  const suggestions: ProgramsReport['suggestions'] = []
  const excluded: ProgramsReport['excluded'] = []
  let suggestibleBytes = 0

  for (const p of installed) {
    const usage = estimateUsage(p, records, now)
    const verdict = judgeProgram(usage, minUnusedDays)
    if (verdict.suggestible) {
      // 레지스트리 크기가 없으면 실제 폴더를 잰다. "0MB"라고 보여주면
      // 정리할 가치가 없어 보이는데, 실제로는 수 GB인 경우가 많다.
      let bytes = usage.estimatedBytes
      if (bytes === 0 && usage.installLocation) {
        bytes = await measureFolder(usage.installLocation)
      }
      suggestions.push({ ...usage, estimatedBytes: bytes, verdict })
      suggestibleBytes += bytes
    } else {
      excluded.push({ name: p.name, reason: verdict.reason })
    }
  }

  suggestions.sort((a, b) => b.estimatedBytes - a.estimatedBytes)
  return { suggestions, excluded, totalScanned: installed.length, suggestibleBytes }
}

/**
 * 제거 명령을 만든다. **실행하지 않는다** — 실행은 셸(Tauri)이 한다.
 *
 * UninstallString은 따옴표·인자가 섞인 원시 명령줄이라 그대로 셸에 넘긴다.
 * 우리가 파일을 지우는 경로는 어디에도 없다.
 */
export function uninstallCommandFor(p: InstalledProgram): string | null {
  return p.uninstallString ?? null
}
