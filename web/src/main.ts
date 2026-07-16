/**
 * 데모 UI — 데스크톱과 '같은 엔진'을 브라우저에서 그대로 돌린다.
 * classify.ts / engine.ts / knowledge/paths.ts 는 순수 로직이라 재사용된다.
 * 바뀌는 건 스캐너뿐(node:fs → File System Access API).
 */

import { isSupported, pickDirectory, scanHandle } from './browser-scanner.ts'
import { classify, isAutoEligible } from '../../src/classify.ts'
import { run, fmtBytes } from '../../src/engine.ts'

const $ = (id: string) => document.getElementById(id)!

const pickBtn = $('pick') as HTMLButtonElement
const statusEl = $('status')
const resultEl = $('result')
const barsEl = $('bars')
const questionsEl = $('questions')
const metricsEl = $('metrics')

if (!isSupported()) {
  $('unsupported').hidden = false
  pickBtn.disabled = true
}

function bar(label: string, cls: string, bytes: number, total: number, count: number): string {
  const pct = total ? (bytes / total) * 100 : 0
  return `
    <div class="barrow ${cls}">
      <span class="barlabel">${label}</span>
      <span class="bartrack"><span class="barfill" style="width:${pct.toFixed(1)}%"></span></span>
      <span class="barval">${fmtBytes(bytes)} · ${count}개</span>
    </div>`
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

pickBtn.addEventListener('click', async () => {
  const dir = await pickDirectory()
  if (!dir) return // 취소는 오류가 아니다

  pickBtn.disabled = true
  resultEl.hidden = true
  statusEl.textContent = '읽는 중...'

  try {
    const scanned = await scanHandle(dir, (n) => {
      statusEl.textContent = `읽는 중... ${n.toLocaleString()}개`
    })

    const { safe, ambig, locked, belowNoiseFloor } = classify(scanned.files)
    const sum = (a: typeof safe) => a.reduce((s, i) => s + i.size, 0)
    const [sB, aB, lB] = [sum(safe), sum(ambig), sum(locked)]
    const total = sB + aB + lB
    const autoOk = safe.filter(isAutoEligible).length

    statusEl.textContent =
      `${scanned.files.length.toLocaleString()}개 · ${fmtBytes(scanned.totalBytes)} · ` +
      `${Math.round(scanned.elapsedMs)}ms` +
      (belowNoiseFloor ? ` · 1MB 미만 ${belowNoiseFloor.toLocaleString()}개는 제외` : '')

    barsEl.innerHTML =
      bar('존 A 안전', 'z-safe', sB, total, safe.length) +
      bar('존 B 애매', 'z-amb', aB, total, ambig.length) +
      bar('존 C 잠금', 'z-lock', lB, total, locked.length)

    const report = run(ambig)

    questionsEl.innerHTML = report.questions.length
      ? report.questions
          .map(
            (q, i) => `
        <div class="q">
          <div class="q-n">Q${i + 1}</div>
          <div class="q-text">${esc(q.text)}</div>
          <div class="q-why">왜 묻나: ${esc(q.rationale)}</div>
          <div class="opts">${q.options
            .map((o) => `<span class="opt"><span class="oi">[${esc(o.label)}]</span> → ${esc(o.preview)}</span>`)
            .join('')}</div>
          <div class="q-stake">걸린 용량: ${fmtBytes(q.stakeBytes)} · ${q.stakeCount}개</div>
        </div>`
          )
          .join('')
      : `<div class="note" style="margin-top:14px">
           <b>물어볼 만한 묶음이 없어요.</b> 애매한 항목이 적거나 잘게 흩어져 있습니다.
           파일이 많은 Downloads 같은 폴더로 해보시면 더 잘 보여요.
         </div>`

    const ruleBacked = scanned.files.length
      ? ((scanned.files.length - ambig.filter((a) => !a.verdict.ruleBacked).length) /
          scanned.files.length) * 100
      : 0

    metricsEl.innerHTML = `
      <div class="metric"><div class="n">${report.gbPerQuestion.toFixed(2)}<span style="font-size:13px;color:var(--muted)"> GB</span></div><div class="l">질문당 해결 용량</div></div>
      <div class="metric"><div class="n">${report.questions.length}</div><div class="l">질문 수 · 4개 넘으면 피로</div></div>
      <div class="metric"><div class="n">${ruleBacked.toFixed(1)}<span style="font-size:13px;color:var(--muted)">%</span></div><div class="l">규칙 커버리지</div></div>
      <div class="metric"><div class="n">${autoOk}<span style="font-size:13px;color:var(--muted)">/${safe.length}</span></div><div class="l">자동 처리 자격 · 규칙 확증분만</div></div>`

    resultEl.hidden = false
  } catch (err) {
    statusEl.textContent = `읽지 못했어요: ${(err as Error).message}`
  } finally {
    pickBtn.disabled = false
    pickBtn.textContent = '다른 폴더 고르기'
  }
})
