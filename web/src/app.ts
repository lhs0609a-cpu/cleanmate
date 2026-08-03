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
const APP_VERSION = '0.4.0'
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

/* ── 화면 전환 ─────────────────────────────────────────────── */
const screens = ['home', 'hidden', 'startup', 'programs', 'move', 'quar', 'tidy']
let hiddenLoaded = false, quarLoaded = false, programsLoaded = false, moveLoaded = false
let startupLoaded = false
function go(name: string) {
  for (const s of screens) $(`s-${s}`).classList.toggle('on', s === name)
  document.querySelectorAll<HTMLButtonElement>('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === name))
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
  $('plan-lede').innerHTML =
    where + '원클릭은 이렇게 해요: 확실한 캐시는 격리로 정리하고(되돌리기 가능), 애매한 건 아래 질문으로 모아서 보여드려요.'
  $('plan3').innerHTML = `
    <div class="stat"><div class="n g">${fmtBytes(r.plan.autoBytes)}</div><div class="l">지금 정리 가능<br>확실한 캐시 ${r.plan.autoCount.toLocaleString()}개 · 규칙 확증분만</div></div>
    <div class="stat"><div class="n a">${fmtBytes(r.plan.askBytes)}</div><div class="l">물어보면 정리 가능<br>애매한 ${r.plan.askCount.toLocaleString()}개 · 아래 질문으로</div></div>
    <div class="stat"><div class="n m">${fmtBytes(r.plan.lockBytes)}</div><div class="l">지켜드린 것<br>${r.plan.lockCount.toLocaleString()}개 · 건드리면 위험</div></div>`

  $('apply-note').innerHTML = esc(r.plan.inferredBytes > 0
    ? `규칙이 확증 못 한 ${fmtBytes(r.plan.inferredBytes)}는 존 A로 보여도 자동 정리에서 뺐어요. 추론만으로는 자동으로 안 지웁니다(오삭제 방어선).`
    : '자동 정리 대상은 전부 규칙이 확증한 캐시예요. 지워도 다시 생깁니다.')

  renderQuestions(r.questions)
  renderKept(r.kept, r.plan.lockBytes)

  $('hero-num').textContent = fmtBytes(r.plan.autoBytes + r.plan.askBytes)
  $('hero-num').classList.remove('muted')
  $('hero-cap').innerHTML = `이 폴더에서 <b style="color:var(--ink)">정리 가능</b> · 지금 즉시 ${fmtBytes(r.plan.autoBytes)} + 물어보면 ${fmtBytes(r.plan.askBytes)}`

  const applyBtn = $('apply-btn') as HTMLButtonElement
  applyBtn.disabled = r.plan.autoBytes === 0
  // 데스크톱에서는 실제로 정리한다. 브라우저에서는 안내만.
  document.querySelectorAll<HTMLElement>('#s-home .pill.desk').forEach((p) => { p.hidden = inTauri })
  applyBtn.textContent = inTauri ? `확실한 캐시 ${fmtBytes(r.plan.autoBytes)} 정리하기` : '확실한 캐시 정리하기'
}

function renderQuestions(questions: Question[]) {
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
      <div class="opts">${q.options.map((o) => `<button class="opt${o.outcome === 'KEEP' ? ' keep' : ''}"
        data-outcome="${o.outcome}" data-preview="${esc(o.preview)}">${esc(o.label)}</button>`).join('')}</div>
      <div class="q-answered" hidden></div>
      <div class="q-stake">걸린 용량: ${fmtBytes(q.stakeBytes)} · ${q.stakeCount.toLocaleString()}개</div>
    </div>`).join('')
  qEl.querySelectorAll<HTMLButtonElement>('.opt').forEach((btn) => btn.addEventListener('click', () => {
    const q = btn.closest('.q')!
    q.querySelectorAll('.opt').forEach((o) => o.classList.remove('chosen'))
    btn.classList.add('chosen')
    const ans = q.querySelector('.q-answered') as HTMLElement
    ans.hidden = false
    const tag = !inTauri && btn.dataset.outcome !== 'KEEP' ? ' <span class="pill desk">데스크톱 앱에서 실행</span>' : ''
    ans.innerHTML = '→ ' + esc(btn.dataset.preview!) + tag
  }))
}

function renderKept(kept: { meaning: string; bytes: number }[], lockBytes: number) {
  const el = $('kept')
  if (!kept.length) { el.hidden = true; return }
  el.hidden = false
  el.innerHTML = `<div style="font-size:12px;font-weight:700;color:var(--safe)">지켜드린 것 — 지웠으면 뭔가 깨졌을 것들</div>
    <div class="n">${fmtBytes(lockBytes)}</div>
    <ul>${kept.map((k) => `<li>${esc(k.meaning)} — ${fmtBytes(k.bytes)}</li>`).join('')}</ul>
    <div style="font-size:11.5px;color:var(--muted);margin-top:8px">경쟁 도구는 "지운 양"을 자랑해요. 우리는 "지킨 양"을 보여드립니다.</div>`
}

/* ── 스캔 실행 ─────────────────────────────────────────────── */

/**
 * 오래 걸리는 작업 중에 '얼마나 지났는지'를 보여준다.
 *
 * 엔진은 결과를 한 번에 돌려주기 때문에 진행률(%)을 만들 수 없다. 없는 진행률을
 * 지어내느니 경과 시간을 정직하게 보여준다 — 멈춘 게 아니라는 것만 알면 된다.
 */
function startTicker(prefix: string): () => void {
  const started = Date.now()
  const paint = () => {
    const s = Math.round((Date.now() - started) / 1000)
    const t = s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`
    $('status').textContent = `${prefix} · ${t}`
  }
  paint()
  const timer = setInterval(paint, 1000)
  return () => clearInterval(timer)
}

/** 기본 스캔 대상(이 PC의 주요 폴더)을 미리 안내한다. 뭘 볼 건지 먼저 말한다. */
async function describeDefaultRoots(): Promise<string> {
  try {
    const d = await engine('default-roots')
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
    $('status').textContent = `문제가 있었어요: ${(err as Error).message}`
  } finally {
    stopTicker?.()
    ;($('oneclick') as HTMLButtonElement).disabled = false
  }
}

// ★ 화살표로 감싼다. addEventListener는 이벤트 객체를 첫 인자로 넘기는데,
//   그게 pickFolder 자리에 들어가면 항상 truthy가 돼서 기본 스캔이 사라진다.
$('oneclick').addEventListener('click', () => runScan(false))
$('pick2').addEventListener('click', () => runScan(true))

/* ── 정리 실행 (데스크톱: 진짜 격리 / 브라우저: 안내) ── */
$('apply-btn').addEventListener('click', async () => {
  if (!inTauri) {
    alert('실제 정리(격리로 이동)는 데스크톱 앱에서 실행됩니다.\n\n브라우저는 보안상 파일을 옮기거나 지울 수 없어요.')
    return
  }
  const btn = $('apply-btn') as HTMLButtonElement
  btn.disabled = true; btn.textContent = '정리 중...'
  try {
    // 경로가 없으면(기본 스캔) 엔진이 같은 기본 목록을 다시 씁니다 — 방금 본 그 범위.
    const res = await engine('apply-sweep', scannedPath ? [scannedPath] : [])
    $('apply-note').innerHTML =
      `<b style="color:var(--safe)">${res.quarantinedCount.toLocaleString()}개를 격리했어요.</b> ` +
      `지금 즉시 확보는 0 — 격리는 옮기기만 한 거예요. <b>30일 뒤 ${fmtBytes(res.bytesAfterGrace)}</b>가 최종 확보되고, ` +
      `그 사이 언제든 격리함에서 되돌릴 수 있어요.` +
      (res.failed.length ? ` (${res.failed.length}개는 사용 중이라 건너뜀)` : '')
    btn.textContent = '정리 완료'
    quarLoaded = false // 격리함 새로고침 필요
  } catch (err) {
    $('apply-note').textContent = `정리 실패: ${(err as Error).message}`
    btn.disabled = false; btn.textContent = '다시 시도'
  }
})

/* ── 숨은 공간 (데스크톱: 실측) ─────────────────────────────── */
async function loadHidden() {
  const card = $('hiber-card')
  card.innerHTML = `<div class="empty">이 PC를 확인하는 중...</div>`
  try {
    const data = await engine('probe')
    if (!data.findings.length) { card.innerHTML = `<div class="empty">회수할 숨은 공간이 없어요. 이미 깔끔하네요.</div>`; return }
    card.innerHTML = data.findings
      .map((f: any, i: number) => explainCard(f, i))
      .join('<hr style="border:0;border-top:1px solid var(--line);margin:22px 0">')
    wireAssists(card, data.findings)
  } catch (err) {
    card.innerHTML = `<div class="note">숨은 공간을 확인하지 못했어요: ${esc((err as Error).message)}</div>`
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
       <span style="font-size:12px;color:var(--muted);margin-left:10px">${esc(f.assist.note)}</span>`
    : `<span class="pill desk">실행(관리자 권한)은 다음 업데이트에서 연결됩니다</span>`

  return `
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
      <h2 style="font-size:17px;font-weight:750">${esc(f.title)}</h2>
      <span style="font-family:var(--mono);font-size:20px;font-weight:800;color:var(--safe);margin-left:auto">${gb(f.bytes)}</span>
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
        alert('실행하지 못했어요: ' + (err as Error).message)
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
  host.innerHTML = `<div style="font-size:12.5px;color:var(--muted);margin-top:10px">사진을 확인하는 중… (수천 장이면 몇 분 걸릴 수 있어요)</div>`
  try {
    const p = await engine('photos-plan')
    if (!p.screenshotCount && !p.dupGroupCount) {
      host.innerHTML = `<div style="font-size:13px;color:var(--safe);margin-top:10px">
        사진 ${p.scanned.toLocaleString()}장을 봤는데 정리할 게 없어요. 이미 깔끔합니다.</div>`
      return
    }

    const dupPreview = p.dupGroups.slice(0, 3).map((g: any) =>
      `<div style="font-size:12px;color:var(--ink-2);padding:2px 0">
        · 남길 것 <b>${esc(g.keeper.name)}</b> — ${esc(g.keeperReason)} (사본 ${g.copies.length}장)</div>`).join('')

    host.innerHTML = `
      <div style="border:1px solid var(--line);border-radius:8px;padding:12px;margin-top:10px;background:var(--surface-2)">
        <div style="font-size:12px;color:var(--muted)">사진 ${p.scanned.toLocaleString()}장을 봤어요</div>
        ${p.screenshotCount ? `<div style="font-size:13.5px;font-weight:650;margin-top:6px">
          오래된 스크린샷 ${p.screenshotCount.toLocaleString()}장 · ${fmtBytes(p.screenshotBytes)}</div>
          <div style="font-size:12px;color:var(--muted)">최근 ${p.recentScreenshots}장은 아직 쓰실 수 있어 그대로 둡니다.
            정리 폴더로 옮기기만 해요.</div>` : ''}
        ${p.dupGroupCount ? `<div style="font-size:13.5px;font-weight:650;margin-top:8px">
          같은 사진이 여러 벌 — ${p.dupGroupCount.toLocaleString()}묶음 · ${fmtBytes(p.dupBytes)}</div>
          <div style="font-size:12px;color:var(--muted)">원본은 그대로 두고 사본만 격리함으로 보냅니다(30일 되돌리기).</div>
          <div style="margin-top:6px">${dupPreview}</div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          ${p.screenshotCount ? `<button class="btn" data-photos="screenshots">스크린샷 정리</button>` : ''}
          ${p.dupGroupCount ? `<button class="btn ghost" data-photos="duplicates">중복 사본만 정리</button>` : ''}
        </div>
        <div style="font-size:12px;color:var(--muted);margin-top:8px">
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
            <div style="font-size:13.5px;font-weight:650;color:var(--safe)">정리했어요</div>
            <div style="font-size:12.5px;color:var(--ink-2);margin-top:4px">
              ${r.movedCount ? `스크린샷 ${r.movedCount.toLocaleString()}장을 ${esc(r.destFolder)}로 옮겼어요.<br>` : ''}
              ${r.quarantinedCount ? `중복 사본 ${r.quarantinedCount.toLocaleString()}장(${fmtBytes(r.quarantinedBytes)})을 격리함으로 보냈어요 — 30일 안에 되돌릴 수 있습니다.<br>` : ''}
              ${r.failed.length ? `${r.failed.length}장은 사용 중이라 건너뛰었습니다.` : ''}</div>
          </div>`
        } catch (err) {
          host.innerHTML = `<div class="note" style="margin-top:10px">정리하지 못했어요: ${esc((err as Error).message)}</div>`
        }
      })
    })
  } catch (err) {
    host.innerHTML = `<div class="note" style="margin-top:10px">확인하지 못했어요: ${esc((err as Error).message)}</div>`
  }
}

/**
 * 콘텐츠의 단계를 앱이 실행한다 — 단, 미리보기가 먼저다.
 * "정리했습니다"라고 통보하는 도구가 되지 않으려면 이 순서를 지켜야 한다.
 */
async function tidyFolderFlow(target: string, host: HTMLElement) {
  host.innerHTML = `<div style="font-size:12.5px;color:var(--muted);margin-top:10px">무엇을 옮길지 확인하는 중…</div>`
  try {
    const p = await engine('tidy-folder-plan', [target])
    if (!p.moveCount && !p.broken.length) {
      host.innerHTML = `<div style="font-size:13px;color:var(--safe);margin-top:10px">
        이미 정리돼 있어요. 옮길 게 없습니다.</div>`
      return
    }

    const list = p.moves.slice(0, 8).map((m: any) =>
      `<div style="font-size:12px;color:var(--ink-2);padding:2px 0">· ${esc(m.name)}</div>`).join('')

    host.innerHTML = `
      <div style="border:1px solid var(--line);border-radius:8px;padding:12px;margin-top:10px;background:var(--surface-2)">
        <div style="font-size:13.5px;font-weight:650">${p.moveCount.toLocaleString()}개를 옮길게요
          ${p.bytes ? `<span style="color:var(--muted);font-weight:400">· ${fmtBytes(p.bytes)}</span>` : ''}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">
          → ${esc(p.destFolder)}<br>최근 ${p.keepCount}개는 작업 중으로 보고 그대로 둡니다.
          ${p.broken.length ? `<br>대상이 사라진 바로가기 ${p.broken.length}개는 격리함으로 보냅니다(30일 되돌리기).` : ''}
        </div>
        <div style="margin-top:8px">${list}${p.moveCount > 8 ? `<div style="font-size:12px;color:var(--muted)">…외 ${p.moveCount - 8}개</div>` : ''}</div>
        <button class="btn" data-tidyapply="${esc(target)}" style="margin-top:10px">옮기기</button>
        <span style="font-size:12px;color:var(--muted);margin-left:8px">지우지 않습니다. 언제든 되돌릴 수 있어요.</span>
      </div>`

    host.querySelector<HTMLButtonElement>('[data-tidyapply]')!.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement
      btn.disabled = true
      btn.textContent = '옮기는 중…'
      try {
        const r = await engine('tidy-folder-apply', [target])
        host.innerHTML = `<div style="border:1px solid var(--line);border-left:3px solid var(--safe);
              border-radius:8px;padding:12px;margin-top:10px;background:var(--surface)">
          <div style="font-size:13.5px;font-weight:650;color:var(--safe)">${r.movedCount.toLocaleString()}개를 옮겼어요</div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px">
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
        host.innerHTML = `<div class="note" style="margin-top:10px">옮기지 못했어요: ${esc((err as Error).message)}</div>`
      }
    })
  } catch (err) {
    host.innerHTML = `<div class="note" style="margin-top:10px">확인하지 못했어요: ${esc((err as Error).message)}</div>`
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
        <b style="font-size:15px">${esc(r.title)}</b>
        <span style="font-size:11.5px;color:var(--accent);font-weight:700">${esc(CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL])}</span>
        <span style="font-size:12px;color:var(--muted)">${r.minutes}분 · ${meta}</span>
        ${r.streak > 1 ? `<span style="font-size:12px;color:var(--safe);font-weight:700">${r.streak}회 연속</span>` : ''}
        <button class="opt" data-tidy="${esc(r.id)}" data-done="${state === 'done' ? '0' : '1'}"
                style="margin-left:auto">${state === 'done' ? '되돌리기' : '했어요'}</button>
      </div>
      <div style="font-size:13px;color:var(--ink-2);margin-top:8px;line-height:1.6">${esc(r.why)}</div>
      <details style="margin-top:8px">
        <summary style="cursor:pointer;font-size:12.5px;color:var(--muted)">이렇게 하면 됩니다</summary>
        <ol style="margin:8px 0 0;padding-left:20px;font-size:13px;color:var(--ink-2);line-height:1.7">
          ${r.steps.map((s: string) => `<li>${esc(s)}</li>`).join('')}
        </ol>
        ${r.tip ? `<div style="font-size:12.5px;color:var(--muted);margin-top:8px">막히는 지점: ${esc(r.tip)}</div>` : ''}
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
      <h2 style="font-size:16px;font-weight:750">오늘 할 것 ${d.due.length}개</h2>
      <span style="margin-left:auto;font-size:12.5px;color:var(--muted)">
        오늘 완료 ${d.doneToday.length}개 · 전체 ${d.total}개</span>
    </div>
    ${d.due.length
      ? d.due.map((r: any) => card(r, 'due')).join('')
      : '<div class="empty">오늘 할 건 다 하셨어요. 더 안 하셔도 됩니다.</div>'}
    ${d.doneToday.length ? `<details open style="margin-top:16px">
      <summary style="cursor:pointer;font-size:13px;color:var(--safe);font-weight:600">오늘 끝낸 ${d.doneToday.length}개</summary>
      ${doneCards}</details>` : ''}
    ${d.later.length ? `<details style="margin-top:12px">
      <summary style="cursor:pointer;font-size:13px;color:var(--muted)">아직 때가 아닌 ${d.later.length}개</summary>
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
    host.innerHTML = `<div style="margin-top:16px;font-size:12.5px;color:var(--muted)">
      혼자 하기 어려운 정리가 있으신가요?
      <button class="opt" id="ref-ask" style="margin-left:6px">사람 도움 알아보기</button></div>`
    document.getElementById('ref-ask')?.addEventListener('click', () => renderReferral(plan, true))
    return
  }

  host.innerHTML = `
    <div style="margin-top:18px;border:1px solid var(--line-2);border-radius:12px;padding:16px;background:var(--surface)">
      <div style="font-size:12px;font-weight:700;color:var(--accent)">사람이 하면 빠른 것</div>
      <h2 style="font-size:16px;font-weight:750;margin:6px 0 4px">여기부터는 혼자 하기 어려울 수 있어요</h2>
      <p style="font-size:13px;color:var(--ink-2);line-height:1.6">
        아래는 기록을 보고 고른 것이고, <b style="color:var(--ink)">안 누르셔도 됩니다.</b></p>

      ${suggestions.map((s, i) => `
        <div style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px">
          <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
            <b style="font-size:14.5px">${esc(s.service.label)}</b>
            <button class="opt" data-ref="${i}" style="margin-left:auto">문의 내용 만들기</button>
          </div>
          <div style="font-size:12.5px;color:var(--muted);margin-top:4px">왜 보여드리나: ${esc(s.reason)}</div>
          <div style="font-size:13px;color:var(--ink-2);margin-top:6px">${esc(s.service.whatTheyDo)}</div>
          <div style="font-size:12.5px;color:var(--muted);margin-top:4px">언제 부르나: ${esc(s.service.when)}</div>
          <div style="font-size:12.5px;color:var(--amb);margin-top:4px">비용: ${esc(s.service.priceNote)}</div>
          <div data-refform="${i}"></div>
        </div>`).join('')}

      <div style="border-top:1px solid var(--line);margin-top:14px;padding-top:12px;font-size:12px;color:var(--muted);line-height:1.7">
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
          <div style="font-size:12.5px;color:var(--muted)">보낼 내용을 먼저 보여드릴게요. 확인하신 뒤에만 나갑니다.</div>
          <input id="ref-region-${i}" placeholder="지역 (예: 서울 강남구)" style="width:100%;margin-top:8px;padding:9px;
            border:1px solid var(--line-2);border-radius:7px;background:var(--surface);color:var(--ink);font-size:13.5px">
          <textarea id="ref-note-${i}" rows="2" placeholder="어떤 게 제일 급한지 (선택)" style="width:100%;margin-top:6px;padding:9px;
            border:1px solid var(--line-2);border-radius:7px;background:var(--surface);color:var(--ink);font-size:13.5px"></textarea>
          <input id="ref-contact-${i}" placeholder="연락 받으실 방법 (선택)" style="width:100%;margin-top:6px;padding:9px;
            border:1px solid var(--line-2);border-radius:7px;background:var(--surface);color:var(--ink);font-size:13.5px">
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
          <pre style="margin-top:8px;padding:10px;background:var(--surface);border:1px solid var(--line);
            border-radius:7px;font-size:12.5px;white-space:pre-wrap;color:var(--ink-2)">${esc(r.text)}</pre>
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
async function loadStartup() {
  const host = $('startup-body')
  host.innerHTML = `<div class="empty">시작프로그램을 읽는 중…</div>`
  try {
    const d = await engine('startup')
    const entries: any[] = d.entries

    const row = (e: any, i: number) => {
      const v = e.verdict
      const tone = v.zone === 'LOCKED' ? 'var(--lock)' : v.suggestible ? 'var(--amb)' : 'var(--muted)'
      const btn = !e.canToggle
        ? `<span class="pill desk" style="margin-top:8px">모든 사용자용이라 관리자 권한이 필요해요</span>`
        : `<button class="opt" data-toggle="${i}" style="margin-top:8px">${e.enabled ? '끄기' : '다시 켜기'}</button>`
      return `<div style="padding:12px 0;border-top:1px solid var(--line)">
        <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
          <b style="font-size:14.5px">${esc(e.name)}</b>
          <span style="font-size:12px;color:${tone};font-weight:700">${esc(v.meaning)}</span>
          <span style="margin-left:auto;font-size:12.5px;color:${e.enabled ? 'var(--ink-2)' : 'var(--muted)'}">
            ${e.enabled ? '켜짐' : '꺼둠'}</span>
        </div>
        <div style="font-size:12.5px;color:var(--muted);margin-top:3px">${esc(v.reason)}</div>
        <div style="font-size:12.5px;color:var(--ink-2);margin-top:3px">끄면: ${esc(v.ifDisabled)}</div>
        ${e.command ? `<div style="font-size:11.5px;color:var(--muted);margin-top:3px">${esc(e.command)}</div>` : ''}
        ${btn}
      </div>`
    }

    // 제안 → 나머지 켜짐 → 꺼둔 것 순. 판단이 선 것부터 보여준다.
    const suggest = entries.filter((e) => e.verdict.suggestible)
    const others = entries.filter((e) => !e.verdict.suggestible && e.enabled)
    const off = entries.filter((e) => !e.enabled)

    host.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:10px;margin:14px 0 4px;flex-wrap:wrap">
        <h2 style="font-size:16px;font-weight:750">켜져 있는 ${d.enabledCount}개 중 ${suggest.length}개를 제안</h2>
        <span style="margin-left:auto;font-size:12.5px;color:var(--muted)">전체 ${entries.length}개</span>
      </div>
      ${suggest.length ? suggest.map(row).join('') : '<div class="empty">지금은 끄자고 권할 만한 항목이 없어요.</div>'}

      <details style="margin-top:18px">
        <summary style="cursor:pointer;font-size:13px;color:var(--muted)">
          제안하지 않은 ${others.length}개와 그 이유</summary>
        <div>${others.map(row).join('')}</div>
      </details>
      ${off.length ? `<details style="margin-top:10px">
        <summary style="cursor:pointer;font-size:13px;color:var(--muted)">꺼둔 ${off.length}개 (되돌릴 수 있어요)</summary>
        <div>${off.map(row).join('')}</div></details>` : ''}
      ${d.logonTaskCount ? `<p class="note" style="margin-top:14px">
        이 외에 <b>로그온 예약작업 ${d.logonTaskCount}개</b>가 더 있습니다. 대부분 시스템이 만든 것이라
        관리자 권한이 있어야 손댈 수 있어서, 여기서는 개수만 알려드려요.</p>` : ''}
      <p class="note" style="margin-top:10px">부팅이 몇 초 빨라지는지는 윈도우가 알려주지 않습니다.
        그래서 <b>"○초 단축" 같은 숫자를 지어내지 않습니다.</b> 작업관리자에도 같은 상태로 보이고, 거기서도 되돌릴 수 있어요.</p>`

    host.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const e = entries[+btn.dataset.toggle!]
        btn.disabled = true
        try {
          await engine('startup-set', [e.id, e.enabled ? 'off' : 'on'])
          startupLoaded = false
          loadStartup() // 실제 상태를 다시 읽는다 — 화면만 바꾸지 않는다
        } catch (err) {
          alert('바꾸지 못했어요: ' + (err as Error).message)
          btn.disabled = false
        }
      })
    })
  } catch (err) {
    host.innerHTML = `<div class="note">시작프로그램을 읽지 못했어요: ${esc((err as Error).message)}</div>`
  }
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
        <h2 style="font-size:16px;font-weight:750">제거 후보 ${d.suggestions.length}개 · ${fmtBytes(d.suggestibleBytes)}</h2>
        <span style="margin-left:auto;font-size:12.5px;color:var(--muted)">설치 항목 ${d.totalScanned}개 중</span>
      </div>`

    if (!d.suggestions.length) {
      host.innerHTML = head + `<div class="empty">오래 안 쓴 프로그램을 찾지 못했어요. 실행 기록으로 확인할 수 있는 것만 제안합니다.</div>`
        + excludedBlock(d)
      return
    }

    host.innerHTML = head + d.suggestions.map((p: any, i: number) => `
      <div style="padding:12px 0;border-top:1px solid var(--line)">
        <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
          <b style="font-size:14.5px">${esc(p.name)}</b>
          ${p.version ? `<span style="font-size:12px;color:var(--muted)">${esc(p.version)}</span>` : ''}
          <span style="margin-left:auto;font-size:13px;font-weight:700">${fmtBytes(p.bytes)}</span>
        </div>
        <div style="font-size:12.5px;color:var(--muted);margin-top:4px">${esc(p.reason)}</div>
        ${p.installLocation ? `<div style="font-size:12px;color:var(--muted);margin-top:2px">${esc(p.installLocation)}</div>` : ''}
        <button class="opt" data-uninstall="${i}" style="margin-top:8px">제거 프로그램 열기</button>
      </div>`).join('') + excludedBlock(d)

    host.querySelectorAll<HTMLButtonElement>('[data-uninstall]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const p = d.suggestions[+btn.dataset.uninstall!]
        // 되돌릴 수 없는 유일한 동작 — 반드시 개별로 확인받는다.
        if (!confirm(`"${p.name}"의 제거 프로그램을 실행할까요?\n\n제조사가 만든 정식 제거 마법사가 열립니다. 이 작업은 되돌릴 수 없어요.`)) return
        try {
          await TAURI.core.invoke('run_uninstaller', { command: p.uninstallString })
          btn.textContent = '제거 프로그램을 열었어요'
          btn.disabled = true
        } catch (err) {
          alert('제거 프로그램을 실행하지 못했어요: ' + (err as Error).message)
        }
      })
    })
  } catch (err) {
    host.innerHTML = `<div class="note">프로그램 목록을 읽지 못했어요: ${esc((err as Error).message)}</div>`
  }
}

/** 무엇을 왜 제외했는지 — "안 건드린 것"을 보여주는 게 신뢰의 근거다. */
function excludedBlock(d: any): string {
  if (!d.excluded?.length) return ''
  return `<details style="margin-top:16px">
    <summary style="cursor:pointer;font-size:13px;color:var(--muted)">제안하지 않은 ${d.excludedCount}개와 그 이유</summary>
    <div style="margin-top:8px">${d.excluded.map((e: any) =>
      `<div style="font-size:12px;color:var(--muted);padding:3px 0">${esc(e.name)} — ${esc(e.reason)}</div>`).join('')}</div>
  </details>`
}

/* ── 다른 드라이브로 옮기기 ──────────────────────────────────── */
let moveDest: string | null = null

async function loadMove() {
  const host = $('move-body')
  host.innerHTML = `<div class="card"><div class="empty">옮길 폴더와 대상 드라이브를 고르면 계획을 보여드려요.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <button class="opt" id="mv-src">옮길 폴더 고르기</button>
      <button class="opt" id="mv-dst">대상 드라이브 고르기</button>
    </div>
    <div id="mv-status" style="font-size:12.5px;color:var(--muted);margin-top:10px"></div></div>`

  let src: string | null = null
  const status = () => {
    $('mv-status').textContent =
      `${src ? '옮길 폴더: ' + src : '옮길 폴더를 고르세요'} · ${moveDest ? '대상: ' + moveDest : '대상 드라이브를 고르세요'}`
  }
  status()

  const pick = async () => (await TAURI.dialog.open({ directory: true })) as string | null

  $('mv-src').addEventListener('click', async () => {
    src = await pick(); status(); if (src && moveDest) planMove(src, moveDest)
  })
  $('mv-dst').addEventListener('click', async () => {
    moveDest = await pick(); status(); if (src && moveDest) planMove(src, moveDest)
  })
}

async function planMove(src: string, dest: string) {
  const host = $('move-body')
  const prev = host.innerHTML
  host.innerHTML = prev + `<div class="empty">옮길 수 있는 것을 찾는 중…</div>`
  try {
    const d = await engine('relocate-plan', [src, dest])
    if (!d.destination.ok) {
      host.innerHTML = prev + `<div class="note">${esc(d.destination.reason)}</div>`
      return
    }
    if (!d.count) {
      host.innerHTML = prev + `<div class="empty">옮길 만한 파일(100MB 이상)이 없어요.${
        d.refusedCount ? ` 안전을 위해 제외한 항목이 ${d.refusedCount}개 있습니다.` : ''}</div>`
      return
    }
    host.innerHTML = prev + `<div class="card" style="margin-top:12px">
      <div style="display:flex;align-items:baseline;gap:10px">
        <h2 style="font-size:16px;font-weight:750">${d.count.toLocaleString()}개 · ${fmtBytes(d.bytes)}</h2>
        <span style="margin-left:auto;font-size:12.5px;color:var(--muted)">→ ${esc(d.destFolder)}</span>
      </div>
      <div style="font-size:12.5px;color:var(--muted);margin-top:4px">지우지 않습니다. 옮긴 기록이 남아 언제든 되돌릴 수 있어요.</div>
      ${d.items.slice(0, 30).map((it: any) => `<div style="padding:7px 0;border-top:1px solid var(--line);font-size:12.5px">
        <div style="color:var(--ink-2)">${esc(it.path)}</div>
        <div style="color:var(--muted)">${fmtBytes(it.size)} · ${esc(it.meaning)}</div></div>`).join('')}
      ${d.refusedCount ? `<div style="font-size:12px;color:var(--muted);margin-top:10px">옮기면 위험해서 제외한 항목 ${d.refusedCount}개 (프로그램 폴더·앱 설정·동기화 폴더 등)</div>` : ''}
      <button class="oneclick" id="mv-apply" style="margin-top:14px">${fmtBytes(d.bytes)} 옮기기</button>
    </div>`

    $('mv-apply').addEventListener('click', async () => {
      const btn = $('mv-apply') as HTMLButtonElement
      btn.disabled = true; btn.textContent = '옮기는 중…'
      try {
        const r = await engine('relocate-apply', [src, dest])
        alert(`${r.movedCount.toLocaleString()}개(${fmtBytes(r.movedBytes)})를 옮겼어요.` +
          (r.failed.length ? `\n${r.failed.length}개는 건너뛰었습니다.` : ''))
        loadMove()
      } catch (err) {
        alert('옮기지 못했어요: ' + (err as Error).message)
        btn.disabled = false
      }
    })
  } catch (err) {
    host.innerHTML = prev + `<div class="note">계획을 세우지 못했어요: ${esc((err as Error).message)}</div>`
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
      ? `<div class="note" style="margin-bottom:12px">유예 ${data.graceDays}일이 끝난
           <b>${lastPurge.purgedCount.toLocaleString()}개(${fmtBytes(lastPurge.bytes)})</b>를 최종 삭제했어요.
           여기서 사라진 만큼 실제 용량이 비었습니다.</div>`
      : ''

    if (!data.items.length) {
      host.innerHTML = `<div class="card">${purgeNote}<div class="empty">아직 격리된 항목이 없어요.</div></div>`
      return
    }
    const day = 86400000
    const drives = [...new Set(data.items.map((it: any) => (it.root ?? '').slice(0, 2)))].filter(Boolean)
    host.innerHTML = `<div class="card">
      ${purgeNote}
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <h2 style="font-size:16px;font-weight:750">격리된 ${data.items.length.toLocaleString()}개 · ${fmtBytes(data.totalBytes)}</h2>
        ${drives.length > 1 ? `<span style="font-size:12px;color:var(--muted)">드라이브 ${drives.join(' · ')}</span>` : ''}
        <button class="btn" id="restore-all" style="margin-left:auto">전부 되돌리기</button>
      </div>
      ${data.items.slice(0, 50).map((it: any) => {
        const left = Math.ceil((data.graceDays * day - (Date.now() - it.quarantinedAt)) / day)
        return `<div style="padding:8px 0;border-top:1px solid var(--line);font-size:12.5px">
          <div style="color:var(--ink-2)">${esc(it.originalPath)}</div>
          <div style="color:var(--muted)">${fmtBytes(it.size)} · ${it.expired ? '만료됨 — 곧 삭제' : left + '일 남음'} · ${esc(it.reason)}</div></div>`
      }).join('')}
      ${data.items.length > 50 ? `<div style="font-size:12px;color:var(--muted);margin-top:10px">…외 ${(data.items.length - 50).toLocaleString()}개</div>` : ''}
    </div>`
    document.getElementById('restore-all')?.addEventListener('click', async () => {
      const r = await engine('restore', ['--all'])
      alert(`${r.restoredCount.toLocaleString()}개를 되돌렸어요.`)
      loadQuar()
    })
  } catch (err) {
    host.innerHTML = `<div class="card"><div class="note">격리함을 읽지 못했어요: ${esc((err as Error).message)}</div></div>`
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
    const res = await fetch(manifest.browser_download_url, { cache: 'no-store' })
    if (!res.ok) return null
    const json = await res.json()
    return typeof json?.signature === 'string' ? json.signature : null
  } catch {
    return null
  }
}

async function checkUpdate() {
  try {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' })
    if (!res.ok) return
    const r = await res.json()
    const version = (r.tag_name ?? '').replace(/^v/, '')
    const assets = r.assets ?? []
    const exe = assets.find((a: any) => /\.exe$/i.test(a.name))
    if (!version || !exe || compareVersions(version, APP_VERSION) <= 0) return // 최신이거나 더 낮음 → 조용히 넘어감
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
        progress.textContent = '업데이트에 실패했어요: ' + (err as Error).message
        ;($('um-now') as HTMLButtonElement).disabled = false
        ;($('um-later') as HTMLButtonElement).disabled = false
      }
    }
  } catch {
    /* 네트워크가 없어도 앱은 정상 작동 — 업데이트는 조용히 건너뛴다. */
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
  purgeExpiredQuarantine() // 유예 끝난 것 실제 삭제
  checkUpdate() // 시작 시 조용히 최신 버전 확인
}
