/**
 * 클린메이트 앱 화면 — 실제 데스크톱 앱의 프론트엔드
 *
 * ★ 이 화면은 버려지지 않는다. 나중에 Tauri가 감싸는 바로 그 프론트엔드다.
 *   (docs/배포-아키텍처.md §2)
 *
 * 브라우저에서 도는 것 / 못 도는 것:
 *   - 도는 것: 스캔·3-존 분류·질문 엔진. 전부 실제 엔진(classify.ts / engine.ts)이다.
 *     파일은 기기를 안 떠난다.
 *   - 못 도는 것: 실제 격리·삭제·powercfg. 브라우저의 물리적 한계다(설계 선택이 아님).
 *     그 부분은 "데스크톱 앱에서 실행"으로 정직하게 표시한다.
 */

import { isSupported, pickDirectory, scanHandle } from './browser-scanner.ts'
import { classifyOne, isAutoEligible } from '../../src/classify.ts'
import { run, fmtBytes } from '../../src/engine.ts'
import type { Classified, FileEntry } from '../../src/types.ts'

const $ = (id: string) => document.getElementById(id)!
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/* ── 화면 전환 ─────────────────────────────────────────────── */
const screens = ['home', 'hidden', 'quar']
function go(name: string) {
  for (const s of screens) $(`s-${s}`).classList.toggle('on', s === name)
  document.querySelectorAll<HTMLButtonElement>('.nav button').forEach((b) =>
    b.classList.toggle('on', b.dataset.go === name)
  )
}
document.querySelectorAll<HTMLButtonElement>('.nav button').forEach((b) =>
  b.addEventListener('click', () => go(b.dataset.go!))
)

/* ── 지원 여부 ─────────────────────────────────────────────── */
if (!isSupported()) {
  $('unsupported').hidden = false
  ;($('oneclick') as HTMLButtonElement).disabled = true
}

/* ── 브라우저용 정리 계획 ──────────────────────────────────────
   sweep.ts의 planSweep과 같은 판단을 한다. 단 scan()은 node:fs라 못 쓰므로,
   브라우저 스캔 결과에 classifyOne(순수 함수)을 직접 돌린다. R1 방어선
   (isAutoEligible = 규칙 확증분만 자동)은 그대로 지킨다. ── */
interface Plan {
  autoBytes: number
  autoCount: number
  lockBytes: number
  lockCount: number
  askBytes: number
  askCount: number
  inferredBytes: number
  safeBytes: number
  ambigBytes: number
  lockedBytes: number
  ambig: Classified[]
  keptExamples: { meaning: string; bytes: number }[]
}

function buildPlan(files: FileEntry[]): Plan {
  let autoBytes = 0, autoCount = 0, lockBytes = 0, lockCount = 0
  let askBytes = 0, askCount = 0, inferredBytes = 0
  let safeBytes = 0, ambigBytes = 0, lockedBytes = 0
  const ambig: Classified[] = []
  const keptMap = new Map<string, number>()

  for (const f of files) {
    const c = classifyOne(f)
    const z = c.verdict.zone
    if (z === 'LOCKED') {
      lockBytes += f.size; lockCount++; lockedBytes += f.size
      keptMap.set(c.verdict.meaning, (keptMap.get(c.verdict.meaning) ?? 0) + f.size)
    } else if (z === 'AMBIG') {
      askBytes += f.size; askCount++; ambigBytes += f.size
      ambig.push(c)
    } else {
      safeBytes += f.size
      if (isAutoEligible(c)) { autoBytes += f.size; autoCount++ }
      else inferredBytes += f.size
    }
  }

  const keptExamples = [...keptMap.entries()]
    .map(([meaning, bytes]) => ({ meaning, bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5)

  return { autoBytes, autoCount, lockBytes, lockCount, askBytes, askCount, inferredBytes,
    safeBytes, ambigBytes, lockedBytes, ambig, keptExamples }
}

/* ── 렌더 ──────────────────────────────────────────────────── */
function zbar(label: string, cls: string, bytes: number, total: number, count: number, desc: string) {
  const pct = total ? (bytes / total) * 100 : 0
  return `<div>
    <div class="zrow ${cls}">
      <span class="zlabel">${label}</span>
      <span class="ztrack"><span class="zfill" style="width:${pct.toFixed(1)}%"></span></span>
      <span class="zval">${fmtBytes(bytes)} · ${count.toLocaleString()}개</span>
    </div>
    <div class="zdesc">${desc}</div>
  </div>`
}

function renderResults(plan: Plan) {
  const total = plan.safeBytes + plan.ambigBytes + plan.lockedBytes

  $('zbars').innerHTML =
    zbar('존 A 안전', 'zsafe', plan.safeBytes, total, plan.autoCount,
      '캐시·로그처럼 다시 생기는 것. 규칙이 확증한 것만 자동 정리해요.') +
    zbar('존 B 애매', 'zamb', plan.ambigBytes, total, plan.askCount,
      '사용자만 아는 것. 무인 삭제 안 하고 물어봅니다.') +
    zbar('존 C 잠금', 'zlock', plan.lockedBytes, total, plan.lockCount,
      '시스템·설정·클라우드. 지우면 뭔가 깨져서 아예 안 건드려요.')

  // 원클릭 계획 3분할 — "거짓말 안 함"
  $('plan-lede').textContent =
    '원클릭은 이렇게 해요: 확실한 캐시는 격리로 정리하고(되돌리기 가능), 애매한 건 아래 질문으로 모아서 보여드려요.'
  $('plan3').innerHTML = `
    <div class="stat"><div class="n g">${fmtBytes(plan.autoBytes)}</div>
      <div class="l">지금 정리 가능<br>확실한 캐시 ${plan.autoCount.toLocaleString()}개 · 규칙 확증분만</div></div>
    <div class="stat"><div class="n a">${fmtBytes(plan.askBytes)}</div>
      <div class="l">물어보면 정리 가능<br>애매한 ${plan.askCount.toLocaleString()}개 · 아래 질문으로</div></div>
    <div class="stat"><div class="n m">${fmtBytes(plan.lockBytes)}</div>
      <div class="l">지켜드린 것<br>${plan.lockCount.toLocaleString()}개 · 건드리면 위험</div></div>`

  const applyNote = plan.inferredBytes > 0
    ? `규칙이 확증 못 한 ${fmtBytes(plan.inferredBytes)}는 존 A로 보여도 자동 정리에서 뺐어요. 추론만으로는 자동으로 안 지웁니다(오삭제 방어선).`
    : '자동 정리 대상은 전부 규칙이 확증한 캐시예요. 지워도 다시 생깁니다.'
  $('apply-note').innerHTML = esc(applyNote)

  // 질문
  const report = run(plan.ambig)
  const qEl = $('questions')
  if (report.questions.length) {
    qEl.innerHTML = report.questions.map((q, i) => `
      <div class="q" data-qi="${i}">
        <div class="q-n">질문 ${i + 1}</div>
        <div class="q-text">${esc(q.text)}</div>
        <div class="q-why">왜 묻나: ${esc(q.rationale)}</div>
        <div class="opts">
          ${q.options.map((o, oi) => `<button class="opt${o.outcome === 'KEEP' ? ' keep' : ''}"
            data-qi="${i}" data-oi="${oi}" data-outcome="${o.outcome}"
            data-preview="${esc(o.preview)}">${esc(o.label)}</button>`).join('')}
        </div>
        <div class="q-answered" hidden></div>
        <div class="q-stake">걸린 용량: ${fmtBytes(q.stakeBytes)} · ${q.stakeCount.toLocaleString()}개</div>
      </div>`).join('')

    // 답변 루프 (프론트) — 답하면 그 결과를 보여준다.
    // 실제 재분류·격리는 데스크톱 앱이 하지만, "물어보고 답을 받는" 흐름은 여기서 완성된다.
    qEl.querySelectorAll<HTMLButtonElement>('.opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = btn.closest('.q')!
        q.querySelectorAll('.opt').forEach((o) => o.classList.remove('chosen'))
        btn.classList.add('chosen')
        const ans = q.querySelector('.q-answered') as HTMLElement
        ans.hidden = false
        const desk = btn.dataset.outcome === 'KEEP' ? '' : ' <span class="pill desk">데스크톱 앱에서 실행</span>'
        ans.innerHTML = '→ ' + esc(btn.dataset.preview!) + desk
      })
    })
  } else {
    qEl.innerHTML = `<div class="note">물어볼 만한 묶음이 없어요. 애매한 항목이 적거나 잘게 흩어져 있습니다.
      Downloads처럼 파일이 많은 폴더에서 더 잘 보여요.</div>`
  }

  // 지켜드린 것
  const kept = $('kept')
  if (plan.keptExamples.length) {
    kept.hidden = false
    kept.innerHTML = `
      <div style="font-size:12px;font-weight:700;color:var(--safe)">지켜드린 것 — 지웠으면 뭔가 깨졌을 것들</div>
      <div class="n">${fmtBytes(plan.lockBytes)}</div>
      <ul>${plan.keptExamples.map((k) => `<li>${esc(k.meaning)} — ${fmtBytes(k.bytes)}</li>`).join('')}</ul>
      <div style="font-size:11.5px;color:var(--muted);margin-top:8px">
        경쟁 도구는 “지운 양”을 자랑해요. 우리는 “지킨 양”을 보여드립니다.</div>`
  } else {
    kept.hidden = true
  }

  // 히어로 숫자 갱신
  $('hero-num').textContent = fmtBytes(plan.autoBytes + plan.askBytes)
  $('hero-num').classList.remove('muted')
  $('hero-cap').innerHTML =
    `이 폴더에서 <b style="color:var(--ink)">정리 가능</b> · 지금 즉시 ${fmtBytes(plan.autoBytes)} + 물어보면 ${fmtBytes(plan.askBytes)}`
  ;($('apply-btn') as HTMLButtonElement).disabled = plan.autoBytes === 0
}

/* ── 스캔 실행 ─────────────────────────────────────────────── */
async function runScan() {
  const dir = await pickDirectory()
  if (!dir) return

  ;($('oneclick') as HTMLButtonElement).disabled = true
  $('status').textContent = '읽는 중...'

  try {
    const scanned = await scanHandle(dir, (n) => {
      $('status').textContent = `읽는 중... ${n.toLocaleString()}개`
    })
    $('status').textContent =
      `${scanned.files.length.toLocaleString()}개 · ${fmtBytes(scanned.totalBytes)} · ${Math.round(scanned.elapsedMs)}ms`

    const plan = buildPlan(scanned.files)
    ;($('results') as HTMLElement).hidden = false
    renderResults(plan)
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (err) {
    $('status').textContent = `읽지 못했어요: ${(err as Error).message}`
  } finally {
    ;($('oneclick') as HTMLButtonElement).disabled = false
  }
}

$('oneclick').addEventListener('click', runScan)
$('pick2').addEventListener('click', runScan)
$('apply-btn').addEventListener('click', () => {
  alert('실제 정리(격리로 이동)는 데스크톱 앱에서 실행됩니다.\n\n브라우저는 보안상 파일을 옮기거나 지울 수 없어요. 이 화면은 그대로 데스크톱 앱의 프론트엔드가 됩니다.')
})

/* ── 숨은 공간 카드 (설명 레이어 시연) ─────────────────────────
   실측·실행은 데스크톱 앱(probes/hiberfil.ts)에서. 여기선 7문답 설명이
   어떻게 보이는지를 보여준다. 숫자는 예시(RAM 32GB PC 기준). ── */
$('hiber-card').innerHTML = `
  <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
    <h2 style="font-size:17px;font-weight:750">최대절전 파일 (hiberfil.sys)</h2>
    <span style="font-family:var(--mono);font-size:20px;font-weight:800;color:var(--safe);margin-left:auto">12.7GB</span>
  </div>
  <div style="font-size:12px;color:var(--muted);margin:2px 0 16px">예시 · RAM 32GB 데스크톱 기준. 실제 값은 데스크톱 앱이 이 PC에서 실측합니다.</div>
  <div class="expl">
    <div class="blk"><div class="h">이게 뭔가요</div>
      <p>컴퓨터를 완전히 끄기 전에, 지금 열어둔 것들을 통째로 저장해두는 파일이에요. 다시 켜면 어제 그 상태로 돌아오게 해줍니다.</p></div>
    <div class="blk"><div class="h">왜 이렇게 큰가요</div>
      <p>메모리(RAM)를 통째로 옮겨 적어야 해서 RAM의 약 40%를 미리 잡아둡니다. 뭔가 쌓여서 커진 게 아니라 처음부터 이 크기예요 — 그래서 파일을 아무리 정리해도 절대 줄지 않아요.</p></div>
    <div class="blk"><div class="h">뭐가 이걸 쓰나요</div>
      <ul><li>최대 절전 모드 — 전원을 껐다 켜도 창이 그대로 돌아오는 기능</li>
        <li><b>빠른 시작</b> — 부팅이 몇 초 빨라지는 기능. 기본으로 켜져 있어 쓰는 줄 모르는 분이 대부분이에요</li></ul></div>
    <div class="blk warn"><div class="h">지우면 뭐가 달라지나요</div>
      <ul><li>최대 절전을 못 씁니다 (절전 모드는 그대로)</li>
        <li>빠른 시작도 꺼져서 부팅이 2~5초 느려질 수 있어요</li>
        <li>데스크톱이면 거의 체감 없어요. 노트북이면 한 번 더 생각해보세요</li></ul></div>
    <div class="blk"><div class="h">되돌릴 수 있나요</div>
      <p>네, 명령 한 줄이면 원래대로예요. 파일을 지우는 게 아니라 기능을 끄는 거라, 다시 켜면 파일이 새로 생깁니다.</p></div>
    <div class="blk"><div class="h">안 지우면요</div>
      <p>아무 문제 없어요. 12.7GB를 계속 쓸 뿐입니다. 급하지 않으면 그냥 두셔도 돼요.</p></div>
  </div>
  <div style="margin-top:18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <button class="btn" disabled>최대절전 끄고 12.7GB 회수</button>
    <span class="pill desk">데스크톱 앱에서 실행 (관리자 권한)</span>
  </div>`
