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
const APP_VERSION = '0.9.13'
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
async function engine(command: string, args: string[] = []): Promise<any> {
  const res = await TAURI.core.invoke('run_engine', { command, args })
  if (!res || res.ok === false) throw new Error(res?.error || '엔진 오류')
  return res.data
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
const screens = ['home', 'hidden', 'startup', 'programs', 'move', 'quar', 'tidy']
let hiddenLoaded = false, quarLoaded = false, programsLoaded = false, moveLoaded = false
let startupLoaded = false
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
}
document.querySelectorAll<HTMLButtonElement>('.nav button').forEach((b) => b.addEventListener('click', () => go(b.dataset.go!)))

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
    zbar('존 A 안전', 'zsafe', r.zones.safe.bytes, total, r.plan.autoCount, '캐시·로그처럼 다시 생기는 것. 규칙이 확증한 것만 자동 정리해요.') +
    zbar('존 B 애매', 'zamb', r.zones.ambig.bytes, total, r.zones.ambig.count, '사용자만 아는 것. 무인 삭제 안 하고 물어봅니다.') +
    zbar('존 C 잠금', 'zlock', r.zones.locked.bytes, total, r.zones.locked.count, '시스템·설정·클라우드. 지우면 뭔가 깨져서 아예 안 건드려요.')

  // 어디를 봤는지 먼저 밝힌다. "PC 전체를 다 봤다"고 오해하게 두지 않는다.
  const where = r.roots?.length
    ? `<b style="color:var(--ink)">본 곳 ${r.roots.length}곳</b>: ${r.roots.map((x) => esc(x.path)).join(' · ')}<br>`
    : ''
  // ★ "문 앞에 내놓고"는 격리 시절의 말이다. 이제 확실한 건 진짜로 지운다 —
  //   화면이 동작과 다른 말을 하면, 맞는 말을 해도 안 믿게 된다.
  $('plan-lede').innerHTML =
    where + '확실한 건 알아서 지우고(용량이 바로 빕니다), 애매한 건 아래에서 물어봅니다.'
  $('plan3').innerHTML = `
    <div class="stat"><div class="n g">${fmtBytes(r.plan.autoBytes)}</div><div class="l">지금 정리 가능<br>확실한 캐시 ${r.plan.autoCount.toLocaleString()}개 · 규칙 확증분만</div></div>
    <div class="stat"><div class="n a">${fmtBytes(r.plan.askBytes)}</div><div class="l">물어보면 정리 가능<br>애매한 ${r.plan.askCount.toLocaleString()}개 · 아래 질문으로</div></div>
    <div class="stat"><div class="n m">${fmtBytes(r.plan.lockBytes)}</div><div class="l">지켜드린 것<br>${r.plan.lockCount.toLocaleString()}개 · 건드리면 위험</div></div>`

  $('apply-note').innerHTML = esc(r.plan.inferredBytes > 0
    ? `“아마 캐시일” ${fmtBytes(r.plan.inferredBytes)}는 자동에서 뺐어요. “아마”로는 안 지웁니다.`
    : '자동으로 치우는 건 전부 캐시예요. 지워도 다시 생기는 것들입니다.')

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
  applyBtn.textContent = inTauri ? `캐시 ${fmtBytes(r.plan.autoBytes)} 지금 지우기` : '확실한 캐시 정리하기'
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
function fileCardsHtml(samples: any[]): string {
  const groups = new Map<string, { o: any; headline: string; files: any[] }>()
  for (const s of samples) {
    // 소유자 판별이 없는 옛 응답(사이드카가 구버전)은 묶을 근거가 없다 → 파일마다 한 줄.
    const key = s.owner ? `${s.headline}|${s.owner.verdict}` : `plain:${s.path}`
    const g = groups.get(key)
    if (g) g.files.push(s)
    else groups.set(key, { o: s.owner, headline: s.headline ?? s.owner?.role ?? '', files: [s] })
  }
  return [...groups.values()].map(groupCardHtml).join('')
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


function renderQuestions(questions: Question[]) {
  lastQuestions = questions // 낱개 목록이 근거를 다시 찾는다(renderPicker)
  const qEl = $('questions')
  if (!questions.length) {
    qEl.innerHTML = `<div class="note">물어볼 만한 묶음이 없어요. 애매한 항목이 적거나 잘게 흩어져 있습니다.</div>`
    return
  }
  qEl.innerHTML = questions.map((q, i) => `
    <div class="q" data-qi="${i}">
      <div class="q-n">질문 ${i + 1}</div>
      <div class="q-text">${esc(q.text)}</div>
      <div class="q-why">왜 묻나: ${esc(q.rationale)}</div>
      ${evidenceHtml((q as any).evidence)}
      <div class="opts">${q.options.map((o) => `<button class="opt${o.outcome === 'KEEP' ? ' keep' : ''}"
        data-outcome="${o.outcome}" data-unknown="${esc(q.unknown)}"
        data-preview="${esc(o.preview)}">${esc(o.label)}</button>`).join('')}</div>
      <div class="q-answered" hidden></div>
      <div class="q-act" data-act="${i}" data-count="${q.stakeCount}" data-bytes="${q.stakeBytes}"></div>
      <div class="q-stake">걸린 용량: ${fmtBytes(q.stakeBytes)} · ${q.stakeCount.toLocaleString()}개</div>
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
   *   **"140,613개 · 18.1GB 격리로 정리하기"** 라는 일괄 버튼이 떴다.
   *   "하나씩 보겠다"고 고른 사람에게 전부 지우기 버튼을 내민 셈이다.
   *   게다가 눌러도 안 됐다 — 엔진은 이 답을 'review'로 해석해 아무것도 안 하고
   *   돌려주는데(engine.ts actionFor), 화면은 r.quarantinedCount를 읽어서
   *   undefined.toLocaleString()으로 터졌다. 있어서도 안 되고 눌러도 에러였다.
   *
   *   이제 이 답은 약속한 것을 한다: 목록을 펴고 낱개로 고르게 한다.
   */
  if (outcome === 'REVIEW_ONE_BY_ONE') {
    renderPicker(host, unknown)
    return
  }

  if (outcome === 'MOVE') {
    host.innerHTML = `<div class="t-small" style="margin-top:10px;color:var(--ink-2)">
      옮기기는 대상 드라이브가 필요해요.
      <button class="opt" data-goto-move="1" style="margin-left:6px">드라이브 옮기기 열기 →</button></div>`
    host.querySelector<HTMLButtonElement>('[data-goto-move]')!.addEventListener('click', () => go('move'))
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
        <button class="btn" data-answer-go="1">${count.toLocaleString()}개 · ${fmtBytes(bytes)} 격리로 정리하기</button>
        <span>지우지 않고 30일 보관 — 언제든 되돌립니다</span>
      </div>`
    host.querySelector<HTMLButtonElement>('[data-answer-go]')!.addEventListener('click', async (ev) => {
      const b = ev.currentTarget as HTMLButtonElement
      b.disabled = true
      b.textContent = '정리 중…'
      try {
        const r = await engine('answer-apply', [unknown, outcome, ...(scannedPath ? [scannedPath] : [])])
        host.innerHTML = `<div class="t-small" style="margin-top:10px;color:var(--safe);font-weight:var(--w-em)">
          ${r.quarantinedCount.toLocaleString()}개를 격리함으로 옮겼어요 — 30일 안에 되돌릴 수 있습니다.
          ${r.failed.length ? `<span style="color:var(--muted);font-weight:var(--w-text)">${r.failed.length}개는 사용 중이라 건너뜀</span>` : ''}</div>`
        mountPurgeNow(host, bytes)
        toast(`${r.quarantinedCount.toLocaleString()}개를 격리했어요. 격리함에서 되돌릴 수 있습니다.`, 'good')
        quarLoaded = false
        refreshDisk(true)
      } catch (err) {
        toast('정리하지 못했어요: ' + errText(err), 'bad')
        b.disabled = false
        b.textContent = '격리로 정리하기'
      }
    })
  } catch (err) {
    host.innerHTML = `<div class="note" style="margin-top:10px">확인하지 못했어요: ${esc(errText(err))}</div>`
  }
}

/* ── 낱개로 고르기 ────────────────────────────────────────────
   이 앱의 실행 단위는 여태 '묶음 전체'였다. 그런데 화면은 파일을 낱개로
   보여준다 — 판단은 낱개로 시키고 실행은 전부-아니면-전무만 준 셈이다.
   격리함엔 개별 되돌리기가 처음부터 있었는데(restore <id>) 지우는 쪽만 없었다. */

/** 마지막으로 그린 질문들 — 낱개 목록이 근거(samples)를 다시 찾는 데 쓴다. */
let lastQuestions: any[] = []

/** 지금 고른 경로. 화면을 다시 그려도 선택이 살아 있어야 한다. */
const picked = new Set<string>()

/**
 * 낱개 선택 목록을 그린다.
 *
 * ★ 기본은 **아무것도 선택 안 됨**이다. 전부 체크해두고 "빼세요"로 시작하면
 *   그건 다시 일괄 삭제고, 사용자가 실수로 누르면 되돌릴 일이 커진다.
 *   고른 것만 지운다 — 고르는 건 사용자 몫이다.
 */
function renderPicker(host: HTMLElement, unknown: string) {
  const q = lastQuestions.find((x) => x.unknown === unknown)
  const samples: any[] = q?.evidence?.samples ?? []
  picked.clear()

  if (!samples.length) {
    host.innerHTML = `<div class="note" style="margin-top:10px">
      낱개로 보여드릴 목록을 못 받았어요. 다시 검사하면 목록이 함께 옵니다.</div>`
    return
  }

  host.innerHTML = `
    <div class="pick" style="margin-top:10px">
      <div class="pick-head">
        <span>지울 것만 골라주세요 — 고른 것만 정리합니다</span>
        <button class="opt" data-pick-all="1">큰 것 10개 고르기</button>
      </div>
      <div class="pick-list">${samples.map((s, i) => `
        <label class="pick-row">
          <input type="checkbox" data-pick="${i}">
          <span class="pick-name">${esc(baseName(s.path))}</span>
          <span class="pick-size">${fmtBytes(s.size)}</span>
          <span class="bd-path">${esc(s.path)}</span>
        </label>`).join('')}
      </div>
      <div class="pick-foot">
        <button class="btn" data-pick-go="1" disabled>고른 것 정리하기</button>
        <span class="t-caption" data-pick-sum="1">아직 고르신 게 없어요</span>
      </div>
      <div class="t-caption" style="color:var(--muted);margin-top:6px">
        큰 것부터 ${samples.length}개까지 보여드려요. 지우지 않고 30일 보관 — 언제든 되돌립니다.</div>
    </div>`

  const goBtn = host.querySelector<HTMLButtonElement>('[data-pick-go]')!
  const sumEl = host.querySelector<HTMLElement>('[data-pick-sum]')!

  const sync = () => {
    const bytes = samples.filter((s) => picked.has(s.path)).reduce((n, s) => n + s.size, 0)
    goBtn.disabled = picked.size === 0
    goBtn.textContent = picked.size ? `고른 ${picked.size}개 정리하기` : '고른 것 정리하기'
    sumEl.textContent = picked.size ? `${picked.size}개 · ${fmtBytes(bytes)}` : '아직 고르신 게 없어요'
  }

  host.querySelectorAll<HTMLInputElement>('[data-pick]').forEach((box) => {
    box.addEventListener('change', () => {
      const s = samples[+box.dataset.pick!]
      if (box.checked) picked.add(s.path)
      else picked.delete(s.path)
      sync()
    })
  })

  host.querySelector<HTMLButtonElement>('[data-pick-all]')!.addEventListener('click', () => {
    // 목록은 이미 큰 것부터다. 상위 10개만 눌러준다 — 전체 선택 버튼은 두지 않는다.
    host.querySelectorAll<HTMLInputElement>('[data-pick]').forEach((box, i) => {
      if (i >= 10) return
      box.checked = true
      picked.add(samples[i].path)
    })
    sync()
  })

  goBtn.addEventListener('click', async () => {
    const paths = samples.filter((s) => picked.has(s.path)).map((s) => s.path)
    const bytes = samples.filter((s) => picked.has(s.path)).reduce((n, s) => n + s.size, 0)
    if (!confirm(`고르신 ${paths.length}개(${fmtBytes(bytes)})를 정리할까요?\n\n지우지 않고 격리함에 30일 보관합니다. 언제든 되돌릴 수 있어요.`)) return

    goBtn.disabled = true
    goBtn.textContent = '정리 중…'
    try {
      const r = await engine('quarantine-paths', paths)
      // 거절당한 게 있으면 숨기지 않는다 — 왜 안 됐는지가 신뢰의 근거다.
      const refused = (r.refused ?? []) as { path: string; reason: string }[]
      host.innerHTML = `<div class="pick-done">
        <div class="pick-done-h">${r.quarantinedCount.toLocaleString()}개를 격리함으로 옮겼어요</div>
        <div class="t-caption">30일 안에 되돌릴 수 있습니다.</div>
        ${r.failed?.length ? `<div class="t-caption">${r.failed.length}개는 사용 중이라 건너뛰었어요.</div>` : ''}
        ${refused.length ? `<div class="t-caption">${refused.length}개는 안 건드렸어요 — ${esc(refused[0].reason)}</div>` : ''}
      </div>`
      mountPurgeNow(host, r.bytesAfterGrace ?? bytes)
      toast(`${r.quarantinedCount.toLocaleString()}개를 격리했어요.`, 'good')
      quarLoaded = false
      refreshDisk(true)
    } catch (err) {
      toast('정리하지 못했어요: ' + errText(err), 'bad')
      goBtn.disabled = false
      goBtn.textContent = `고른 ${paths.length}개 정리하기`
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
  })
}

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
function startTicker(prefix: string): () => void {
  const started = Date.now()
  lastProgress = null
  let shownPct = 0 // 뒤로 가지 않게 여기서 한 번 더 잠근다
  const box = $('prog') as HTMLElement
  const fill = box.querySelector('span') as HTMLElement
  box.hidden = false
  box.classList.remove('prog-known')
  fill.style.width = ''

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
      if (pickFolder) {
        const path = await TAURI.dialog.open({ directory: true, title: '정리할 폴더 고르기' })
        if (!path) { $('status').textContent = ''; return }
        scannedPath = path as string
        paths = [scannedPath]
        stopTicker = startTicker('분석 중')
      } else {
        scannedPath = null // 기본 스캔은 여러 곳이라 경로 하나로 특정되지 않는다
        stopTicker = startTicker(await describeDefaultRoots())
      }
      report = (await engine('scan-plan', paths)) as Report
      stopTicker(); stopTicker = null
      $('status').textContent =
        `${report.scannedFiles.toLocaleString()}개 · ${Math.round(report.elapsedMs / 1000)}초` +
        (report.roots?.length ? ` · ${report.roots.length}곳` : '')
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
   ★ 이 버튼은 이제 **실제로 지운다.** 전에는 격리함으로 옮기고 멈췄는데,
     격리함은 같은 드라이브에 있어서 용량이 1바이트도 안 줬다. "지금 정리 가능
     7.0GB"를 보고 누른 사람에게 "용량은 아직 그대로입니다"가 뜨는 화면이었다.
     두 번 같은 항의를 들었고, 두 번 다 맞는 말이었다.

     30일 격리를 원하는 사람을 위해 선택지는 아래에 남겨둔다 — 없애는 게 아니라
     기본을 바꾸는 것이다. */
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
    if (res.purged) {
      $('apply-note').innerHTML =
        `<b style="color:var(--safe)">${res.purgedCount.toLocaleString()}개를 지웠어요 — ` +
        `${fmtBytes(res.bytesAfterGrace)}가 지금 비었습니다.</b>${skipped}` +
        `<div class="t-small" style="color:var(--muted);margin-top:6px">` +
        `규칙이 확증한 캐시·로그·임시 파일만 지웠어요. 애매한 건 아래에서 물어봅니다.</div>`
    } else {
      // --quarantine으로 돌린 경우(선택지를 쓴 사람). 용량이 안 준다는 걸 숨기지 않는다.
      $('apply-note').innerHTML =
        `<b style="color:var(--safe)">${res.quarantinedCount.toLocaleString()}개를 격리함으로 옮겼어요.</b> ` +
        `<b>용량은 아직 그대로입니다</b> — 격리함이 같은 드라이브에 있거든요. ` +
        `30일 뒤 ${fmtBytes(res.bytesAfterGrace)}가 자동으로 비워집니다.${skipped}`
      mountPurgeNow($('apply-note'), res.bytesAfterGrace)
    }
    btn.textContent = '정리 완료'
    quarLoaded = false // 격리함 새로고침 필요
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
 * "지금 비우기" 버튼을 붙인다 — 유예 30일을 안 기다리고 즉시 용량을 확보한다.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────
 * 격리함은 **같은 드라이브에 있다.** 그래서 격리만으로는 용량이 1바이트도 안 준다.
 * 디스크가 92% 찬 사람에게 "30일 뒤에 37GB가 빕니다"는 답이 아니다 —
 * 지금 부족해서 이 앱을 연 사람이다. 실제로 "삭제가 안 됐다니 이게 무슨
 * 소리냐"는 말을 들었고, 그 말이 맞았다.
 *
 * ── 그래도 기본값은 30일이다 ─────────────────────────────────
 * 되돌릴 수 있다는 게 이 제품의 약속이고, 그건 안 없앤다. 없애는 게 아니라
 * **기다리지 않을 자유**를 더하는 것이다. 그래서 누를 때 한 번 더 확인받고,
 * 되돌릴 수 없다는 걸 숫자와 함께 분명히 말한다.
 */
function mountPurgeNow(host: HTMLElement, bytes: number) {
  if (!inTauri || !bytes) return
  const box = document.createElement('div')
  box.style.marginTop = '12px'
  box.innerHTML = `<button class="btn ghost" data-purge-now="1">지금 비우기 — ${fmtBytes(bytes)} 즉시 확보</button>
    <span class="t-small" style="color:var(--muted);margin-left:8px">되돌릴 수 없어요</span>`
  host.appendChild(box)

  box.querySelector<HTMLButtonElement>('[data-purge-now]')!.addEventListener('click', async (ev) => {
    const b = ev.currentTarget as HTMLButtonElement
    if (!confirm(`격리함을 지금 비울까요?\n\n${fmtBytes(bytes)}가 바로 확보됩니다.\n\n30일을 기다리지 않고 지금 지우는 거라 되돌릴 수 없어요.`)) return
    b.disabled = true
    b.textContent = '비우는 중…'
    try {
      const r = await engine('quar-purge-now')
      box.innerHTML = `<span class="t-small" style="color:var(--safe);font-weight:var(--w-em)">
        ${r.purgedCount.toLocaleString()}개를 지웠어요 — ${fmtBytes(r.bytes)}가 비었습니다.</span>` +
        (r.failed.length ? `<span class="t-small" style="color:var(--muted);margin-left:6px">${r.failed.length}개는 사용 중이라 남겨뒀어요</span>` : '')
      quarLoaded = false
      refreshDisk(true)
      toast(`${fmtBytes(r.bytes)}를 비웠어요`, 'good')
    } catch (err) {
      b.disabled = false
      b.textContent = '지금 비우기'
      toast('비우지 못했어요: ' + errText(err), 'bad')
    }
  })
}

/* ── 숨은 공간 (데스크톱: 실측) ─────────────────────────────── */
async function loadHidden() {
  const card = $('hiber-card')
  card.innerHTML = `<div class="empty">이 PC를 확인하는 중...</div>`
  try {
    const data = await engine('probe')
    if (!data.findings.length) { card.innerHTML = `<div class="empty"><svg class="ic"><use href="#i-check"/></svg><b>회수할 숨은 공간이 없어요</b><span>최대절전 파일·휴지통·업데이트 캐시 모두 깔끔합니다.</span></div>`; return }
    card.innerHTML = data.findings
      .map((f: any, i: number) => explainCard(f, i))
      .join('<hr style="border:0;border-top:1px solid var(--line);margin:22px 0">')
    wireAssists(card, data.findings)
  } catch (err) {
    card.innerHTML = `<div class="note">숨은 공간을 확인하지 못했어요: ${esc(errText(err))}</div>`
  }
}

function explainCard(f: any, index: number): string {
  const e = f.explain
  const gb = (n: number) => (n / 1073741824).toFixed(1) + 'GB'
  const blk = (h: string, body: string, warn = false) => `<div class="blk${warn ? ' warn' : ''}"><div class="h">${h}</div>${body}</div>`
  const ul = (arr: string[]) => `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`

  /* 실행 줄. 항목마다 우리가 할 수 있는 게 다르다 —
     되돌리는 명령이 있으면 SystemAction, 없으면 정식 도구(assist),
     둘 다 없으면 아직 안전한 경로를 모르는 것이므로 솔직히 그렇게 쓴다. */
  const foot = f.assist
    ? `<button class="btn${f.assist.irreversible ? '' : ' ghost'}" data-assist="${index}">${esc(f.assist.label)}</button>
       <span class="t-small" style="color:var(--muted);margin-left:10px">${esc(f.assist.note)}</span>`
    : `<span class="pill desk">실행(관리자 권한)은 다음 업데이트에서 연결됩니다</span>`

  return `
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
      <h2 class="t-title" style="font-weight:var(--w-num)">${esc(f.title)}</h2>
      <span class="t-h2 tnum" style="font-weight:var(--w-num);color:var(--safe);margin-left:auto">${gb(f.bytes)}</span>
    </div>
    <div class="expl" style="margin-top:14px">
      ${blk('이게 뭔가요', `<p>${esc(e.what)}</p>`)}
      ${blk('왜 이렇게 큰가요', `<p>${esc(e.why)}</p>`)}
      ${blk('뭐가 이걸 쓰나요', ul(e.usedBy))}
      ${blk('지우면 뭐가 달라지나요', ul(e.ifRemoved), true)}
      ${blk('되돌릴 수 있나요', `<p>${esc(e.recoveryNote)}</p>`)}
      ${blk('안 지우면요', `<p>${esc(e.ifKept)}</p>`)}
    </div>
    <div style="margin-top:16px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">${foot}</div>`
}

/**
 * assist 실행 — 되돌릴 수 없는 것은 반드시 개별 확인을 받는다.
 * (프로그램 제거와 같은 원칙: 되돌릴 수 없는 동작에 일괄 버튼을 만들지 않는다)
 */
function wireAssists(host: HTMLElement, findings: any[]) {
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
  host.innerHTML = `<div class="t-small" style="color:var(--muted);margin-top:10px">사진을 확인하는 중… (수천 장이면 몇 분 걸릴 수 있어요)</div>`
  try {
    const p = await engine('photos-plan')
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
          <div class="t-small" style="color:var(--muted)">원본은 그대로 두고 사본만 격리함으로 보냅니다(30일 되돌리기).</div>
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
              ${r.quarantinedCount ? `중복 사본 ${r.quarantinedCount.toLocaleString()}장(${fmtBytes(r.quarantinedBytes)})을 격리함으로 보냈어요 — 30일 안에 되돌릴 수 있습니다.<br>` : ''}
              ${r.failed.length ? `${r.failed.length}장은 사용 중이라 건너뛰었습니다.` : ''}</div>
          </div>`
        } catch (err) {
          host.innerHTML = `<div class="note" style="margin-top:10px">정리하지 못했어요: ${esc(errText(err))}</div>`
        }
      })
    })
  } catch (err) {
    host.innerHTML = `<div class="note" style="margin-top:10px">확인하지 못했어요: ${esc(errText(err))}</div>`
  }
}

/**
 * 콘텐츠의 단계를 앱이 실행한다 — 단, 미리보기가 먼저다.
 * "정리했습니다"라고 통보하는 도구가 되지 않으려면 이 순서를 지켜야 한다.
 */
async function tidyFolderFlow(target: string, host: HTMLElement) {
  host.innerHTML = `<div class="t-small" style="color:var(--muted);margin-top:10px">무엇을 옮길지 확인하는 중…</div>`
  try {
    const p = await engine('tidy-folder-plan', [target])
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
          ${p.broken.length ? `<br>대상이 사라진 바로가기 ${p.broken.length}개는 격리함으로 보냅니다(30일 되돌리기).` : ''}
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
            ${r.brokenQuarantined ? `깨진 바로가기 ${r.brokenQuarantined}개는 격리함에 있어요. ` : ''}
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
  return { today, ...planToday(state, today), total: ROUTINES.length }
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
   여기만 '삭제'가 아니라 '끄기'다. 되돌리기가 즉시라 격리를 안 거친다.
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
  if (!quiet) host.innerHTML = `<div class="empty">시작프로그램을 읽는 중…</div>`
  try {
    const d = await engine('startup')
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
      const btn = !e.canToggle
        ? `<span class="pill desk" style="margin-top:8px">모든 사용자용이라 관리자 권한이 필요해요</span>`
        : `<button class="opt" data-toggle="${i}" style="margin-top:8px">${e.enabled ? '끄기' : '다시 켜기'}</button>`
      return `<div class="row">
        <div class="row-main">
          <div class="row-t">
            <b>${esc(e.name)}</b>
            <span style="font-size:var(--t-caption);color:${tone};font-weight:var(--w-head)">${esc(v.meaning)}</span>
            <span class="ver">${e.enabled ? '켜짐' : '꺼둠'}</span>
          </div>
          <div class="row-sub">${esc(v.reason)}</div>
          <div class="row-sub" style="color:var(--ink-2)">끄면: ${esc(v.ifDisabled)}</div>
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

    host.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const e = entries[+btn.dataset.toggle!]
        btn.disabled = true
        // 무엇을 건드리는지 버튼에 그대로 쓴다 — 엉뚱한 걸 껐던 적이 있다(row 머리말).
        btn.textContent = e.enabled ? `“${e.name}” 끄는 중…` : `“${e.name}” 켜는 중…`
        try {
          await engine('startup-set', [e.id, e.enabled ? 'off' : 'on'])
          toast(`“${e.name}”을(를) ${e.enabled ? '껐어요' : '다시 켰어요'}`, 'good')
          startupLoaded = false
          // 실제 상태를 다시 읽는다 — 화면만 바꾸지 않는다.
          // 다만 읽는 동안 목록을 지우지는 않는다(quiet).
          await loadStartup(true)
        } catch (err) {
          toast('바꾸지 못했어요: ' + errText(err), 'bad')
          btn.disabled = false
          btn.textContent = e.enabled ? '끄기' : '다시 켜기'
        }
      })
    })

    // 각주는 목록을 그린 뒤에 채운다 — 세는 데 오래 걸려서 본문을 막으면 안 된다.
    fillLogonTaskNote()
  } catch (err) {
    host.innerHTML = `<div class="note">시작프로그램을 읽지 못했어요: ${esc(errText(err))}</div>`
  }
}

const logonTaskNote = (n: number) =>
  `이 밖에 <b>예약작업 ${n}개</b>가 더 있어요. 대부분 윈도우가 만든 거라 여기서는 개수만 알려드립니다.`

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
   제거는 격리로 되돌릴 수 없다. 그래서 일괄 처리 버튼을 만들지 않고
   항목마다 개별 확인을 받는다. (src/probes/programs.ts 머리말) */
async function loadPrograms() {
  const host = $('programs-body')
  host.innerHTML = `<div class="empty">설치된 프로그램과 실행 기록을 읽는 중…</div>`
  try {
    const d = await engine('programs')
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
  host.innerHTML = `<div class="card"><div class="empty">옮겨도 되는 것을 찾는 중…</div></div>`

  let d: any
  try {
    d = await engine('relocate-scan')
  } catch (err) {
    host.innerHTML = `<div class="card"><div class="note">찾지 못했어요: ${esc(errText(err))}</div></div>`
    return
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
  slot.innerHTML = `<div class="empty">옮길 수 있는 것을 찾는 중…</div>`
  try {
    const d = await engine('relocate-plan', [src, dest])
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
  }
}

/* ── 격리함 (데스크톱: 실제 목록 + 되돌리기) ─────────────────── */
async function loadQuar() {
  const screen = $('s-quar')
  const listId = 'quar-list-live'
  let host = document.getElementById(listId)
  if (!host) { host = document.createElement('div'); host.id = listId; screen.appendChild(host) }
  host.innerHTML = `<div class="empty">격리함을 읽는 중...</div>`
  try {
    const data = await engine('quar-list')
    // 유예가 끝난 것이 있으면 이 화면에 오기 전에 이미 지워졌다(시작할 때 purge).
    // 무엇이 사라졌는지 말하지 않으면 사용자는 파일이 증발했다고 느낀다.
    const purgeNote = lastPurge && lastPurge.purgedCount
      ? `<div class="note" style="margin-bottom:12px">${data.graceDays}일이 지난
           <b>${lastPurge.purgedCount.toLocaleString()}개(${fmtBytes(lastPurge.bytes)})</b>를 이제 진짜 버렸어요.
           그만큼 용량이 비었습니다.</div>`
      : ''

    if (!data.items.length) {
      host.innerHTML = `<div class="card">${purgeNote}<div class="empty"><svg class="ic"><use href="#i-undo"/></svg><b>아직 격리된 항목이 없어요</b><span>정리를 실행하면 여기에 30일간 보관됩니다.</span></div></div>`
      return
    }
    const day = 86400000
    const drives = [...new Set(data.items.map((it: any) => (it.root ?? '').slice(0, 2)))].filter(Boolean)
    host.innerHTML = `<div class="card">
      ${purgeNote}
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <h2 class="t-title" style="font-weight:var(--w-num)">격리된 ${data.items.length.toLocaleString()}개 · ${fmtBytes(data.totalBytes)}</h2>
        ${drives.length > 1 ? `<span class="t-small" style="color:var(--muted)">드라이브 ${drives.join(' · ')}</span>` : ''}
        <button class="btn ghost" id="purge-all">지금 비우기</button>
        <button class="btn" id="restore-all" style="margin-left:auto">전부 되돌리기</button>
      </div>
      <div class="t-small" style="color:var(--muted);margin:-4px 0 12px">
        여기 있는 동안은 <b>용량이 안 줄어듭니다</b> — 격리함이 같은 드라이브에 있거든요.
        30일을 안 기다리려면 '지금 비우기'를 누르세요.
      </div>
      ${data.items.slice(0, 50).map((it: any) => {
        const left = Math.ceil((data.graceDays * day - (Date.now() - it.quarantinedAt)) / day)
        return `<div class="row">
          <div class="row-main">
            <div class="row-path" style="margin-top:0">${esc(it.originalPath)}</div>
            <div class="row-sub">${fmtBytes(it.size)} · ${it.expired ? '만료됨 — 곧 삭제' : left + '일 남음'} · ${esc(it.reason)}</div>
          </div>
          <div class="row-act"><button class="opt" data-restore="${esc(it.id)}">되돌리기</button></div>
        </div>`
      }).join('')}
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
            btn.textContent = '실패'
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
      //   '전부'에만 없었다. 되돌리기가 조용히 실패하는 건 격리함의 존재 이유를 깬다.
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

    // 유예를 안 기다리고 지금 비운다. 되돌릴 수 없으므로 숫자와 함께 한 번 더 확인받는다.
    document.getElementById('purge-all')?.addEventListener('click', async (ev) => {
      const b = ev.currentTarget as HTMLButtonElement
      if (!confirm(`격리함을 지금 비울까요?\n\n${data.items.length.toLocaleString()}개 · ${fmtBytes(data.totalBytes)}가 바로 확보됩니다.\n\n30일을 기다리지 않고 지금 지우는 거라 되돌릴 수 없어요.`)) return
      b.disabled = true
      b.textContent = '비우는 중…'
      try {
        const r = await engine('quar-purge-now')
        toast(`${r.purgedCount.toLocaleString()}개를 지웠어요 — ${fmtBytes(r.bytes)}가 비었습니다.`, 'good')
        refreshDisk(true)
        loadQuar() // 실제 상태를 다시 읽는다
      } catch (err) {
        b.disabled = false
        b.textContent = '지금 비우기'
        toast('비우지 못했어요: ' + errText(err), 'bad')
      }
    })
  } catch (err) {
    host.innerHTML = `<div class="card"><div class="note">격리함을 읽지 못했어요: ${esc(errText(err))}</div></div>`
  }
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

/* ── 유예 만료분 최종 삭제 ─────────────────────────────────────
   격리는 '옮기기'라 그것만으로는 용량이 안 빈다. 30일이 지난 것을 실제로
   지우는 이 호출이 있어야 "정리했는데 용량이 그대로"가 끝난다.

   ★ 왜 앱을 켤 때인가: 사용자가 격리함을 열어봐야만 지워진다면, 안 열어보는
     사람의 디스크는 영원히 안 빈다. 판단(30일)은 엔진 안에 갇혀 있어서
     여기서 앞당길 방법이 없다 — 그래서 매번 불러도 안전하다. */
let lastPurge: { purgedCount: number; bytes: number } | null = null

async function purgeExpiredQuarantine() {
  try {
    const r = await engine('purge')
    if (r.purgedCount) {
      lastPurge = { purgedCount: r.purgedCount, bytes: r.bytes }
      quarLoaded = false // 격리함을 다시 읽어야 한다
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
  purgeExpiredQuarantine() // 유예 끝난 것 실제 삭제
  // 시작할 때 한 번, 그 뒤 6시간마다. 트레이에 상주하는 앱이라
  // '시작할 때만' 보면 며칠 켜둔 사이 나온 버전을 영영 모른다.
  const ver = document.getElementById('app-ver')
  if (ver) ver.textContent = 'v' + APP_VERSION
  document.getElementById('check-upd')?.addEventListener('click', () => checkUpdate(true))
  checkUpdate()
  setInterval(() => checkUpdate(), 6 * 60 * 60 * 1000)
}
