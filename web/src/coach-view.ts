/**
 * 정리 코치 화면 그리기 — 시작 · 분석 · 오늘 여기 · 같이 하기 · 이번 달
 *
 * ★ tidy-view.ts와 같은 규칙이다: 여기 있는 건 전부 "상태를 받아 문자열을
 *   돌려주는" 순수 함수다. 판단은 src/content/coach.ts·session.ts에 있고,
 *   여기선 그리기만 한다. 그래야 Node에서 그대로 테스트할 수 있다.
 *
 * ★ 이 파일에도 빨강이 없다.
 *   "흐려지는 곳"·"계속 미뤄지는 것"은 사실이지만 경고가 아니다. 한 달에 한 번
 *   사람 기분을 상하게 하는 리포트는 다음 달에 안 열린다.
 */

import type { AnalysisStep, MonthReport, TodayPick } from '../../src/content/coach.ts'
import type { SessionView } from '../../src/content/session.ts'
import type { TidyRoutine } from '../../src/content/tidy.ts'

const esc = (s: string) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/* ── 시작 ───────────────────────────────────────────────────── */

/**
 * 시작 버튼 한 줄. 화면 맨 위에 둔다.
 *
 * ★ 이 버튼이 이 탭의 유일한 '문'이다. 아래에 목록이 마흔 개 있어도
 *   처음 온 사람은 여기만 누르면 되게 만든다 — 고르는 것부터가 일이면
 *   사람은 하나도 안 고른다.
 */
export function startHtml(): string {
  return `<section class="coach start">
    <div class="t">
      <h2>정리정돈 시작</h2>
      <p>지금 상태를 보고 <b>오늘 할 한 곳</b>만 골라 드릴게요. 목록은 그다음입니다.</p>
    </div>
    <button class="btn" id="coach-go">시작하기</button>
  </section>`
}

/* ── 분석 ───────────────────────────────────────────────────── */

/**
 * 분석 화면. `shown`만큼만 밝힌다.
 *
 * ★ 진행률 막대를 안 쓴다.
 *   여기 계산은 순수 함수라 눈 깜짝할 새에 끝난다. 그런데 막대를 돌리면
 *   "오래 걸리는 일을 하고 있다"고 말하는 셈이고, 그건 거짓말이다.
 *   대신 **실제로 센 값**을 한 줄씩 내놓는다 — 화면에 뜨는 숫자가 전부
 *   진짜면 나눠 보여주는 건 연출이지 속임수가 아니다.
 */
export function analyzingHtml(steps: AnalysisStep[], shown: number): string {
  const rows = steps.slice(0, Math.max(0, shown)).map((s, i) => {
    const last = i === Math.min(shown, steps.length) - 1
    return `<li class="${last ? 'now' : 'done'}">
      <span class="lb">${esc(s.label)}</span>
      <b class="rs">${esc(s.result)}</b>
    </li>`
  }).join('')

  return `<section class="coach">
    <h2 class="an-h">지금 상태를 보는 중</h2>
    <ol class="anlist">${rows}</ol>
    <p class="note">기록은 이 컴퓨터에만 있습니다. 여기 숫자는 전부 그 기록을 센 것입니다.</p>
  </section>`
}

/* ── 오늘 여기 ──────────────────────────────────────────────── */

export function pickHtml(pick: TodayPick | null): string {
  if (!pick) {
    return `<section class="coach">
      <div class="pk-empty">
        <h2>오늘은 안 하셔도 됩니다.</h2>
        <p>할 때가 된 곳이 없어요. 없는 할 일을 만들어 드리지는 않습니다.</p>
        <button class="opt" id="coach-close">닫기</button>
      </div>
    </section>`
  }

  const r = pick.routine
  const spots = pick.spots.length
    ? `<div class="pk-spots">
         <div class="lb">여기를 꼭 같이 보세요 — 매번 빠지는 자리입니다</div>
         <ul>${pick.spots.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
       </div>`
    : ''

  return `<section class="coach">
    <div class="pk-kicker">${pick.rule === 'first' ? '여기부터가 가장 쉬워요' : '오늘은 여기'}</div>
    <h2 class="pk-title">${esc(r.title)}</h2>
    <div class="pk-meta">
      ${pick.zone ? `<span class="zn">${esc(pick.zone.name)}</span>` : ''}
      <span>${r.minutes}분</span>
      <span>${r.everyDays}일마다</span>
    </div>
    <p class="pk-why">${esc(pick.because)}</p>
    ${r.why ? `<p class="pk-sub">${esc(r.why)}</p>` : ''}
    ${spots}
    <div class="pk-act">
      ${r.steps.length
        /* ★ 단계가 없으면 '같이 하기'를 못 준다. 내가 만든 항목에는 우리가 쓴
           단계가 없고, 없는 단계를 지어내면 그 화면이 통째로 거짓말이 된다.
           그래서 그때는 바로 끝내는 버튼만 준다. */
        ? `<button class="btn" id="coach-start">같이 하기</button>`
        : `<button class="btn" id="coach-done">했어요</button>`}
      <button class="opt" id="coach-skip">오늘은 넘길게요</button>
      <button class="opt" id="coach-other">다른 곳 보기</button>
    </div>
    <p class="note">넘기셔도 아무 일 없습니다 — 넘긴 날을 세지 않습니다.</p>
  </section>`
}

/* ── 같이 하기 ──────────────────────────────────────────────── */

export function sessionHtml(v: SessionView, routine: TidyRoutine): string {
  const dots = Array.from({ length: v.stepCount }, (_, i) =>
    `<span class="dot ${i < v.stepIndex ? 'past' : i === v.stepIndex ? 'now' : ''}"></span>`
  ).join('')

  /* 시계는 남은 시간이 주인공이다 — "3분만 하면 끝"이라는 경계가 시작을 쉽게
     만든다. 넘기면 경고가 아니라 "여기까지 하셔도 됩니다"로 바뀐다. */
  const clockBlock = v.overtime
    ? `<div class="ss-clock over"><b>${esc(v.overLabel ?? '')}</b><span>${esc(v.overNote ?? '')}</span></div>`
    : `<div class="ss-clock"><b>${esc(v.remainLabel ?? '')}</b><span>남았어요</span></div>`

  const spots = v.spots.length
    ? `<div class="ss-spots">
         <div class="lb">빠지기 쉬운 곳</div>
         ${v.spots.map((s, i) =>
           `<button type="button" class="spot ${s.checked ? 'on' : ''}" data-spot="${i}">
              <span class="bx" aria-hidden="true">${s.checked ? '✓' : ''}</span>${esc(s.text)}
            </button>`).join('')}
       </div>`
    : ''

  return `<section class="coach sess">
    <div class="ss-h">
      <div class="ss-t">
        <div class="ss-kick">${esc(routine.title)}</div>
        <div class="ss-step">${v.stepIndex + 1} / ${v.stepCount}</div>
      </div>
      ${clockBlock}
    </div>
    <div class="ss-dots" aria-hidden="true">${dots}</div>

    <p class="ss-now">${esc(v.stepText)}</p>
    ${spots}

    <div class="ss-act">
      ${v.isLast
        ? `<button class="btn" id="ss-finish">다 했어요</button>`
        : `<button class="btn" id="ss-next">이 단계 끝</button>`}
      <button class="opt" id="ss-pause">${v.paused ? '다시 시작' : '잠깐 멈춤'}</button>
      ${v.stepIndex > 0 ? `<button class="opt" id="ss-back">앞 단계</button>` : ''}
      <button class="opt" id="ss-quit">그만두기</button>
    </div>
    <p class="note">그만두셔도 기록에 아무것도 안 남습니다. 벌점 같은 건 없어요.</p>
  </section>`
}

export function doneHtml(routine: TidyRoutine, line: string): string {
  return `<section class="coach">
    <div class="dn">
      <div class="dn-k">끝났습니다</div>
      <h2>${esc(routine.title)}</h2>
      <p class="dn-time">${esc(line)}</p>
      <p class="dn-sub">기록해 뒀어요. 방 지도의 그 칸에 불이 들어옵니다.</p>
      <div class="pk-act">
        <button class="btn" id="coach-go">한 곳 더</button>
        <button class="opt" id="coach-close">오늘은 여기까지</button>
      </div>
    </div>
  </section>`
}

/* ── 이번 달 리포트 ─────────────────────────────────────────── */

const monthLabel = (ym: string) => `${+ym.slice(0, 4)}년 ${+ym.slice(5, 7)}월`

/**
 * ★ 네 칸으로 나눈 게 설계다.
 *   "어디가 더러워지고 있나"를 한 덩어리로 보여주면 그냥 성적표가 된다.
 *   한 곳 / 흐려진 곳 / 아직 안 해본 것 / 계속 미뤄지는 것을 갈라놓으면
 *   각각이 **사실**로 읽힌다. 특히 '아직 안 해본 것'을 '밀린 것'과 섞지 않는
 *   것이 중요하다 — 섞는 순간 처음 켠 사람의 리포트가 통째로 빨개진다.
 */
export function reportHtml(rep: MonthReport | null | undefined): string {
  if (!rep) return ''
  const diff = rep.doneCount - rep.prevDoneCount

  const box = (
    title: string,
    empty: string,
    rows: { main: string; sub: string }[],
    cls = ''
  ) => `<div class="rp-box ${cls}">
      <h3>${esc(title)}</h3>
      ${rows.length
        ? `<ul>${rows.slice(0, 5).map((r) =>
            `<li><b>${esc(r.main)}</b><span>${esc(r.sub)}</span></li>`).join('')}</ul>
           ${rows.length > 5 ? `<p class="more">그 밖에 ${rows.length - 5}개</p>` : ''}`
        : `<p class="empty">${esc(empty)}</p>`}
    </div>`

  return `<section class="card rp">
    <div class="sechead">
      <h2>${esc(monthLabel(rep.ym))} 정리 기록</h2>
      <span class="t-small" style="margin-left:auto;color:var(--muted)">
        ${rep.doneCount}번 · ${rep.activeDays}일</span>
    </div>
    <p class="note" style="margin-bottom:14px">
      지난달은 ${rep.prevDoneCount}번이었어요${
        diff === 0 ? ' — 같습니다.' : diff > 0 ? ` — ${diff}번 늘었습니다.` : `.`
      }
      ${diff < 0 ? '<b>줄었다고 나쁜 달은 아닙니다.</b> 바쁜 달이 있습니다.' : ''}
    </p>

    <div class="rp-grid">
      ${box('정리한 곳', '이번 달엔 아직 기록이 없어요.',
        rep.cleaned.map((c) => ({ main: c.name, sub: `${c.times}번 · 마지막 ${c.daysAgo}일 전` })))}
      ${box('이번 달에 안 온 곳', '없어요 — 모든 곳을 한 번씩은 보셨습니다.',
        rep.fading.map((f) => ({ main: f.name, sub: `${f.daysAgo}일 전이 마지막` })))}
      ${box('아직 안 해본 것', '없어요 — 전부 한 번씩은 해보셨습니다.',
        rep.missed.map((m) => ({ main: m.title, sub: `${m.zoneName || '—'} · ${m.minutes}분` })))}
      ${box('계속 미뤄지는 것', '없어요.',
        rep.slipping.map((s) => ({ main: s.title, sub: `${s.everyDays}일마다인데 ${s.daysLate}일 지남` })))}
    </div>

    ${rep.focus.length
      ? `<div class="rp-focus">
          <h3>다음 달엔 이 셋만</h3>
          <p class="note">열 개를 적어두면 하나도 안 합니다. 셋만 골랐어요.</p>
          <ol>${rep.focus.map((f) =>
            `<li><b>${esc(f.title)}</b><span>${esc(f.why)}</span></li>`).join('')}</ol>
         </div>`
      : `<div class="rp-focus calm"><h3>다음 달에 딱히 챙길 게 없습니다.</h3>
          <p class="note">억지로 만들어 드리지 않습니다.</p></div>`}
  </section>`
}
