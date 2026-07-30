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
import type { FileEntry, Question } from '../../src/types.ts'

/** 이 빌드의 버전. 릴리스마다 tauri.conf/Cargo와 함께 올린다. */
const APP_VERSION = '0.4.0'
/** GitHub 릴리스 API — 최신 버전·설치파일 URL을 준다(CORS 허용, 검증됨). */
const LATEST_API = 'https://api.github.com/repos/lhs0609a-cpu/cleanmate/releases/latest'

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
const screens = ['home', 'hidden', 'quar']
let hiddenLoaded = false, quarLoaded = false
function go(name: string) {
  for (const s of screens) $(`s-${s}`).classList.toggle('on', s === name)
  document.querySelectorAll<HTMLButtonElement>('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === name))
  if (inTauri && name === 'hidden' && !hiddenLoaded) { hiddenLoaded = true; loadHidden() }
  if (inTauri && name === 'quar' && !quarLoaded) { quarLoaded = true; loadQuar() }
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

  $('plan-lede').textContent = '원클릭은 이렇게 해요: 확실한 캐시는 격리로 정리하고(되돌리기 가능), 애매한 건 아래 질문으로 모아서 보여드려요.'
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
async function runScan() {
  ;($('oneclick') as HTMLButtonElement).disabled = true
  $('status').textContent = inTauri ? '폴더 고르는 중...' : '읽는 중...'
  try {
    let report: Report
    if (inTauri) {
      const path = await TAURI.dialog.open({ directory: true, title: '정리할 폴더 고르기' })
      if (!path) { $('status').textContent = ''; return }
      scannedPath = path as string
      $('status').textContent = '분석 중...'
      report = (await engine('scan-plan', [scannedPath])) as Report
      $('status').textContent = `${report.scannedFiles.toLocaleString()}개 · ${report.elapsedMs}ms`
    } else {
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
    ;($('oneclick') as HTMLButtonElement).disabled = false
  }
}

$('oneclick').addEventListener('click', runScan)
$('pick2').addEventListener('click', runScan)

/* ── 정리 실행 (데스크톱: 진짜 격리 / 브라우저: 안내) ── */
$('apply-btn').addEventListener('click', async () => {
  if (!inTauri) {
    alert('실제 정리(격리로 이동)는 데스크톱 앱에서 실행됩니다.\n\n브라우저는 보안상 파일을 옮기거나 지울 수 없어요.')
    return
  }
  if (!scannedPath) return
  const btn = $('apply-btn') as HTMLButtonElement
  btn.disabled = true; btn.textContent = '정리 중...'
  try {
    const res = await engine('apply-sweep', [scannedPath])
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
    card.innerHTML = data.findings.map((f: any) => explainCard(f)).join('')
  } catch (err) {
    card.innerHTML = `<div class="note">숨은 공간을 확인하지 못했어요: ${esc((err as Error).message)}</div>`
  }
}

function explainCard(f: any): string {
  const e = f.explain
  const gb = (n: number) => (n / 1073741824).toFixed(1) + 'GB'
  const blk = (h: string, body: string, warn = false) => `<div class="blk${warn ? ' warn' : ''}"><div class="h">${h}</div>${body}</div>`
  const ul = (arr: string[]) => `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
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
    <div style="margin-top:16px"><span class="pill desk">실행(관리자 권한)은 다음 업데이트에서 연결됩니다</span></div>`
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
    if (!data.items.length) { host.innerHTML = `<div class="card"><div class="empty">아직 격리된 항목이 없어요.</div></div>`; return }
    const day = 86400000
    host.innerHTML = `<div class="card">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px">
        <h2 style="font-size:16px;font-weight:750">격리된 ${data.items.length.toLocaleString()}개 · ${fmtBytes(data.totalBytes)}</h2>
        <button class="btn" id="restore-all" style="margin-left:auto">전부 되돌리기</button>
      </div>
      ${data.items.slice(0, 50).map((it: any) => {
        const left = Math.ceil((data.graceDays * day - (Date.now() - it.quarantinedAt)) / day)
        return `<div style="padding:8px 0;border-top:1px solid var(--line);font-size:12.5px">
          <div style="color:var(--ink-2)">${esc(it.originalPath)}</div>
          <div style="color:var(--muted)">${fmtBytes(it.size)} · ${it.expired ? '만료됨' : left + '일 남음'} · ${esc(it.reason)}</div></div>`
      }).join('')}
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
    body.innerHTML = `지금 버전은 v${APP_VERSION}이에요. ` + (m.notes ? esc(m.notes) + ' ' : '') + '받아서 자동으로 설치할게요 — 추가로 누르실 건 없어요.'
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

/* ── 데스크톱 초기화 ───────────────────────────────────────── */
if (inTauri) {
  // 데스크톱에서는 정적 데모 카드를 감추고 실측으로 대체한다.
  $('hiber-card').innerHTML = `<div class="empty">'숨은 공간' 탭을 열면 이 PC를 실측합니다.</div>`
  checkUpdate() // 시작 시 조용히 최신 버전 확인
}
