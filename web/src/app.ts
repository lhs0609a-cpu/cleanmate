/**
 * 테라클린 앱 화면 — 브라우저 데모 + 데스크톱 앱 공용 프론트엔드
 *
 * 한 벌의 화면이 두 곳에서 돈다:
 *   - 브라우저(Vercel 데모): 분석까지. 실제 삭제는 브라우저가 못 한다(보안 경계).
 *   - 데스크톱(Tauri): run_engine으로 검증된 엔진을 호출 → 진짜로 청소한다.
 *
 * 두 경로가 '같은 리포트 형태'를 만들어 같은 렌더 함수에 넣는다.
 * (형태 = engine-cli.ts의 scan-plan 출력)
 */

import { isSupported, pickDirectory, scanHandle } from './browser-scanner.ts'
import { classifyOne, isAutoEligible } from '../../src/classify.ts'
import { run as runEngine, fmtBytes } from '../../src/engine.ts'
import { fmtDuration } from '../../src/progress.ts'
import { compareVersions, verifyIntegrity, normalizeSha256 } from '../../src/updater.ts'
import {
  ROUTINES,
  CATEGORY_LABEL,
  emptyState,
  markDone,
  undoDone,
  planToday,
  habitStats,
  todayISO,
  type TidyState,
} from '../../src/content/tidy.ts'
import {
  stuckRoutines,
  suggestServices,
  buildRequestSummary,
  DISCLOSURE,
} from '../../src/content/referral.ts'
import type { FileEntry, Question } from '../../src/types.ts'

/** 이 빌드의 버전. 릴리스마다 tauri.conf/Cargo와 함께 올린다. */
const APP_VERSION = '0.22.0'
/**
 * GitHub 릴리스 API — 최신 버전·설치파일 URL을 준다(CORS 허용, 검증됨).
 * ★ 소스 저장소가 아니라 '배포 저장소'다. 소스는 비공개라 릴리스 API가 인증 없이는
 *   404를 주고, 그러면 설치된 앱이 업데이트를 영원히 못 찾는다. (landing.ts의 REPO 주석 참고)
 */
const LATEST_API = 'https://api.github.com/repos/lhs0609a-cpu/teraclean-releases/releases/latest'

const $ = (id: string) => document.getElementById(id)!
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// ── 실행 환경 감지 ──
const TAURI = (window as any).__TAURI__
const inTauri = !!TAURI

/**
 * 오류를 사람이 읽을 문장으로 바꾼다.
 *
 * ★ 왜 필요한가 (실물에서 터진 버그): Tauri의 invoke는 실패할 때 Error가 아니라
 *   **문자열**을 던진다 — Rust가 `Err(String)`을 돌려주기 때문이다. 그래서
 *   `errText(err)`가 undefined가 되고, 화면에는 원인 대신
 *   "제거 창을 열지 못했어요: undefined"만 남았다. 정작 Rust는 이유를
 *   또박또박 적어 보냈는데 그게 통째로 버려지고 있었다.
 */
function errText(err: unknown): string {
  if (typeof err === 'string') return err
  const m = (err as any)?.message
  return typeof m === 'string' && m ? m : String(err)
}

/** 엔진 사이드카 호출 (데스크톱 전용). JSON {ok,data|error} 규약. */
/**
 * @param job 세울 수 있어야 하는 긴 명령에만 붙인다. 이름이 있으면 Rust가
 *   그 엔진의 stdin을 붙잡아 두고, cancelEngine(job)이 "cancel"을 흘려보낸다.
 */
async function engine(command: string, args: string[] = [], job?: string): Promise<any> {
  const res = await TAURI.core.invoke('run_engine', { command, args, job: job ?? null })
  if (!res || res.ok === false) throw new Error(res?.error || '엔진 오류')
  return res.data
}

/* ── 문의 창구 ────────────────────────────────────────────────
   ★ 여기에 이메일 주소를 넣으면 그쪽으로 간다. 비워두면 지금처럼 GitHub 이슈다.

   왜 이렇게 두나: GitHub 이슈는 계정이 필요하고 영어 화면이고 공개 글이라,
   일반 사용자에게는 창구가 없는 것과 같다. 다만 없는 주소를 지어내면 문의가
   허공으로 가므로, 주소가 정해지기 전까지는 되는 길(이슈)을 그대로 쓴다. */
const SUPPORT_EMAIL = '' // 예: 'help@teraclean.app'
const SUPPORT_ISSUES = 'https://github.com/lhs0609a-cpu/teraclean-releases/issues/new'

function setupSupportLink() {
  const a = document.getElementById('support-link') as HTMLAnchorElement | null
  if (!a) return
  // 버전을 미리 적어 보낸다. 문의의 첫 왕복이 "버전이 뭐예요?"로 새는 걸 막는다.
  const v = APP_VERSION ? `v${APP_VERSION}` : '버전 미상'
  const where = inTauri ? '데스크톱 앱' : '브라우저 체험'
  if (SUPPORT_EMAIL) {
    const subject = encodeURIComponent(`[테라클린 ${v}] 문의`)
    const body = encodeURIComponent(
      `무슨 일이 있었나요?\n\n\n---\n${where} · ${v}\n(이 아래 줄은 지우지 말아주세요 — 어떤 환경인지 아는 데 씁니다)`
    )
    a.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`
  } else {
    a.href = `${SUPPORT_ISSUES}?title=${encodeURIComponent(`[${v}] `)}`
    a.target = '_blank'
    a.rel = 'noopener'
  }
}
setupSupportLink()

/** 도는 엔진을 세운다. 이미 끝났으면 아무 일도 안 일어난다 — 그건 실패가 아니다. */
async function cancelEngine(job: string): Promise<void> {
  try {
    await TAURI.core.invoke('cancel_engine', { job })
  } catch {
    /* 못 세워도 스캔은 제 시간에 끝난다. 실패를 사용자에게 떠넘기지 않는다. */
  }
}

/* ── 공통 리포트 형태 ─────────────────────────────────────── */
interface Report {
  /** 어디를 봤는지. 기본 스캔은 여러 곳을 훑으므로 목록으로 보여준다. */
  roots?: { path: string; files: number; bytes: number }[]
  scannedFiles: number
  elapsedMs: number
  zones: { safe: ZC; ambig: ZC; locked: ZC }
  plan: {
    autoBytes: number; autoCount: number
    askBytes: number; askCount: number
    lockBytes: number; lockCount: number
    inferredBytes: number
  }
  /** 제안 카드 — 42만 개의 판정을 사람이 볼 수 있는 몇 장으로 접은 것.
      경로 배열은 안 온다(엔진 캐시에 있다) — 실행은 id로 한다. */
  proposals?: {
    id: string; title: string; where: string
    bytes: number; count: number
    action: 'delete' | 'ask' | 'keep'
    recovery: string; effort: string; because: string
    tier: 1 | 2 | 3
    samples: { path: string; size: number }[]
  }[]
  proposalRest?: { bytes: number; count: number; cards: number }
  /** 다 훑지 못했다. 이 숫자들을 '전부'라고 쓰면 안 되는 신호다 */
  truncated?: boolean
  /** 왜 덜 훑었나 — 사용자가 세운 것과 시간이 모자란 것은 할 말이 다르다 */
  stoppedBy?: 'deadline' | 'cancel'
  questions: Question[]
  kept: { meaning: string; bytes: number }[]
}
interface ZC { bytes: number; count: number }

/** 브라우저 스캔 결과 → 리포트 (engine-cli와 같은 판단, classifyOne은 순수) */
function buildBrowserReport(files: FileEntry[], elapsedMs: number): Report {
  let sB = 0, sC = 0, aB = 0, aC = 0, lB = 0, lC = 0, autoB = 0, autoC = 0, inferB = 0
  const ambig = []
  const keptMap = new Map<string, number>()
  for (const f of files) {
    const c = classifyOne(f)
    const z = c.verdict.zone
    if (z === 'LOCKED') { lB += f.size; lC++; keptMap.set(c.verdict.meaning, (keptMap.get(c.verdict.meaning) ?? 0) + f.size) }
    else if (z === 'AMBIG') { aB += f.size; aC++; ambig.push(c) }
    else { sB += f.size; sC++; if (isAutoEligible(c)) { autoB += f.size; autoC++ } else inferB += f.size }
  }
  return {
    scannedFiles: files.length, elapsedMs,
    zones: { safe: { bytes: sB, count: sC }, ambig: { bytes: aB, count: aC }, locked: { bytes: lB, count: lC } },
    plan: { autoBytes: autoB, autoCount: autoC, askBytes: aB, askCount: aC, lockBytes: lB, lockCount: lC, inferredBytes: inferB },
    questions: runEngine(ambig).questions,
    kept: [...keptMap.entries()].map(([meaning, bytes]) => ({ meaning, bytes })).sort((a, b) => b.bytes - a.bytes).slice(0, 6),
  }
}

/* ── 알림 (토스트) ────────────────────────────────────────────
   브라우저 기본 경고창은 화면을 막고 OS 대화상자를 띄운다 — 앱이 아니라
   스크립트처럼 보인다. 알림은 화면 안에서, 흐름을 끊지 않고 준다.
   되돌릴 수 없는 동작의 '확인'은 여전히 confirm()을 쓴다. 그건 막아야 맞다. */
let toastTimer: ReturnType<typeof setTimeout> | undefined
function toast(message: string, kind: 'info' | 'good' | 'bad' = 'info') {
  const el = $('toast')
  el.textContent = message
  el.className = 'toast' + (kind === 'info' ? '' : ' ' + kind)
  el.hidden = false
  requestAnimationFrame(() => el.classList.add('on'))
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    el.classList.remove('on')
    setTimeout(() => { el.hidden = true }, 260)
  }, 4200)
}

/* ── 디스크 상태 ──────────────────────────────────────────────
   화면 맨 위. "정리 가능 용량"보다 이게 먼저다 — 사람들이 이 앱을 여는
   이유가 "용량이 부족해서"라서, 얼마나 부족한지가 첫 화면이어야 한다. */
let diskReadAt = 0

/**
 * 디스크 상태를 다시 읽는다. 너무 자주 부르는 건 막되, 낡은 값을 보여주진 않는다.
 *
 * ★ 왜 필요한가 (실물에서 나온 문제): loadDisk는 앱이 **켜질 때 한 번**만 돌았다.
 *   그런데 이 앱은 트레이 상주라 창을 닫아도 며칠씩 떠 있는다. 그래서 화면의
 *   "남은 공간"이 마지막 실행 시점의 값으로 굳어버렸다. 실측에서 탐색기는
 *   75.5GB인데 앱은 111.3GB라고 하고 있었다 — 36GB 차이.
 *
 *   용량을 알려주는 도구가 용량을 틀리게 말하면 나머지를 다 잘해도 소용이 없다.
 *   엔진 호출은 statfs 한 번이라 싸다. 홈으로 올 때와 창이 다시 앞으로 나올 때
 *   읽는다.
 */
/**
 * 마지막으로 읽은 디스크 상태. "정리하면 얼마나 남나"를 확인 문구에 쓴다.
 *
 * ★ 숫자를 새로 만들지 않는다 — 화면 위쪽이 보여주는 그 값을 그대로 쓴다.
 *   같은 화면에서 남은 공간이 두 가지로 보이면 둘 다 안 믿게 된다.
 */
let lastDisk: { free: number; total: number; drive: string } | null = null

/**
 * 정리 전후 여유 공간 한 줄.
 *
 * ★ 전에는 이 함수에 갈래가 둘이었다. 격리(보관)는 같은 드라이브 안으로 옮기는
 *   것이라 용량이 안 빠져서, "지금은 용량이 안 빕니다"라는 긴 변명을 여기서
 *   해야 했다. 보관을 없앤 지금은 갈래가 하나다 — 지우면 그만큼 빈다.
 */
function spaceHint(bytes: number): string {
  if (!lastDisk) return ''
  const drive = lastDisk.drive.replace(/\\$/, '')
  return `${drive} 남은 공간 ${fmtBytes(lastDisk.free)} → ${fmtBytes(lastDisk.free + bytes)}\n\n`
}

function refreshDisk(force = false) {
  if (!inTauri) return
  const now = Date.now()
  if (!force && now - diskReadAt < 5000) return // 연달아 부르는 것만 막는다
  diskReadAt = now
  loadDisk()
}

async function loadDisk() {
  if (!inTauri) {
    $('disk-title').textContent = '브라우저 체험판'
    $('disk-sub').textContent = '디스크 상태는 데스크톱 앱에서 보여드려요.'
    return
  }
  try {
    const d = await engine('disk')
    lastDisk = d
    const pct = d.usedPercent
    const ring = $('disk-ring')
    ring.style.setProperty('--pct', String(pct))
    // 색이 곧 상태다. 문구도 색과 같은 말을 해야 한다 — 초록인데 "위험"이면 아무도 안 믿는다.
    ring.className = 'ring ' + (pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'good')
    $('disk-pct').textContent = pct + '%'
    $('disk-title').textContent =
      pct >= 90 ? `${d.drive.replace(/\\$/, '')} 드라이브가 거의 찼어요`
      : pct >= 70 ? `${d.drive.replace(/\\$/, '')} 드라이브에 여유가 줄고 있어요`
      : `${d.drive.replace(/\\$/, '')} 드라이브는 아직 여유가 있어요`
    $('disk-sub').textContent = `${d.drive.replace(/\$/, '')} · ${fmtBytes(d.used)} 사용 중`
    $('disk-free').textContent = fmtBytes(d.free)
    $('disk-total').textContent = fmtBytes(d.total)
  } catch {
    $('disk-title').textContent = '디스크 상태를 읽지 못했어요'
    $('disk-sub').textContent = '정리 기능은 그대로 쓸 수 있어요.'
  }
}

/* ── 화면 전환 ─────────────────────────────────────────────── */
const screens = ['home', 'hidden', 'startup', 'programs', 'dupes', 'move', 'quar', 'tidy']
let hiddenLoaded = false, quarLoaded = false, programsLoaded = false, moveLoaded = false
let startupLoaded = false, dupesLoaded = false
function go(name: string) {
  for (const s of screens) $(`s-${s}`).classList.toggle('on', s === name)
  document.querySelectorAll<HTMLButtonElement>('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === name))
  // 홈은 디스크 상태가 주인공이다. 올 때마다 실제 값을 다시 읽는다.
  if (name === 'home') refreshDisk()
  // 생활 정리는 파일을 안 건드리므로 브라우저에서도 그대로 돈다(기록만 localStorage).
  if (name === 'tidy') loadTidy()
  if (inTauri && name === 'startup' && !startupLoaded) { startupLoaded = true; loadStartup() }
  if (inTauri && name === 'hidden' && !hiddenLoaded) { hiddenLoaded = true; loadHidden() }
  if (inTauri && name === 'quar' && !quarLoaded) { quarLoaded = true; loadQuar() }
  if (inTauri && name === 'programs' && !programsLoaded) { programsLoaded = true; loadPrograms() }
  if (inTauri && name === 'move' && !moveLoaded) { moveLoaded = true; loadMove() }
  if (inTauri && name === 'dupes' && !dupesLoaded) { dupesLoaded = true; loadDupes() }
}
document.querySelectorAll<HTMLButtonElement>('.nav button').forEach((b) => b.addEventListener('click', () => go(b.dataset.go!)))

/* ★ "실측·실행은 데스크톱 앱"은 **웹 데모에서만** 맞는 말이다.
   여태 홈 화면 것만, 그것도 스캔이 끝난 뒤에야 숨겼다. 그래서 데스크톱 앱을
   켜고 '숨은 공간'에 들어가면 "실측은 데스크톱 앱에서 하세요"가 떠 있었다 —
   지금 그 앱 안에서. 켜자마자 전부 숨긴다. */
document.querySelectorAll<HTMLElement>('.web-only').forEach((el) => { el.hidden = inTauri })

/* ── 지원 여부 ─────────────────────────────────────────────── */
if (!inTauri && !isSupported()) {
  $('unsupported').hidden = false
  ;($('oneclick') as HTMLButtonElement).disabled = true
}

/* ── 렌더 ──────────────────────────────────────────────────── */
function zbar(label: string, cls: string, bytes: number, total: number, count: number, desc: string) {
  const pct = total ? (bytes / total) * 100 : 0
  return `<div><div class="zrow ${cls}">
      <span class="zlabel">${label}</span>
      <span class="ztrack"><span class="zfill" style="width:${pct.toFixed(1)}%"></span></span>
      <span class="zval">${fmtBytes(bytes)} · ${count.toLocaleString()}개</span>
    </div><div class="zdesc">${desc}</div></div>`
}

let scannedPath: string | null = null // Tauri: 정리 실행에 쓸 경로

function renderReport(r: Report) {
  const total = r.zones.safe.bytes + r.zones.ambig.bytes + r.zones.locked.bytes
  $('zbars').innerHTML =
    zbar('존 A 안전', 'zsafe', r.zones.safe.bytes, total, r.plan.autoCount, '임시 파일·기록처럼 지워도 다시 생기는 것. 규칙으로 확인한 것만 자동 정리해요.') +
    zbar('존 B 애매', 'zamb', r.zones.ambig.bytes, total, r.zones.ambig.count, '사용자만 아는 것. 무인 삭제 안 하고 물어봅니다.') +
    zbar('존 C 잠금', 'zlock', r.zones.locked.bytes, total, r.zones.locked.count, '시스템·설정·클라우드. 지우면 뭔가 깨져서 아예 안 건드려요.')

  // 어디를 봤는지 먼저 밝힌다. "PC 전체를 다 봤다"고 오해하게 두지 않는다.
  const where = r.roots?.length
    ? `<b style="color:var(--ink)">본 곳 ${r.roots.length}곳</b>: ${r.roots.map((x) => esc(x.path)).join(' · ')}<br>`
    : ''
  /* ★ 덜 훑었으면 그 사실이 맨 위에 온다.
     "정리 가능 1.9GB"는 다 훑었을 때만 참인 문장이다. 멈춘 사람에게 그대로
     보여주면 화면이 아는 척을 하는 셈이고, 그건 이 제품이 파는 것과 정반대다. */
  const stopped =
    r.stoppedBy === 'cancel'
      ? '<b style="color:var(--amb)">여기까지만 훑었어요</b> — 아래 숫자는 멈추기 전까지 본 것뿐이에요. 다시 누르면 처음부터 훑어요.<br>'
      : r.truncated
        ? '<b style="color:var(--amb)">다 훑지 못했어요</b> — 시간이 모자라 도중에 멈췄어요. 아래는 본 것까지의 결과예요.<br>'
        : ''

  // ★ "문 앞에 내놓고"는 격리 시절의 말이다. 이제 확실한 건 진짜로 지운다 —
  //   화면이 동작과 다른 말을 하면, 맞는 말을 해도 안 믿게 된다.
  $('plan-lede').innerHTML =
    stopped + where + '확실한 건 알아서 지우고(용량이 바로 빕니다), 애매한 건 아래에서 물어봅니다.'
  $('plan3').innerHTML = `
    <div class="stat"><div class="n g">${fmtBytes(r.plan.autoBytes)}</div><div class="l">지금 정리 가능<br>확실한 임시 파일 ${r.plan.autoCount.toLocaleString()}개 · 규칙으로 확인한 것만</div></div>
    <div class="stat"><div class="n a">${fmtBytes(r.plan.askBytes)}</div><div class="l">물어보면 정리 가능<br>애매한 ${r.plan.askCount.toLocaleString()}개 · 아래 질문으로</div></div>
    <div class="stat"><div class="n m">${fmtBytes(r.plan.lockBytes)}</div><div class="l">지켜드린 것<br>${r.plan.lockCount.toLocaleString()}개 · 건드리면 위험</div></div>`

  $('apply-note').innerHTML = esc(r.plan.inferredBytes > 0
    ? `“아마 임시 파일일” ${fmtBytes(r.plan.inferredBytes)}는 자동에서 뺐어요. “아마”로는 안 지웁니다.`
    : '자동으로 치우는 건 전부 임시 파일이에요. 지워도 다시 생기는 것들입니다.')

  renderCards(r.proposals ?? [], r.proposalRest)
  renderQuestions(r.questions)
  renderKept(r.kept, r.plan.lockBytes)

  $('hero-num').textContent = fmtBytes(r.plan.autoBytes + r.plan.askBytes)
  $('hero-num').classList.remove('muted')
  $('hero-cap').innerHTML = `이 폴더에서 <b style="color:var(--ink)">정리 가능</b> · 지금 즉시 ${fmtBytes(r.plan.autoBytes)} + 물어보면 ${fmtBytes(r.plan.askBytes)}`

  const applyBtn = $('apply-btn') as HTMLButtonElement
  applyBtn.disabled = r.plan.autoBytes === 0
  // 데스크톱에서는 실제로 정리한다. 브라우저에서는 안내만.
  document.querySelectorAll<HTMLElement>('#s-home .pill.desk').forEach((p) => { p.hidden = inTauri })
  // 버튼이 무슨 일을 하는지 그대로 쓴다. '정리하기'는 옮기는 것도 지우는 것도 될 수 있다.
  applyBtn.textContent = inTauri ? `임시 파일 ${fmtBytes(r.plan.autoBytes)} 지금 지우기` : '확실한 임시 파일 정리하기'
}

/* ── 제안 카드 ─────────────────────────────────────────────────
   ★ 왜 카드인가 (2026-08-19)

   엔진은 파일 647,083개 전부에 판정을 붙인다. 그런데 지워도 되는 것만 15만 개다.
   체크박스 15만 개는 목록이 아니라 벽이다.

   사용자가 원하는 건 이 대화의 모양이었다:
       "C드라이브 꽉 찼어, 지워도 되는 거 찾아봐"
     → 묶음 몇 개로 정리(용량·근거·순위)
     → "1순위만 실행"
     → 얼마 비었고 뭘 못 했는지 보고

   그래서 카드 한 장 = 결정 하나 = 실행 단위 하나로 만든다. 카드가 들고 있는
   경로 목록은 화면으로 안 온다(14만 개짜리도 있다) — 엔진이 스캔할 때 적어두고
   카드 id로 되짚는다. */

const TIER_HEAD: Record<number, string> = {
  1: '1순위 — 바로 지워도 됩니다',
  2: '2순위 — 지워도 되지만 다시 만드는 데 시간이 걸려요',
  3: '3순위 — 되살릴 수 없어요. 필요하신지만 알려주세요',
}

function cardHtml(c: any): string {
  const egs = (c.samples ?? [])
    .map((s: any) => `<div>· ${fmtBytes(s.size)}  ${esc(s.path)}</div>`)
    .join('')
  /* 3순위에는 실행 버튼을 달지 않는다. 되살릴 수 없는 것을 버튼 한 번으로
     지우면 그건 무단 삭제다 — 그건 낱개 목록에서 골라야 한다. */
  const act =
    c.action === 'delete'
      ? `<button class="${c.tier === 1 ? 'btn' : 'btn ghost'}" data-card="${esc(c.id)}">${fmtBytes(c.bytes)} 지우기</button>`
      : `<button class="opt" data-card-pick="${esc(c.id)}">하나씩 볼게요</button>`
  return `
    <div class="pcard t${c.tier}">
      <div class="pcard-main">
        <div class="pcard-h">
          <span class="pcard-amt">${fmtBytes(c.bytes)}</span>
          <span class="pcard-name">${esc(c.title)}</span>
          <span class="pcard-cnt">${c.count.toLocaleString()}개</span>
        </div>
        <div class="pcard-why">${esc(c.because)}</div>
        <div class="pcard-where">${esc(c.where)}</div>
        ${egs ? `<div class="pcard-eg">${egs}</div>` : ''}
      </div>
      <div class="pcard-act">${act}</div>
    </div>`
}

function renderCards(cards: any[], rest: any) {
  const host = $('cards')
  if (!cards?.length) { host.innerHTML = ''; return }

  let html = ''
  let tier = 0
  for (const c of cards) {
    if (c.tier !== tier) {
      tier = c.tier
      html += `<div class="t-small" style="font-weight:var(--w-head);color:var(--ink-2);margin-top:14px">${TIER_HEAD[tier] ?? ''}</div>`
    }
    html += cardHtml(c)
  }
  /* 자른 것을 반드시 말한다. 조용히 자르면 사용자는 이게 전부인 줄 안다. */
  if (rest?.cards) {
    html += `<div class="t-caption" style="color:var(--muted);margin-top:8px">
      이 목록에 안 올린 것이 ${rest.cards}묶음 더 있어요 — ${fmtBytes(rest.bytes)} · ${rest.count.toLocaleString()}개.
      작은 것부터라 목록이 길어지기만 해서 접어뒀습니다.</div>`
  }
  host.innerHTML = `<div class="card-list">${html}</div>`

  host.querySelectorAll<HTMLButtonElement>('[data-card]').forEach((btn) => {
    btn.addEventListener('click', () => runCard(btn, cards.find((c) => c.id === btn.dataset.card)))
  })
  /* '하나씩 볼게요'는 질문 쪽으로 보낸다 — 되살릴 수 없는 건 낱개로 골라야 한다. */
  host.querySelectorAll<HTMLButtonElement>('[data-card-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('questions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  })
}

/** 카드 하나 실행 — 무엇을 지우는지 이름을 대고 확인받는다. */
async function runCard(btn: HTMLButtonElement, card: any) {
  if (!card) return
  if (!inTauri) {
    toast('실제 삭제는 데스크톱 앱에서 실행됩니다. 브라우저는 보안상 파일을 지울 수 없어요.', 'bad')
    return
  }
  const egs = (card.samples ?? []).slice(0, 3).map((s: any) => `· ${baseName(s.path)} (${fmtBytes(s.size)})`).join('\n')
  if (!confirm(
    `${card.title}\n${card.count.toLocaleString()}개 · ${fmtBytes(card.bytes)}\n\n${egs}\n\n` +
    `${card.because}\n\n되돌릴 수 없습니다 — 휴지통에도 안 남아요.\n\n${spaceHint(card.bytes)}`
  )) return

  /* ★ 자리를 먼저 잡아둔다.
     전에는 btn.parentElement.innerHTML을 덮어썼다. 그러면 그 안에 있던 btn 자신이
     DOM에서 빠지고, 그다음 btn.parentElement가 null이 되어 appendChild에서 터졌다
     ("Cannot read properties of null" — 실물에서 나왔다). 부모를 미리 붙잡는다. */
  const slot = btn.parentElement as HTMLElement
  btn.disabled = true

  /* 진행 표시 — 실측에서 7,279개에 46초였다. "지우는 중…"만 띄우면 멈춘 건지
     도는 건지 알 수 없다. 몇 %인지, 몇 개 중 몇 개인지, 얼마나 남았는지를 말한다.
     남은 시간은 지금까지의 속도로만 잰다 — 없는 진행률을 지어내지 않는다. */
  cardProgress.delete(card.id)
  const started = Date.now()
  const paint = () => {
    const p = cardProgress.get(card.id)
    const elapsed = fmtDuration((Date.now() - started) / 1000)
    if (!p || !p.total) { btn.textContent = `지우는 중… · 경과 ${elapsed}`; return }
    const parts = [`${p.pct ?? 0}%`]
    parts.push(`${(p.done ?? 0).toLocaleString()} / ${p.total.toLocaleString()}개`)
    if (p.etaSec !== null && p.etaSec !== undefined) parts.push(`남은 시간 약 ${fmtDuration(p.etaSec)}`)
    else parts.push(`경과 ${elapsed}`)
    btn.textContent = parts.join(' · ')
  }
  paint()
  const timer = setInterval(paint, 400)

  try {
    const r = await engine('proposal-apply', [card.id])
    const left = leftoverNote(r.leftover)
    const skipped = r.failed?.length ? `${r.failed.length}개는 사용 중이라 건너뛰었어요. ` : ''
    /* 완료 표시와 남은 이야기를 **한 번에** 넣는다. 덮어쓴 뒤에 appendChild를
       부르면 붙일 자리가 이미 사라지고 없다 — 위에서 터졌던 그 자리다. */
    slot.innerHTML =
      `<span class="t-small" style="color:var(--safe);font-weight:var(--w-em)">✓ ${r.deletedCount.toLocaleString()}개 · ${fmtBytes(r.deletedBytes)}</span>` +
      (skipped || left
        ? `<div class="t-caption" style="color:var(--muted);margin-top:4px">${skipped}${left}</div>`
        : '')
    toast(`${r.deletedCount.toLocaleString()}개를 지웠어요 — ${fmtBytes(r.deletedBytes)}가 비었습니다.`, 'good')
    refreshDisk(true)
  } catch (err) {
    toast('지우지 못했어요: ' + errText(err), 'bad')
    btn.disabled = false
    btn.textContent = `${fmtBytes(card.bytes)} 지우기`
  } finally {
    clearInterval(timer)
    cardProgress.delete(card.id)
  }
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p

/**
 * 파일 목록 — 같은 설명을 반복하지 않는다.
 *
 * ★ 처음엔 파일마다 카드를 하나씩 그렸다. 실물에서 이렇게 나왔다:
 *
 *     video.mp4  …  MusicFactory의 …  왜 이렇게 봤나 …  지우면 …  영향 범위 …
 *     video.mp4  …  MusicFactory의 …  왜 이렇게 봤나 …  지우면 …  영향 범위 …
 *     video.mp4  …  MusicFactory의 …  왜 이렇게 봤나 …  지우면 …  영향 범위 …
 *
 *   똑같은 문장 네 줄이 세 번. 정보량은 한 카드분인데 화면은 세 배를 쓰고,
 *   그래서 아무도 안 읽는다. 같은 프로그램·같은 역할이면 설명은 한 번이면 된다.
 *
 * 그래서 (프로그램 + 역할 + 판정)이 같은 파일을 한 묶음으로 묶고, 설명은 묶음에
 * 한 번만 쓰고 파일은 이름·크기·경로만 줄줄이 붙인다.
 */
interface OwnerGroup { o: any; headline: string; files: any[] }

/**
 * (프로그램 + 역할 + 판정)이 같은 파일을 한 묶음으로.
 *
 * ★ 근거 패널과 낱개 목록이 **같은 함수**를 쓴다. 두 화면이 같은 파일을 다르게
 *   묶으면 사용자는 다른 파일이라고 읽는다 — 한쪽에서 "3개"라고 본 것이
 *   다른 쪽에서 흩어져 나오면 어느 쪽을 믿을지부터 고민하게 된다.
 */
function groupByOwner(samples: any[]): OwnerGroup[] {
  const groups = new Map<string, OwnerGroup>()
  for (const s of samples) {
    // 소유자 판별이 없는 옛 응답(사이드카가 구버전)은 묶을 근거가 없다 → 파일마다 한 줄.
    const key = s.owner ? `${s.headline}|${s.owner.verdict}` : `plain:${s.path}`
    const g = groups.get(key)
    if (g) g.files.push(s)
    else groups.set(key, { o: s.owner, headline: s.headline ?? s.owner?.role ?? '', files: [s] })
  }
  return [...groups.values()]
}

function fileCardsHtml(samples: any[]): string {
  return groupByOwner(samples).map(groupCardHtml).join('')
}

/** 파일 한 줄 — 이름 · 크기 · 경로. 설명은 묶음이 이미 했다. */
function fileRowHtml(s: any): string {
  return `<div class="of-f">
    <span class="of-fn">${esc(baseName(s.path))}</span>
    <span class="bd-size">${fmtBytes(s.size)}</span>
    <span class="bd-path">${esc(s.path)}</span>
  </div>`
}

/**
 * 묶음 하나 — "무엇의 것 / 지우면 / 무엇이 깨지고 무엇이 안전한가".
 *
 * 영향을 ✕(깨지는 것)·✓(그대로인 것) 두 줄로 나눠 그린다. 전에는 한 문장에
 * 섞여 있어서 눈으로 훑을 수가 없었고, '지우면' 칸과 같은 말이 두 번 실렸다.
 * 사람이 찾는 건 두 가지뿐이다 — 뭐가 깨지나, 뭐가 안전하나.
 */
function groupCardHtml(g: { o: any; headline: string; files: any[] }): string {
  const bytes = g.files.reduce((s: number, f: any) => s + f.size, 0)
  const head =
    g.files.length === 1
      ? esc(baseName(g.files[0].path))
      : `${esc(baseName(g.files[0].path))} 외 ${g.files.length - 1}개`

  if (!g.o) {
    const s = g.files[0]
    return `<div class="bd-file">
      <span class="bd-name">${esc(baseName(s.path))}</span>
      ${s.kind ? `<span class="bd-kindtag">${esc(s.kind)}</span>` : ''}
      <span class="bd-size">${fmtBytes(s.size)}</span>
      <span class="bd-path">${esc(s.path)}</span>
    </div>`
  }

  const o = g.o
  const line = (cls: string, mark: string, items: string[]) =>
    items.length ? `<div class="of-l ${cls}"><i>${mark}</i>${esc(items.join(' · '))}</div>` : ''

  return `
    <div class="bd-file of of-${esc(o.verdict)}">
      <div class="of-h">
        <span class="bd-name">${head}</span>
        <span class="of-v">${esc(o.verdictLabel)}</span>
        <span class="bd-size">${fmtBytes(bytes)}</span>
      </div>
      <div class="of-who">${esc(g.headline)}</div>
      <div class="of-l of-do"><i>→</i>${esc(o.onDelete)}</div>
      ${line('of-bad', '✕', o.breaks ?? [])}
      ${line('of-ok', '✓', o.intact ?? [])}
      <div class="of-files">${g.files.map(fileRowHtml).join('')}</div>
      <div class="of-why">근거 ${esc(o.because)}</div>
    </div>`
}

/**
 * 근거 패널 — ★ 답을 고르기 '전에' 보여주고, 접지 않는다.
 *
 * 전에는 답을 누른 뒤에야 나왔다. 판단하려고 정보가 필요한데 정보를 보려면
 * 먼저 결정해야 하는 구조였다 — 순서가 거꾸로였다. 이제 스캔이 근거를 함께
 * 실어 오므로(engine-cli의 scanPlan) 즉시 그린다.
 *
 * 사용자가 결정을 못 내리는 이유는 셋이다:
 *   "이게 정확히 뭐냐 / 지워도 되냐 / 지우면 뭐가 영향받냐"
 * 그래서 종류마다 [무엇인지 · 왜 그렇게 봤나 · 지우면 어떻게 되나 · 다시 생기나]를
 * 한 줄도 접지 않고 편다. 접어두면 아무도 안 펴고, 안 펴면 없는 것과 같다.
 * 파일 하나하나도 같은 질문에 답한다 — fileCardHtml.
 */
function evidenceHtml(ev: any): string {
  if (!ev) return ''
  const e = ev.explain

  const kinds = (ev.kinds ?? []).map((k: any) => `
    <div class="kd kd-${k.impact?.level ?? 'medium'}">
      <div class="kd-h">
        <span class="kd-name">${esc(k.label)}</span>
        <span class="kd-imp">${esc(k.impact?.levelLabel ?? '')}</span>
        <span class="kd-amt">${fmtBytes(k.bytes)} · ${k.count.toLocaleString()}개</span>
      </div>
      <div class="kd-line"><b>왜 이렇게 봤나</b> ${esc(k.why)}</div>
      <div class="kd-line"><b>지우면</b> ${esc(k.impact?.affects ?? '')}</div>
      <div class="kd-line"><b>다시 생기나</b> ${esc(k.impact?.regen ?? '')}</div>
    </div>`).join('')

  const folders = (ev.folders ?? []).slice(0, 4).map((g: any) => `
    <div class="bd-row">
      <span class="bd-k">${esc(g.key)}</span>
      <span class="bd-v">${fmtBytes(g.bytes)} · ${g.count.toLocaleString()}개</span>
    </div>`).join('')

  const files = fileCardsHtml((ev.samples ?? []).slice(0, 8))

  return `
    <div class="bd">
      ${ev.mix ? `<div class="bd-mix">${esc(ev.mix)}</div>` : ''}
      ${ev.age ? `<div class="bd-age">가장 오래된 것 ${Math.floor(ev.age.oldestDays / 30)}개월 전${
        ev.age.overYearPercent >= 20 ? ` · 1년 넘은 것 ${ev.age.overYearPercent}%` : ''}</div>` : ''}

      <div class="bd-sec">무엇이고, 지우면 어떻게 되나</div>
      <div class="kds">${kinds}</div>

      ${e ? `<div class="bd-ex">
        <div class="bd-b"><span class="bd-h">지워도 되나요</span>${esc(e.safety)}</div>
        <div class="bd-b"><span class="bd-h">되돌릴 수 있나요</span>${esc(e.recovery)}</div>
      </div>` : ''}

      <div class="bd-sec">어디에 있나</div>
      ${folders}
      <div class="bd-sec">큰 파일부터 — 무엇의 것이고, 지우면 어떻게 되나</div>
      ${files}
    </div>`
}


/* ── 결론부터 ──────────────────────────────────────────────────
   ★ 왜 접게 됐나 (앞의 판단을 뒤집는다)

   전에는 근거를 한 줄도 접지 않았다. 그때 적어둔 이유는 이랬다 —
   "접어두면 아무도 안 펴고, 안 펴면 없는 것과 같다."
   맞는 말이었지만 반쪽이었다. **전부 펼쳤더니 아무도 안 읽었다.**

   실측 화면 하나에 질문 하나가 이만큼을 실었다: 질문 + 왜 묻나 + 구성비 +
   나이 + 종류마다 3줄(왜 봤나/지우면/다시 생기나) + 지워도 되나 + 되돌리나 +
   폴더 목록 + 파일마다 또 4줄. 답변 버튼은 세 화면쯤 스크롤해야 나왔다.
   게다가 **643KB짜리 종류가 10.7GB짜리와 똑같은 크기의 카드**를 받았다 —
   전체의 0.006%인데 읽는 부담은 같았다.

   그래서 '접기 대 펼치기'가 아니라 **덜 보여주기**로 간다. 결정에 필요한 건
   두 줄이다: 이게 대체로 무엇인가, 지우면 무엇이 달라지나. 나머지는 접는다.
   접은 칸에는 무엇이 들었는지 개수까지 적어둔다 — 접힌 걸 모르면 없는 것과
   같다는 옛 지적은 여전히 옳으니까. */

/**
 * 결정에 필요한 두 줄. 판단은 이미 엔진이 했고 여기선 고르기만 한다.
 *   1) 이게 대체로 무엇인가 (ev.mix — "대부분 …입니다(100%)")
 *   2) 지우면 무엇이 달라지나 (가장 큰 종류의 영향)
 * 둘 다 없으면 아무것도 안 그린다 — 빈 칸을 만들어 자리만 먹지 않는다.
 */
function gistHtml(ev: any): string {
  if (!ev) return ''
  // 가장 큰 종류 하나만 본다. 꼬리는 결정을 안 바꾼다.
  const top = [...(ev.kinds ?? [])].sort((a: any, b: any) => b.bytes - a.bytes)[0]
  const affects = top?.impact?.affects
  const lines = [ev.mix, affects].filter(Boolean) as string[]
  if (!lines.length) return ''
  return `<div class="q-gist">${lines.map((s) => `<div>${esc(s)}</div>`).join('')}</div>`
}

/** 접은 칸에 뭐가 들었는지 — 개수를 적어야 펴볼 마음이 든다. */
function moreLabel(ev: any): string {
  if (!ev) return ''
  const bits: string[] = []
  if (ev.kinds?.length) bits.push(`종류 ${ev.kinds.length}`)
  if (ev.folders?.length) bits.push(`폴더 ${ev.folders.length}곳`)
  if (ev.samples?.length) bits.push(`큰 파일 ${ev.samples.length}개`)
  return bits.length ? ` (${bits.join(' · ')})` : ''
}

/**
 * 옮겨도 되나 — **누르기 전에** 답한다.
 *
 * ★ 왜 필요한가 (2026-08-19, 실물에서 나옴)
 *   질문 카드가 "아주 큰 파일 18개(65.8GB)가 있어요. 지울까요, 다른 드라이브로
 *   옮길까요?"라고 묻고 [다른 드라이브로 옮길래요] 버튼을 내밀었다.
 *
 *   그런데 그 18개는 **하나도 옮길 수 없었다.** 전부 AppData 안이라
 *   "앱 설정 — 옮기면 설정이 초기화됩니다", "프로그램이 저장한 자료 — 옮기면
 *   그 앱이 못 찾습니다"로 이미 판정돼 있었다. 판정은 엔진이 진작 내려서
 *   samples[].move에 실어 보내고 있었는데, 화면이 그걸 안 읽고 선택지만 내밀었다.
 *   누르면 다음 화면에서 "옮길 수 있는 게 없었어요"를 보게 되는 막다른 길이다.
 *
 *   ★ 다만 "못 옮긴다"로 끝나면 그것도 틀린 말이다. 낱개로는 못 옮겨도
 *     **폴더째로는 옮길 수 있다** — 원래 자리에 안내판(정션)을 남기면 프로그램은
 *     예전 주소로 찾아가도 그대로 열린다. 실측에서 낱개는 0/17이었지만
 *     폴더째는 21.9GB가 가능했다. 둘을 갈라서 말해야 선택지가 진짜 선택지가 된다.
 */
function moveOutlook(ev: any): { movable: number; total: number; folderBytes: number; folders: number } {
  const samples: any[] = ev?.samples ?? []
  const units: any[] = ev?.units ?? []
  // 엔진이 폴더째 옮길 수 있다고 표시한 것만 센다(정션이 막힌 곳은 이미 걸러져 온다).
  const movableFolders = units.filter((u) => u?.moveOnly || u?.canMove)
  return {
    movable: samples.filter((s) => s?.move?.ok === true).length,
    total: samples.length,
    folderBytes: movableFolders.reduce((n, u) => n + (u.bytes ?? 0), 0),
    folders: movableFolders.length,
  }
}

/** 질문 카드에 붙일 한 줄. 옮기기 선택지가 없는 질문에는 아무것도 안 붙인다. */
function moveOutlookHtml(q: any): string {
  const hasMove = (q.options ?? []).some((o: any) => o.outcome === 'MOVE')
  if (!hasMove) return ''
  const o = moveOutlook(q.evidence)
  if (!o.total) return ''

  if (o.movable > 0) {
    return `<div class="q-move ok"><i>⇄</i>큰 파일 ${o.total}개 중 <b>${o.movable}개</b>는 다른 드라이브로 옮겨도 그대로 열려요.</div>`
  }
  /* 낱개로는 못 옮긴다. 그래도 폴더째 길이 있으면 그걸 말한다 —
     "안 됩니다"로 끝내면 사용자는 방법이 없는 줄 안다. */
  if (o.folders) {
    return `<div class="q-move warn"><i>⇄</i>낱개로는 옮길 수 없어요 —
      <b>프로그램이 저장한 자료</b>라 자리를 바꾸면 그 앱이 못 찾습니다.
      대신 <b>폴더째 ${fmtBytes(o.folderBytes)}</b>는 옮길 수 있어요. 원래 자리에 안내판을 남겨서 앱은 그대로 열립니다.</div>`
  }
  return `<div class="q-move warn"><i>⇄</i>이건 <b>옮길 수 없어요</b> —
    프로그램이 저장한 자료라 자리를 바꾸면 그 앱이 못 찾습니다. 지우거나 그대로 두는 것 중에 고르셔야 해요.</div>`
}

function renderQuestions(questions: Question[]) {
  lastQuestions = questions // 낱개 목록이 근거를 다시 찾는다(renderPicker)
  const qEl = $('questions')
  if (!questions.length) {
    qEl.innerHTML = `<div class="note">물어볼 만한 묶음이 없어요. 애매한 항목이 적거나 잘게 흩어져 있습니다.</div>`
    return
  }
  qEl.innerHTML = questions.map((q, i) => `
    <div class="q" data-qi="${i}">
      <div class="q-head">
        <span class="q-n">질문 ${i + 1}</span>
        <span class="q-stake">${fmtBytes(q.stakeBytes)} · ${q.stakeCount.toLocaleString()}개</span>
      </div>
      <div class="q-text">${esc(q.text)}</div>
      ${gistHtml((q as any).evidence)}
      ${moveOutlookHtml(q)}
      <div class="opts">${q.options.map((o) => `<button class="opt${o.outcome === 'KEEP' ? ' keep' : ''}"
        data-outcome="${o.outcome}" data-unknown="${esc(q.unknown)}"
        data-preview="${esc(o.preview)}">${esc(o.label)}</button>`).join('')}</div>
      <div class="q-answered" hidden></div>
      <div class="q-act" data-act="${i}" data-count="${q.stakeCount}" data-bytes="${q.stakeBytes}"></div>
      <details class="q-more">
        <summary>근거 자세히${moreLabel((q as any).evidence)}</summary>
        <div class="q-why">왜 묻나: ${esc(q.rationale)}</div>
        ${evidenceHtml((q as any).evidence)}
      </details>
    </div>`).join('')
  qEl.querySelectorAll<HTMLButtonElement>('.opt').forEach((btn) => btn.addEventListener('click', () => {
    const q = btn.closest('.q')!
    q.querySelectorAll('.opt').forEach((o) => o.classList.remove('chosen'))
    btn.classList.add('chosen')
    const ans = q.querySelector('.q-answered') as HTMLElement
    ans.hidden = false
    ans.innerHTML = '→ ' + esc(btn.dataset.preview!)
    const act = q.querySelector('.q-act') as HTMLElement
    answerAction(act, btn.dataset.unknown!, btn.dataset.outcome as any)
  }))
}

/**
 * 답을 고른 뒤 실제로 실행할 수 있게 한다 — 여태 문구만 뜨고 끝났던 자리.
 *
 * 순서를 지킨다: 답 → 무엇이 걸리는지 미리보기 → 누르면 실행 → 되돌릴 수 있음.
 * 답을 골랐다고 바로 옮기지 않는다. 답은 '분류'고, 실행은 별도 승낙이다.
 */
async function answerAction(host: HTMLElement, unknown: string, outcome: string) {
  host.innerHTML = ''
  if (!inTauri) {
    if (outcome !== 'KEEP') {
      host.innerHTML = `<div style="margin-top:10px"><span class="pill desk">실제 정리는 데스크톱 앱에서</span></div>`
    }
    return
  }
  // 보존을 뜻하는 답은 실행할 게 없다. 버튼을 만들지 않는다.
  if (outcome === 'KEEP') return

  /**
   * ★ "하나씩 볼게요" — 여기가 정반대로 동작하고 있었다.
   *
   *   이 답은 위 두 분기 어디에도 안 걸려서 그대로 흘러내려갔고, 결과적으로
   *   **"140,613개 · 18.1GB 지우기"** 라는 일괄 버튼이 떴다.
   *   "하나씩 보겠다"고 고른 사람에게 전부 지우기 버튼을 내민 셈이다.
   *   게다가 눌러도 안 됐다 — 엔진은 이 답을 'review'로 해석해 아무것도 안 하고
   *   돌려주는데(engine.ts actionFor), 화면은 없는 개수 필드를 읽어서
   *   undefined.toLocaleString()으로 터졌다. 있어서도 안 되고 눌러도 에러였다.
   *
   *   이제 이 답은 약속한 것을 한다: 목록을 펴고 낱개로 고르게 한다.
   */
  if (outcome === 'REVIEW_ONE_BY_ONE') {
    renderPicker(host, unknown)
    return
  }

  /**
   * ★ "옮길래요" — 여기도 약속과 다른 곳으로 보내고 있었다.
   *
   *   버튼 하나('드라이브 옮기기 열기')만 띄우고 끝났는데, 그 화면은 **방금 보던
   *   파일들과 아무 상관이 없다.** 다운로드·영상·사진 폴더를 처음부터 다시 훑어서
   *   전혀 다른 목록을 보여준다(relocateRoots). "이 40개를 옮기겠다"고 답한 사람
   *   앞에 다른 목록을 놓고 처음부터 다시 고르라고 한 셈이다.
   *
   *   이제 그 자리에서 이 파일들을 그대로 고르고 옮긴다. 옮기면 깨지는 것
   *   (프로그램 폴더·앱 데이터·가상환경)은 목록에서 이유와 함께 표시된다.
   */
  if (outcome === 'MOVE') {
    host.innerHTML = `<div class="t-small" style="margin-top:10px;color:var(--ink-2)">
      지우지 않고 자리만 옮겨요. 옮기면 깨지는 것은 아래에서 이유와 함께 빼드립니다.
      <button class="opt" data-goto-move="1" style="margin-left:6px">폴더째 옮기기 →</button></div>
      <div data-move-pick="1"></div>`
    host.querySelector<HTMLButtonElement>('[data-goto-move]')!.addEventListener('click', () => go('move'))
    renderPicker(host.querySelector<HTMLElement>('[data-move-pick]')!, unknown, 'move')
    return
  }

  // ★ 여기서 다시 스캔하지 않는다. 질문이 근거를 이미 들고 왔다.
  //   예전엔 답을 누를 때마다 전체를 다시 훑었다 — 이 PC 기준 330초.
  //   버튼을 눌렀는데 5분 넘게 아무 일도 안 일어나는 화면이었다.
  const count = Number(host.dataset.count || 0)
  const bytes = Number(host.dataset.bytes || 0)
  try {
    host.innerHTML = `
      <div class="bd-act">
        <button class="btn danger" data-answer-go="1">${count.toLocaleString()}개 · ${fmtBytes(bytes)} 지우기</button>
        <span>바로 지웁니다 — 되돌릴 수 없어요</span>
      </div>`
    host.querySelector<HTMLButtonElement>('[data-answer-go]')!.addEventListener('click', async (ev) => {
      const b = ev.currentTarget as HTMLButtonElement
      // 되돌릴 수 없는 일괄 실행이다. 개수·용량과 함께 한 번 더 확인받는다.
      if (!confirm(
        `${count.toLocaleString()}개(${fmtBytes(bytes)})를 지울까요?\n\n` +
        `되돌릴 수 없습니다 — 휴지통에도 안 남아요.\n\n${spaceHint(bytes)}`
      )) return
      b.disabled = true
      b.textContent = '지우는 중…'
      try {
        const r = await engine('answer-apply', [unknown, outcome, ...(scannedPath ? [scannedPath] : [])])
        const left = leftoverNote(r.leftover)
        host.innerHTML = `<div class="t-small" style="margin-top:10px;color:var(--safe);font-weight:var(--w-em)">
          ${r.deletedCount.toLocaleString()}개를 지웠어요 — ${fmtBytes(r.deletedBytes)}가 지금 비었습니다.
          ${r.failed.length ? `<span style="color:var(--muted);font-weight:var(--w-text)">${r.failed.length}개는 사용 중이라 건너뜀</span>` : ''}</div>
          ${left ? `<div class="t-caption" style="color:var(--muted);margin-top:4px">${left}</div>` : ''}`
        toast(`${r.deletedCount.toLocaleString()}개를 지웠어요 — ${fmtBytes(r.deletedBytes)}가 비었습니다.`, 'good')
        quarLoaded = false
        refreshDisk(true)
      } catch (err) {
        toast('지우지 못했어요: ' + errText(err), 'bad')
        b.disabled = false
        b.textContent = `${count.toLocaleString()}개 · ${fmtBytes(bytes)} 지우기`
      }
    })
  } catch (err) {
    host.innerHTML = `<div class="note" style="margin-top:10px">확인하지 못했어요: ${esc(errText(err))}</div>`
  }
}

/* ── 낱개로 고르기 ────────────────────────────────────────────
   이 앱의 실행 단위는 여태 '묶음 전체'였다. 그런데 화면은 파일을 낱개로
   보여준다 — 판단은 낱개로 시키고 실행은 전부-아니면-전무만 준 셈이다.
   낱개로 보여주면 낱개로 지울 수 있어야 한다 — 그 비대칭을 여기서 없앤다. */

/** 마지막으로 그린 질문들 — 낱개 목록이 근거(samples)를 다시 찾는 데 쓴다. */
let lastQuestions: any[] = []

/** 지금 고른 경로. 화면을 다시 그려도 선택이 살아 있어야 한다. */
const picked = new Set<string>()

/** 낱개 목록에서 고른 이동 대상 드라이브. 화면을 다시 그려도 유지한다. */
let pickDest: string | null = null

/** 이 파일을 다른 드라이브로 옮겨도 되나. 엔진이 판단해서 실어 보낸다(withOwner). */
const canMove = (s: any): boolean => s?.move?.ok === true

/**
 * 낱개 한 줄 — 체크박스 · 이름 · 크기 · 경로.
 * 설명은 묶음 머리가 이미 했다. 파일마다 같은 네 줄을 반복하면 아무도 안 읽는다.
 */
/**
 * 긴 경로를 한 줄로 — **앞을 버린다.**
 *
 * ★ 왜 (2026-08-20 실물): 목록의 경로가 이렇게 나왔다.
 *     C:\Users\lhs06\AppData\Local\MusicFactory\work\l
 *     ongform\20260819_1630_채널a\video.mp4
 *   한 줄에 안 들어가 두 줄로 접히고, 그나마 단어 중간(l|ongform)에서 잘려서
 *   읽히지도 않았다. 줄마다 두 줄씩 먹으니 목록이 절반만 보인다.
 *
 * ★ 처음엔 가운데를 접었다. 그랬더니 C:\Users\lhs06\…\채널a\video.mp4가 됐는데,
 *   앞의 C:\Users\lhs06은 **모든 줄에 똑같이 붙는 잡음**이다. 게다가 어느 앱인지는
 *   묶음 머리가 이미 말한다("MusicFactory(프로그램)의 동영상으로 보입니다").
 *   줄이 해야 할 일은 **줄끼리 구별되는 것**뿐이라, 뒤쪽만 남긴다.
 *
 * 짧아서 다 보이는 경로는 손대지 않는다 — 접는 게 늘 이득은 아니다.
 * 전체 경로는 title로 남겨서 마우스를 올리면 그대로 보인다.
 */
function shortPath(p: string, keepTail = 3, fitsAt = 52): string {
  if (p.length <= fitsAt) return p
  const segs = p.split(/[\\/]/).filter(Boolean)
  if (segs.length <= keepTail) return p
  return '…\\' + segs.slice(-keepTail).join('\\')
}

/**
 * 낱개 한 줄 — 체크박스 · 이름 · 크기 · 경로.
 * 설명은 묶음 머리가 이미 했다. 파일마다 같은 네 줄을 반복하면 아무도 안 읽는다.
 */
/**
 * 낱개 한 줄 — 체크박스 · 이름 · 크기 · 경로.
 * 설명은 묶음 머리가 이미 했다. 파일마다 같은 네 줄을 반복하면 아무도 안 읽는다.
 *
 * ★ 이름은 파일명만으로는 모자란다 (2026-08-20 실물): 40줄이 전부 `video.mp4`였다.
 *   같은 이름이 반복되면 이름 칸이 아무 말도 안 하는 셈이다. 구별되는 건
 *   상위 폴더(20260819_1630_채널a)라서, 그걸 앞에 세운다.
 */
function pickRowHtml(s: any): string {
  const segs = s.path.split(/[\\/]/).filter(Boolean)
  const name = segs[segs.length - 1] ?? s.path
  const parent = segs.length > 1 ? segs[segs.length - 2] : ''
  return `
    <label class="pick-row">
      <input type="checkbox" data-pick="${esc(s.path)}">
      <span class="pick-name">${parent ? `<span class="pick-dir">${esc(parent)} ›</span> ` : ''}${esc(name)}</span>
      <span class="pick-size">${fmtBytes(s.size)}</span>
      <span class="bd-path" title="${esc(s.path)}">${esc(shortPath(s.path))}</span>
    </label>`
}

/**
 * 옮길 수 있나 — 묶음 단위로 한 줄.
 *
 * 지우기만 물으면 "지우긴 아까운데 자리는 차지한다"에는 답이 없다. 그 답은
 * 이동이고, 이동은 파일마다 가능·불가능이 갈린다(relocate.ts). 그래서 결정하는
 * 자리에서 바로 말한다 — 안 되는 건 이유까지. 이유 없는 거절은 고장으로 읽힌다.
 */
function moveNoteHtml(files: any[]): string {
  if (files.some((f) => f.move === undefined)) return '' // 옛 사이드카 — 아는 척하지 않는다
  const ok = files.filter(canMove).length
  if (ok === files.length) {
    return `<div class="pg-l pg-mv"><i>⇄</i>다른 드라이브로 옮길 수 있어요 — 지우지 않고 자리만 옮깁니다</div>`
  }
  const why = files.find((f) => !canMove(f))?.move?.why ?? '옮길 수 없습니다'
  if (ok === 0) return `<div class="pg-l pg-nomv"><i>⇄</i>옮기기는 안 돼요 — ${esc(why)}</div>`
  return `<div class="pg-l pg-mv"><i>⇄</i>${ok}개만 옮길 수 있어요. 나머지는 ${esc(why)}</div>`
}

/**
 * 낱개 목록의 묶음 하나 — **"이게 뭔데요?"에 목록 안에서 답한다.**
 *
 * ★ 왜 고쳤나: 여태 이 목록은 `torch_cuda.dll · 1.2GB · C:\…\torch_cuda.dll`만
 *   보여줬다. 정확히 우리가 비판하던 화면이다 — 파일명과 숫자를 주고 "고르세요"라고
 *   한다. 사용자는 그게 무슨 파일인지, 어느 프로그램 것인지, 지우면 뭐가 깨지는지를
 *   모른 채 체크박스를 눌러야 했다.
 *
 *   황당한 건 그 답을 **엔진이 이미 보내고 있었다는 것**이다(owners.ts → withOwner).
 *   같은 응답을 접힌 '근거 자세히' 패널은 다 쓰고 있었는데, 정작 지울 것을 고르는
 *   화면만 안 쓰고 있었다. 정보가 없어서가 아니라 안 그려서 못 읽은 것이다.
 */
function pickGroupHtml(g: OwnerGroup, gi: number): string {
  const bytes = g.files.reduce((n: number, f: any) => n + f.size, 0)
  const o = g.o
  const line = (cls: string, mark: string, items?: string[]) =>
    items?.length ? `<div class="pg-l ${cls}"><i>${mark}</i>${esc(items.join(' · '))}</div>` : ''

  return `
    <div class="pg${o ? ` pg-${esc(o.verdict)}` : ''}">
      <div class="pg-h">
        <span class="pg-who">${esc(g.headline || baseName(g.files[0].path))}</span>
        ${o ? `<span class="pg-v">${esc(o.verdictLabel)}</span>` : ''}
        <span class="pg-amt">${g.files.length}개 · ${fmtBytes(bytes)}</span>
        <button class="pg-all" data-pick-group="${gi}">${g.files.length}개 다 고르기</button>
      </div>
      ${o ? `<div class="pg-l pg-do"><i>→</i>${esc(o.onDelete)}</div>` : ''}
      ${line('pg-bad', '✕', o?.breaks)}
      ${line('pg-ok', '✓', o?.intact)}
      ${o?.unit ? `<div class="pg-l pg-unit"><i>!</i>${esc(o.unit)}</div>` : ''}
      ${moveNoteHtml(g.files)}
      ${o?.because ? `<div class="pg-why">근거 ${esc(o.because)}</div>` : ''}
      <div class="pg-files">${g.files.map(pickRowHtml).join('')}</div>
    </div>`
}

/* ── 결정 단위(폴더) ──────────────────────────────────────────
   ★ 왜 낱개 목록 위에 이게 오나

   화면은 "145,401개를 목록으로 보여드릴게요"라고 하고 체크박스 40줄을 폈다.
   14만 개를 낱개로 고르라는 건 정리가 아니고, 게다가 **낱개로 고르는 것 자체가
   손해다** — .venv에서 dll 하나를 빼면 용량은 1/5만 줄고 프로젝트는 통째로
   지운 것과 똑같이 안 돌아간다.

   개발 산출물의 단위는 파일이 아니라 폴더다. 그래서 엔진이 접어서 보내주고
   (units.ts), 여기서는 **폴더 하나 = 결정 하나**로 그린다. 낱개 목록은
   그 아래에 그대로 남는다 — 폴더째가 싫은 사람의 선택지를 뺏지 않는다. */

function unitCardsHtml(units: any[]): string {
  if (!units?.length) return ''
  return `
    <div class="units">
      <div class="units-h">
        <span>폴더째 결정하시는 게 빠릅니다 — 이 안의 파일은 한 덩어리로 움직여요</span>
        <select class="pick-dest" data-unit-dest="1"><option value="">옮길 드라이브…</option></select>
      </div>
      ${units.map((u, i) => `
        <div class="unit${u.activeNow ? ' unit-live' : ''}">
          <div class="unit-h">
            <span class="unit-name">${esc(u.label)}</span>
            ${u.undoCost ? `<span class="unit-undo">되돌리기 ${esc(u.undoCost)}</span>` : ''}
            <span class="unit-amt">${fmtBytes(u.bytes)} · ${u.count.toLocaleString()}개</span>
          </div>
          <div class="unit-l">${esc(u.what)} · ${esc(u.lastTouched ?? '')}</div>
          ${u.activityNote ? `<div class="unit-l unit-act-l"><i>◆</i>${esc(u.activityNote)}</div>` : ''}
          <div class="unit-l"><i>→</i>${esc(u.onDelete)}</div>
          <div class="bd-path">${esc(u.path)}</div>
          <div class="unit-act">
            ${u.moveOnly
              // 안에 뭐가 있는지 모르는 폴더에 "통째로 정리"를 달지 않는다.
              // 모르는 것을 지우라고 권하는 게 되니까 — 옮기기만 권한다.
              ? `<button class="btn" data-unit-move="${i}" disabled>옮기고 안내판 남기기 (${fmtBytes(u.bytes)})</button>`
              : `<button class="btn" data-unit="${i}">이 폴더 통째로 정리 (${fmtBytes(u.bytes)})</button>
                 <button class="opt" data-unit-move="${i}" disabled>옮기고 안내판 남기기</button>`}
          </div>
          <div class="unit-l" data-unit-out="${i}"></div>
        </div>`).join('')}
      <div class="t-caption" style="color:var(--muted)">
        “옮기고 안내판 남기기”는 지우는 게 아니에요. 이사하고 원래 자리에
        <b>“이 폴더는 저쪽으로 옮겼어요”</b> 안내판을 붙여두는 것과 같아서,
        프로그램은 예전 주소로 찾아가도 그대로 열립니다.
      </div>
    </div>`
}

/**
 * 드라이브 목록을 select에 채운다. 두 자리(낱개 목록·폴더 카드)가 같은 함수를 쓴다 —
 * 목록이 갈리면 한쪽에만 보이는 드라이브가 생긴다.
 */
function fillDriveSelect(sel: HTMLSelectElement, selected: string | null, onPick: (v: string | null) => void) {
  engine('drives')
    .then((d: any) => {
      // 시스템 드라이브는 뺀다 — 같은 드라이브로 옮기면 용량이 안 는다.
      const list = (d.drives ?? []).filter((v: any) => !v.isSystem)
      if (!list.length) {
        sel.innerHTML = `<option value="">옮길 다른 드라이브가 없어요</option>`
        return
      }
      sel.innerHTML =
        `<option value="">옮길 드라이브…</option>` +
        list.map((v: any) => `<option value="${esc(v.root)}"${v.root === selected ? ' selected' : ''}>${esc(v.root)} 남은 공간 ${fmtBytes(v.free)}</option>`).join('')
      onPick(sel.value || null)
    })
    .catch(() => { sel.innerHTML = `<option value="">드라이브를 못 읽었어요</option>` })
  sel.addEventListener('change', () => onPick(sel.value || null))
}

/**
 * 낱개 선택 목록을 그린다.
 *
 * ★ 기본은 **아무것도 선택 안 됨**이다. 전부 체크해두고 "빼세요"로 시작하면
 *   그건 다시 일괄 삭제고, 사용자가 실수로 누르면 되돌릴 일이 커진다.
 *   고른 것만 지운다 — 고르는 건 사용자 몫이다.
 *
 * ★ 대신 **한 번에 고르는 건 한 번에 되게 한다.** 40줄을 하나씩 누르게 하는 건
 *   "고르라"가 아니라 "포기하라"다. 전체 선택은 목록 맨 위에 두고, 몇 개를
 *   고르는지 버튼에 적는다 — 안 보이는 것까지 골랐다고 믿게 두지 않는다.
 */
function renderPicker(host: HTMLElement, unknown: string, prefer: 'delete' | 'move' = 'delete') {
  const q = lastQuestions.find((x) => x.unknown === unknown)
  const samples: any[] = q?.evidence?.samples ?? []
  picked.clear()

  if (!samples.length) {
    host.innerHTML = `<div class="note" style="margin-top:10px">
      낱개로 보여드릴 목록을 못 받았어요. 다시 검사하면 목록이 함께 옵니다.</div>`
    return
  }

  const byPath = new Map<string, any>(samples.map((s) => [s.path, s]))
  const groups = groupByOwner(samples)
  const movableTotal = samples.filter(canMove).length
  const units: any[] = q?.evidence?.units ?? []
  const loose = q?.evidence?.looseCount ?? 0

  host.innerHTML = `
    ${prefer === 'move' ? '' : unitCardsHtml(units)}
    <div class="pick" style="margin-top:10px">
      <div class="pick-head">
        <span>${prefer === 'move'
          ? '옮길 것만 골라주세요 — 고른 것만 옮깁니다'
          : units.length
            ? `폴더째가 아니라 파일 하나씩 고르실 거면 여기서${loose ? ` (묶이지 않은 ${loose.toLocaleString()}개 포함)` : ''}`
            : '지울 것만 골라주세요 — 고른 것만 정리합니다'}</span>
        <button class="opt" data-pick-all="1">큰 것 10개</button>
        <button class="opt strong" data-pick-every="1">전체 선택 (${samples.length}개)</button>
      </div>
      <div class="pick-list">${groups.map(pickGroupHtml).join('')}</div>
      <div class="pick-foot">
        <button class="${prefer === 'move' ? 'opt' : 'btn'}" data-pick-go="1" disabled>고른 것 지우기</button>
        ${movableTotal ? `
          <select class="pick-dest" data-pick-dest="1"><option value="">옮길 드라이브…</option></select>
          <button class="${prefer === 'move' ? 'btn' : 'opt'}" data-pick-move="1" disabled>고른 것 옮기기</button>` : ''}
        <span class="t-caption" data-pick-sum="1">아직 고르신 게 없어요</span>
      </div>
      <div class="t-caption" data-pick-bk="1" style="margin-top:6px" hidden></div>
      <div class="t-caption" style="color:var(--muted);margin-top:6px">
        큰 것부터 ${samples.length}개까지 보여드려요. <b style="color:var(--lock)">고른 것은 바로 지웁니다 — 되돌릴 수 없어요.</b>${
          movableTotal ? `<br>이 중 ${movableTotal}개는 지우는 대신 <b>다른 드라이브로 옮길 수</b> 있어요 — 파일은 그대로 남고 C드라이브만 빕니다.` : ''}</div>
      <div data-pick-out="1"></div>
    </div>`

  /* 폴더째 옮기기 — 지우는 게 아니라 자리만 바꾸고 바로가기를 남긴다.
     "옮기면 깨져요"라고 막아둔 것들(앱 데이터·게임·가상환경)의 답이다. */
  const unitDest = host.querySelector<HTMLSelectElement>('[data-unit-dest]')
  const unitMoveBtns = host.querySelectorAll<HTMLButtonElement>('[data-unit-move]')
  if (unitDest) {
    fillDriveSelect(unitDest, pickDest, (v) => {
      pickDest = v
      unitMoveBtns.forEach((b) => (b.disabled = !v))
    })
  }
  unitMoveBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const u = units[+btn.dataset.unitMove!]
      if (!pickDest) return
      const outEl = host.querySelector<HTMLElement>(`[data-unit-out="${btn.dataset.unitMove}"]`)!
      btn.disabled = true
      btn.textContent = '옮길 곳 확인 중…'
      try {
        const p = await engine('relocate-folder-plan', [pickDest, u.path])
        if (p.blocked) throw new Error(p.blocked)
        if (p.sameVolume) throw new Error('같은 드라이브라 옮겨도 용량이 늘지 않아요.')
        if (!p.destination?.ok) throw new Error(p.destination?.reason ?? '대상 드라이브를 쓸 수 없어요')
        if (!confirm(`${u.label} 폴더를 ${pickDest}로 옮길까요?\n\n${p.files.toLocaleString()}개 · ${fmtBytes(p.bytes)}\n→ ${p.dest}\n\n${spaceHint(p.bytes)}지우지 않습니다. 원래 자리엔 안내판이 남아서, 프로그램은 예전 주소로 찾아가도 그대로 열려요.\n그 프로그램이 실행 중이면 먼저 닫아주세요.`)) {
          btn.disabled = false
          btn.textContent = u.moveOnly ? `옮기고 안내판 남기기 (${fmtBytes(u.bytes)})` : '옮기고 안내판 남기기'
          return
        }
        btn.textContent = '옮기는 중… (복사하고 대조하느라 몇 분 걸려요)'
        const r = await engine('relocate-folder-apply', [pickDest, u.path])
        const card = btn.closest('.unit') as HTMLElement | null
        card?.classList.add('unit-done')
        outEl.innerHTML = ''
        ;(btn.parentElement as HTMLElement).innerHTML = doneBlock(
          `옮기기 완료 — ${r.files.toLocaleString()}개 (${fmtBytes(r.bytes)})`,
          [
            // 이동은 지우는 게 아닌데도 용량은 **지금** 빈다. 그 차이를 분명히 말한다.
            `${fmtBytes(r.bytes)}가 지금 비었습니다.`,
            `실물은 ${esc(r.movedTo)}에 있고, 원래 자리엔 안내판이 남아서 프로그램은 그대로 열려요.`,
            "되돌리려면 '되돌리기' 화면에서 되돌리시면 됩니다.",
          ]
        )
        toast(`옮기기 완료 — ${fmtBytes(r.bytes)}가 비었습니다.`, 'good')
        refreshDisk(true)
      } catch (err) {
        toast('옮기지 못했어요: ' + errText(err), 'bad')
        outEl.innerHTML = `<i>✕</i>${esc(errText(err))}`
        btn.disabled = false
        btn.textContent = u.moveOnly ? `옮기고 안내판 남기기 (${fmtBytes(u.bytes)})` : '옮기고 안내판 남기기'
      }
    })
  })

  /* 폴더째 정리 — 결정 하나가 파일 수만 개를 지운다. 되돌릴 수 없으므로,
     무엇이 사라지는지 숫자와 이름으로 다시 보여주고 그 사실을 먼저 놓는다. */
  host.querySelectorAll<HTMLButtonElement>('[data-unit]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const u = units[+btn.dataset.unit!]
      if (!confirm(`${u.label} 폴더를 통째로 지울까요?\n\n${u.path}\n${u.count.toLocaleString()}개 · ${fmtBytes(u.bytes)}\n\n${u.onDelete}\n\n되돌릴 수 없습니다 — 휴지통에도 안 남아요.\n\n${spaceHint(u.bytes)}`)) return
      btn.disabled = true
      btn.textContent = '지우는 중… (파일이 많으면 몇 분 걸려요)'
      try {
        const r = await engine('quarantine-folders', [u.path])
        const bytes = r.deletedBytes ?? u.bytes
        /* ★ 버튼 글씨만 바꾸지 않는다 — 버튼 모양 그대로면 "아직 눌러야 하나?"로
           읽힌다. 카드를 완료 상태로 바꾸고, 다음에 뭘 하면 되는지까지 붙인다. */
        const card = btn.closest('.unit') as HTMLElement | null
        card?.classList.add('unit-done')
        const act = btn.parentElement as HTMLElement
        act.innerHTML = doneBlock(
          `삭제 완료 — ${r.deletedCount.toLocaleString()}개 (${fmtBytes(bytes)})`,
          [
            `${fmtBytes(bytes)}가 지금 비었습니다.`,
            r.refusedCount ? `잠근 항목 ${r.refusedCount.toLocaleString()}개는 안 건드렸어요.` : '',
            r.failed?.length ? `${r.failed.length}개는 사용 중이라 건너뛰었어요.` : '',
            leftoverNote(r.leftover),
          ]
        )
        toast(`삭제 완료 — ${u.label} ${fmtBytes(bytes)}가 비었습니다.`, 'good')
        quarLoaded = false
        refreshDisk(true)
      } catch (err) {
        toast('지우지 못했어요: ' + errText(err), 'bad')
        btn.disabled = false
        btn.textContent = `이 폴더 통째로 정리 (${fmtBytes(u.bytes)})`
      }
    })
  })

  const goBtn = host.querySelector<HTMLButtonElement>('[data-pick-go]')!
  const sumEl = host.querySelector<HTMLElement>('[data-pick-sum]')!
  const moveBtn = host.querySelector<HTMLButtonElement>('[data-pick-move]')
  const destSel = host.querySelector<HTMLSelectElement>('[data-pick-dest]')
  const outEl = host.querySelector<HTMLElement>('[data-pick-out]')!
  const everyBtn = host.querySelector<HTMLButtonElement>('[data-pick-every]')!
  const groupBtns = [...host.querySelectorAll<HTMLButtonElement>('[data-pick-group]')]

  const pickedFiles = () => [...picked].map((p) => byPath.get(p)).filter(Boolean)

  const sync = () => {
    const chosen = pickedFiles()
    const bytes = chosen.reduce((n, s) => n + s.size, 0)
    const movable = chosen.filter(canMove)
    goBtn.disabled = picked.size === 0
    /* 버튼이 무슨 일을 하는지 그 자리에서 말한다 — 지우고, 그만큼 지금 빈다.
       "정리"라는 말은 쓰지 않는다. 되돌릴 수 없는 일을 부드러운 말로 부르면
       사용자는 되돌릴 수 있다고 읽는다. */
    goBtn.textContent = picked.size
      ? `고른 ${picked.size}개 지우기 (${fmtBytes(bytes)} 확보)`
      : '고른 것 지우기'
    goBtn.classList.toggle('danger', picked.size > 0)
    sumEl.textContent = picked.size ? `${picked.size}개 · ${fmtBytes(bytes)}` : '아직 고르신 게 없어요'
    // 목록 전체·묶음 버튼의 글씨는 지금 상태를 따라간다. 다 골라놓고도
    // "다 고르기"라고 적혀 있으면 한 번 더 눌러서 통째로 풀어버린다.
    const allOn = samples.length > 0 && samples.every((s) => picked.has(s.path))
    everyBtn.textContent = allOn ? `전체 해제 (${samples.length}개)` : `전체 선택 (${samples.length}개)`
    everyBtn.classList.toggle('chosen', allOn)
    for (const btn of groupBtns) {
      const files = groups[+btn.dataset.pickGroup!].files
      const on = files.every((f: any) => picked.has(f.path))
      btn.textContent = on ? `${files.length}개 해제` : `${files.length}개 다 고르기`
    }
    if (moveBtn) {
      // 옮길 수 없는 것은 세지 않는다. 버튼에 적힌 개수와 실제로 옮겨질 개수가
      // 다르면, 끝나고 나서 "왜 3개만 옮겨졌지"가 된다.
      const mb = movable.reduce((n, s) => n + s.size, 0)
      moveBtn.disabled = !movable.length || !pickDest
      moveBtn.textContent = movable.length
        ? `${movable.length}개(${fmtBytes(mb)}) 옮기기`
        : '고른 것 옮기기'
    }
  }

  /* 체크박스를 경로로 찾을 수 있게 들고 있는다. 선택자로 찾으면 경로의 역슬래시가
     CSS 이스케이프로 먹혀서 조용히 못 찾는다 — 윈도우 경로에서만 터지는 종류다. */
  const boxes = new Map<string, HTMLInputElement>()
  host.querySelectorAll<HTMLInputElement>('[data-pick]').forEach((box) => {
    boxes.set(box.dataset.pick!, box)
    box.addEventListener('change', () => {
      if (box.checked) picked.add(box.dataset.pick!)
      else picked.delete(box.dataset.pick!)
      sync()
    })
  })

  /* ── 백업 확인 ────────────────────────────────────────────
     "이거 백업해두셨어요?"를 묻는 대신 우리가 확인한다. 목록을 **먼저 그리고**
     나중에 줄만 채운다 — 클라우드 폴더를 훑는 일이라 늦을 수 있는데, 그동안
     목록을 못 보게 만들 이유는 없다.

     ★ 찾은 것만 말한다. 못 찾았다고 "백업이 없다"고 하지 않는다 — 색인이 시간
        예산 안에서 다 못 훑었을 수 있고(partial), 그 차이를 사용자가 알 수 없다.
        한 번 단정했다가 틀리면 나머지 판단까지 같이 의심받는다. */
  const bkEl = host.querySelector<HTMLElement>('[data-pick-bk]')!
  engine('backup-check', samples.map((s) => s.path))
    .then((b: any) => {
      let found = 0
      for (const r of b.results ?? []) {
        if (!r.note) continue
        const row = boxes.get(r.path)?.closest('.pick-row')
        if (!row) continue
        const el = document.createElement('span')
        el.className = r.found ? 'pick-bk' : 'pick-bk warn'
        el.textContent = (r.found ? '✓ ' : '⚠ ') + r.note
        row.appendChild(el)
        if (r.found) found++
      }
      if (found) {
        bkEl.hidden = false
        bkEl.innerHTML = `<b style="color:var(--safe)">${found}개는 ${esc((b.roots ?? []).join('·'))}에도 있어요</b> — 그건 지워도 그쪽에 남습니다.`
      }
    })
    .catch(() => { /* 백업 확인이 안 돼도 목록은 그대로 쓸 수 있다 */ })

  const setPicked = (path: string, on: boolean) => {
    const box = boxes.get(path)
    if (box) box.checked = on
    if (on) picked.add(path)
    else picked.delete(path)
  }

  /** 묶음째 고르기 — 설명이 하나면 결정도 하나다. 한 줄씩 누르게 하지 않는다. */
  for (const btn of groupBtns) {
    btn.addEventListener('click', () => {
      const files = groups[+btn.dataset.pickGroup!].files
      const on = !files.every((f: any) => picked.has(f.path)) // 다 골라져 있으면 해제
      for (const f of files) setPicked(f.path, on)
      sync() // 버튼 글씨(고르기↔해제)도 sync가 맞춘다
    })
  }

  host.querySelector<HTMLButtonElement>('[data-pick-all]')!.addEventListener('click', () => {
    // 목록은 이미 큰 것부터다. 여기는 상위 10개만 — 대부분은 이걸로 끝난다.
    for (const s of samples.slice(0, 10)) setPicked(s.path, true)
    sync()
  })

  /* 전체 선택 — 40줄을 하나씩 누르게 하는 건 고르라는 게 아니라 포기하라는 거다.
     ★ 그래도 **기본은 여전히 아무것도 안 골라진 상태**다. 켜져 있는 걸 빼게 하는
        것과, 직접 눌러서 켜는 것은 실수했을 때 결과가 다르다.
     ★ '전체'는 화면에 보이는 이 목록까지다(703개가 아니라 40개). 개수를 버튼에
        적어두는 이유가 그것이다 — 안 보이는 것까지 지웠다고 믿게 두지 않는다. */
  everyBtn.addEventListener('click', () => {
    const allOn = samples.every((s) => picked.has(s.path))
    for (const s of samples) setPicked(s.path, !allOn)
    sync()
  })

  sync() // 버튼에 개수를 처음부터 적어둔다

  /* ── 옮기기 ────────────────────────────────────────────────
     대상 드라이브 목록은 파일을 훑지 않는 가벼운 명령으로 받는다(drives).
     여기서 relocate-scan을 부르면 다운로드·영상 폴더를 통째로 다시 훑는다 —
     지금 눈앞의 40개와 아무 상관없는 작업으로 몇 분을 쓰게 된다. */
  if (destSel) fillDriveSelect(destSel, pickDest, (v) => { pickDest = v; sync() })

  moveBtn?.addEventListener('click', async () => {
    const paths = pickedFiles().filter(canMove).map((s) => s.path)
    if (!paths.length || !pickDest) return
    moveBtn.disabled = true
    moveBtn.textContent = '옮길 곳 확인 중…'
    try {
      // 먼저 계획만 세운다 — 아무것도 안 건드리고 어디로 갈지·몇 개가 갈지 보여준다.
      const p = await engine('relocate-paths-plan', [pickDest, ...paths])
      if (!p.destination?.ok) throw new Error(p.destination?.reason ?? '대상 드라이브를 쓸 수 없어요')
      if (!p.count) {
        outEl.innerHTML = `<div class="note" style="margin-top:10px">옮길 수 있는 게 없었어요.${
          p.refused?.length ? ` ${esc(p.refused[0].reason)}` : ''}</div>`
        return
      }
      if (!confirm(`${p.count.toLocaleString()}개(${fmtBytes(p.bytes)})를 ${p.destFolder}로 옮길까요?\n\n${spaceHint(p.bytes)}지우지 않습니다. 폴더 구조를 유지한 채 옮기고, 옮긴 기록이 파일 옆에 남아 언제든 되돌릴 수 있어요.`)) return
      moveBtn.textContent = '옮기는 중…'
      const r = await engine('relocate-paths-apply', [pickDest, ...paths])
      outEl.innerHTML = `<div class="pick-done">
        <div class="pick-done-h">✓ 옮기기 완료 — ${r.movedCount.toLocaleString()}개(${fmtBytes(r.movedBytes)})</div>
        <div class="t-caption">${esc(p.destFolder)} — 되돌리려면 '드라이브 옮기기' 화면에서 되돌릴 수 있어요.</div>
        ${r.failed?.length ? `<div class="t-caption">${r.failed.length}개는 옮기지 못했어요 — ${esc(r.failed[0].reason)}</div>` : ''}
        ${r.skipped?.length ? `<div class="t-caption">${r.skipped.length}개는 같은 드라이브라 건너뛰었어요.</div>` : ''}
      </div>`
      toast(`${r.movedCount.toLocaleString()}개를 옮겼어요. 용량이 그만큼 빕니다.`, 'good')
      refreshDisk(true)
    } catch (err) {
      toast('옮기지 못했어요: ' + errText(err), 'bad')
      outEl.innerHTML = `<div class="note" style="margin-top:10px">옮기지 못했어요: ${esc(errText(err))}</div>`
    } finally {
      sync()
    }
  })

  goBtn.addEventListener('click', async () => {
    const chosen = samples.filter((s) => picked.has(s.path))
    const paths = chosen.map((s) => s.path)
    const bytes = chosen.reduce((n, s) => n + s.size, 0)

    /* ★ '두시는 게 안전합니다'로 판정한 걸 고르셨으면 한 번 더 묻는다.
       엔진은 존 C(잠금)만 거절한다. 그런데 owners.ts의 'keep'은 그것보다 넓다 —
       세이브 파일·설정·직접 만든 문서처럼 **되돌릴 수 없는 것**이 여기 들어온다.
       거절하지는 않는다. 사용자가 자기 파일을 지울 권리는 있으니까. 다만 무엇을
       고르셨는지 이름을 대고 한 번 더 확인한다. */
    const risky = chosen.filter((s) => s.owner?.verdict === 'keep')
    if (risky.length) {
      const names = risky.slice(0, 3).map((s) => `· ${baseName(s.path)} — ${s.owner.onDelete}`).join('\n')
      if (!confirm(
        `저희가 "두시는 게 안전합니다"로 본 것이 ${risky.length}개 섞여 있어요.\n\n${names}` +
        `${risky.length > 3 ? `\n… 외 ${risky.length - 3}개` : ''}\n\n그래도 지울까요? 되돌릴 수 없습니다.`
      )) return
    }

    /* ★ 낱개로 고르면 손해인 묶음 — 폴더째가 더 나은 경우를 말해준다.
       일부만 골라 지우면 용량은 조금 줄고 프로젝트는 통째로 지운 것과 똑같이
       안 돌아간다(owners.ts의 unit). 막지는 않는다. 알려주고 결정은 사용자가 한다. */
    const partial = groups.find(
      (g) => g.o?.unit && g.files.some((f: any) => picked.has(f.path)) && !g.files.every((f: any) => picked.has(f.path))
    )
    if (partial && !confirm(`${partial.o.unit}\n\n그래도 고른 것만 지울까요?`)) return

    /* ★ **되돌릴 수 없다**는 말을 먼저 놓는다. 이 창을 대충 읽고 누르는 사람에게
       마지막으로 남는 줄이 그것이어야 한다. 그리고 '휴지통에도 안 남는다'까지
       적는다 — 사람들이 아는 삭제는 대개 휴지통을 거치는 삭제라서, 안 적으면
       "휴지통에서 꺼내면 되지"로 읽는다. */
    if (!confirm(
      `고르신 ${paths.length}개(${fmtBytes(bytes)})를 지울까요?\n\n` +
      `되돌릴 수 없습니다 — 휴지통에도 안 남아요.\n\n${spaceHint(bytes)}`
    )) return

    goBtn.disabled = true
    goBtn.textContent = '지우는 중…'
    try {
      const r = await engine('quarantine-paths', paths)
      // 거절당한 게 있으면 숨기지 않는다 — 왜 안 됐는지가 신뢰의 근거다.
      const refused = (r.refused ?? []) as { path: string; reason: string }[]
      host.innerHTML = `<div class="pick-done">
          <div class="pick-done-h">✓ 삭제 완료 — ${r.deletedCount.toLocaleString()}개(${fmtBytes(r.deletedBytes ?? bytes)})를 지웠어요</div>
          <div class="t-caption">용량이 지금 비었습니다.</div>
          ${r.failed?.length ? `<div class="t-caption">${r.failed.length}개는 사용 중이라 건너뛰었어요.</div>` : ''}
          ${r.leftover > 0 ? `<div class="t-caption">${leftoverNote(r.leftover)}</div>` : ''}
        </div>`
      toast(`${r.deletedCount.toLocaleString()}개를 지웠어요 — ${fmtBytes(r.deletedBytes ?? bytes)}가 비었습니다.`, 'good')
      quarLoaded = false
      refreshDisk(true)
    } catch (err) {
      toast('지우지 못했어요: ' + errText(err), 'bad')
      goBtn.disabled = false
      sync() // 버튼 글씨를 지금 고른 개수로 되돌린다
    }
  })
}

function renderKept(kept: { meaning: string; bytes: number }[], lockBytes: number) {
  const el = $('kept')
  if (!kept.length) { el.hidden = true; return }
  el.hidden = false
  el.innerHTML = `<div class="t-small" style="font-weight:var(--w-head);color:var(--safe)">지켜드린 것 — 지웠으면 뭔가 깨졌을 것들</div>
    <div class="n">${fmtBytes(lockBytes)}</div>
    <ul>${kept.map((k) => `<li>${esc(k.meaning)} — ${fmtBytes(k.bytes)}</li>`).join('')}</ul>
    <div class="t-small" style="color:var(--muted);margin-top:8px">경쟁 도구는 "지운 양"을 자랑해요. 우리는 "지킨 양"을 보여드립니다.</div>`
}

/* ── 스캔 실행 ─────────────────────────────────────────────── */

/* ── 진행 상황 수신 ────────────────────────────────────────────
   엔진이 stderr로 흘린 것을 Rust가 `engine-progress` 이벤트로 중계한다
   (main.rs의 run_engine). 여기서는 마지막 값만 들고 있다가 1초에 한 번 그린다 —
   초당 네 번 오는 걸 올 때마다 그리면 글자가 떨려서 오히려 읽기 어렵다. */

interface ScanProgress {
  t: 'scan' | 'plan'
  /** null이면 진행률을 정말 모른다 — 그때는 무한 막대를 유지한다 */
  pct: number | null
  etaSec: number | null
  basis: 'learned' | 'roots' | 'unknown'
  files: number
  rootIndex?: number
  rootCount?: number
  /** 지금 훑는 폴더의 경로. 화면에는 사람이 읽는 이름으로 바꿔 쓴다 */
  root?: string
}

/**
 * 지우는 동안의 진행 상황. 스캔과 형태가 달라서 따로 둔다 —
 * 스캔은 '파일 몇 개를 봤나'고, 이쪽은 '몇 개를 처리했고 얼마나 비었나'다.
 */
interface SweepProgress {
  t: 'sweep' | 'sweep-plan'
  /** sweep-plan: 계획을 다시 훑지 않고 캐시에서 꺼냈다 */
  cached?: boolean
  done?: number
  total?: number
  /** 지금까지 실제로 비운 용량 */
  bytes?: number
  pct?: number
  etaSec?: number | null
}

let lastProgress: ScanProgress | null = null
let lastSweep: SweepProgress | null = null
/** 카드 id → 그 카드의 삭제 진행. 여러 장을 잇달아 눌러도 안 섞이게. */
const cardProgress = new Map<string, { done?: number; total?: number; bytes?: number; pct?: number; etaSec?: number | null }>()

/**
 * 경로 → 사람이 읽는 폴더 이름('다운로드', '앱 데이터(로컬)').
 * 엔진은 경로를 보내고 이름은 default-roots가 안다 — 한 번 받아 여기 담아둔다.
 */
const rootLabels = new Map<string, string>()

function rootLabel(path?: string): string {
  if (!path) return '훑는 중'
  return rootLabels.get(path) ?? path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

if (inTauri) {
  TAURI.event.listen('engine-progress', (e: any) => {
    const p = e?.payload
    if (p && (p.t === 'scan' || p.t === 'plan')) lastProgress = p as ScanProgress
    else if (p && (p.t === 'sweep' || p.t === 'sweep-plan')) lastSweep = p as SweepProgress
    // 카드 삭제 진행 — 카드마다 따로 담는다(여러 장을 잇달아 누를 수 있다)
    else if (p && p.t === 'proposal' && p.id) cardProgress.set(p.id, p)
    // 같은 파일 찾기 — 훑기(빠름)와 안을 펼쳐 확인(느림)이 따로 온다
    else if (p && (p.t === 'dupes-scan' || p.t === 'dupes-hash')) lastDupes = p as DupProgress
    // 화면마다 하나씩 도는 조회(안 쓴 프로그램·숨은 공간·시작프로그램…).
    // 명령 이름으로 담아둔다 — 두 화면을 잇달아 열어도 안 섞인다.
    else if (p && p.t === 'task' && p.cmd) taskProgress.set(p.cmd, p as TaskProgress)
  })
}

/**
 * 화면 하나를 채우는 조회의 진행 상황.
 *
 * ★ 왜 생겼나 (실물에서 본 것)
 *   '안 쓴 프로그램' 화면은 "설치된 프로그램과 실행 기록을 읽는 중…" 한 줄만
 *   띄운 채 수십 초를 버텼다. 멈춘 건지 도는 건지 알 수 없는 화면이다.
 *   스캔에는 진행률이 있었는데 나머지 화면에는 없었다 — 근거를 만들기가
 *   어려웠기 때문이지, 사용자가 덜 궁금해서가 아니다.
 *
 *   이제 엔진이 명령마다 진행을 흘린다(engine-cli.ts withTaskProgress).
 *   근거는 셋 중 하나이고, 무엇으로 셌는지 화면이 그대로 말한다.
 */
interface TaskProgress {
  t: 'task'
  /** 엔진 명령 이름 — 어느 화면의 진행인지 */
  cmd: string
  /** 지금 하는 일 (사람 말) */
  label?: string
  /** null이면 정말 모른다 — 무한 막대를 유지하고 경과 시간만 말한다 */
  pct: number | null
  etaSec: number | null
  basis: 'counted' | 'learned-time' | 'steps' | 'unknown'
  done?: number
  total?: number
  /**
   * done/total이 '우리 내부 단계'라서 사람에게 보여주면 안 되는 경우.
   * 5개가 무엇의 5개인지 사용자는 알 길이 없다 — %와 지금 하는 일만 말한다.
   */
  coarse?: boolean
}
const taskProgress = new Map<string, TaskProgress>()

/**
 * 로딩 자리에 진행 표시를 그린다. 화면마다 따로 짜지 않는다.
 *
 * ★ 전에는 자리마다 문자열 한 줄씩 손으로 박혀 있었다("…읽는 중…").
 *   그래서 한 곳에 진행률을 붙여도 나머지 여섯 곳은 그대로였다.
 *   여기 하나로 모아두면 다음에 생기는 화면도 자동으로 같은 대우를 받는다.
 *
 * @param cmd 엔진 명령 이름. 이 이름으로 오는 진행만 그린다.
 * @param headline 진행 문구가 아직 없을 때 보여줄 첫 줄
 * @param compact 카드 안에 끼워 넣는 자리(생활 정리). 카드를 또 그리면 겹쳐 보인다.
 * @returns 멈추는 함수. 결과를 그리기 **전에** 부른다.
 */
function startPanel(host: HTMLElement, cmd: string, headline: string, compact = false): () => void {
  // 지난번 실행이 남긴 100%를 물려받지 않는다 — 열자마자 다 된 것처럼 보인다.
  taskProgress.delete(cmd)

  const started = Date.now()
  let shownPct = 0 // 뒤로 가지 않게 화면에서도 한 번 더 잠근다

  host.innerHTML = compact
    ? `<div style="margin-top:10px">
        <div class="prog" data-panel-bar="1" style="margin:0"><div class="prog-bar"><span></span></div></div>
        <div class="t-small" data-panel-line="1" style="color:var(--muted);margin-top:8px">${esc(headline)}</div>
      </div>`
    : `<div class="card">
        <div class="prog" data-panel-bar="1" style="margin:0"><div class="prog-bar"><span></span></div></div>
        <div class="empty" data-panel-line="1" style="padding-top:12px">${esc(headline)}</div>
      </div>`
  const bar = host.querySelector<HTMLElement>('[data-panel-bar]')
  const fill = host.querySelector<HTMLElement>('[data-panel-bar] span')
  const line = host.querySelector<HTMLElement>('[data-panel-line]')

  const paint = () => {
    if (!line) return
    const elapsed = fmtDuration((Date.now() - started) / 1000)
    const p = taskProgress.get(cmd)
    const head = p?.label || headline

    if (!p || p.pct === null || p.pct === undefined) {
      /* 진행률을 셀 근거가 없다 — 거의 첫 실행이다. 무한 막대를 두고 아는 것만
         말한다. 그리고 **왜 없는지**를 말한다: 이유를 모르면 사용자는 앱이
         고장난 줄 안다. 다음부터는 뜬다는 걸 알면 기다릴 수 있다. */
      line.textContent = `${head} · 경과 ${elapsed}`
        + (p ? ' · 이번에 걸린 시간을 재고 있어요 — 다음부터 남은 시간을 알려드릴 수 있어요' : '')
      return
    }

    shownPct = Math.max(shownPct, p.pct)
    bar?.classList.add('prog-known')
    // 0%에서 막대를 폭 0으로 두면 빈 홈만 보인다 — 시작한 게 안 보이면 안 누른 줄 안다.
    if (fill) fill.style.width = `${Math.max(2, shownPct)}%`

    const parts = [`${shownPct}%`]
    /* 셀 수 있는 **실물**이 있을 때만 개수를 보여준다 — 그러면 %만 있는 것보다
       훨씬 잘 믿긴다. 내부 단계 수(coarse)는 뜻이 안 통하므로 숨긴다. */
    if (p.basis === 'counted' && p.total && !p.coarse) {
      parts.push(`${(p.done ?? 0).toLocaleString()} / ${p.total.toLocaleString()}개`)
    }
    parts.push(`경과 ${elapsed}`)
    if (p.etaSec !== null && p.etaSec !== undefined) parts.push(`남은 시간 약 ${fmtDuration(p.etaSec)}`)
    else if (p.basis === 'learned-time') parts.push('지난번보다 오래 걸리고 있어요 — 조금만 더요')
    else if (p.basis === 'steps') parts.push('남은 시간은 단계마다 달라서 말씀드리기 어려워요')

    line.textContent = `${head} · ${parts.join(' · ')}`
  }
  paint()
  /* 500ms — 이 화면들은 스캔(수 분)보다 짧다(수 초~수십 초). 1초 눈금이면
     10초짜리 일에서 열 번밖에 안 움직여서 멈춘 것처럼 보인다. */
  const timer = setInterval(paint, 500)
  return () => {
    clearInterval(timer)
    taskProgress.delete(cmd)
  }
}

/**
 * 같은 파일 찾기의 진행 상황.
 *
 * ★ 두 단계를 갈라서 받는다. 폴더를 훑는 건 빠르고, **안을 펼쳐 내용을 확인하는
 *   건 느리다**(파일마다 실제로 읽는다). 한 막대로 합치면 후반에 멈춘 것처럼
 *   보인다 — 실제로는 제일 중요한 일을 하는 중인데.
 */
interface DupProgress {
  t: 'dupes-scan' | 'dupes-hash'
  phase: 'scan' | 'hash' | 'done'
  files?: number
  label?: string
  rootIndex?: number
  rootCount?: number
  done?: number
  total?: number
  pct?: number | null
  etaSec?: number | null
}
let lastDupes: DupProgress | null = null

/**
 * 오래 걸리는 작업 중에 '어디까지 왔고 얼마나 남았는지'를 보여준다.
 *
 * ★ 전에는 경과 시간만 보여줬다. 코드 주석에도 "엔진이 결과를 한 번에 돌려주니
 *   진행률을 만들 수 없다, 없는 걸 지어내느니 경과 시간을 보여준다"고 적혀 있었다.
 *   정직했지만 7분이 지난 화면에서 사용자는 반이나 왔는지, 1분 남았는지
 *   20분 남았는지, 멈춘 건 아닌지를 알 수 없었다. 그래서 엔진이 진행 상황을
 *   흘려보내게 고쳤고(engine-cli.ts) 이제 진짜 숫자를 그린다.
 *
 * 진행 상황이 안 오면(구버전 엔진·진행을 안 내는 명령) 예전처럼 경과 시간만
 * 보여주고 막대는 무한 막대로 둔다 — 없는 진행률을 지어내지 않는다는 원칙은 그대로다.
 */
/**
 * @param onStop 있으면 '여기까지만 보기' 버튼이 뜬다. 없으면 안 뜬다 —
 *   세울 수 없는 작업에 멈춤 버튼을 보여주면 그건 거짓 약속이다.
 */
function startTicker(prefix: string, onStop?: () => void): () => void {
  const started = Date.now()
  lastProgress = null
  let shownPct = 0 // 뒤로 가지 않게 여기서 한 번 더 잠근다
  const box = $('prog') as HTMLElement
  const fill = box.querySelector('span') as HTMLElement
  const stop = $('prog-stop') as HTMLButtonElement
  box.hidden = false
  box.classList.remove('prog-known')
  fill.style.width = ''

  stop.hidden = !onStop
  stop.disabled = false
  stop.textContent = '여기까지만 보기'
  const onClick = () => {
    // 두 번 누를 일이 없다. 그리고 눌린 뒤엔 '멈추는 중'이라고 말한다 —
    // 아무 반응이 없으면 사용자는 안 먹혔다고 생각하고 또 누른다.
    stop.disabled = true
    stop.textContent = '멈추는 중…'
    onStop?.()
  }
  if (onStop) stop.addEventListener('click', onClick)

  const paint = () => {
    const elapsed = fmtDuration((Date.now() - started) / 1000)
    const p = lastProgress

    if (!p) {
      $('status').textContent = `${prefix} · ${elapsed}`
      return
    }

    const parts: string[] = []
    if (p.pct === null) {
      // 진행률을 셀 근거가 없다(폴더 한 곳만 훑는 첫 스캔). 막대는 무한 막대로 두고
      // 아는 것만 말한다 — 파일 수와 경과 시간도 여태 없던 정보다.
      parts.push('진행률은 이번 스캔이 끝나면 알 수 있어요')
    } else {
      shownPct = Math.max(shownPct, p.pct)
      // 결정된 진행률이 생긴 순간 무한 막대를 실제 막대로 바꾼다.
      box.classList.add('prog-known')
      fill.style.width = `${shownPct}%`
      parts.push(`${shownPct}%`)
    }
    parts.push(`${p.files.toLocaleString()}개`)
    parts.push(`경과 ${elapsed}`)
    if (p.etaSec !== null) parts.push(`남은 시간 약 ${fmtDuration(p.etaSec)}`)
    // 첫 스캔은 폴더 개수로만 세는 거라 거칠다. 그걸 숨기면 다음에 값이
    // 확 달라 보여서 오히려 안 믿게 된다.
    else if (p.basis === 'roots') parts.push('남은 시간은 이번 스캔이 끝나면 알 수 있어요')

    /* ★ 머리말을 지금 보는 폴더로 바꾼다.
       기다리는 동안 필요한 건 '어디를 볼 예정인지'가 아니라 '지금 어디를 보는지'다.
       그리고 폴더 7곳 이름을 다 늘어놓은 채로 진행률·파일 수·남은 시간까지 붙이면
       줄이 두 줄로 넘어가서 아무것도 안 읽힌다(실물에서 이미 넘쳤다). */
    const head =
      p.t === 'plan' ? '정리 계획을 세우는 중'
      : p.rootCount && p.rootCount > 1
        ? `${rootLabel(p.root)} 훑는 중 (${p.rootCount}곳 중 ${(p.rootIndex ?? 0) + 1})`
        : p.root ? `${rootLabel(p.root)} 훑는 중` : prefix

    $('status').textContent = `${head} · ${parts.join(' · ')}`
  }
  paint()
  const timer = setInterval(paint, 1000)
  return () => {
    clearInterval(timer)
    box.hidden = true
    box.classList.remove('prog-known')
    fill.style.width = ''
    lastProgress = null
    stop.hidden = true
    if (onStop) stop.removeEventListener('click', onClick)
  }
}

/** 기본 스캔 대상(이 PC의 주요 폴더)을 미리 안내한다. 뭘 볼 건지 먼저 말한다. */
async function describeDefaultRoots(): Promise<string> {
  try {
    const d = await engine('default-roots')
    // 이름을 담아둔다 — 진행 중에는 '지금 보는 폴더' 하나만 보여줄 때 쓴다.
    for (const r of d.roots) if (r?.path && r?.label) rootLabels.set(r.path, r.label)
    const labels = d.roots.map((r: any) => r.label)
    return labels.length ? `${labels.join(' · ')} 훑는 중` : '훑는 중'
  } catch {
    return '훑는 중'
  }
}

/**
 * @param pickFolder 폴더를 직접 고를 것인가. 기본(false)은 '이 PC의 주요 폴더'.
 *   폴더를 고를 줄 아는 사람이면 이 앱이 필요 없다 — 기본이 알아서여야 한다.
 */
async function runScan(pickFolder = false) {
  ;($('oneclick') as HTMLButtonElement).disabled = true
  let stopTicker: (() => void) | null = null
  try {
    let report: Report
    if (inTauri) {
      let paths: string[] = []
      /* 이 스캔의 이름. Rust가 이 이름으로 엔진의 stdin을 붙잡아 둔다.
         스캔마다 새로 만든다 — 지난 스캔의 이름으로 세우면 엉뚱한 걸 세운다. */
      const job = `scan-${Date.now()}`
      const stopScan = () => cancelEngine(job)
      if (pickFolder) {
        const path = await TAURI.dialog.open({ directory: true, title: '정리할 폴더 고르기' })
        if (!path) { $('status').textContent = ''; return }
        scannedPath = path as string
        paths = [scannedPath]
        stopTicker = startTicker('분석 중', stopScan)
      } else {
        scannedPath = null // 기본 스캔은 여러 곳이라 경로 하나로 특정되지 않는다
        stopTicker = startTicker(await describeDefaultRoots(), stopScan)
      }
      report = (await engine('scan-plan', paths, job)) as Report
      stopTicker(); stopTicker = null
      $('status').textContent =
        `${report.scannedFiles.toLocaleString()}개 · ${Math.round(report.elapsedMs / 1000)}초` +
        (report.roots?.length ? ` · ${report.roots.length}곳` : '') +
        // 덜 훑었으면 숫자 옆에 바로 붙인다. 아래 안내만으로는 이 줄이 거짓말이 된다.
        (report.stoppedBy === 'cancel' ? ' · 여기까지만 훑었어요' : '')
    } else {
      $('status').textContent = '읽는 중...'
      const dir = await pickDirectory()
      if (!dir) { $('status').textContent = ''; return }
      const scanned = await scanHandle(dir, (n) => { $('status').textContent = `읽는 중... ${n.toLocaleString()}개` })
      report = buildBrowserReport(scanned.files, Math.round(scanned.elapsedMs))
      $('status').textContent = `${scanned.files.length.toLocaleString()}개 · ${fmtBytes(scanned.totalBytes)} · ${Math.round(scanned.elapsedMs)}ms`
    }
    ;($('results') as HTMLElement).hidden = false
    renderReport(report)
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (err) {
    $('status').textContent = `문제가 있었어요: ${errText(err)}`
  } finally {
    stopTicker?.()
    ;($('oneclick') as HTMLButtonElement).disabled = false
  }
}

// ★ 화살표로 감싼다. addEventListener는 이벤트 객체를 첫 인자로 넘기는데,
//   그게 pickFolder 자리에 들어가면 항상 truthy가 돼서 기본 스캔이 사라진다.
$('oneclick').addEventListener('click', () => runScan(false))
$('pick2').addEventListener('click', () => runScan(true))

/* ── 정리 실행 ─────────────────────────────────────────────────
   ★ 이 버튼은 **실제로 지운다.** 전에는 보관함으로 옮기고 멈췄는데,
     보관함은 같은 드라이브에 있어서 용량이 1바이트도 안 줬다. "지금 정리 가능
     7.0GB"를 보고 누른 사람에게 "용량은 아직 그대로입니다"가 뜨는 화면이었다.
     두 번 같은 항의를 들었고, 두 번 다 맞는 말이었다. 그래서 보관은 없앴다. */
$('apply-btn').addEventListener('click', async () => {
  if (!inTauri) {
    toast('실제 정리는 데스크톱 앱에서 실행됩니다. 브라우저는 보안상 파일을 지울 수 없어요.', 'bad')
    return
  }
  const btn = $('apply-btn') as HTMLButtonElement
  btn.disabled = true; btn.textContent = '지우는 중...'
  const stopSweepTicker = startSweepTicker()
  try {
    // 경로가 없으면(기본 스캔) 엔진이 같은 기본 목록을 다시 씁니다 — 방금 본 그 범위.
    const res = await engine('apply-sweep', scannedPath ? [scannedPath] : [])
    const skipped = res.failed.length ? ` (${res.failed.length}개는 사용 중이라 건너뜀)` : ''
    const left = leftoverNote(res.leftover)
    $('apply-note').innerHTML =
      `<b style="color:var(--safe)">${res.deletedCount.toLocaleString()}개를 지웠어요 — ` +
      `${fmtBytes(res.deletedBytes)}가 지금 비었습니다.</b>${skipped}` +
      `<div class="t-small" style="color:var(--muted);margin-top:6px">` +
      `규칙으로 확인한 임시 파일·기록만 지웠어요. 애매한 건 아래에서 물어봅니다.</div>` +
      (left ? `<div class="t-small" style="color:var(--muted);margin-top:6px">${left}</div>` : '')
    btn.textContent = '정리 완료'
    quarLoaded = false // '되돌리기' 화면을 다시 읽어야 한다
    refreshDisk(true)
  } catch (err) {
    $('apply-note').textContent = `정리 실패: ${errText(err)}`
    btn.disabled = false; btn.textContent = '다시 시도'
  } finally {
    stopSweepTicker()
  }
})

/**
 * 지우는 동안 무슨 일이 벌어지는지 말한다 — 여기가 통째로 조용했다.
 *
 * ★ 전에는 버튼이 "지우는 중…"으로 바뀌는 게 전부였다. 그 뒤로 몇 분이 흘러도
 *   몇 개 중 몇 개인지, 얼마나 남았는지, 애초에 도는 중인지 알 방법이 없었다.
 *   게다가 그 몇 분의 대부분은 **방금 끝낸 스캔을 다시 하는 시간**이었다.
 *   이제 계획을 캐시에서 꺼내 쓰므로(engine-cli의 writePlanCache) 그 구간이
 *   통째로 사라졌고, 남은 진짜 작업만 숫자로 보여준다.
 *
 * 진행 상황이 안 오면(구버전 엔진) 예전처럼 경과 시간만 보여준다 —
 * 없는 진행률을 지어내지 않는다는 원칙은 그대로다.
 */
function startSweepTicker(): () => void {
  const started = Date.now()
  lastSweep = null
  let shownPct = 0
  const note = $('apply-note')

  const paint = () => {
    const elapsed = fmtDuration((Date.now() - started) / 1000)
    const s = lastSweep

    if (!s) {
      note.textContent = `지울 목록을 확인하는 중 · 경과 ${elapsed}`
      return
    }
    if (s.t === 'sweep-plan') {
      note.textContent = s.cached
        ? `방금 만든 계획을 그대로 씁니다 — ${(s.total ?? 0).toLocaleString()}개 · 다시 훑지 않아요`
        : `지울 목록을 다시 만드는 중 · 경과 ${elapsed}`
      return
    }

    shownPct = Math.max(shownPct, s.pct ?? 0)
    const parts = [`${shownPct}%`]
    if (s.total) parts.push(`${(s.done ?? 0).toLocaleString()} / ${s.total.toLocaleString()}개`)
    if (s.bytes) parts.push(`${fmtBytes(s.bytes)} 비움`)
    parts.push(`경과 ${elapsed}`)
    if (s.etaSec !== null && s.etaSec !== undefined) parts.push(`남은 시간 약 ${fmtDuration(s.etaSec)}`)
    note.textContent = `지우는 중 · ${parts.join(' · ')}`
  }

  paint()
  const timer = setInterval(paint, 500)
  return () => { clearInterval(timer); lastSweep = null }
}

/**
 * 끝났다는 걸 눈에 보이게 — **버튼 글씨만 바꾸면 아무도 못 알아본다.**
 *
 * ★ 실물 화면에서 이렇게 끝났다: 눌렀던 버튼이 회색으로 바뀌고 글씨가
 *   "2,380개를 정리했어요"가 됐다. 버튼 모양 그대로라 **아직 처리 중인 것처럼**
 *   읽혔고, 사용자는 "다 된 건가?"를 물어야 했다. 완료는 버튼이 아니라
 *   **칸**으로 보여야 한다 — 초록 줄, ✓ 표시, 그리고 다음에 뭘 하면 되는지.
 *
 * @param title 한 줄로 무엇이 끝났나 ("정리 완료 — 2,380개")
 * @param lines 숫자·조건 같은 나머지 사실
 */
function doneBlock(title: string, lines: (string | false | undefined)[]): string {
  return `<div class="pick-done">
    <div class="pick-done-h">✓ ${title}</div>
    ${lines.filter(Boolean).map((l) => `<div class="t-caption">${l}</div>`).join('')}
  </div>`
}

/**
 * 옮기긴 했는데 못 지운 것을 말한다 — **없어진 척하지 않는다.**
 *
 * 지우기는 두 걸음이다: 안전하게 옮긴 뒤 지운다(engine-cli의 deleteNow).
 * 두 번째 걸음이 실패하는 경우가 있다 — 대개 다른 프로그램이 파일을 잡고 있을
 * 때다. 그 파일은 원래 자리에 없고 용량도 그대로인데 화면이 "다 지웠다"고 하면
 * 사용자는 그 몇 개가 어디로 갔는지 영영 모른다. 개수를 말하고, 그것만 모아둔
 * '되돌리기' 화면으로 안내한다.
 */
function leftoverNote(leftover: number): string {
  if (!leftover || leftover <= 0) return ''
  return `${leftover.toLocaleString()}개는 다른 프로그램이 쓰고 있어서 못 지웠어요 —
    '되돌리기' 화면에서 다시 지우거나 원래 자리로 되돌릴 수 있습니다.`
}

/* ── 숨은 공간 (데스크톱: 실측) ─────────────────────────────── */
async function loadHidden() {
  const card = $('hiber-card')
  const stop = startPanel(card, 'probe', '이 PC를 확인하는 중')
  try {
    const data = await engine('probe')
    stop()
    if (!data.findings.length) { card.innerHTML = `<div class="empty"><svg class="ic"><use href="#i-check"/></svg><b>회수할 숨은 공간이 없어요</b><span>최대절전 파일·휴지통·업데이트가 남긴 파일 모두 깔끔합니다.</span></div>`; return }
    card.innerHTML = data.findings.map((f: any, i: number) => explainCard(f, i)).join('')
    wireAssists(card, data.findings)
  } catch (err) {
    card.innerHTML = `<div class="note">숨은 공간을 확인하지 못했어요: ${esc(errText(err))}</div>`
  } finally {
    stop()
  }
}

/**
 * 사실 카드 — 숫자가 먼저다
 *
 * ★ 2026-08-20 재설계. 여기는 원래 여섯 블록이 **전부 펼쳐진** 자리였다.
 *   "이게 뭔가요 / 왜 이렇게 큰가요 / 뭐가 이걸 쓰나요 / 지우면 뭐가
 *   달라지나요 / 되돌릴 수 있나요 / 안 지우면요" — 12px 청록 라벨 여섯 개가
 *   세로로 서 있고, 정작 사용자가 이 화면에 온 이유인 69.8GB는 오른쪽 구석에
 *   23px로 붙어 있었다. 읽을 것을 하나도 못 고른 화면이다.
 *
 *   순서를 뒤집는다. 언제나 보이는 것은 **결정에 필요한 것**뿐이다:
 *     얼마나(숫자) → 무엇을(이름) → 이게 뭔지 → ★위험 → 할 수 있는 것
 *   나머지 배경 설명은 접는다. 접는 게 숨기는 것이 되지 않도록,
 *   **★가 붙은 줄은 절대 접지 않는다** — 엔진이 "이건 반드시 읽혀야 한다"고
 *   붙인 표시이고(노트북 빠른 시작, 리눅스 환경이 통째로 사라짐 …),
 *   접힌 채로 안 읽히면 안 쓴 것과 같기 때문이다.
 */
function explainCard(f: any, index: number): string {
  const e = f.explain
  const gb = (n: number) => (n / 1073741824).toFixed(1) + 'GB'
  const li = (arr: string[]) => `<ul>${arr.map((x) => `<li>${esc(x.replace(/^★\s*/, ''))}</li>`).join('')}</ul>`
  const blk = (h: string, body: string) => `<div><span class="h">${h}</span>${body}</div>`

  const risks = (e.ifRemoved ?? []).filter((x: string) => x.includes('★'))
  const rest = (e.ifRemoved ?? []).filter((x: string) => !x.includes('★'))

  /* 실행 줄. 항목마다 우리가 할 수 있는 게 다르다 —
     되돌리는 명령이 있으면 우리가 실행(SystemAction),
     권한이 없어 못 잰 것이면 권한을 받아 재기(MeasureAction),
     그것도 아니면 정식 도구(assist),
     전부 없으면 아직 안전한 경로를 모르는 것이므로 솔직히 그렇게 쓴다.

     ★ measure가 assist보다 앞이다. 못 잰 항목에서 사용자가 할 일은
       '설정 창을 열어 직접 읽고 오기'가 아니라 '재달라고 하기'다. */
  const foot = f.action?.run
    ? `<button class="btn" data-run="${index}">${esc(f.action.describe)}</button>
       <span class="why">관리자 확인 창이 한 번 뜹니다 · 되돌리기: ${esc(f.action.undoDescribe)}</span>`
    : f.measure?.run
      ? `<button class="btn" data-measure="${index}">${esc(f.measure.label)}</button>
         ${f.assist ? `<button class="btn ghost" data-assist="${index}">${esc(f.assist.label)}</button>` : ''}
         <span class="why">${esc(f.measure.note)}</span>`
      : f.assist
        ? `<button class="btn${f.assist.irreversible ? '' : ' ghost'}" data-assist="${index}">${esc(f.assist.label)}</button>
           <span class="why">${esc(f.assist.note)}</span>`
        : `<span class="pill desk">아직 안전하게 실행할 방법을 몰라서, 알려만 드립니다</span>`

  return `
    <div class="fact">
      <span class="fact-n${f.bytes ? '' : ' unknown'}">${
        // ★ 못 잰 것에 0GB라고 쓰지 않는다. "없다"와 "못 봤다"는 다른 말이다.
        f.bytes ? gb(f.bytes) : '확인 필요'
      }</span>
      <div class="fact-t">${esc(f.title)}</div>
      <p class="fact-p">${esc(e.what)}</p>
      <p class="fact-p">${esc(e.why)}</p>
      ${risks.length ? `<div class="fact-risk">${li(risks)}</div>` : ''}
      <details class="more">
        <summary>뭐가 쓰는지 · 되돌리기 · 안 지우면</summary>
        <div class="more-b">
          ${blk('뭐가 이걸 쓰나요', li(e.usedBy))}
          ${rest.length ? blk('지우면 뭐가 달라지나요', li(rest)) : ''}
          ${blk('되돌릴 수 있나요', `<p>${esc(e.recoveryNote)}</p>`)}
          ${blk('안 지우면요', `<p>${esc(e.ifKept)}</p>`)}
        </div>
      </details>
      <div class="fact-act">${foot}</div>
    </div>`
}

/**
 * assist 실행 — 되돌릴 수 없는 것은 반드시 개별 확인을 받는다.
 * (프로그램 제거와 같은 원칙: 되돌릴 수 없는 동작에 일괄 버튼을 만들지 않는다)
 */
function wireAssists(host: HTMLElement, findings: any[]) {
  /* 우리가 직접 실행하는 것 — 되돌릴 수 있는 것만 여기 온다.
     끝나면 **실제로 얼마가 비었는지 다시 재서** 말한다. "했습니다"만 말하지 않는다. */
  host.querySelectorAll<HTMLButtonElement>('[data-run]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const f = findings[+btn.dataset.run!]
      const a = f.action
      if (!confirm(`${a.describe}\n\n${a.command}\n\n관리자 확인 창이 뜹니다.\n되돌리려면: ${a.undoDescribe}\n\n계속할까요?`)) return
      btn.disabled = true
      const before = btn.textContent
      btn.textContent = '실행 중… (관리자 확인 창을 확인해 주세요)'
      try {
        const r = await engine(a.run)
        const box = btn.parentElement as HTMLElement

        /* ★ 무엇이 끝났는지는 엔진이 말한다(r.done).
           화면이 제 나름대로 "X가 비었습니다"를 지으면 안 되는 경우가 있다 —
           가상 메모리는 **재시작하기 전까지 한 바이트도 안 빈다.** 그 자리에
           "31.3GB가 비었습니다"를 띄우면 v0.16.0("58.86GB를 아낄 수 있어요"라고
           해놓고 0바이트였다)을 그대로 다시 하는 것이다. */
        const title = r.done ?? `완료 — ${fmtBytes(r.freedBytes || f.bytes)}가 비었습니다`
        box.innerHTML = doneBlock(title, [
          ...(r.notes ?? []).map((n: string) => esc(n)),
          r.notes ? '' : `되돌리려면: ${esc(a.undoDescribe)}`,
          r.bytesNow ? `아직 ${fmtBytes(r.bytesNow)}가 남아 있어요 — 윈도우가 정리하는 데 잠깐 걸릴 수 있습니다.` : '',
        ])

        /* 되돌리기를 **누를 수 있게** 둔다. 여태는 "되돌리려면: …"이라고 글로만
           적어놨는데, 그건 되돌릴 수 있다는 말이지 되돌릴 방법은 아니다. */
        if (a.undoRun) {
          const undo = document.createElement('button')
          undo.className = 'btn ghost'
          undo.style.marginTop = '12px'
          undo.textContent = `되돌리기 — ${a.undoDescribe}`
          undo.addEventListener('click', async () => {
            undo.disabled = true
            undo.textContent = '되돌리는 중… (관리자 확인 창을 확인해 주세요)'
            try {
              const u = await engine(a.undoRun)
              box.innerHTML = doneBlock(u.done ?? '되돌렸어요', (u.notes ?? []).map((n: string) => esc(n)))
              toast(u.done ?? '되돌렸어요.', 'good')
              hiddenLoaded = false
            } catch (err) {
              toast(errText(err), 'bad')
              undo.disabled = false
              undo.textContent = `되돌리기 — ${a.undoDescribe}`
            }
          })
          box.appendChild(undo)
        }

        toast(title, 'good')
        hiddenLoaded = false
        // 재시작해야 반영되는 것은 지금 다시 재봐야 그대로다 — 괜히 안 재운다.
        if (!r.needsRestart) refreshDisk(true)
      } catch (err) {
        toast(errText(err), 'bad')
        btn.disabled = false
        btn.textContent = before
      }
    })
  })

  /* 권한을 받아 다시 재기 — 읽기만 한다.
     ★ 다 끝나고 화면을 통째로 새로고침하면 안 된다. 새로고침은 probe를 다시
       부르는데 그건 권한 없이 도는 통로라, 방금 잰 값이 도로 "확인 필요"가 된다.
       그래서 그 카드 하나만 갈아끼운다. */
  host.querySelectorAll<HTMLButtonElement>('[data-measure]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const i = +btn.dataset.measure!
      const f = findings[i]
      btn.disabled = true
      const before = btn.textContent
      btn.textContent = '관리자 확인 창을 확인해 주세요…'
      try {
        const r = await engine(f.measure.run)
        const card = btn.closest('.fact') as HTMLElement | null
        if (r.finding && card) {
          findings[i] = r.finding
          const box = document.createElement('div')
          box.innerHTML = explainCard(r.finding, i)
          const fresh = box.firstElementChild as HTMLElement
          card.replaceWith(fresh)
          // 새로 그린 카드 안쪽만 다시 배선한다 — host 전체를 다시 걸면 나머지 카드에
          // 같은 처리기가 한 겹 더 쌓여 한 번 누른 게 두 번 실행된다.
          wireAssists(fresh, findings)
          toast(`재봤어요 — ${fmtBytes(r.allocatedBytes)}가 잡혀 있습니다.`, 'good')
        } else {
          // 재보니 항목으로 낼 만큼 크지 않은 경우. 그래도 숫자는 알려준다 —
          // "재달라"고 눌렀는데 아무 답이 없으면 안 잰 것과 구별이 안 된다.
          const p = document.createElement('p')
          p.className = 'fact-p'
          p.textContent = `재봤어요 — 지금 ${fmtBytes(r.usedBytes)}를 쓰고 있고 ` +
            `${fmtBytes(r.allocatedBytes)}가 잡혀 있습니다. 정리할 만큼은 아니에요.`
          btn.parentElement?.replaceWith(p)
        }
      } catch (err) {
        toast(errText(err), 'bad')
        btn.disabled = false
        btn.textContent = before
      }
    })
  })

  host.querySelectorAll<HTMLButtonElement>('[data-assist]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const f = findings[+btn.dataset.assist!]
      const a = f.assist
      if (a.irreversible && !confirm(`${a.label}\n\n${a.note}\n\n계속할까요?`)) return
      btn.disabled = true
      const before = btn.textContent
      btn.textContent = '실행 중…'
      try {
        const r = await engine(a.command)
        btn.textContent = a.command === 'empty-recycle-bin'
          ? `비웠어요 — ${fmtBytes(r.freedBytes)} 확보`
          : '열었어요'
        if (a.command === 'empty-recycle-bin') { hiddenLoaded = false; loadHidden() }
      } catch (err) {
        toast('실행하지 못했어요: ' + errText(err), 'bad')
        btn.disabled = false
        btn.textContent = before
      }
    })
  })
}

/* ── 생활 정리 ─────────────────────────────────────────────────
   PC 밖의 정리. 파일을 안 건드리므로 브라우저에서도 그대로 돈다 —
   데스크톱은 앱 데이터 폴더에, 브라우저는 localStorage에 기록한다.
   판단(오늘 뭘 할 때가 됐나)은 양쪽 다 같은 순수 함수를 쓴다. */
const TIDY_KEY = 'teraclean.tidy'

/** 콘텐츠 항목 → 앱이 실제로 실행할 수 있는 폴더. 임의 경로는 받지 않는다. */
const FOLDER_ACTION: Record<string, string> = {
  'desktop-icons': 'desktop',
  downloads: 'downloads',
  photos: 'photos', // 폴더 이동이 아니라 사진 전용 흐름
}

/**
 * 사진 정리 — 스크린샷과 '내용이 완전히 같은 사본'만.
 * 비슷한 사진 고르기는 하지 않는다. 잘못 고르면 되돌릴 수 없는 손해다.
 */
async function photosFlow(host: HTMLElement) {
  const stop = startPanel(host, 'photos-plan', '사진을 확인하는 중 (수천 장이면 몇 분 걸릴 수 있어요)', true)
  try {
    const p = await engine('photos-plan')
    stop()
    if (!p.screenshotCount && !p.dupGroupCount) {
      host.innerHTML = `<div class="t-small" style="color:var(--safe);margin-top:10px">
        사진 ${p.scanned.toLocaleString()}장을 봤는데 정리할 게 없어요. 이미 깔끔합니다.</div>`
      return
    }

    const dupPreview = p.dupGroups.slice(0, 3).map((g: any) =>
      `<div class="t-small" style="color:var(--ink-2);padding:2px 0">
        · 남길 것 <b>${esc(g.keeper.name)}</b> — ${esc(g.keeperReason)} (사본 ${g.copies.length}장)</div>`).join('')

    host.innerHTML = `
      <div style="border:1px solid var(--line);border-radius:8px;padding:12px;margin-top:10px;background:var(--surface-2)">
        <div class="t-small" style="color:var(--muted)">사진 ${p.scanned.toLocaleString()}장을 봤어요</div>
        ${p.screenshotCount ? `<div class="t-small" style="font-weight:var(--w-em);margin-top:6px">
          오래된 스크린샷 ${p.screenshotCount.toLocaleString()}장 · ${fmtBytes(p.screenshotBytes)}</div>
          <div class="t-small" style="color:var(--muted)">최근 ${p.recentScreenshots}장은 아직 쓰실 수 있어 그대로 둡니다.
            정리 폴더로 옮기기만 해요.</div>` : ''}
        ${p.dupGroupCount ? `<div class="t-small" style="font-weight:var(--w-em);margin-top:8px">
          같은 사진이 여러 벌 — ${p.dupGroupCount.toLocaleString()}묶음 · ${fmtBytes(p.dupBytes)}</div>
          <div class="t-small" style="color:var(--muted)">원본은 그대로 두고 사본만 지웁니다 — 되돌릴 수 없어요. 남는 건 원본입니다.</div>
          <div style="margin-top:6px">${dupPreview}</div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          ${p.screenshotCount ? `<button class="btn" data-photos="screenshots">스크린샷 정리</button>` : ''}
          ${p.dupGroupCount ? `<button class="btn ghost" data-photos="duplicates">중복 사본만 정리</button>` : ''}
        </div>
        <div class="t-small" style="color:var(--muted);margin-top:8px">
          일반 사진은 아무리 오래돼도 건드리지 않습니다.</div>
      </div>`

    host.querySelectorAll<HTMLButtonElement>('[data-photos]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const what = btn.dataset.photos!
        host.querySelectorAll<HTMLButtonElement>('[data-photos]').forEach((b) => (b.disabled = true))
        btn.textContent = '정리 중…'
        try {
          const r = await engine('photos-apply', [what])
          host.innerHTML = `<div style="border:1px solid var(--line);border-left:3px solid var(--safe);
                border-radius:8px;padding:12px;margin-top:10px;background:var(--surface)">
            <div class="t-small" style="font-weight:var(--w-em);color:var(--safe)">정리했어요</div>
            <div class="t-small" style="color:var(--ink-2);margin-top:4px">
              ${r.movedCount ? `스크린샷 ${r.movedCount.toLocaleString()}장을 ${esc(r.destFolder)}로 옮겼어요.<br>` : ''}
              ${r.deletedCount ? `중복 사본 ${r.deletedCount.toLocaleString()}장(${fmtBytes(r.deletedBytes)})을 지웠어요 — 원본은 그대로 있습니다.<br>` : ''}
              ${r.failed.length ? `${r.failed.length}장은 사용 중이라 건너뛰었습니다.` : ''}</div>
          </div>`
        } catch (err) {
          host.innerHTML = `<div class="note" style="margin-top:10px">정리하지 못했어요: ${esc(errText(err))}</div>`
        }
      })
    })
  } catch (err) {
    host.innerHTML = `<div class="note" style="margin-top:10px">확인하지 못했어요: ${esc(errText(err))}</div>`
  } finally {
    stop()
  }
}

/**
 * 콘텐츠의 단계를 앱이 실행한다 — 단, 미리보기가 먼저다.
 * "정리했습니다"라고 통보하는 도구가 되지 않으려면 이 순서를 지켜야 한다.
 */
async function tidyFolderFlow(target: string, host: HTMLElement) {
  const stop = startPanel(host, 'tidy-folder-plan', '무엇을 옮길지 확인하는 중', true)
  try {
    const p = await engine('tidy-folder-plan', [target])
    stop()
    if (!p.moveCount && !p.broken.length) {
      host.innerHTML = `<div class="t-small" style="color:var(--safe);margin-top:10px">
        이미 정리돼 있어요. 옮길 게 없습니다.</div>`
      return
    }

    const list = p.moves.slice(0, 8).map((m: any) =>
      `<div class="t-small" style="color:var(--ink-2);padding:2px 0">· ${esc(m.name)}</div>`).join('')

    host.innerHTML = `
      <div style="border:1px solid var(--line);border-radius:8px;padding:12px;margin-top:10px;background:var(--surface-2)">
        <div class="t-small" style="font-weight:var(--w-em)">${p.moveCount.toLocaleString()}개를 옮길게요
          ${p.bytes ? `<span style="color:var(--muted);font-weight:var(--w-text)">· ${fmtBytes(p.bytes)}</span>` : ''}</div>
        <div class="t-small" style="color:var(--muted);margin-top:2px">
          → ${esc(p.destFolder)}<br>최근 ${p.keepCount}개는 작업 중으로 보고 그대로 둡니다.
          ${p.broken.length ? `<br>대상이 사라진 바로가기 ${p.broken.length}개는 지웁니다 — 가리키던 파일이 이미 없어서 눌러도 안 열리는 것들이에요.` : ''}
        </div>
        <div style="margin-top:8px">${list}${p.moveCount > 8 ? `<div class="t-small" style="color:var(--muted)">…외 ${p.moveCount - 8}개</div>` : ''}</div>
        <button class="btn" data-tidyapply="${esc(target)}" style="margin-top:10px">옮기기</button>
        <span class="t-small" style="color:var(--muted);margin-left:8px">지우지 않습니다. 언제든 되돌릴 수 있어요.</span>
      </div>`

    host.querySelector<HTMLButtonElement>('[data-tidyapply]')!.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement
      btn.disabled = true
      btn.textContent = '옮기는 중…'
      try {
        const r = await engine('tidy-folder-apply', [target])
        host.innerHTML = `<div style="border:1px solid var(--line);border-left:3px solid var(--safe);
              border-radius:8px;padding:12px;margin-top:10px;background:var(--surface)">
          <div class="t-small" style="font-weight:var(--w-em);color:var(--safe)">${r.movedCount.toLocaleString()}개를 옮겼어요</div>
          <div class="t-small" style="color:var(--muted);margin-top:3px">
            ${esc(r.destFolder)}<br>
            ${r.brokenDeleted ? `대상이 사라진 바로가기 ${r.brokenDeleted}개는 지웠어요. ` : ''}
            ${r.failed.length ? `${r.failed.length}개는 사용 중이라 건너뛰었습니다.` : ''}</div>
          <button class="opt" data-tidyundo="${esc(target)}" style="margin-top:10px">되돌리기</button>
        </div>`
        host.querySelector<HTMLButtonElement>('[data-tidyundo]')!.addEventListener('click', async (e2) => {
          const ub = e2.currentTarget as HTMLButtonElement
          ub.disabled = true
          const back = await engine('tidy-folder-undo', [target])
          ub.textContent = `${back.restoredCount.toLocaleString()}개를 원래 자리로 되돌렸어요`
        })
      } catch (err) {
        host.innerHTML = `<div class="note" style="margin-top:10px">옮기지 못했어요: ${esc(errText(err))}</div>`
      }
    })
  } catch (err) {
    host.innerHTML = `<div class="note" style="margin-top:10px">확인하지 못했어요: ${esc(errText(err))}</div>`
  } finally {
    stop()
  }
}

function readLocalTidy(): TidyState {
  try {
    const raw = localStorage.getItem(TIDY_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed.done === 'object' ? parsed : emptyState()
  } catch {
    return emptyState()
  }
}

async function tidyPlan(mark?: { id: string; done: boolean }) {
  if (inTauri) {
    if (!mark) return engine('tidy-list')
    return engine(mark.done ? 'tidy-done' : 'tidy-undo', [mark.id])
  }
  const today = todayISO()
  let state = readLocalTidy()
  if (mark) {
    state = mark.done ? markDone(state, mark.id, today) : undoDone(state, mark.id, today)
    try { localStorage.setItem(TIDY_KEY, JSON.stringify(state)) } catch { /* 사생활 모드 등 — 기록만 안 남는다 */ }
  }
  return { today, ...planToday(state, today), total: ROUTINES.length, habit: habitStats(state, today) }
}

/**
 * 습관 기록 — "얼마나 잘하고 있나"를 보여주는 자리.
 *
 * ★ 이 블록에 없는 것들이 설계다.
 *   빨간색이 없다. "며칠 밀렸어요"가 없다. 연속 기록이 끊길까 봐 겁주는 문구도
 *   없다. 정리는 시험이 아니라 살림이고, 살림은 하루 거르는 날이 있다.
 *
 *   대신 셋을 보여준다 — 지금까지 몇 번 했는지(등급), 최근 이레 중 어느 날
 *   했는지(점 일곱 개), 다음 단계까지 몇 번인지. 셋 다 **셀 수 있는 것**이다.
 *   "연구에 따르면 습관은 21일" 같은 지어낸 수치는 여기에도 안 쓴다.
 */
function habitHtml(h: any): string {
  if (!h) return ''
  if (!h.doneTotal) {
    return `<div class="hb">
      <div class="hb-t">아직 기록이 없어요</div>
      <div class="t-small" style="color:var(--muted)">아래에서 하나만 눌러보세요. 오늘부터 세어드릴게요.</div>
    </div>`
  }
  const dots = h.days7
    .map((d: any) => `<i class="${d.count ? 'on' : ''}" title="${esc(d.date)}${d.count ? ` · ${d.count}개` : ''}"></i>`)
    .join('')
  const runLine = h.currentDays > 0
    ? `<b>${h.currentDays}일째</b> 이어가는 중` +
      (h.bestDays > h.currentDays ? ` · 가장 길었던 건 ${h.bestDays}일` : '')
    // ★ 쉬었다고 나무라지 않는다. 그냥 기록을 말하고 다시 시작할 수 있다고 한다.
    : `가장 길었던 건 <b>${h.bestDays}일</b> · 오늘 하나 하면 다시 시작돼요`

  return `<div class="hb">
    <div class="hb-h">
      <span class="hb-t">${esc(h.rank.name)}</span>
      <span class="t-small" style="color:var(--muted);margin-left:auto">지금까지 ${h.doneTotal.toLocaleString()}번</span>
    </div>
    <div class="hb-week"><span class="hb-dots">${dots}</span><span class="t-micro" style="color:var(--faint)">최근 7일</span></div>
    <div class="t-small" style="color:var(--ink-2)">${runLine}</div>
    ${h.next ? `<div class="t-small" style="color:var(--muted)">${h.next.remain}번 더 하면 '${esc(h.next.name)}'</div>` : ''}
  </div>`
}

async function loadTidy(mark?: { id: string; done: boolean }) {
  const host = $('tidy-body')
  const d = await tidyPlan(mark)

  const card = (r: any, state: 'due' | 'later' | 'done') => {
    const meta = state === 'later'
      ? `${r.daysUntil}일 뒤`
      : state === 'done'
        ? '오늘 완료'
        : r.daysLate === null ? '아직 안 해봄' : r.daysLate > 0 ? `${r.daysLate}일 지남` : '오늘'
    const border = state === 'done' ? 'var(--safe)' : state === 'due' ? 'var(--accent)' : 'var(--line-2)'
    return `<div style="border:1px solid var(--line);border-left:3px solid ${border};border-radius:10px;
                        background:var(--surface);padding:14px;margin-top:10px">
      <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
        <b class="t-lead">${esc(r.title)}</b>
        <span class="t-micro" style="color:var(--accent);font-weight:var(--w-head)">${esc(CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL])}</span>
        <span class="t-small" style="color:var(--muted)">${r.minutes}분 · ${meta}</span>
        ${r.streak > 1 ? `<span class="t-small" style="color:var(--safe);font-weight:var(--w-head)">${r.streak}회 연속</span>` : ''}
        <button class="opt" data-tidy="${esc(r.id)}" data-done="${state === 'done' ? '0' : '1'}"
                style="margin-left:auto">${state === 'done' ? '되돌리기' : '했어요'}</button>
      </div>
      <div class="t-small" style="color:var(--ink-2);margin-top:8px;line-height:1.6">${esc(r.why)}</div>
      <details style="margin-top:8px">
        <summary class="t-small" style="cursor:pointer;color:var(--muted)">이렇게 하면 됩니다</summary>
        <ol class="t-small" style="margin:8px 0 0;padding-left:20px;color:var(--ink-2);line-height:1.7">
          ${r.steps.map((s: string) => `<li>${esc(s)}</li>`).join('')}
        </ol>
        ${r.tip ? `<div class="t-small" style="color:var(--muted);margin-top:8px">막히는 지점: ${esc(r.tip)}</div>` : ''}
        ${FOLDER_ACTION[r.id] && inTauri
          ? `<button class="opt" data-tidyfolder="${FOLDER_ACTION[r.id]}" style="margin-top:10px">이건 앱이 대신 해드릴게요 — 먼저 보여드릴게요</button>
             <div data-plan="${FOLDER_ACTION[r.id]}"></div>`
          : r.appTab ? `<button class="opt" data-goto="${esc(r.appTab)}" style="margin-top:10px">이건 앱이 대신 해드릴게요 →</button>` : ''}
      </details>
    </div>`
  }

  const byId = new Map(ROUTINES.map((r) => [r.id, r]))
  const doneCards = d.doneToday.map((id: string) => card({ ...byId.get(id), streak: 0 }, 'done')).join('')

  host.innerHTML = `
    ${habitHtml(d.habit)}
    <div style="display:flex;align-items:baseline;gap:10px;margin:16px 0 4px;flex-wrap:wrap">
      <h2 class="t-title" style="font-weight:var(--w-num)">오늘 할 것 ${d.due.length}개</h2>
      <span class="t-small" style="margin-left:auto;color:var(--muted)">
        오늘 완료 ${d.doneToday.length}개 · 전체 ${d.total}개</span>
    </div>
    ${d.due.length
      ? d.due.map((r: any) => card(r, 'due')).join('')
      : '<div class="empty">오늘 할 건 다 하셨어요. 더 안 하셔도 됩니다.</div>'}
    ${d.doneToday.length ? `<details open style="margin-top:16px">
      <summary class="t-small" style="cursor:pointer;color:var(--safe);font-weight:var(--w-ui)">오늘 끝낸 ${d.doneToday.length}개</summary>
      ${doneCards}</details>` : ''}
    ${d.later.length ? `<details style="margin-top:12px">
      <summary class="t-small" style="cursor:pointer;color:var(--muted)">아직 때가 아닌 ${d.later.length}개</summary>
      ${d.later.map((r: any) => card(r, 'later')).join('')}</details>` : ''}
    <p class="note" style="margin-top:14px">기록은 이 컴퓨터에만 있습니다.
      <b>못 한 날을 세지 않습니다</b> — 며칠 걸러도 연속 기록은 이어집니다.</p>
    <div id="referral"></div>`

  renderReferral(d)

  host.querySelectorAll<HTMLButtonElement>('[data-tidy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.disabled = true
      loadTidy({ id: btn.dataset.tidy!, done: btn.dataset.done === '1' })
    })
  })
  host.querySelectorAll<HTMLButtonElement>('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => go(btn.dataset.goto!))
  })
  host.querySelectorAll<HTMLButtonElement>('[data-tidyfolder]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tidyfolder!
      btn.disabled = true
      const panel = host.querySelector<HTMLElement>(`[data-plan="${target}"]`)
      if (!panel) return
      if (target === 'photos') photosFlow(panel)
      else tidyFolderFlow(target, panel)
    })
  })
}

/* ── 업체 연결 ─────────────────────────────────────────────────
   이 제품의 수익 모델이지만, 화면에서는 마지막 단계여야 한다.
   먼저 들이밀면 그 순간 앱 전체가 광고판이 된다. 그래서:
     - 같은 정리를 세 번 넘게 건너뛴 신호가 있을 때만 카드가 뜬다
     - 우리가 대신 할 수 있는 것(바탕화면·사진)은 절대 연결하지 않는다
     - 수수료를 받는다는 것과 아직 제휴 업체가 없다는 것을 그대로 쓴다 */
function renderReferral(plan: any, askedByUser = false) {
  const host = document.getElementById('referral')
  if (!host) return

  const state = inTauri ? null : readLocalTidy()
  // 데스크톱은 엔진이 준 목록에서, 브라우저는 로컬 기록에서 신호를 만든다
  const stuck = state
    ? stuckRoutines(state, plan.today)
    : (plan.due ?? [])
        .filter((r: any) => r.daysLate !== null && r.daysLate >= r.everyDays * 2)
        .map((r: any) => ({ id: r.id, title: r.title, category: r.category, timesOverdue: 3 }))

  const suggestions = suggestServices({ stuck, askedByUser })

  if (!suggestions.length) {
    // 조용한 입구 하나만 남긴다. 권하지 않되 길은 열어둔다.
    host.innerHTML = `<div class="t-small" style="margin-top:16px;color:var(--muted)">
      혼자 하기 어려운 정리가 있으신가요?
      <button class="opt" id="ref-ask" style="margin-left:6px">사람 도움 알아보기</button></div>`
    document.getElementById('ref-ask')?.addEventListener('click', () => renderReferral(plan, true))
    return
  }

  host.innerHTML = `
    <div style="margin-top:18px;border:1px solid var(--line-2);border-radius:12px;padding:16px;background:var(--surface)">
      <div class="t-small" style="font-weight:var(--w-head);color:var(--accent)">사람이 하면 빠른 것</div>
      <h2 class="t-title" style="font-weight:var(--w-num);margin:6px 0 4px">여기부터는 혼자 하기 어려울 수 있어요</h2>
      <p class="t-small" style="color:var(--ink-2);line-height:1.6">
        아래는 기록을 보고 고른 것이고, <b style="color:var(--ink)">안 누르셔도 됩니다.</b></p>

      ${suggestions.map((s, i) => `
        <div style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px">
          <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
            <b class="t-body">${esc(s.service.label)}</b>
            <button class="opt" data-ref="${i}" style="margin-left:auto">문의 내용 만들기</button>
          </div>
          <div class="t-small" style="color:var(--muted);margin-top:4px">왜 보여드리나: ${esc(s.reason)}</div>
          <div class="t-small" style="color:var(--ink-2);margin-top:6px">${esc(s.service.whatTheyDo)}</div>
          <div class="t-small" style="color:var(--muted);margin-top:4px">언제 부르나: ${esc(s.service.when)}</div>
          <div class="t-small" style="color:var(--amb);margin-top:4px">비용: ${esc(s.service.priceNote)}</div>
          <div data-refform="${i}"></div>
        </div>`).join('')}

      <div class="t-small" style="border-top:1px solid var(--line);margin-top:14px;padding-top:12px;color:var(--muted);line-height:1.7">
        · ${esc(DISCLOSURE.fee)}<br>
        · ${esc(DISCLOSURE.status)}<br>
        · ${esc(DISCLOSURE.privacy)}<br>
        · ${esc(DISCLOSURE.optOut)}
      </div>
    </div>`

  host.querySelectorAll<HTMLButtonElement>('[data-ref]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.ref!
      const s = suggestions[i]
      const form = host.querySelector<HTMLElement>(`[data-refform="${i}"]`)!
      form.innerHTML = `
        <div style="margin-top:10px;background:var(--surface-2);border-radius:8px;padding:12px">
          <div class="t-small" style="color:var(--muted)">보낼 내용을 먼저 보여드릴게요. 확인하신 뒤에만 나갑니다.</div>
          <input id="ref-region-${i}" placeholder="지역 (예: 서울 강남구)" class="t-small" style="width:100%;margin-top:8px;padding:9px;
            border:1px solid var(--line-2);border-radius:7px;background:var(--surface);color:var(--ink)">
          <textarea id="ref-note-${i}" rows="2" placeholder="어떤 게 제일 급한지 (선택)" class="t-small" style="width:100%;margin-top:6px;padding:9px;
            border:1px solid var(--line-2);border-radius:7px;background:var(--surface);color:var(--ink)"></textarea>
          <input id="ref-contact-${i}" placeholder="연락 받으실 방법 (선택)" class="t-small" style="width:100%;margin-top:6px;padding:9px;
            border:1px solid var(--line-2);border-radius:7px;background:var(--surface);color:var(--ink)">
          <button class="btn" data-refmake="${i}" style="margin-top:8px">내용 확인하기</button>
          <div data-refout="${i}"></div>
        </div>`

      form.querySelector<HTMLButtonElement>(`[data-refmake="${i}"]`)!.addEventListener('click', () => {
        const outEl = form.querySelector<HTMLElement>(`[data-refout="${i}"]`)!
        const r = buildRequestSummary({
          serviceId: s.service.id,
          region: (document.getElementById(`ref-region-${i}`) as HTMLInputElement).value,
          note: (document.getElementById(`ref-note-${i}`) as HTMLTextAreaElement).value,
          contact: (document.getElementById(`ref-contact-${i}`) as HTMLInputElement).value,
        })
        if (!r.ok) {
          outEl.innerHTML = `<div class="note" style="margin-top:8px">${esc(r.problem!)}</div>`
          return
        }
        outEl.innerHTML = `
          <pre class="t-small" style="margin-top:8px;padding:10px;background:var(--surface);border:1px solid var(--line);
            border-radius:7px;white-space:pre-wrap;color:var(--ink-2)">${esc(r.text)}</pre>
          <button class="opt" data-refcopy="${i}">복사하기</button>
          <a class="opt" style="display:inline-block;text-decoration:none;margin-left:6px"
             href="https://github.com/lhs0609a-cpu/teraclean-releases/issues/new?title=%EC%A0%95%EB%A6%AC%20%EB%8F%84%EC%9B%80%20%EC%9A%94%EC%B2%AD"
             target="_blank" rel="noopener">요청 보내는 곳 열기</a>`
        outEl.querySelector<HTMLButtonElement>(`[data-refcopy="${i}"]`)!.addEventListener('click', (ev) => {
          navigator.clipboard?.writeText(r.text)
          ;(ev.currentTarget as HTMLButtonElement).textContent = '복사했어요'
        })
      })
    })
  })
}

/* ── 시작프로그램 ─────────────────────────────────────────────
   여기만 '삭제'가 아니라 '끄기'다. 지우는 게 아니라서 언제든 다시 켤 수 있다.
   대신 자동으로 꺼주는 항목은 하나도 없다 — 아침에 켰는데 카톡이 없으면
   그건 편의가 아니라 사고다. */
/** 예약작업 개수는 세는 데 오래 걸린다 — 한 번 받으면 세션 동안 다시 안 센다. */
let logonTaskCount: number | null = null

/**
 * @param quiet 화면을 지우지 않고 다시 읽는다.
 *   끄기를 누른 뒤에 쓴다. 전에는 여기서도 목록을 통째로 지우고 "읽는 중…"으로
 *   되돌렸는데, 그러면 스위치 하나 내릴 때마다 화면이 처음으로 돌아가고
 *   펼쳐둔 목록도 접혔다. 읽는 동안 이전 목록을 그대로 두는 게 맞다.
 */
async function loadStartup(quiet = false) {
  const host = $('startup-body')
  // quiet일 때는 이전 목록을 그대로 둔다(위 머리말) — 진행 표시도 띄우지 않는다.
  const stop = quiet ? () => {} : startPanel(host, 'startup', '시작프로그램을 읽는 중')
  try {
    const d = await engine('startup')
    stop()
    const entries: any[] = d.entries

    /**
     * ★ 버튼이 가리키는 번호는 **entries 기준**이어야 한다.
     *
     *   전에는 row(e, i)로 map의 두 번째 인자를 그대로 썼다. 그런데 아래에서
     *   suggest/others/off 세 묶음으로 걸러 각각 map을 돌리므로, i는 그 묶음 안에서
     *   0부터 다시 세어진다. 그래서 버튼이 **엉뚱한 항목을 껐다** — 제안 목록의
     *   첫 항목을 눌렀는데 전체 목록의 첫 항목이 꺼지는 식이다.
     *   실측에서 사용자가 누르지 않은 두 개(GVF-Node·AdPT-Agent)가 꺼졌다.
     *
     *   시작프로그램은 되돌리기가 즉시라 복구는 쉽지만, "내가 안 누른 게 꺼졌다"는
     *   이 앱이 절대 하면 안 되는 일이다. 그래서 번호를 짐작하지 않고 원본에서 찾는다.
     */
    const row = (e: any) => {
      const i = entries.indexOf(e)
      const v = e.verdict
      const tone = v.zone === 'LOCKED' ? 'var(--lock)' : v.suggestible ? 'var(--amb)' : 'var(--muted)'
      /* ★ 예전엔 모든 사용자용 항목에 "관리자 권한이 필요해요" 딱지만 붙어 있었다.
         알려주기만 하고 아무것도 못 하게 하는 건 안내가 아니라 떠넘기기다 — 사용자는
         그 다음에 뭘 해야 하는지 모른 채 작업관리자를 찾아가야 했다.
         이제 여기서 끈다. 대신 **누르기 전에** 확인 창이 뜬다고 말한다. */
      const label = e.enabled ? '끄기' : '다시 켜기'
      const btn = !e.canToggle
        ? `<span class="pill desk" style="margin-top:8px">이 항목은 저희가 끄지 못해요</span>`
        : `<button class="opt" data-toggle="${i}" style="margin-top:8px">${
            label}${e.needsAdmin ? ' (관리자 확인)' : ''}</button>${
            e.needsAdmin
              ? `<div class="t-small" style="color:var(--muted);margin-top:6px">모든 사용자용이라 윈도우 확인 창이 한 번 떠요. “예”를 누르면 여기서 바로 꺼집니다. 취소하면 아무것도 안 바뀌어요.</div>`
              : ''}`
      return `<div class="row">
        <div class="row-main">
          <div class="row-t">
            <b>${esc(e.name)}</b>
            <span style="font-size:var(--t-caption);color:${tone};font-weight:var(--w-head)">${esc(v.meaning)}</span>
            <span class="ver">${e.enabled ? '켜짐' : '꺼둠'}</span>
          </div>
          <div class="row-sub">${esc(v.reason)}</div>
          <div class="row-sub" style="color:var(--ink-2)">끄면: ${esc(v.ifDisabled)}</div>
          ${e.identity?.path
            ? `<div class="row-sub sig" data-sig="${esc(e.identity.path)}" hidden></div>`
            : ''}
          ${e.command ? `<div class="row-path">${esc(e.command)}</div>` : ''}
          ${btn}
        </div>
      </div>`
    }

    // 제안 → 나머지 켜짐 → 꺼둔 것 순. 판단이 선 것부터 보여준다.
    const suggest = entries.filter((e) => e.verdict.suggestible)
    const others = entries.filter((e) => !e.verdict.suggestible && e.enabled)
    const off = entries.filter((e) => !e.enabled)

    host.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:10px;margin:14px 0 4px;flex-wrap:wrap">
        <h2 class="t-title" style="font-weight:var(--w-num)">켜져 있는 ${d.enabledCount}개 중 ${suggest.length}개를 제안</h2>
        <span class="t-small" style="margin-left:auto;color:var(--muted)">전체 ${entries.length}개</span>
      </div>
      ${suggest.length ? suggest.map(row).join('') : '<div class="empty">지금은 끄자고 권할 만한 항목이 없어요.</div>'}

      <details style="margin-top:18px">
        <summary class="t-small" style="cursor:pointer;color:var(--muted)">
          제안하지 않은 ${others.length}개와 그 이유</summary>
        <div>${others.map(row).join('')}</div>
      </details>
      ${off.length ? `<details style="margin-top:10px">
        <summary class="t-small" style="cursor:pointer;color:var(--muted)">꺼둔 ${off.length}개 (되돌릴 수 있어요)</summary>
        <div>${off.map(row).join('')}</div></details>` : ''}
      <p class="note" id="startup-tasks" style="margin-top:14px;${logonTaskCount ? '' : 'display:none'}">${
        logonTaskCount ? logonTaskNote(logonTaskCount) : ''
      }</p>
      <p class="note" style="margin-top:10px">몇 초 빨라지는지는 윈도우가 안 알려줘요.
        그래서 <b>“○초 단축” 같은 숫자를 지어내지 않습니다.</b> 작업관리자에서도 똑같이 보이고, 거기서도 되돌릴 수 있어요.</p>`

    fillSignatures()

    host.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const e = entries[+btn.dataset.toggle!]
        const was = e.enabled
        btn.disabled = true
        // 무엇을 건드리는지 버튼에 그대로 쓴다 — 엉뚱한 걸 껐던 적이 있다(row 머리말).
        // 승격이 필요한 항목은 여기서 멈춰 보인다. 그래서 왜 멈췄는지도 같이 쓴다.
        btn.textContent =
          (was ? `“${e.name}” 끄는 중…` : `“${e.name}” 켜는 중…`) +
          (e.needsAdmin ? ' 확인 창에서 “예”를 눌러주세요' : '')
        try {
          const r = await engine('startup-set', [e.id, was ? 'off' : 'on'])
          toast(
            `${r?.elevated ? '관리자 확인을 받아 ' : ''}“${e.name}”을(를) ${was ? '껐어요' : '다시 켰어요'}`,
            'good'
          )
          startupLoaded = false
          // 실제 상태를 다시 읽는다 — 화면만 바꾸지 않는다.
          // 다만 읽는 동안 목록을 지우지는 않는다(quiet).
          await loadStartup(true)
        } catch (err) {
          toast('바꾸지 못했어요: ' + errText(err), 'bad')
          btn.disabled = false
          btn.textContent = (was ? '끄기' : '다시 켜기') + (e.needsAdmin ? ' (관리자 확인)' : '')
        }
      })
    })

    // 각주는 목록을 그린 뒤에 채운다 — 세는 데 오래 걸려서 본문을 막으면 안 된다.
    fillLogonTaskNote()
  } catch (err) {
    host.innerHTML = `<div class="note">시작프로그램을 읽지 못했어요: ${esc(errText(err))}</div>`
  } finally {
    stop()
  }
}

const logonTaskNote = (n: number) =>
  `이 밖에 <b>예약작업 ${n}개</b>가 더 있어요. 대부분 윈도우가 만든 거라 여기서는 개수만 알려드립니다.`

/**
 * 서명 정보를 뒤늦게 채운다.
 *
 * ★ 왜 나중인가: 서명 확인은 파일을 통째로 해시한다. 실측에서 21개에 5.5초였다
 *   (버전 정보는 34ms). "누가 만든 프로그램인가"라는 본문이 각주 때문에 5초를
 *   기다리면 안 된다 — 예약작업 146초에서 배운 것과 같은 자리다.
 *
 * ★ 못 받으면 아무 말도 안 한다. 여기서 "서명 없음"으로 채우면, 서명된 프로그램을
 *   서명이 없다고 말하는 셈이 된다. 안 본 것과 없는 것은 다르다.
 */
let signaturesPending: Promise<any> | null = null

async function fillSignatures() {
  if (!inTauri) return
  try {
    signaturesPending ??= engine('startup-signatures')
    const r = await signaturesPending
    const map: Record<string, string> = r.signatures ?? {}
    document.querySelectorAll<HTMLElement>('[data-sig]').forEach((el) => {
      const note = map[el.dataset.sig ?? '']
      if (!note) return
      el.textContent = note
      el.hidden = false
    })
  } catch {
    signaturesPending = null // 다음에 화면을 열 때 다시 시도한다
  }
}

/**
 * 로그온 예약작업 개수를 뒤늦게 채운다. 못 세면 각주를 그냥 안 보여준다 — 지어내지 않는다.
 *
 * ★ 한 번에 하나만 돈다. 세는 데 몇 분이 걸릴 수 있어서, 끄기를 여러 번 누르는 동안
 *   같은 조회가 겹쳐 쌓이면 파워셸이 몇 개씩 붙어 있게 된다.
 */
let logonTaskPending: Promise<any> | null = null

async function fillLogonTaskNote() {
  if (logonTaskCount !== null) return
  try {
    logonTaskPending ??= engine('startup-tasks')
    const t = await logonTaskPending
    logonTaskCount = t.logonTaskCount ?? 0
  } catch {
    logonTaskPending = null // 다음에 화면을 열 때 다시 시도한다
    return
  }
  const el = document.getElementById('startup-tasks')
  if (!el || !logonTaskCount) return
  el.innerHTML = logonTaskNote(logonTaskCount)
  el.style.display = ''
}

/* ── 오래 안 쓴 프로그램 ──────────────────────────────────────
   제거는 우리가 되돌릴 수 없다. 그래서 일괄 처리 버튼을 만들지 않고
   항목마다 개별 확인을 받는다. (src/probes/programs.ts 머리말) */
async function loadPrograms() {
  const host = $('programs-body')
  const stop = startPanel(host, 'programs', '설치된 프로그램과 실행 기록을 읽는 중')
  try {
    const d = await engine('programs')
    stop()
    const head = `<div style="display:flex;align-items:baseline;gap:10px;margin:14px 0 10px">
        <h2 class="t-title" style="font-weight:var(--w-num)">제거 후보 ${d.suggestions.length}개 · ${fmtBytes(d.suggestibleBytes)}</h2>
        <span class="t-small" style="margin-left:auto;color:var(--muted)">설치 항목 ${d.totalScanned}개 중</span>
      </div>`

    if (!d.suggestions.length) {
      host.innerHTML = head + `<div class="empty"><svg class="ic"><use href="#i-box"/></svg><b>제안할 프로그램이 없어요</b><span>실행 기록으로 확인되는 것만 제안합니다. 기록이 없으면 넘겨짚지 않아요.</span></div>`
        + excludedBlock(d)
      return
    }

    host.innerHTML = head + d.suggestions.map((p: any, i: number) => `
      <div class="row">
        <div class="row-main">
          <div class="row-t">
            <b>${esc(p.name)}</b>
            ${p.version ? `<span class="ver">${esc(p.version)}</span>` : ''}
          </div>
          <div class="row-sub">${esc(p.reason)}</div>
          ${p.installLocation ? `<div class="row-path">${esc(p.installLocation)}</div>` : ''}
          <button class="opt" data-uninstall="${i}" style="margin-top:8px">${
            p.silentUninstall ? '제거하기' : '제거 창 열기'
          }</button>
          <div class="row-sub" data-ustate="${i}" style="margin-top:6px">${
            p.silentUninstall
              ? '여기서 바로 지웁니다.'
              : '여기선 못 끝내요 — 만든 회사의 제거 창이 열립니다.'
          }</div>
        </div>
        <div class="row-val">${fmtBytes(p.bytes)}</div>
      </div>`).join('') + excludedBlock(d)

    host.querySelectorAll<HTMLButtonElement>('[data-uninstall]').forEach((btn) => {
      btn.addEventListener('click', () => uninstallOne(d.suggestions[+btn.dataset.uninstall!], btn))
    })
  } catch (err) {
    host.innerHTML = `<div class="note">프로그램 목록을 읽지 못했어요: ${esc(errText(err))}</div>`
  } finally {
    stop() // 실패로 빠져나가도 타이머는 반드시 선다
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 한 개를 제거한다. **앱 안에서 끝낸다** — 되는 경우에는.
 *
 * ── 왜 "제거 프로그램 열기"를 그만뒀나 ────────────────────────
 * 사용자 입장에서 그건 제거가 아니라 **떠넘기기**다. 우리가 "이건 6개월째
 * 안 쓰셨어요"까지 말해놓고, 정작 지우는 건 다른 창에서 알아서 하라는 건
 * 일을 절반만 한 것이다. 제조사가 무인 제거 명령을 등록해뒀다면 여기서 끝낸다.
 *
 * ── 그래도 지키는 것 ─────────────────────────────────────────
 *   · 파일을 우리가 지우지 않는다. 제조사 언인스톨러만 부른다. (예전과 동일)
 *   · 무인 스위치를 지어내지 않는다. 등록된 것 또는 MSI 규격만 쓴다.
 *   · **끝났다고 우리가 판단하지 않는다.** 언인스톨러 종료 코드는 못 믿으므로
 *     레지스트리에 다시 물어보고, 항목이 사라진 걸 확인한 뒤에만 "제거됐어요"라고 쓴다.
 *   · 확인이 안 되면 성공했다고 하지 않는다 — 마법사로 되돌아갈 길을 준다.
 */
async function uninstallOne(p: any, btn: HTMLButtonElement) {
  const state = btn.parentElement?.querySelector<HTMLElement>('[data-ustate]')
  const say = (s: string) => { if (state) state.textContent = s }

  // 마법사 경로 — 무인 제거 명령이 없는 프로그램. 예전 동작 그대로.
  if (!p.silentUninstall) {
    // 처음부터 무인 명령이 없었을 수도, 방금 무인 제거가 실패해 여기로 내려왔을 수도 있다.
    // 어느 쪽이든 참인 문장으로 쓴다.
    if (!confirm(`"${p.name}"의 제거 창을 열까요?\n\n이건 여기서 바로 끝낼 수 없어서, 만든 회사의 제거 창이 열립니다. 거기서 마저 진행해 주세요.\n\n되돌릴 수 없어요.`)) return
    try {
      await TAURI.core.invoke('run_uninstaller', { command: p.uninstallString, silent: false, elevate: false })
      btn.disabled = true
      btn.textContent = '제거 창을 열었어요'
      say('그 창에서 제거를 마치면 목록을 새로 고쳐 주세요.')
    } catch (err) {
      // 이유를 말풍선에만 띄우면 몇 초 뒤 사라진다. 항목 밑에도 남긴다.
      say('열지 못했어요 — ' + errText(err))
      toast('제거 창을 열지 못했어요: ' + errText(err), 'bad')
    }
    return
  }

  // 되돌릴 수 없는 유일한 동작 — 반드시 개별로 확인받는다.
  if (!confirm(`"${p.name}"을(를) 지울까요?\n\n만든 회사가 준 제거 도구로 지웁니다. 폴더를 직접 퍼내지 않아요.\n\n되돌릴 수 없어요. 다시 쓰려면 새로 설치해야 합니다.`)) return

  btn.disabled = true
  btn.textContent = '지우는 중…'
  say(p.needsAdmin
    ? '관리자 확인 창이 뜨면 “예”를 눌러주세요.'
    : '제거 도구가 도는 중이에요.')

  let outcome: { waited: boolean; code: number | null }
  try {
    outcome = await TAURI.core.invoke('run_uninstaller', {
      command: p.silentUninstall, silent: true, elevate: !!p.needsAdmin,
    })
  } catch (err) {
    btn.disabled = false
    btn.textContent = '제거하기'
    say('시작하지 못했어요: ' + errText(err))
    toast('제거를 시작하지 못했어요: ' + errText(err), 'bad')
    return
  }

  // ★ 여기서부터가 결론이다. 언인스톨러가 0을 돌려줘도 아직 모른다 —
  //   이노셋업은 임시 폴더의 복사본에 일을 넘기고 먼저 빠진다. 레지스트리에 물어본다.
  //
  //   반대로 종료 코드가 0이 아닌 건 **실패의 신호로는** 쓸 수 있다(UAC 거절, 권한 부족).
  //   그때는 30초를 헛되이 기다리지 않고 한 번만 확인하고 끝낸다.
  //   3010은 "성공했는데 재부팅이 필요함"이라 실패가 아니다.
  const failed = typeof outcome.code === 'number' && outcome.code !== 0 && outcome.code !== 3010
  say('정말 없어졌는지 확인하는 중…')
  let gone = false
  for (let i = 0; i < (failed ? 1 : 15) && !gone; i++) {
    try {
      gone = !(await engine('program-installed', [p.keyPath])).installed
    } catch { break }
    if (!gone && !failed) await sleep(2000)
  }

  if (gone) {
    btn.textContent = '지웠어요'
    say(`목록에서 사라진 걸 확인했어요. ${fmtBytes(p.bytes)}가 비워집니다.`)
    btn.closest<HTMLElement>('.row')!.style.opacity = '0.55'
    toast(`"${p.name}"을(를) 지웠어요`, 'good')
  } else {
    // 실패했을 수도, 아직 도는 중일 수도 있다. 둘 다 "제거됐다"가 아니다.
    btn.disabled = false
    btn.textContent = '제거 창 열기'
    p.silentUninstall = null // 다음 클릭은 제조사 창으로 간다
    say(failed
      ? '안 지워졌어요. 관리자 확인을 취소했거나 권한이 모자란 경우예요 — 제거 창으로 마무리해 주세요.'
      : '아직 목록에 남아 있어요 — 제거 창으로 마무리해 주세요.')
  }
}

/** 무엇을 왜 제외했는지 — "안 건드린 것"을 보여주는 게 신뢰의 근거다. */
function excludedBlock(d: any): string {
  if (!d.excluded?.length) return ''
  return `<details style="margin-top:16px">
    <summary class="t-small" style="cursor:pointer;color:var(--muted)">제안하지 않은 ${d.excludedCount}개와 그 이유</summary>
    <div style="margin-top:8px">${d.excluded.map((e: any) =>
      `<div class="t-small" style="color:var(--muted);padding:3px 0">${esc(e.name)} — ${esc(e.reason)}</div>`).join('')}</div>
  </details>`
}

/* ── 같은 파일이 여러 벌 ──────────────────────────────────────
   ★ 왜 별도 화면인가: 이건 스캔 결과가 아니라 **내용을 읽어야** 알 수 있는
     사실이다(크기로 좁히고 해시로 확정 — dupes.ts). 스캔에 끼워 넣으면 스캔이
     느려지고, 스캔을 안 한 사람은 영영 못 본다. 그래서 자기 시간을 갖는다. */
const dupPicked = new Set<string>()

/** 이번에 훑을 폴더. 비어 있으면 기본(사람이 만든 자료가 사는 곳)만 본다. */
let dupRoots: string[] = []

/**
 * AI 모델처럼 **여러 프로그램이 같은 파일을 각자 갖고 있는** 경우.
 *
 * ★ 실측: 같은 모델 6.46GB가 6벌(32.3GB 낭비). 여기서 5벌을 지우면 프로그램
 *   5개가 깨진다 — 6벌 다 진짜고 6벌 다 필요하다. 그래서 이 화면의 기본 답은
 *   '지우기'가 아니라 '하나로 합치기'다.
 */
function dupRootsHtml(roots: { label: string; path: string }[]): string {
  if (!roots.length) return ''
  return `
    <div class="mv-dests" style="margin-top:12px">
      <div class="mv-dests-h">AI 모델이 있을 만한 폴더를 찾았어요 — 볼 곳을 골라주세요</div>
      <div class="t-caption" style="color:var(--muted);margin-bottom:6px">
        기본으로는 다운로드·영상·사진 같은 자료 폴더만 봅니다. 아래 폴더는 따로 골라야 봐요.
      </div>
      ${roots.map((r, i) => `
        <label class="pick-row" style="grid-template-columns:auto 1fr">
          <input type="checkbox" data-dup-root="${i}" ${i < 6 ? 'checked' : ''}>
          <span class="pick-name">${esc(r.label)}</span>
          <span class="bd-path">${esc(r.path)}</span>
        </label>`).join('')}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn" data-dup-scan="1">고른 폴더에서 같은 파일 찾기</button>
        <button class="opt" data-dup-add="1">다른 폴더 추가…</button>
      </div>
    </div>`
}

/** "왜 이렇게 됐나" — 사본을 지우는 것보다 이게 진짜 결정이다. */
function dupCauseHtml(causes: any[]): string {
  if (!causes?.length) return ''
  return causes.map((c) => `
    <div class="unit" style="border-left-color:var(--lock)">
      <div class="unit-h">
        <span class="unit-name">${esc(c.name)}이(가) ${c.roots.length}곳에 있어요</span>
        <span class="unit-amt">${fmtBytes(c.wastedBytes)} 낭비</span>
      </div>
      <div class="unit-l">같은 프로그램이 여러 곳에 깔려 있어서 자료도 그만큼 여러 벌입니다.</div>
      ${c.roots.map((r: string) => `<div class="bd-path">${esc(r)}</div>`).join('')}
      <div class="unit-l"><i>→</i>사본을 정리해도 프로그램이 그대로면 다시 쌓여요. 안 쓰는 설치본이 있으면 그걸 지우시는 게 근본 해결입니다.</div>
    </div>`).join('')
}

async function loadDupes() {
  const host = $('dupes-body')
  /* ★ 여기가 "찾는 중…" 한 줄로 몇 분을 버티던 자리다.
     진행 표시가 없으면 사람이 견디는 건 중앙값 9초다. 막대를 보여주면 그 두 배를
     넘게 기다린다 — 같은 작업인데. 그래서 아는 것을 전부 적는다:
     몇 개를 봤는지, 몇 %인지, 얼마나 남았는지. 모르는 건 모른다고 쓴다. */
  lastDupes = null
  host.innerHTML = `<div class="card">
    <div class="prog" style="margin:0"><div class="prog-bar"><span></span></div></div>
    <div class="empty" data-dup-prog="1" style="padding-top:12px">같은 파일을 찾는 중…</div>
  </div>`
  const started = Date.now()
  const bar = host.querySelector<HTMLElement>('.prog')
  const fill = host.querySelector<HTMLElement>('.prog-bar span')
  const line = host.querySelector<HTMLElement>('[data-dup-prog]')
  const paint = () => {
    if (!line) return
    const elapsed = fmtDuration((Date.now() - started) / 1000)
    const d = lastDupes
    if (!d) { line.textContent = `같은 파일을 찾는 중… · 경과 ${elapsed}`; return }

    if (d.phase === 'scan') {
      // 아직 몇 개가 나올지 모른다 — 진행률을 지어내지 않고 본 개수만 말한다.
      const where = d.label ? `${d.label} ` : ''
      const nth = d.rootCount && d.rootCount > 1 ? ` (${d.rootCount}곳 중 ${(d.rootIndex ?? 0) + 1})` : ''
      line.textContent = `${where}훑는 중${nth} · ${(d.files ?? 0).toLocaleString()}개 · 경과 ${elapsed}`
      return
    }
    const parts = [`안을 펼쳐 확인하는 중`]
    if (d.pct !== null && d.pct !== undefined) {
      parts.push(`${d.pct}%`)
      if (fill) fill.style.width = `${d.pct}%`
      bar?.classList.add('prog-known')
    }
    if (d.total) parts.push(`${(d.done ?? 0).toLocaleString()} / ${d.total.toLocaleString()}개`)
    parts.push(`경과 ${elapsed}`)
    if (d.etaSec !== null && d.etaSec !== undefined) parts.push(`남은 시간 약 ${fmtDuration(d.etaSec)}`)
    else parts.push('남은 시간은 조금 더 봐야 알 수 있어요')
    line.textContent = parts.join(' · ')
  }
  paint()
  const timer = setInterval(paint, 1000)
  dupPicked.clear()
  try {
    const [d, mr] = await Promise.all([
      engine('dupes-scan', dupRoots),
      // 모델 폴더 탐색은 폴더 이름만 보는 가벼운 작업이라 같이 돌린다.
      engine('model-roots').catch(() => ({ roots: [] })),
    ])
    const modelRoots: { label: string; path: string }[] = mr.roots ?? []

    if (!d.groupCount) {
      host.innerHTML = `<div class="note" style="margin-top:12px">
        <b>같은 파일이 없어요</b>
        <span>${d.scanned.toLocaleString()}개를 봤고, 그중 ${fmtBytes(d.minBytes)}가 넘는 ${d.candidates.toLocaleString()}개를 자세히 확인했습니다.</span>
      </div>
      ${dupRootsHtml(modelRoots)}`
      wireDupRoots(host, modelRoots)
      return
    }

    // 사본 전체(= 지울 수 있는 것) 목록. 버튼의 숫자와 실제가 같아야 한다.
    const allCopies = d.groups.flatMap((g: any) => g.copies)
    const allBytes = allCopies.reduce((n: number, c: any) => n + c.size, 0)

    host.innerHTML = `
      <div class="mv-dests" style="margin-top:14px">
        <h2 class="t-h2" style="font-weight:var(--w-num)">${d.groupCount.toLocaleString()}묶음 · ${fmtBytes(d.wastedBytes)}를 아낄 수 있어요</h2>
        <div class="t-small" style="color:var(--muted);margin-top:4px">
          ${d.scanned.toLocaleString()}개 중 ${fmtBytes(d.minBytes)}가 넘는 ${d.candidates.toLocaleString()}개를 추려 ${d.hashed.toLocaleString()}개의 안을 직접 펼쳐 확인했습니다.
          ${d.excluded ? `프로그램 부품 폴더 안의 ${d.excluded.toLocaleString()}개는 여러 벌 있는 게 정상이라 아예 안 봤어요.` : ''}
        </div>
        <div class="t-caption" style="color:var(--muted);margin-top:6px">
          파일 앞뒤를 직접 펼쳐 보고 크기까지 같을 때만 같은 파일로 봅니다. 원본은 남기고 사본만 지워요 — 되돌리기 대신 원본이 남습니다.
        </div>
      </div>

      ${dupCauseHtml(d.causes)}
      ${dupRootsHtml(modelRoots)}

      <div class="pick" style="margin-top:12px">
        <div class="pick-head">
          <span>치울 사본만 골라주세요 — 원본은 건드리지 않습니다</span>
          <button class="opt strong" data-dup-all="1">전체 선택 (사본 ${allCopies.length.toLocaleString()}개 · ${fmtBytes(allBytes)})</button>
        </div>
        <div class="pick-list">${d.groups.map((g: any) => dupGroupHtml(g)).join('')}</div>
        <!-- ★ 버튼 두 개를 나란히 놓으면 그건 판단을 떠넘긴 것이다.
             엔진은 이미 어느 쪽이 맞는지 알고 있다(모델·받아온 자료 = 합치기).
             그러면 화면도 그렇게 말해야 한다 — 권장을 글로 적고, 위험한 쪽은
             한 단 낮춘다. 숫자만 크다고 좋은 선택이 아니라는 걸 말해주는 건
             화면의 몫이다(지우기 49.6GB vs 합치기 13.1GB처럼 보일 때). -->
        <div class="t-caption" data-dup-rec="1" style="margin:10px 0 6px"></div>
        <div class="pick-foot">
          <button class="btn" data-dup-merge="1" disabled>하나로 합치기</button>
          <button class="opt" data-dup-go="1" disabled>고른 사본 지우기</button>
          <span class="t-caption" data-dup-sum="1">아직 고르신 게 없어요</span>
        </div>
        ${d.groupCount > d.groups.length ? `<div class="t-caption" style="color:var(--muted);margin-top:6px">
          낭비가 큰 ${d.groups.length}묶음만 보여드려요. 정리하고 다시 열면 나머지가 올라옵니다.</div>` : ''}
        <div data-dup-out="1"></div>
      </div>`

    const goBtn = host.querySelector<HTMLButtonElement>('[data-dup-go]')!
    const sumEl = host.querySelector<HTMLElement>('[data-dup-sum]')!
    const outEl = host.querySelector<HTMLElement>('[data-dup-out]')!
    const boxes = new Map<string, HTMLInputElement>()
    const sizeOf = new Map<string, number>(allCopies.map((c: any) => [c.path, c.size]))

    /* 합칠 수 있는 사본 = 같은 드라이브에 있고 시스템 자리가 아닌 것.
       엔진이 사본마다 판정해서 보낸다(mergeBlocked). */
    const mergeBtn = host.querySelector<HTMLButtonElement>('[data-dup-merge]')
    const keeperOf = new Map<string, string>()
    const blockedOf = new Map<string, string | null>()
    for (const g of d.groups) {
      for (const c of g.copies) {
        keeperOf.set(c.path, g.keeper.path)
        blockedOf.set(c.path, c.mergeBlocked ?? null)
      }
    }

    const sync = () => {
      const bytes = [...dupPicked].reduce((n, p) => n + (sizeOf.get(p) ?? 0), 0)
      goBtn.disabled = dupPicked.size === 0
      goBtn.textContent = dupPicked.size ? `사본 ${dupPicked.size}개 지우기 (${fmtBytes(bytes)} 확보)` : '고른 사본 지우기'
      goBtn.classList.toggle('danger', dupPicked.size > 0)
      sumEl.textContent = dupPicked.size ? `${dupPicked.size}개 · ${fmtBytes(bytes)}` : '아직 고르신 게 없어요'
      if (mergeBtn) {
        // 합칠 수 없는 것까지 세면 버튼의 숫자가 거짓말이 된다.
        const ok = [...dupPicked].filter((p) => !blockedOf.get(p))
        const okBytes = ok.reduce((n, p) => n + (sizeOf.get(p) ?? 0), 0)
        mergeBtn.disabled = ok.length === 0
        mergeBtn.textContent = ok.length
          ? `${ok.length}개를 하나로 합치기 (${fmtBytes(okBytes)} 회수)`
          : '하나로 합치기'
      }
      /* ★ 무엇을 눌러야 하는지 한 줄로 말한다.
         합칠 수 있는 게 하나라도 있으면 답은 합치기다 — 지우면 그 프로그램이
         다음에 켤 때 다시 받는다. 못 합치는 것(드라이브가 다름)만 남았을 때
         비로소 지우기가 선택지가 된다. */
      const rec = host.querySelector<HTMLElement>('[data-dup-rec]')
      if (rec) {
        const mergeable = [...dupPicked].filter((p) => !blockedOf.get(p))
        const blocked = [...dupPicked].filter((p) => blockedOf.get(p))
        const recommendMerge = mergeable.length > 0
        goBtn.classList.toggle('danger', dupPicked.size > 0 && !recommendMerge)
        if (!dupPicked.size) {
          rec.textContent = ''
        } else if (recommendMerge) {
          rec.innerHTML =
            `<b style="color:var(--accent)">합치기를 권합니다</b> — 프로그램이 자기 자리에서 찾는 파일이라, ` +
            `지우면 다음에 켤 때 <b>다시 받습니다</b>. 합치면 경로는 다 살아 있고 용량만 한 벌치를 써요.` +
            (blocked.length
              ? ` (${blocked.length}개는 드라이브가 달라 못 합쳐요 — 그건 '드라이브 옮기기'로 해결하세요)`
              : '')
        } else {
          rec.innerHTML =
            `고르신 ${blocked.length}개는 <b>드라이브가 달라 합칠 수 없어요.</b> ` +
            `어느 프로그램도 그 자리를 안 본다는 확신이 있을 때만 지우세요 — 되돌릴 수 없습니다.`
        }
      }
    }

    host.querySelectorAll<HTMLInputElement>('[data-dup]').forEach((box) => {
      boxes.set(box.dataset.dup!, box)
      box.addEventListener('change', () => {
        if (box.checked) dupPicked.add(box.dataset.dup!)
        else dupPicked.delete(box.dataset.dup!)
        sync()
      })
    })

    host.querySelector<HTMLButtonElement>('[data-dup-all]')!.addEventListener('click', () => {
      for (const c of allCopies) {
        const box = boxes.get(c.path)
        if (box) box.checked = true
        dupPicked.add(c.path)
      }
      sync()
    })

    /* ── 하나로 합치기 ────────────────────────────────────────
       지우는 게 아니다. 사본 자리를 원본과 **같은 실물**로 이어 붙여서, 경로는
       전부 살아 있고 디스크만 한 벌치를 쓰게 만든다. 같은 모델을 여섯 프로그램이
       각자 갖고 있는 경우의 유일하게 맞는 답이다. */
    mergeBtn?.addEventListener('click', async () => {
      const targets = [...dupPicked].filter((p) => !blockedOf.get(p))
      if (!targets.length) return
      const bytes = targets.reduce((n, p) => n + (sizeOf.get(p) ?? 0), 0)
      const blocked = [...dupPicked].filter((p) => blockedOf.get(p))
      if (!confirm(
        `${targets.length.toLocaleString()}개를 하나로 합칠까요?\n\n` +
        `${spaceHint(bytes)}` +
        `지우지 않습니다. 파일 경로는 전부 그대로 열리고, 디스크만 한 벌치를 씁니다.\n` +
        `※ 합친 뒤에는 같은 실물이라, 한쪽을 고치면 양쪽이 같이 바뀝니다.\n` +
        `   (모델·영상처럼 읽기만 하는 파일이면 문제 없어요)` +
        (blocked.length ? `\n\n${blocked.length}개는 못 합쳐요 — ${blockedOf.get(blocked[0])}` : '')
      )) return

      mergeBtn.disabled = true
      mergeBtn.textContent = '합치는 중…'
      // 남길 파일(원본)별로 묶어서 넘긴다 — 엔진은 '원본 하나 + 사본들' 단위로 받는다.
      const byKeeper = new Map<string, string[]>()
      for (const p of targets) {
        const k = keeperOf.get(p)!
        byKeeper.set(k, [...(byKeeper.get(k) ?? []), p])
      }
      let merged = 0
      let freed = 0
      const failures: { path: string; reason: string }[] = []
      try {
        for (const [keeper, copies] of byKeeper) {
          const r = await engine('dupes-link', [keeper, ...copies])
          merged += r.mergedCount
          freed += r.bytes
          for (const f of r.failed ?? []) failures.push(f)
        }
        outEl.innerHTML = `<div class="pick-done">
          <div class="pick-done-h">✓ 합치기 완료 — ${merged.toLocaleString()}개 · ${fmtBytes(freed)} 회수</div>
          <div class="t-caption">파일은 하나도 안 지웠어요. 경로는 전부 그대로 열립니다.</div>
          ${failures.length ? `<div class="t-caption">${failures.length}개는 못 합쳤어요 — ${esc(failures[0].reason)}</div>` : ''}
        </div>`
        toast(`${fmtBytes(freed)}를 회수했어요. 지운 파일은 없습니다.`, 'good')
        dupesLoaded = false
        refreshDisk(true)
      } catch (err) {
        toast('합치지 못했어요: ' + errText(err), 'bad')
      } finally {
        sync()
      }
    })

    goBtn.addEventListener('click', async () => {
      const paths = [...dupPicked]
      const bytes = paths.reduce((n, p) => n + (sizeOf.get(p) ?? 0), 0)
      if (!confirm(
        `사본 ${paths.length.toLocaleString()}개(${fmtBytes(bytes)})를 지울까요?\n\n` +
        `원본은 그대로 둡니다 — 그게 되돌리기 대신이에요. 지운 사본은 못 되돌립니다.\n\n${spaceHint(bytes)}`
      )) return
      goBtn.disabled = true
      goBtn.textContent = '지우는 중…'
      try {
        const r = await engine('quarantine-paths', paths)
        const refused = (r.refused ?? []) as { path: string; reason: string }[]
        outEl.innerHTML = `<div class="pick-done">
          <div class="pick-done-h">✓ 삭제 완료 — 사본 ${r.deletedCount.toLocaleString()}개(${fmtBytes(r.deletedBytes ?? bytes)})를 지웠어요</div>
          <div class="t-caption">원본은 그대로 있습니다. 용량이 지금 비었어요.</div>
          ${r.failed?.length ? `<div class="t-caption">${r.failed.length}개는 사용 중이라 건너뛰었어요.</div>` : ''}
          ${refused.length ? `<div class="t-caption">${refused.length}개는 안 건드렸어요 — ${esc(refused[0].reason)}</div>` : ''}
          ${r.leftover > 0 ? `<div class="t-caption">${leftoverNote(r.leftover)}</div>` : ''}
        </div>`
        toast(`사본 ${r.deletedCount.toLocaleString()}개를 지웠어요 — ${fmtBytes(r.deletedBytes ?? bytes)}가 비었습니다.`, 'good')
        quarLoaded = false
        dupesLoaded = false // 다시 열면 남은 묶음이 올라온다
        refreshDisk(true)
      } catch (err) {
        toast('지우지 못했어요: ' + errText(err), 'bad')
        goBtn.disabled = false
        sync()
      }
    })
    wireDupRoots(host, modelRoots)
  } catch (err) {
    host.innerHTML = `<div class="note" style="margin-top:12px">찾지 못했어요: ${esc(errText(err))}</div>`
  } finally {
    clearInterval(timer)
    lastDupes = null
  }
}

/**
 * 볼 폴더 고르기.
 *
 * ★ "폴더를 고르세요"로 시작하지 않는다 — 어디에 모델이 쌓여 있는지 아는 사람은
 *   이 기능이 필요 없다. 찾아서 보여주고, 고르는 것만 맡긴다.
 *   (같은 이유로 이동 화면도 자동 탐색으로 바꿨다 — relocate.ts 머리말)
 */
function wireDupRoots(host: HTMLElement, roots: { label: string; path: string }[]) {
  const boxes = host.querySelectorAll<HTMLInputElement>('[data-dup-root]')
  const chosen = () => [...boxes].filter((b) => b.checked).map((b) => roots[+b.dataset.dupRoot!].path)

  host.querySelector<HTMLButtonElement>('[data-dup-scan]')?.addEventListener('click', () => {
    dupRoots = chosen()
    if (!dupRoots.length) { toast('볼 폴더를 하나 이상 골라주세요.', 'bad'); return }
    loadDupes()
  })

  host.querySelector<HTMLButtonElement>('[data-dup-add]')?.addEventListener('click', async () => {
    try {
      const path = await TAURI.dialog.open({ directory: true, title: '같은 파일을 찾을 폴더 고르기' })
      if (!path) return
      dupRoots = [...chosen(), path as string]
      loadDupes()
    } catch (err) {
      toast('폴더를 고르지 못했어요: ' + errText(err), 'bad')
    }
  })
}

/**
 * 중복 묶음 하나 — 남길 것을 먼저, 이유와 함께.
 *
 * 사본 쪽에만 체크박스를 둔다. 원본에 체크박스가 있으면 "둘 중 아무거나 골라
 * 지우세요"가 되고, 그 순간 이 기능은 판단을 사용자에게 떠넘긴 게 된다.
 * 원본을 바꾸고 싶으면 사본을 남기고 원본을 고르는 게 아니라, 목록에서
 * 그 묶음을 건너뛰면 된다 — 아무것도 안 하는 게 언제나 가능해야 한다.
 */
function dupGroupHtml(g: any): string {
  return `
    <div class="pg pg-safe">
      <div class="pg-h">
        <span class="pg-who">${esc(g.keeper.name)}</span>
        <span class="pg-v">남길 것</span>
        ${g.isModel ? `<span class="pg-v" style="color:var(--accent);border-color:var(--accent)">합치기 권장</span>` : ''}
        <span class="pg-amt">사본 ${g.copies.length}개 · ${fmtBytes(g.wastedBytes)} 낭비</span>
      </div>
      <div class="pg-l pg-ok"><i>✓</i>${esc(g.keeperReason)}</div>
      ${g.isModel ? `<div class="pg-l pg-mv"><i>⇄</i>받아온 자료예요. 프로그램마다 필요할 수 있으니 <b>지우기보다 합치기</b>가 안전합니다 — 경로는 다 살아 있고 용량만 한 벌치를 씁니다.</div>` : ''}
      <div class="bd-path" style="margin-top:2px">${esc(g.keeper.path)}</div>
      <div class="pg-files">${g.copies.map((c: any) => `
        <label class="pick-row">
          <input type="checkbox" data-dup="${esc(c.path)}">
          <span class="pick-name">${esc(c.name)}</span>
          <span class="pick-size">${fmtBytes(c.size)}</span>
          <span class="bd-path">${esc(c.path)}</span>
          ${c.mergeBlocked ? `<span class="pick-bk warn">⚠ 합치기는 안 돼요 — ${esc(c.mergeBlocked)}</span>` : ''}
        </label>`).join('')}
      </div>
    </div>`
}

/* ── 다른 드라이브로 옮기기 ──────────────────────────────────── */
let moveDest: string | null = null

/**
 * ★ 폴더를 고르라고 하지 않는다.
 *
 * 이 화면은 여태 '옮길 폴더 고르기'부터 시작했다. 그런데 어느 폴더에 큰 게
 * 들어 있는지 아는 사람이면 이 기능이 필요 없다 — 용량이 부족한 사람은
 * 어디를 봐야 할지 몰라서 부족한 거다. 그래서 알아서 찾아 보여준다.
 * (같은 이유로 스캔은 이미 기본 목록을 쓴다 — presets.ts 머리말)
 *
 * 대상 드라이브는 **자동으로 안 고른다.** 여유 공간만 보고 고르면 클라우드
 * 동기화 마운트(구글 드라이브 G:는 여유 2048GB로 보고한다)를 집을 수 있고,
 * 그러면 옮긴 게 통째로 업로드된다. 목록만 주고 고르는 건 사용자가 한다.
 */
async function loadMove() {
  const host = $('move-body')
  const stop = startPanel(host, 'relocate-scan', '옮겨도 되는 것을 찾는 중')

  let d: any
  try {
    d = await engine('relocate-scan')
  } catch (err) {
    host.innerHTML = `<div class="card"><div class="note">찾지 못했어요: ${esc(errText(err))}</div></div>`
    return
  } finally {
    stop()
  }

  if (!d.totalCount) {
    host.innerHTML = `<div class="card"><div class="empty">
      <b>옮길 만한 큰 파일이 없어요</b>
      <span>${fmtBytes(d.minBytes)}보다 큰 것만 찾습니다 — 작은 걸 옮겨봐야 체감이 없어서요.
      ${d.refusedCount ? ` 안전을 위해 제외한 항목이 ${d.refusedCount.toLocaleString()}개 있습니다.` : ''}</span>
    </div></div>`
    return
  }

  // 대상 후보 — 시스템 드라이브는 뺀다(같은 드라이브로 옮기면 용량이 안 는다).
  const dests = (d.drives ?? []).filter((v: any) => !v.isSystem)

  host.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
        <h2 class="t-h2" style="font-weight:var(--w-num)">옮길 수 있는 것 ${d.totalCount.toLocaleString()}개 · ${fmtBytes(d.totalBytes)}</h2>
      </div>
      <div class="t-small" style="color:var(--muted);margin-top:4px">
        ${esc((d.roots ?? []).join(' · '))}에서 ${fmtBytes(d.minBytes)}보다 큰 것만 찾았어요.
        프로그램 폴더·앱 설정·동기화 폴더는 옮기면 깨지므로 아예 빼놓습니다.
      </div>

      <div class="mv-dests">
        <div class="mv-dests-h">어느 드라이브로 옮길까요</div>
        ${dests.length ? dests.map((v: any) => `
          <label class="mv-dest">
            <input type="radio" name="mv-dest" value="${esc(v.root)}">
            <span class="mv-dest-n">${esc(v.root)}</span>
            <span class="mv-dest-f">여유 ${fmtBytes(v.free)} / ${fmtBytes(v.total)}</span>
          </label>`).join('')
        : `<div class="t-small" style="color:var(--muted)">다른 드라이브가 안 보여요. 외장하드를 꽂으면 여기 나옵니다.</div>`}
        <div class="t-caption" style="color:var(--muted);margin-top:6px">
          클라우드 동기화 폴더(구글 드라이브·원드라이브)를 고르면 옮긴 파일이 통째로 업로드됩니다 — 확인하고 골라주세요.
        </div>
      </div>

      <div id="mv-groups">${d.groups.map((g: any) => `
        <div class="mv-g">
          <div class="mv-g-h">
            <span class="mv-g-n">${esc(g.label)}</span>
            <span class="mv-g-v">${g.count.toLocaleString()}개 · ${fmtBytes(g.bytes)}</span>
          </div>
          <div class="row-path">${esc(g.path)}</div>
          <div class="mv-g-files">${g.items.slice(0, 5).map((it: any) => `
            <div class="mv-f">
              <span class="mv-f-n">${esc(baseName(it.path))}</span>
              <span class="mv-f-s">${fmtBytes(it.size)}</span>
            </div>`).join('')}
            ${g.count > 5 ? `<div class="t-caption" style="color:var(--muted)">…외 ${(g.count - 5).toLocaleString()}개</div>` : ''}
          </div>
          <button class="opt" data-mv-plan="${esc(g.path)}" disabled>이 폴더 옮기기</button>
        </div>`).join('')}</div>

      <div id="mv-plan"></div>
    </div>`

  const planButtons = host.querySelectorAll<HTMLButtonElement>('[data-mv-plan]')
  const syncDest = () => {
    planButtons.forEach((b) => { b.disabled = !moveDest })
  }
  host.querySelectorAll<HTMLInputElement>('input[name="mv-dest"]').forEach((r) => {
    if (moveDest && r.value === moveDest) r.checked = true
    r.addEventListener('change', () => { moveDest = r.value; syncDest() })
  })
  syncDest()

  planButtons.forEach((b) => {
    b.addEventListener('click', () => {
      if (!moveDest) return
      planMove(b.dataset.mvPlan!, moveDest)
    })
  })
}

/**
 * @param src 옮길 폴더. 화면이 자동으로 찾아준 것 중 하나다(loadMove).
 *
 * ★ 결과를 전용 칸(#mv-plan)에만 그린다. 전에는 host 전체를 다시 그렸는데,
 *   그러면 위쪽 드라이브 선택지와 폴더 버튼에 걸어둔 리스너가 통째로 날아가서
 *   한 번 계획을 본 뒤에는 다른 폴더를 못 골랐다.
 */
async function planMove(src: string, dest: string) {
  const slot = document.getElementById('mv-plan') ?? $('move-body')
  const stop = startPanel(slot, 'relocate-plan', '옮길 수 있는 것을 찾는 중')
  try {
    const d = await engine('relocate-plan', [src, dest])
    stop()
    if (!d.destination.ok) {
      slot.innerHTML = `<div class="note">${esc(d.destination.reason)}</div>`
      return
    }
    if (!d.count) {
      slot.innerHTML = `<div class="empty">여기엔 옮길 만한 파일이 없어요.${
        d.refusedCount ? ` 안전을 위해 제외한 항목이 ${d.refusedCount}개 있습니다.` : ''}</div>`
      return
    }
    slot.innerHTML = `<div class="card" style="margin-top:12px">
      <div style="display:flex;align-items:baseline;gap:10px">
        <h2 class="t-title" style="font-weight:var(--w-num)">${d.count.toLocaleString()}개 · ${fmtBytes(d.bytes)}</h2>
        <span class="t-small" style="margin-left:auto;color:var(--muted)">→ ${esc(d.destFolder)}</span>
      </div>
      <div class="t-small" style="color:var(--muted);margin-top:4px">지우지 않습니다. 옮긴 기록이 남아 언제든 되돌릴 수 있어요.</div>
      ${d.items.slice(0, 30).map((it: any) => `<div class="row">
        <div class="row-main">
          <div class="row-path" style="margin-top:0">${esc(it.path)}</div>
          <div class="row-sub">${esc(it.meaning)}</div>
        </div>
        <div class="row-val">${fmtBytes(it.size)}</div></div>`).join('')}
      ${d.refusedCount ? `<div class="t-small" style="color:var(--muted);margin-top:10px">옮기면 위험해서 제외한 항목 ${d.refusedCount}개 (프로그램 폴더·앱 설정·동기화 폴더 등)</div>` : ''}
      <button class="oneclick" id="mv-apply" style="margin-top:14px">${fmtBytes(d.bytes)} 옮기기</button>
    </div>`

    $('mv-apply').addEventListener('click', async () => {
      const btn = $('mv-apply') as HTMLButtonElement
      if (!confirm(`${d.count.toLocaleString()}개(${fmtBytes(d.bytes)})를 ${dest}로 옮길까요?\n\n지우지 않습니다. 옮긴 기록이 파일 옆에 남아 언제든 되돌릴 수 있어요.`)) return
      btn.disabled = true; btn.textContent = '옮기는 중…'
      try {
        const r = await engine('relocate-apply', [src, dest])
        toast(`${r.movedCount.toLocaleString()}개(${fmtBytes(r.movedBytes)})를 옮겼어요.` +
          (r.failed.length ? ` ${r.failed.length}개는 건너뛰었습니다.` : ''))
        refreshDisk(true)
        loadMove()
      } catch (err) {
        toast('옮기지 못했어요: ' + errText(err), 'bad')
        btn.disabled = false
        btn.textContent = `${fmtBytes(d.bytes)} 옮기기`
      }
    })
  } catch (err) {
    slot.innerHTML = `<div class="note">계획을 세우지 못했어요: ${esc(errText(err))}</div>`
  } finally {
    stop()
  }
}

/* ── 되돌리기 (데스크톱: 옮긴 것·합친 것·못 지운 것) ───────────
   ★ 이 화면은 '보관함'이었다. 정리한 걸 30일간 여기 담아뒀다가 나중에 지웠는데,
     담아두는 자리가 **같은 드라이브**라 그동안 용량이 1바이트도 안 빴다.
     "12.7GB 정리했습니다" 다음 줄에 "용량은 아직 그대로입니다"를 쓰는 화면이었고,
     그건 정리 도구가 할 수 있는 가장 이상한 말이다. 그래서 보관을 없앴다 —
     이제 정리는 곧 삭제고, 이 화면은 **되돌릴 수 있는 것만** 모은다.

   여기 남는 세 가지:
     · 다른 드라이브로 옮긴 것 — 지운 게 아니라 자리만 바꾼 것
     · 하나로 합친 것 — 같은 실물을 나눠 쓰는 것, 따로 떼면 용량을 도로 쓴다
     · 지우려다 못 지운 것 — 옮기기까진 됐는데 삭제가 막힌 것(대개 사용 중),
       그리고 옛 버전 보관함에 아직 남아 있는 것. 안 보여주면 영영 안 보이는
       용량이 된다. */
async function loadQuar() {
  const screen = $('s-quar')
  const listId = 'quar-list-live'
  let host = document.getElementById(listId)
  if (!host) { host = document.createElement('div'); host.id = listId; screen.appendChild(host) }
  const stop = startPanel(host, 'quar-list', '되돌릴 수 있는 것을 읽는 중')
  try {
    const data = await engine('quar-list')
    stop()
    // 옛 버전이 보관해둔 것 중 30일이 지난 건 이 화면에 오기 전에 이미 지워졌다
    // (앱 켤 때 purge). 무엇이 사라졌는지 말하지 않으면 파일이 증발한 걸로 느낀다.
    const purgeNote = lastPurge && lastPurge.purgedCount
      ? `<div class="note" style="margin-bottom:12px">예전 버전이 보관해뒀던 것 중
           ${data.graceDays}일이 지난 <b>${lastPurge.purgedCount.toLocaleString()}개(${fmtBytes(lastPurge.bytes)})</b>를
           이제 진짜 버렸어요. 그만큼 용량이 비었습니다.</div>`
      : ''

    if (!data.items.length) {
      host.innerHTML = purgeNote
      // 남은 게 없어도 옮기거나 합친 게 있을 수 있다. 안 그리면 되돌릴 길이 사라진다.
      const moved = await renderMovedUndo(host)
      const merged = await renderMergedUndo(host)
      if (!moved && !merged) {
        host.innerHTML = `<div class="card">${purgeNote}<div class="empty"><svg class="ic"><use href="#i-undo"/></svg><b>되돌릴 것이 없어요</b><span>지운 것은 되돌릴 수 없습니다. 다른 드라이브로 옮기거나 하나로 합친 것이 여기 올라와요.</span></div></div>`
      }
      return
    }

    const drives = [...new Set(data.items.map((it: any) => (it.root ?? '').slice(0, 2)))].filter(Boolean)
    host.innerHTML = `<div class="card">
      ${purgeNote}
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <h2 class="t-title" style="font-weight:var(--w-num)">못 지우고 남은 ${data.items.length.toLocaleString()}개 · ${fmtBytes(data.totalBytes)}</h2>
        ${drives.length > 1 ? `<span class="t-small" style="color:var(--muted)">드라이브 ${drives.join(' · ')}</span>` : ''}
        <button class="btn danger" id="purge-all">지금 지우기</button>
        <button class="btn ghost" id="restore-all" style="margin-left:auto">전부 되돌리기</button>
      </div>
      <div class="t-small" style="color:var(--muted);margin:-4px 0 12px">
        지우려 했는데 <b>다른 프로그램이 쓰고 있어서</b> 못 지운 것들이에요(옛 버전이 보관해둔 것도 여기 있습니다).
        원래 자리에는 없지만 <b>용량도 아직 안 빴습니다</b> — 그 프로그램을 닫고 '지금 지우기'를 누르거나,
        되돌려서 원래 자리로 돌려놓으세요.
      </div>
      ${data.items.slice(0, 50).map((it: any) => `<div class="row">
          <div class="row-main">
            <div class="row-path" style="margin-top:0">${esc(it.originalPath)}</div>
            <div class="row-sub">${fmtBytes(it.size)} · ${esc(it.reason)}</div>
          </div>
          <div class="row-act"><button class="opt" data-restore="${esc(it.id)}">되돌리기</button></div>
        </div>`).join('')}
      ${data.items.length > 50 ? `<div class="t-small" style="color:var(--muted);margin-top:10px">…외 ${(data.items.length - 50).toLocaleString()}개</div>` : ''}
    </div>`

    /* ★ 항목마다 되돌리기 — "전부"만 있으면 하나 되살리려고 전부를 되살려야 한다.
       실제로 흔한 요구는 "이거 하나만"이다. 엔진은 처음부터 개별 복구를
       지원했는데 화면에 버튼이 없었다. */
    host.querySelectorAll<HTMLButtonElement>('[data-restore]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true
        btn.textContent = '되돌리는 중…'
        try {
          const r = await engine('restore', [btn.dataset.restore!])
          if (!r.restoredCount) {
            // 자리를 누가 차지했을 때가 대부분이다 — 이유를 그대로 보여준다.
            toast(r.failed?.[0]?.reason ?? '되돌리지 못했어요.', 'bad')
            btn.disabled = false
            btn.textContent = '되돌리기'
            return
          }
          loadQuar() // 목록을 다시 읽는다 — 화면만 지우지 않는다
        } catch (err) {
          toast('되돌리지 못했어요: ' + errText(err), 'bad')
          btn.disabled = false
          btn.textContent = '되돌리기'
        }
      })
    })

    document.getElementById('restore-all')?.addEventListener('click', async (ev) => {
      // ★ 여기만 try/catch가 빠져 있었다. 실패하면 unhandled rejection으로 흘러
      //   화면엔 아무 일도 안 일어난 것처럼 보였다 — 개별 되돌리기엔 있는데
      //   '전부'에만 없었다. 되돌리기가 조용히 실패하는 건 이 화면의 존재 이유를 깬다.
      const b = ev.currentTarget as HTMLButtonElement
      b.disabled = true
      b.textContent = '되돌리는 중…'
      try {
        const r = await engine('restore', ['--all'])
        toast(`${r.restoredCount.toLocaleString()}개를 되돌렸어요.`)
        loadQuar()
      } catch (err) {
        toast('되돌리지 못했어요: ' + errText(err), 'bad')
        b.disabled = false
        b.textContent = '전부 되돌리기'
      }
    })

    // 되돌릴 수 없으므로 숫자와 함께 한 번 더 확인받는다.
    document.getElementById('purge-all')?.addEventListener('click', async (ev) => {
      const b = ev.currentTarget as HTMLButtonElement
      if (!confirm(`남은 ${data.items.length.toLocaleString()}개(${fmtBytes(data.totalBytes)})를 지금 지울까요?\n\n되돌릴 수 없습니다 — 휴지통에도 안 남아요.\n\n${spaceHint(data.totalBytes)}`)) return
      b.disabled = true
      b.textContent = '지우는 중…'
      try {
        const r = await engine('quar-purge-now')
        toast(`${r.purgedCount.toLocaleString()}개를 지웠어요 — ${fmtBytes(r.bytes)}가 비었습니다.`, 'good')
        refreshDisk(true)
        loadQuar() // 실제 상태를 다시 읽는다
      } catch (err) {
        b.disabled = false
        b.textContent = '지금 지우기'
        toast('지우지 못했어요: ' + errText(err), 'bad')
      }
    })
    /* ★ 옮긴 것도 같은 화면에서 되돌린다.
       전에는 이동 되돌리기가 '드라이브 옮기기' 화면에만 있었다. 그러면 사용자는
       **어느 드라이브로 옮겼는지 기억해서** 그 화면을 찾아가야 한다.
       기억해야 하는 되돌리기는 되돌리기가 아니다. */
    renderMovedUndo(host)
    renderMergedUndo(host)
  } catch (err) {
    host.innerHTML = `<div class="card"><div class="note">되돌릴 수 있는 것을 읽지 못했어요: ${esc(errText(err))}</div></div>`
  } finally {
    stop()
  }
}

/**
 * 하나로 합친 것 — 다시 따로 뗄 수 있게.
 *
 * ★ '되돌리기'라고 부르지 않는다. 따로 떼면 그만큼 용량을 **도로 쓴다.**
 *   되돌리기라는 말은 "원래대로 공짜로 돌아간다"로 읽히는데 그게 아니다.
 */
async function renderMergedUndo(host: HTMLElement): Promise<boolean> {
  let d: any
  try {
    d = await engine('merge-list')
  } catch {
    return false
  }
  if (!d.count) return false

  const box = document.createElement('div')
  box.className = 'card'
  box.style.marginTop = '12px'
  box.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <h2 class="t-title" style="font-weight:var(--w-num)">하나로 합친 ${d.count.toLocaleString()}개 · ${fmtBytes(d.bytes)} 회수 중</h2>
    </div>
    <div class="t-small" style="color:var(--muted);margin:-4px 0 12px">
      지운 게 아니라 <b>같은 실물을 여러 자리에서 함께 쓰는 것</b>이에요. 경로는 전부 그대로 열립니다.
      따로 떼면 그만큼 용량을 도로 씁니다.
    </div>
    ${d.items.slice(0, 50).map((m: any) => `
      <div class="row">
        <div class="row-main">
          <div class="row-path" style="margin-top:0">${esc(m.linked)}</div>
          <div class="row-sub">${fmtBytes(m.size)} · 실물은 ${esc(m.keeper)}</div>
        </div>
        <div class="row-act"><button class="opt" data-unmerge="${esc(m.id)}">따로 떼기</button></div>
      </div>`).join('')}`

  host.appendChild(box)

  box.querySelectorAll<HTMLButtonElement>('[data-unmerge]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true
      btn.textContent = '떼는 중…'
      try {
        const r = await engine('merge-undo', [btn.dataset.unmerge!])
        if (!r.splitCount) {
          toast(r.failed?.[0]?.reason ?? '따로 떼지 못했어요.', 'bad')
          btn.disabled = false
          btn.textContent = '따로 떼기'
          return
        }
        toast('따로 뗐어요. 그만큼 용량을 다시 씁니다.', 'good')
        refreshDisk(true)
        loadQuar()
      } catch (err) {
        toast('따로 떼지 못했어요: ' + errText(err), 'bad')
        btn.disabled = false
        btn.textContent = '따로 떼기'
      }
    })
  })
  return true
}

/** 옮긴 것 되돌리기 — 남은 것 아래에 이어 붙인다. 목록이 비면 아무것도 안 그린다. */
async function renderMovedUndo(host: HTMLElement): Promise<boolean> {
  let d: any
  try {
    d = await engine('undo-list')
  } catch {
    return false // 부가 목록 하나 때문에 화면 전체를 망치지 않는다.
  }
  if (!d.movedCount) return false

  const box = document.createElement('div')
  box.className = 'card'
  box.style.marginTop = '12px'
  box.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <h2 class="t-title" style="font-weight:var(--w-num)">다른 드라이브로 옮긴 ${d.movedCount.toLocaleString()}개 · ${fmtBytes(d.movedBytes)}</h2>
    </div>
    <div class="t-small" style="color:var(--muted);margin:-4px 0 12px">
      이건 지운 게 아니라 <b>자리만 옮긴 것</b>이에요. 되돌리면 원래 경로로 그대로 돌아옵니다.
    </div>
    ${d.moved.slice(0, 50).map((m: any) => `
      <div class="row">
        <div class="row-main">
          <div class="row-path" style="margin-top:0">${esc(m.originalPath)}</div>
          <div class="row-sub">${fmtBytes(m.size)}${m.kind === 'folder' ? ` · 폴더 ${(m.files ?? 0).toLocaleString()}개 · 원래 자리에 안내판 있음` : ''} → ${esc(m.movedTo)}</div>
        </div>
        <div class="row-act"><button class="opt" data-undo-move="${esc(m.id)}" data-dest="${esc(m.destRoot)}">되돌리기</button></div>
      </div>`).join('')}
    ${d.movedCount > 50 ? `<div class="t-small" style="color:var(--muted);margin-top:10px">…외 ${(d.movedCount - 50).toLocaleString()}개</div>` : ''}`

  host.appendChild(box)

  box.querySelectorAll<HTMLButtonElement>('[data-undo-move]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true
      btn.textContent = '되돌리는 중…'
      try {
        const r = await engine('relocate-undo', [btn.dataset.dest!, btn.dataset.undoMove!])
        if (!r.restoredCount) {
          toast(r.failed?.[0]?.reason ?? '되돌리지 못했어요.', 'bad')
          btn.disabled = false
          btn.textContent = '되돌리기'
          return
        }
        toast('원래 자리로 되돌렸어요.', 'good')
        refreshDisk(true)
        loadQuar()
      } catch (err) {
        toast('되돌리지 못했어요: ' + errText(err), 'bad')
        btn.disabled = false
        btn.textContent = '되돌리기'
      }
    })
  })
  return true
}

/* ── 자동 업데이트 (V3/알약식) ─────────────────────────────────
   앱이 켜지면 조용히 최신 버전을 확인 → 새 버전이면 팝업 → 받아서 무인 재설치.
   판단(compareVersions·verifyIntegrity)은 테스트된 순수 로직, 다운로드·설치는 Rust 명령.

   무결성: 릴리스에 함께 올라간 latest.json의 signature(설치파일 SHA-256)를 읽어,
   받은 파일의 해시와 대조한 뒤에만 실행한다. 서명이 없으면 설치하지 않는다
   (fail closed). Rust의 apply_update가 실행 직전에 한 번 더 대조한다. */

/** 릴리스 자산에서 latest.json을 찾아 설치파일의 SHA-256을 읽는다. 없으면 null. */
async function fetchExpectedHash(assets: any[]): Promise<string | null> {
  const manifest = assets.find((a: any) => a.name === 'latest.json')
  if (!manifest) return null
  try {
    /* ★ 실물에서 터진 버그: 웹뷰에서 이 주소를 fetch하면 **CORS에 막힌다.**
       GitHub API(api.github.com)는 허용 헤더를 주지만, 릴리스 자산 다운로드
       (release-assets.githubusercontent.com)는 주지 않는다. 그래서 서명을 못 읽고
       "릴리스에 SHA-256 서명이 없어요"라며 거절됐다 — 서명은 멀쩡히 있었는데.
       (Node로 검증할 땐 CORS를 안 따져서 통과하는 바람에, 실물에서만 드러났다.)
       Rust에는 CORS가 없다. 데스크톱에서는 그쪽으로 받는다. */
    const raw = inTauri
      ? await TAURI.core.invoke('fetch_update_manifest', { url: manifest.browser_download_url })
      : await (await fetch(manifest.browser_download_url, { cache: 'no-store' })).text()
    const json = JSON.parse(raw)
    return typeof json?.signature === 'string' ? json.signature : null
  } catch {
    return null
  }
}

/**
 * @param manual 사용자가 '업데이트 확인'을 눌렀나.
 *
 * ★ 조용한 실패를 없앤다. 배경 확인은 실패해도 조용히 넘어가는 게 맞지만
 *   (네트워크 없다고 앱이 시끄러우면 안 된다), 사용자가 직접 눌렀을 때도
 *   아무 반응이 없으면 "고장 났다"로 읽힌다. 실제로 그렇게 보였다.
 */
async function checkUpdate(manual = false) {
  const say = (msg: string, kind: 'info' | 'good' | 'bad' = 'info') => {
    const el = document.getElementById('upd-state')
    if (el) el.textContent = msg
    if (manual) toast(msg, kind)
  }
  if (manual) say('확인하는 중…')
  try {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' })
    if (!res.ok) {
      // 가장 흔한 원인은 GitHub API 시간당 한도(비인증 60회)다. 남 탓처럼 안 들리게 쓴다.
      say(res.status === 403 ? '지금은 확인이 막혔어요. 잠시 뒤 다시 눌러주세요.' : `확인 실패 (HTTP ${res.status})`, 'bad')
      return
    }
    const r = await res.json()
    const version = (r.tag_name ?? '').replace(/^v/, '')
    const assets = r.assets ?? []
    const exe = assets.find((a: any) => /\.exe$/i.test(a.name))
    if (!version || !exe) { say('릴리스를 읽지 못했어요.', 'bad'); return }
    if (compareVersions(version, APP_VERSION) <= 0) {
      say(`최신 버전이에요 (v${APP_VERSION})`, 'good')
      return
    }
    const expectedHash = await fetchExpectedHash(assets)
    const m = { version, url: exe.browser_download_url, notes: (r.body ?? '').split('\n')[0] }

    const modal = $('update-modal')
    const body = $('um-body')
    const progress = $('um-progress')
    $('um-title').textContent = `업데이트 v${m.version}이 있어요`
    // "추가로 누르실 건 없어요"는 이 버튼을 누른 '뒤'의 얘기다 — 버튼 옆에서 하면
    // 안 눌러도 되는 것처럼 읽힌다. 확인이 필요하다는 걸 먼저 말한다.
    body.innerHTML =
      `지금 버전은 v${APP_VERSION}이에요. ` +
      (m.notes ? esc(m.notes) + ' ' : '') +
      '확인하시면 받아서 검증한 뒤 설치할게요 — 그 뒤로 누르실 건 없어요.'
    modal.style.display = 'flex'

    $('um-later').onclick = () => { modal.style.display = 'none' }
    $('um-now').onclick = async () => {
      ;($('um-now') as HTMLButtonElement).disabled = true
      ;($('um-later') as HTMLButtonElement).disabled = true
      progress.style.display = 'block'
      try {
        progress.textContent = '새 버전을 받는 중…'
        const got = await TAURI.core.invoke('download_update', { url: m.url })

        // ★ 받은 파일이 릴리스에 게시된 그 파일인지 확인한 뒤에만 실행한다.
        progress.textContent = '받은 파일을 검증하는 중…'
        const expected = normalizeSha256(expectedHash) // 장부에 적힌 값
        const check = verifyIntegrity(expected, got?.sha256)
        if (!check.ok || !expected) {
          throw new Error(
            `${check.reason ?? '업데이트를 검증할 수 없어요'}. 안전을 위해 설치하지 않았어요 — 릴리스 페이지에서 직접 받아주세요.`
          )
        }

        progress.textContent = '설치하고 다시 시작할게요…'
        // 앱은 여기서 종료·재설치된다.
        // 넘기는 건 '장부에 적힌 값'이다 — 다운로드가 계산해 준 값을 되돌려주면
        // Rust가 자기 계산값과 자기를 비교하는 셈이라 재검증이 의미를 잃는다.
        await TAURI.core.invoke('apply_update', { installerPath: got.path, expectedSha256: expected })
      } catch (err) {
        progress.textContent = '업데이트에 실패했어요: ' + errText(err)
        ;($('um-now') as HTMLButtonElement).disabled = false
        ;($('um-later') as HTMLButtonElement).disabled = false
      }
    }
    say(`v${version} 준비됨 — 팝업에서 진행해주세요`, 'good')
  } catch (err) {
    // 네트워크가 없어도 앱은 정상 작동한다. 다만 직접 누른 경우엔 이유를 말해준다.
    say('인터넷 연결을 확인해주세요.', 'bad')
  }
}

/* ── 옛 보관함 만료분 최종 삭제 ─────────────────────────────────
   보관은 없앴지만, 예전 버전이 보관해둔 것은 남의 디스크에 그대로 있다.
   그때 우리가 한 약속은 "30일간 되돌릴 수 있다"였고, 그 약속은 지킨다 —
   30일이 지난 것만 여기서 실제로 지운다. 새로 보관되는 것은 이제 없으므로
   이 목록은 시간이 지나면 저절로 빈다.

   ★ 왜 앱을 켤 때인가: 사용자가 그 화면을 열어봐야만 지워진다면, 안 열어보는
     사람의 디스크는 영원히 안 빈다. 판단(30일)은 엔진 안에 갇혀 있어서
     여기서 앞당길 방법이 없다 — 그래서 매번 불러도 안전하다. */
let lastPurge: { purgedCount: number; bytes: number } | null = null

async function purgeExpiredQuarantine() {
  try {
    const r = await engine('purge')
    if (r.purgedCount) {
      lastPurge = { purgedCount: r.purgedCount, bytes: r.bytes }
      quarLoaded = false // '되돌리기' 화면을 다시 읽어야 한다
    }
  } catch {
    /* 못 지워도 앱은 정상 작동한다. 다음 실행 때 다시 시도된다. */
  }
}

/* ── 데스크톱 초기화 ───────────────────────────────────────── */
if (inTauri) {
  // 데스크톱에서는 정적 데모 카드를 감추고 실측으로 대체한다.
  $('hiber-card').innerHTML = `<div class="empty">'숨은 공간' 탭을 열면 이 PC를 실측합니다.</div>`
  // 폴더를 고를 필요가 없다는 걸 버튼에 먼저 적는다.
  const one = $('oneclick').querySelector('.s')
  if (one) one.textContent = '이 PC의 주요 폴더를 알아서 훑어요 · 확실한 것만 정리'
  $('pick2').textContent = '특정 폴더만 고르기'
  $('hero-cap').textContent = '원클릭을 누르면 이 PC의 주요 폴더를 훑어서 정리 가능한 용량을 보여드려요.'
  // 창을 닫으면 트레이로 내려간다. 어디로 갔는지 모르면 그건 사라진 것이다.
  ;($('tray-note') as HTMLElement).hidden = false
  refreshDisk(true)
  // ★ 트레이에서 창을 다시 꺼냈을 때도 읽는다. 그 사이 며칠이 지났을 수 있다.
  //   (같은 이유로 업데이트 확인도 6시간마다 돈다 — 아래)
  window.addEventListener('focus', () => refreshDisk())
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDisk() })
  purgeExpiredQuarantine() // 옛 보관함의 유예 끝난 것 실제 삭제
  // 시작할 때 한 번, 그 뒤 6시간마다. 트레이에 상주하는 앱이라
  // '시작할 때만' 보면 며칠 켜둔 사이 나온 버전을 영영 모른다.
  const ver = document.getElementById('app-ver')
  if (ver) ver.textContent = 'v' + APP_VERSION
  document.getElementById('check-upd')?.addEventListener('click', () => checkUpdate(true))
  checkUpdate()
  setInterval(() => checkUpdate(), 6 * 60 * 60 * 1000)
}
