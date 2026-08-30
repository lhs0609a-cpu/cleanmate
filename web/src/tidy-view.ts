/**
 * 생활 정리 화면 그리기 — 방 지도·달력·이번 달
 *
 * ★ 왜 app.ts에서 떼어냈나
 *   app.ts는 3,900줄이고 DOM·Tauri·엔진 호출이 뒤섞여 있어서 Node에서 못 부른다.
 *   그래서 이 화면이 실제로 무엇을 그리는지 **테스트가 한 번도 못 봤다.**
 *   여기 있는 건 전부 "상태를 받아 문자열을 돌려주는" 순수 함수다 —
 *   떼어놓으면 그대로 테스트할 수 있고(src/content/room-view.test.ts),
 *   app.ts는 붙이는 일만 한다.
 *
 * ★ 이 파일 전체에 빨강이 한 번도 안 나오는 것이 설계다.
 *   공간이 오래되면 빨개지는 게 아니라 **흐려진다.** 밀린 것을 경고로 그리는
 *   순간 이 화면은 잔소리가 되고, 잔소리는 닫힌다.
 *   (판단은 src/content/room.ts, 색은 web/app.html의 .room 블록)
 */

import {
  ROOM_ZONES,
  ZONE_MOOD_LABEL,
  WEEKDAYS,
  type RoomView,
  type ZoneState,
  type MonthGrid,
  type MonthSummary,
} from '../../src/content/room.ts'
import type { HabitStats } from '../../src/content/tidy.ts'

/** 화면에 넣기 전에 꺾쇠를 막는다. app.ts의 같은 이름 함수와 같은 규칙이다. */
const esc = (s: string) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

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
export function habitHtml(h: HabitStats | null | undefined): string {
  if (!h) return ''
  if (!h.doneTotal) {
    return `<div class="hb">
      <div class="hb-t">아직 기록이 없어요</div>
      <div class="t-small" style="color:var(--muted)">아래에서 하나만 눌러보세요. 오늘부터 세어드릴게요.</div>
    </div>`
  }
  const dots = h.days7
    .map((d) => `<i class="${d.count ? 'on' : ''}" title="${esc(d.date)}${d.count ? ` · ${d.count}개` : ''}"></i>`)
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

/* ── 오늘의 방 ─────────────────────────────────────────────────
   "내 방을 얼마나 관리하고 있나"에 직접 답하는 화면.

   ★ 화면이 지키는 것 — 판단은 src/content/room.ts에 있고, 여기선 그리기만 한다.
     · 오래된 공간을 **빨갛게 칠하지 않는다.** 흐려질 뿐이다.
     · 처음 켠 사람에게 "0%"를 들이밀지 않는다. 아직 잴 게 없으면 안 잰다.
     · 가리키는 곳은 **하나**다. 여섯 곳을 동시에 가리키면 아무것도 안 한다. */

/** 마지막으로 손댄 지 얼마나 됐나 — 숫자보다 사람 말이 먼저 읽힌다 */
export function agoWord(days: number | null): string {
  if (days === null) return ''
  if (days <= 0) return '오늘'
  if (days === 1) return '어제'
  if (days < 7) return `${days}일 전`
  if (days < 30) return `${Math.floor(days / 7)}주 전`
  if (days < 365) return `${Math.floor(days / 30)}개월 전`
  return '한참 전'
}

function zoneHtml(z: ZoneState): string {
  const mood = ZONE_MOOD_LABEL[z.mood]
  const line = z.mood === 'never' ? mood : `${agoWord(z.daysAgo)} · ${mood}`
  /* aria-label을 따로 다는 이유: 화면에선 색 진하기가 상태를 말하는데,
     그건 읽어주는 기계에 아무 정보도 아니다. */
  return `<button type="button" class="zone ${esc(z.mood)}" data-zone="${esc(z.id)}"
      style="--f:${z.freshness.toFixed(3)}"
      aria-label="${esc(z.name)} — ${esc(line)}${z.dueCount ? `, 지금 할 수 있는 것 ${z.dueCount}개` : ''}">
    ${z.dueCount ? `<span class="zc" aria-hidden="true">${z.dueCount}</span>` : ''}
    <span class="zn">${esc(z.name)}</span>
    <span class="zm">${esc(line)}</span>
    <span class="zh">${esc(z.hint)}</span>
  </button>`
}

export function roomHtml(room: RoomView | null | undefined): string {
  if (!room) return ''
  const zones = room.zones.map(zoneHtml).join('')

  /* 아직 잴 게 없는 사람과 재본 사람에게 다른 문장을 준다.
     같은 화면에 "0%"를 띄우면 시작하기도 전에 진 기분이 든다. */
  const fresh = room.untouchedZones < ROOM_ZONES.length
  const head = fresh
    ? `<div class="room-score"><div class="n">${room.score}<span class="u">%</span></div>
         <div class="l">지금 방 상태</div></div>`
    : ''
  const sub = fresh
    ? `${ROOM_ZONES.length}곳 중 <b>${ROOM_ZONES.length - room.untouchedZones}곳</b>을 기록하고 있어요.
       진할수록 최근에 손댄 곳입니다.`
    : '아직 아무 곳도 기록이 없어요. 아래에서 하나만 눌러보시면 그 칸에 불이 들어옵니다.'

  const s = room.suggest
  const next = s
    ? `<div class="room-next">
         <span class="txt">${s.mood === 'never'
            ? `<b>${esc(s.name)}</b>은 아직 한 번도 안 해보셨어요 — 여기가 가장 시작하기 쉬워요.`
            : `<b>${esc(s.name)}</b>이 ${esc(agoWord(s.daysAgo))}으로 가장 오래됐어요.`}</span>
         <button class="opt strong" data-zone="${esc(s.id)}">${esc(s.name)} 할 일 보기</button>
       </div>`
    // 할 게 없으면 없다고 말한다. 없는 할 일을 만들어내지 않는다.
    : `<div class="room-next calm"><span class="txt">${ROOM_ZONES.length}곳 다 최근에 손대셨어요. <b>오늘은 안 하셔도 됩니다.</b></span></div>`

  return `<section class="room">
    <div class="room-h">
      <div class="t"><h3>오늘의 방</h3><p class="sub">${sub}</p></div>
      ${head}
    </div>
    <div class="room-map">${zones}</div>
    ${next}
  </section>`
}

/* ── 달력 ─────────────────────────────────────────────────────
   점이 쌓이는 걸 보는 자리. 여기서도 '안 한 날'은 빈 칸일 뿐 회색 경고가 아니다. */
export function calendarHtml(months: MonthGrid[], habit: HabitStats | null | undefined): string {
  if (!months?.length) return ''
  const level = (n: number) => (n >= 4 ? 'l4' : n >= 3 ? 'l3' : n >= 2 ? 'l2' : n >= 1 ? 'l1' : '')
  const wd = WEEKDAYS.map((d) => `<div class="wd">${d}</div>`).join('')

  const grids = months.map((m) => `
    <div class="cal">
      <div class="cal-t"><span class="m">${esc(m.label)}</span>
        <span class="c">${m.activeDays ? `${m.activeDays}일 · ${m.doneCount}번` : '기록 없음'}</span></div>
      <div class="cal-grid" role="grid" aria-label="${esc(m.label)} 정리 기록">
        ${wd}
        ${m.cells.map((c) => {
          if (!c.date) return `<div class="cal-d pad" aria-hidden="true"></div>`
          const day = Number(c.date.slice(8))
          const cls = [level(c.count), c.isToday ? 'today' : '', c.isFuture ? 'future' : ''].filter(Boolean).join(' ')
          const label = c.count ? `${c.date} ${c.count}개 완료` : c.date
          return `<div class="cal-d ${cls}" role="gridcell" title="${esc(label)}" aria-label="${esc(label)}">${day}</div>`
        }).join('')}
      </div>
    </div>`).join('')

  return `<section class="card">
    <div class="sechead"><h2>이어온 기록</h2></div>
    <p class="lede">한 날에 여러 개를 하면 그 칸이 진해집니다.
      <b>빈 칸은 쉰 날일 뿐</b>이고, 그건 아무 데도 안 세어집니다.</p>
    ${habitHtml(habit)}
    <div class="cal-wrap">${grids}</div>
    <div class="cal-legend"><span>적게</span><i></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>많이</span></div>
  </section>`
}

/* ── 이번 달 — 셀 수 있는 것만. 목표도, 남과의 비교도 두지 않는다. */
export function monthHtml(m: MonthSummary | null | undefined): string {
  if (!m) return ''
  const diff = m.doneCount - m.prevDoneCount
  const trend = m.prevDoneCount
    ? diff > 0 ? `<div class="d up">지난달보다 ${diff}번 더</div>`
      : diff < 0 ? `<div class="d">지난달은 ${m.prevDoneCount}번이었어요</div>`
      : `<div class="d">지난달과 같아요</div>`
    : ''

  return `<section class="card">
    <div class="sechead"><h2>${esc(m.label)}</h2></div>
    <div class="msum">
      <div class="m"><div class="n">${m.doneCount}<span class="u">번</span></div>
        <div class="l">이번 달에 정리한 횟수</div>${trend}</div>
      <div class="m"><div class="n">${m.activeDays}<span class="u">일</span></div>
        <div class="l">뭔가 한 날</div>
        ${m.firstTimeCount ? `<div class="d">처음 해본 것 ${m.firstTimeCount}가지</div>` : ''}</div>
      <div class="m">
        ${m.top
          ? `<div class="n" style="font-size:var(--t-title);letter-spacing:var(--tr-title)">${esc(m.top.title)}</div>
             <div class="l">가장 자주 한 것 · ${m.top.count}번</div>`
          : `<div class="n" style="font-size:var(--t-title);letter-spacing:var(--tr-title);color:var(--muted)">아직</div>
             <div class="l">이번 달 기록이 쌓이면 여기 나와요</div>`}
      </div>
    </div>
  </section>`
}
