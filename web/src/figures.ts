/**
 * 그림 — 잰 값을 그리는 곳. 이 파일이 이 제품의 그림 언어 전부다.
 *
 * ══ 왜 그림인가 ═══════════════════════════════════════════════
 *   글이 길어서가 아니라, **문장으로는 두 번 말해야 하는 것**이 있어서다.
 *   "줄인 크기는 재시작한 뒤에 반영됩니다. 재시작 전까지는 용량이 안 빕니다."
 *   시간이 걸린 조건이라 한 번으로는 안 된다. 같은 자로 그린 막대 두 줄이면
 *   한 번에 보인다. 그래서 그 문장은 화면에서 뺀다 — 그림이 문장을 지워야
 *   글이 준다. 못 지우면 그림은 장식이고, 장식은 이 제품에서 빼는 것이다.
 *
 * ══ 그림 문법 ═════════════════════════════════════════════════
 *   실선·회색 채움 = 지금 있는 것 (재서 확인한 값)
 *   점선·청록     = 아직 아닌 것 (우리가 회수할 몫, 조건이 붙은 몫)
 *   점선·빈칸     = 못 잰 것     (0으로 안 그린다)
 *   점선 안내선   = 안 변한 것   ("그대로다"를 눈으로 확인시킨다)
 *
 *   여섯 화면의 그림이 이 넷으로만 만들어진다. 그래서 한 화면에서 배운 읽는 법이
 *   다음 화면에서도 그대로 통한다 — 그게 그림을 '언어'라고 부르는 이유다.
 *
 * ══ 여기서 지키는 것 ══════════════════════════════════════════
 *   ★ 숫자를 안 만든다. 엔진이 준 값을 길이·개수로 바꾸기만 한다.
 *     화면이 숫자를 지어내기 시작하면 이 제품이 하는 말 전부가 못 믿을 것이 된다.
 *   ★ 못 잰 것을 안 그린다. 눈금을 그럴듯하게 채우는 순간 그림이 거짓말이 된다.
 *     (WSL 그림에서 '안에 든 것'을 안 그리는 이유가 이것이다 — 우리는 그 값을 모른다.)
 *   ★ 새 색을 안 만든다. 전부 기존 토큰이라 다크 모드가 저절로 따라온다.
 *     판정 3색(초록·주황·빨강)은 그림에서도 판정에만 쓴다.
 *   ★ 라이브러리를 안 쓴다. 요청이 0이어야 "파일이 기기를 안 떠난다"가 안 깨진다.
 *   ★ 크기는 viewBox로만 잡는다. 창이 좁아져도 안 깨지고, 최소폭 아래로는
 *     그림 상자 안에서만 가로로 밀린다 — 화면 전체가 밀리지 않는다.
 *   ★ 그림마다 aria-label이 붙는다. 그림을 못 보는 사람에게는 지운 그 문장이
 *     그대로 남는다 — 정보를 줄이는 게 아니라 옮기는 것이다.
 */

import { fmtBytes } from '../../src/engine.ts'
import type { Figure } from '../../src/types.ts'

const esc = (s: string) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/* 그림 안에서 참조하는 id(clipPath)는 문서에서 유일해야 한다.
   한 화면에 같은 종류의 그림이 둘 이상 그려지면 뒤엣것이 앞엣것의 조각을 쓴다. */
let seq = 0
const uid = (p: string) => `${p}-${++seq}`

/** 막대가 함께 쓰는 자 — 모든 그림이 같은 가로 좌표를 쓴다. 눈이 화면 사이를 옮겨도 안 흔들린다. */
const X = 64
const W = 400
const RIGHT = X + W

/** 길이로 바꾼다. 0이 아닌 몫은 최소 2px을 준다 — 있는 것이 안 보이면 없는 것이 된다. */
function span(part: number, whole: number): number {
  if (!(whole > 0)) return 0
  if (part <= 0) return 0
  return Math.max(2, Math.min(W, Math.round((part / whole) * W)))
}

function wrap(alt: string, height: number, body: string): string {
  return `<figure class="fact-fig">
      <svg viewBox="0 0 520 ${height}" role="img" aria-label="${esc(alt)}">${body}</svg>
    </figure>`
}

/* 색표 한 칸. 몫이 0이면 안 그린다 — "0B 남김"은 알려주는 게 아니라 잡음이다. */
function key(dx: number, cls: string, label: string, accent: boolean, on: boolean): string {
  if (!on) return ''
  return `<rect x="${X + dx}" y="122" width="12" height="12" rx="3" class="${cls}"/>
    <text x="${X + dx + 18}" y="132" class="dv${accent ? ' ac' : ''}">${esc(label)}</text>`
}

/* ════════════════════════════════════════════════════════════
   1. 같은 자 위의 막대 두 줄 — 지금 / 바꾼 뒤

   답하는 질문: "바꾸면 얼마가, 언제 비나"
   쓰는 곳: 가상 메모리 · 드라이브 옮기기 · 못 지우고 남은 것

   ★ 값 라벨을 막대 안에 안 넣는다. 잡아둔 게 크고 비는 몫이 작으면(100GB 중 12GB)
     그 칸이 48px가 되어 글자가 튀어나간다. 밖에 색표와 함께 두면 비율과 무관하게 읽힌다.
   ════════════════════════════════════════════════════════════ */
function beforeAfter(f: Extract<Figure, { kind: 'before-after' }>): string {
  const keepW = span(f.keepBytes, f.totalBytes)
  const split = X + keepW
  return wrap(f.alt, 140, `
    <text x="${X}" y="16" class="dl">${esc(f.beforeLabel)}</text>
    <rect x="${X}" y="24" width="${W}" height="28" rx="6" class="d-now"/>
    <text x="${X + W / 2}" y="43" class="dv" text-anchor="middle">${fmtBytes(f.totalBytes)}</text>

    <line x1="${split}" y1="52" x2="${split}" y2="84" class="d-tick"/>

    <text x="${X}" y="76" class="dl">${esc(f.afterLabel)}</text>
    <rect x="${X}" y="84" width="${W}" height="28" rx="6" class="d-soon"/>
    <rect x="${X}" y="84" width="${keepW}" height="28" rx="6" class="d-now"/>

    ${key(0, 'd-now', `${fmtBytes(f.keepBytes)} 남김`, false, f.keepBytes > 0)}
    ${key(f.keepBytes > 0 ? 168 : 0, 'd-soon', `${fmtBytes(f.freesBytes)} · ${f.freesNote}`, true, f.freesBytes > 0)}`)
}

/* ════════════════════════════════════════════════════════════
   2. 같은 크기 상자 둘 — 안이 달라져도 밖은 그대로

   답하는 질문: "안에서 지웠는데 왜 용량이 그대로인가"
   쓰는 곳: WSL 리눅스 디스크 · Docker 저장소

   ★ 안쪽은 '못 잰 것'으로 그린다. 우리가 밖에서 볼 수 있는 건 파일 크기 하나뿐이다.
     여기에 그럴듯한 눈금을 넣으면 이 그림이 거짓말이 되고, 그 순간 이 화면에서
     우리가 하는 다른 말도 같이 못 믿을 것이 된다.
   ★ 위아래 점선 안내선이 이 그림의 전부다 — 두 상자가 같은 높이라는 걸
     눈이 붙잡아야 "그대로"가 문장이 아니라 사실로 읽힌다.
   ════════════════════════════════════════════════════════════ */
function unchanged(f: Extract<Figure, { kind: 'unchanged' }>): string {
  const size = fmtBytes(f.bytes)
  const box = (x: number, top: string, cx: number) => `
    <text x="${cx}" y="26" class="dl" text-anchor="middle">${esc(top)}</text>
    <rect x="${x}" y="36" width="150" height="104" rx="8" class="d-box"/>
    <rect x="${x + 12}" y="48" width="126" height="80" rx="4" class="d-empty" stroke-dasharray="5 4"/>
    <text x="${cx}" y="93" class="dv q" text-anchor="middle">?</text>
    <text x="${cx}" y="162" class="dv" text-anchor="middle">${size}</text>`

  return wrap(f.alt, 186, `
    <line x1="24" y1="36" x2="456" y2="36" class="d-guide"/>
    <line x1="24" y1="140" x2="456" y2="140" class="d-guide"/>
    ${box(24, f.beforeLabel, 99)}
    <text x="240" y="80" class="dl" text-anchor="middle">${esc(f.betweenLabel)}</text>
    <line x1="186" y1="104" x2="284" y2="104" class="d-arrow"/>
    <polygon points="284,98 296,104 284,110" class="arw"/>
    ${box(306, f.afterLabel, 381)}
    <text x="260" y="180" class="dl" text-anchor="middle">${esc(f.insideNote)}</text>`)
}

/* ════════════════════════════════════════════════════════════
   3. 같은 것 N벌 — 한 벌만 남는다

   답하는 질문: "다 지우는 건가? 하나는 남나?"
   쓰는 곳: 같은 파일 · 같은 폴더가 여러 벌

   ★ 이 화면에서 가장 자주 다시 읽히는 문장이 "한 벌은 남습니다"다.
     그림이면 다시 안 읽어도 된다.
   ★ 벌 수가 많으면 다 안 그린다. 열두 장을 그려봐야 세지 않는다 —
     여덟 장까지 그리고 나머지는 수로 말한다.
   ════════════════════════════════════════════════════════════ */
function copies(f: Extract<Figure, { kind: 'copies' }>): string {
  const MAX = 8
  const shown = Math.min(Math.max(f.total, 1), MAX)
  const gap = 16
  const w = Math.min(44, Math.floor((W - (shown - 1) * gap) / shown))
  const used = shown * w + (shown - 1) * gap
  const x0 = X + Math.round((W - used) / 2)
  const at = (i: number) => x0 + i * (w + gap)

  const keepShown = Math.min(f.keep, shown)
  const sheets = Array.from({ length: shown }, (_, i) => {
    const x = at(i)
    const kept = i < keepShown
    const fold = w >= 30 ? `<path d="M${x + w - 14} 30 L${x + w - 14} 44 L${x + w} 44" class="d-mark"/>` : ''
    return `<rect x="${x}" y="30" width="${w}" height="58" rx="4" class="${kept ? 'd-keep' : 'd-gone'}"/>${kept ? fold : ''}`
  }).join('')

  // 남는 것 아래 한 마디, 지우는 것들 아래 묶음표 하나.
  const keepMid = at(0) + (keepShown * (w + gap) - gap) / 2
  const goneFrom = at(keepShown)
  const goneTo = at(shown - 1) + w
  const goneMid = (goneFrom + goneTo) / 2
  const more = f.total > shown ? ` (${shown}벌만 그렸어요)` : ''

  return wrap(f.alt, 130, `
    <text x="${X + W / 2}" y="18" class="dl" text-anchor="middle">이름도 크기도 같은 것 ${f.total}벌${more}</text>
    ${sheets}
    <text x="${keepMid}" y="106" class="dv sf" text-anchor="middle">${esc(f.keepLabel)}</text>
    ${f.gone > 0 ? `<path d="M${goneFrom} 96 L${goneFrom} 102 L${goneTo} 102 L${goneTo} 96" class="d-gone"/>
    <text x="${goneMid}" y="122" class="dv" text-anchor="middle">${f.gone}벌 지움 · ${fmtBytes(f.freesBytes)}</text>` : ''}`)
}

/* ════════════════════════════════════════════════════════════
   4. 실선 0 과 점선 빈칸 — "없다"와 "못 봤다"는 다른 말이다

   답하는 질문: "숫자가 없는데, 없다는 건가 모른다는 건가"
   쓰는 곳: 시스템 복원(관리자 권한이 있어야 읽힌다)

   ★ 이건 글을 줄이려고 넣는 그림이 아니라, 이 제품이 지키는 원칙을 화면에 새기는
     그림이다. 숫자 자리가 비어 있으면 사람은 그걸 0으로 읽는다. 점선 빈칸은
     0으로 안 읽힌다. 실측에서 여기 100GB가 잡혀 있는 PC가 있었다.
   ════════════════════════════════════════════════════════════ */
function unmeasured(f: Extract<Figure, { kind: 'unmeasured' }>): string {
  const bx = 96
  const bw = RIGHT - bx
  const mid = bx + bw / 2
  return wrap(f.alt, 112, `
    <text x="84" y="42" class="dl" text-anchor="end">${esc(f.wrongTag)}</text>
    <rect x="${bx}" y="24" width="${bw}" height="28" rx="6" class="d-empty"/>
    <text x="${mid}" y="43" class="dv q" text-anchor="middle">${esc(f.wrongLabel)}</text>

    <text x="84" y="88" class="dl" text-anchor="end">${esc(f.rightTag)}</text>
    <rect x="${bx}" y="70" width="${bw}" height="28" rx="6" class="d-empty" stroke-dasharray="5 4"/>
    <rect x="184" y="83" width="11" height="8" rx="1.5" class="d-lock"/>
    <path d="M186.5 83 v-3 a3.2 3.2 0 0 1 6.4 0 v3" class="d-lock"/>
    <text x="202" y="93" class="dv ac">${esc(f.rightLabel)}</text>`)
}

/* ════════════════════════════════════════════════════════════
   5. 한 줄 막대를 몇 갈래로 — 전체가 어떻게 나뉘었나

   답하는 질문: "N개 중 M개를 제안한다는데, 나머지는 뭔가"
   쓰는 곳: 시작프로그램 머리말

   ★ 청록은 '우리가 하자는 것'에만 쓴다. 나머지는 회색 단계로만 나눈다 —
     여기서 색을 하나 더 쓰면 화면 전체에서 청록이 '누를 것'이라는 뜻을 잃는다.
   ★ 제안한 몫이 점선인 이유: 아직 안 한 일이다. 문법이 그대로 통한다.
   ════════════════════════════════════════════════════════════ */
function split(f: Extract<Figure, { kind: 'split' }>): string {
  const whole = f.parts.reduce((s, p) => s + p.count, 0)
  const clip = uid('sp')
  const cls = { act: 'd-soon', hold: 'd-now', off: 'd-off' } as const

  let x = X
  const segs = f.parts.map((p, i) => {
    const last = i === f.parts.length - 1
    const w = last ? Math.max(0, RIGHT - x) : span(p.count, whole)
    const seg = `<rect x="${x}" y="24" width="${w}" height="28" class="${cls[p.tone]}"/>`
    x += w
    return seg
  }).join('')

  // 색표는 두 줄까지. 셋이 한 줄에 들어가는 폭(133px)이면 이름이 잘린다.
  const keys = f.parts.map((p, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const kx = X + col * 200
    const ky = 72 + row * 24
    return `<rect x="${kx}" y="${ky - 10}" width="12" height="12" rx="3" class="${cls[p.tone]}"/>
      <text x="${kx + 18}" y="${ky}" class="dv${p.tone === 'act' ? ' ac' : ''}">${esc(p.label)} ${p.count.toLocaleString()}개</text>`
  }).join('')

  const rows = Math.ceil(f.parts.length / 2)
  return wrap(f.alt, 56 + rows * 24, `
    <defs><clipPath id="${clip}"><rect x="${X}" y="24" width="${W}" height="28" rx="6"/></clipPath></defs>
    <g clip-path="url(#${clip})">${segs}</g>
    ${keys}`)
}

/* ════════════════════════════════════════════════════════════
   6. 시간 축 위의 점 — 마지막으로 쓴 때

   답하는 질문: "오래 안 썼다는데, 얼마나 오래인가"
   쓰는 곳: 안 쓴 프로그램

   ★ 이 화면에서 사람이 의심하는 건 제안이 아니라 근거다("정말 안 썼나?").
     근거가 시간이면 시간을 그려야 한다. 기준선을 같이 그리는 이유도 그것이다 —
     왜 이것들만 골랐는지가 그림 안에서 답이 된다.
   ★ 기록이 없는 것은 축에 안 올린다. '아주 오래전'과 '모름'은 다른 말이고,
     축의 왼쪽 끝은 아주 오래전이라는 뜻이다. 수로만 따로 적는다.
   ★ 점마다 이름을 안 쓴다. 여섯 개만 돼도 글자가 겹쳐 아무것도 안 읽힌다.
     이름은 <title>로 넣는다 — 마우스를 올리면 나오고, 낭독기도 읽는다.
   ════════════════════════════════════════════════════════════ */
function timeline(f: Extract<Figure, { kind: 'timeline' }>): string {
  const y = 62
  // 오른쪽이 오늘이다. 오래될수록 왼쪽 — 사람이 시간을 읽는 방향 그대로.
  const at = (days: number) => RIGHT - Math.round((Math.min(days, f.spanDays) / f.spanDays) * W)

  /* 겹치는 점은 위로 쌓는다. 같은 자리에 찍으면 다섯 개가 한 개로 보인다. */
  const used: number[] = []
  const dots = f.marks.map((m) => {
    const cx = at(m.daysAgo)
    const level = used.filter((u) => Math.abs(u - cx) < 11).length
    used.push(cx)
    const cy = y - level * 11
    return `<circle cx="${cx}" cy="${cy}" r="4.5" class="d-dot"><title>${esc(m.label)}</title></circle>`
  }).join('')

  const tx = at(f.thresholdDays)
  return wrap(f.alt, 108, `
    <line x1="${X}" y1="${y}" x2="${RIGHT}" y2="${y}" class="d-axis"/>
    <line x1="${tx}" y1="26" x2="${tx}" y2="${y + 8}" class="d-tick"/>
    <text x="${tx + 6}" y="24" class="dv ac">${esc(f.thresholdLabel)}</text>
    ${dots}
    <text x="${X}" y="82" class="dl">${esc(f.farLabel)}</text>
    <text x="${RIGHT}" y="82" class="dl" text-anchor="end">${esc(f.nowLabel)}</text>
    ${f.unknownCount
      ? `<rect x="${X}" y="92" width="12" height="12" rx="3" class="d-empty" stroke-dasharray="4 3"/>
         <text x="${X + 18}" y="102" class="dv q">${esc(f.unknownLabel)} ${f.unknownCount.toLocaleString()}개 — 축에 안 올립니다</text>`
      : ''}`)
}

/**
 * 그림 하나를 그린다. 그릴 게 없으면 빈 문자열 — 카드는 지금 그대로 나온다.
 *
 * ★ 모르는 종류가 오면 아무것도 안 그린다. 여기서 대충 뭔가를 그리면
 *   화면이 엔진보다 앞서 나가게 된다.
 */
export function figureSvg(fig: Figure | undefined | null): string {
  if (!fig || !fig.alt) return ''
  switch (fig.kind) {
    case 'before-after': return fig.totalBytes > 0 ? beforeAfter(fig) : ''
    case 'unchanged':    return fig.bytes > 0 ? unchanged(fig) : ''
    case 'copies':       return fig.total > 1 ? copies(fig) : ''
    case 'unmeasured':   return unmeasured(fig)
    case 'split':        return fig.parts.some((p) => p.count > 0) ? split(fig) : ''
    case 'timeline':     return fig.marks.length && fig.spanDays > 0 ? timeline(fig) : ''
    default:             return ''
  }
}

/** 그림이 대신하는 줄은 화면에서 뺀다. 데이터에서 지우는 게 아니다(types.ts 머리말). */
export function withoutCovered(lines: string[] | undefined, fig: Figure | undefined | null): string[] {
  const covered = fig?.replaces ?? []
  return (lines ?? []).filter((x) => !covered.includes(x))
}
