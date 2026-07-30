/**
 * 브랜드 자산 생성기 — 의존성 0 (Node 내장 zlib만)
 *
 *   node scripts/make-brand.mjs
 *     → web/public/og.png            (1200×630, 링크 공유 썸네일)
 *     → web/public/favicon-32.png    (탭 아이콘)
 *     → web/public/favicon-180.png   (iOS 홈화면)
 *
 * 왜 손으로 PNG를 굽나: 이 환경엔 이미지 편집기도 폰트 래스터라이저도 없다.
 * make-logo.mjs와 같은 방식 — SDF(부호거리함수)로 도형을 그리고 zlib로 인코딩한다.
 *
 * 글자는 폰트 파일 없이 '획(stroke) 폰트'로 그린다. GLYPHS가 각 글자를 폴리라인으로
 * 정의하고, 선분까지의 거리에 두께를 줘서 획을 만든다. 둥근 글자는 arc()로 호를
 * 잘게 쪼개 폴리라인으로 만든다 — 그래서 곡선이 각지지 않는다.
 *
 * 한글은 못 그린다. OG 이미지의 한국어 문구는 og:title/og:description이 맡고,
 * 이미지는 브랜드(로고·워드마크·수치·존 색)를 맡는다.
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

/* ── 브랜드 색 (web/index.html의 :root와 동일) ──────────────── */
const BG = [7, 9, 13]
const SURFACE = [16, 21, 30]
const LINE = [30, 39, 51]
const INK = [243, 247, 251]
const INK2 = [194, 205, 217]
const MUTED = [124, 136, 152]
const ACC = [47, 228, 210]
const ACC2 = [56, 189, 248]
const ACC3 = [91, 141, 239]
const SAFE = [74, 222, 128]
const AMB = [251, 191, 36]
const LOCK = [251, 113, 133]
const WHITE = [255, 255, 255]
const TEAL_TOP = [14, 138, 147]
const TEAL_BOT = [8, 96, 103]

/* ── SDF 헬퍼 ────────────────────────────────────────────────
   좌표계는 픽셀, y는 아래로 증가(이미지 좌표). */

/** 사각형 중심 (cx,cy), 반크기 (hw,hh), 코너 반경 r 까지의 부호거리. */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r
  const qy = Math.abs(py - cy) - hh + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/** 선분 (ax,ay)-(bx,by) 까지의 거리. */
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax
  const pay = py - ay
  const bax = bx - ax
  const bay = by - ay
  const dd = bax * bax + bay * bay
  const h = dd === 0 ? 0 : Math.max(0, Math.min(1, (pax * bax + pay * bay) / dd))
  return Math.hypot(pax - bax * h, pay - bay * h)
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
/** 부호거리 → 커버리지. 경계 1px에서 부드럽게 떨어진다. */
const cov = (d) => clamp01(0.5 - d)

/** src over dst 알파 합성. 알파는 0~1. */
function over(dst, sr, sg, sb, sa) {
  const da = dst[3]
  const oa = sa + da * (1 - sa)
  if (oa === 0) {
    dst[0] = dst[1] = dst[2] = dst[3] = 0
    return
  }
  dst[0] = (sr * sa + dst[0] * da * (1 - sa)) / oa
  dst[1] = (sg * sa + dst[1] * da * (1 - sa)) / oa
  dst[2] = (sb * sa + dst[2] * da * (1 - sa)) / oa
  dst[3] = oa
}

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

/* ── 획 폰트 ─────────────────────────────────────────────────
   좌표는 0~1 정규화, y는 위로 증가(베이스라인 0, 캡하이트 1).
   기하학적 대문자 산세리프. */

/**
 * 타원호를 폴리라인 점 배열로. 각도는 '회전 수'(0=오른쪽, 0.25=위, 반시계).
 * a0>a1이면 시계 방향으로 돈다.
 */
function arc(cx, cy, rx, ry, a0, a1, n = 14) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const a = (a0 + ((a1 - a0) * i) / n) * Math.PI * 2
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return pts
}
/** 닫힌 타원 (시작점으로 되돌아온다). */
const ring = (cx, cy, rx, ry, n = 18) => arc(cx, cy, rx, ry, 0, 1, n)

const GLYPHS = {
  A: [[[0.05, 0], [0.5, 1], [0.95, 0]], [[0.22, 0.34], [0.78, 0.34]]],
  B: [
    [[0.15, 1], [0.15, 0]],
    [[0.15, 1], [0.54, 1], ...arc(0.54, 0.775, 0.3, 0.225, 0.25, -0.25, 10), [0.15, 0.55]],
    [[0.15, 0.55], [0.56, 0.55], ...arc(0.56, 0.275, 0.32, 0.275, 0.25, -0.25, 10), [0.15, 0]],
  ],
  C: [arc(0.5, 0.5, 0.38, 0.5, 0.07, 0.93, 18)],
  D: [[[0.15, 1], [0.15, 0]], [[0.15, 1], [0.48, 1], ...arc(0.48, 0.5, 0.38, 0.5, 0.25, -0.25, 14), [0.15, 0]]],
  E: [[[0.86, 1], [0.15, 1], [0.15, 0], [0.86, 0]], [[0.15, 0.52], [0.7, 0.52]]],
  F: [[[0.86, 1], [0.15, 1], [0.15, 0]], [[0.15, 0.52], [0.7, 0.52]]],
  G: [[...arc(0.5, 0.5, 0.38, 0.5, 0.07, 0.94, 18), [0.88, 0.2], [0.88, 0.46], [0.58, 0.46]]],
  H: [[[0.15, 1], [0.15, 0]], [[0.85, 1], [0.85, 0]], [[0.15, 0.52], [0.85, 0.52]]],
  I: [[[0.24, 1], [0.24, 0]]],
  J: [[[0.76, 1], [0.76, 0.26], ...arc(0.5, 0.26, 0.26, 0.26, 0, -0.5, 10)]],
  K: [[[0.15, 1], [0.15, 0]], [[0.85, 1], [0.15, 0.44]], [[0.37, 0.62], [0.87, 0]]],
  L: [[[0.15, 1], [0.15, 0], [0.83, 0]]],
  M: [[[0.09, 0], [0.09, 1], [0.5, 0.3], [0.91, 1], [0.91, 0]]],
  N: [[[0.15, 0], [0.15, 1], [0.85, 0], [0.85, 1]]],
  O: [ring(0.5, 0.5, 0.38, 0.5, 22)],
  P: [[[0.15, 1], [0.15, 0]], [[0.15, 1], [0.54, 1], ...arc(0.54, 0.77, 0.31, 0.23, 0.25, -0.25, 10), [0.15, 0.54]]],
  Q: [ring(0.5, 0.5, 0.38, 0.5, 22), [[0.62, 0.2], [0.93, -0.07]]],
  R: [
    [[0.15, 1], [0.15, 0]],
    [[0.15, 1], [0.54, 1], ...arc(0.54, 0.77, 0.31, 0.23, 0.25, -0.25, 10), [0.15, 0.54]],
    [[0.5, 0.54], [0.87, 0]],
  ],
  S: [[[0.86, 0.86], [0.74, 0.97], [0.55, 1], [0.34, 0.97], [0.2, 0.85], [0.2, 0.7], [0.34, 0.6], [0.6, 0.5], [0.78, 0.42], [0.82, 0.26], [0.7, 0.08], [0.5, 0.02], [0.28, 0.05], [0.14, 0.16]]],
  T: [[[0.07, 1], [0.93, 1]], [[0.5, 1], [0.5, 0]]],
  U: [[[0.15, 1], [0.15, 0.3], ...arc(0.5, 0.3, 0.35, 0.3, 0.5, 1, 12), [0.85, 1]]],
  V: [[[0.07, 1], [0.5, 0], [0.93, 1]]],
  W: [[[0.04, 1], [0.27, 0], [0.5, 0.6], [0.73, 0], [0.96, 1]]],
  X: [[[0.1, 1], [0.9, 0]], [[0.9, 1], [0.1, 0]]],
  Y: [[[0.09, 1], [0.5, 0.5], [0.91, 1]], [[0.5, 0.5], [0.5, 0]]],
  Z: [[[0.12, 1], [0.88, 1], [0.12, 0], [0.88, 0]]],
  0: [ring(0.5, 0.5, 0.35, 0.5, 22)],
  1: [[[0.24, 0.78], [0.52, 1], [0.52, 0]]],
  2: [[[0.15, 0.8], [0.24, 0.93], [0.42, 1], [0.62, 0.99], [0.78, 0.9], [0.83, 0.75], [0.78, 0.6], [0.62, 0.45], [0.14, 0.02], [0.88, 0.02]]],
  3: [[[0.15, 0.86], [0.28, 0.97], [0.5, 1], [0.7, 0.96], [0.8, 0.84], [0.76, 0.68], [0.56, 0.57], [0.74, 0.5], [0.85, 0.36], [0.8, 0.16], [0.6, 0.03], [0.36, 0.04], [0.15, 0.14]]],
  4: [[[0.72, 0], [0.72, 1], [0.1, 0.28], [0.92, 0.28]]],
  5: [[[0.84, 1], [0.2, 1], [0.18, 0.56], [0.34, 0.63], [0.54, 0.64], [0.74, 0.55], [0.82, 0.38], [0.74, 0.16], [0.52, 0.03], [0.28, 0.04], [0.13, 0.12]]],
  // 6·9는 '동그라미 + 꼬리'다. 한 폴리라인으로 이으면 닫힌 링의 끝점에서 꼬리
  // 시작점까지 선이 가로질러 그어진다 — 반드시 따로 둔다.
  6: [ring(0.5, 0.3, 0.34, 0.3, 18), [[0.16, 0.3], [0.17, 0.56], [0.25, 0.79], [0.43, 0.96], [0.64, 1], [0.84, 0.9]]],
  7: [[[0.13, 1], [0.88, 1], [0.42, 0]]],
  8: [ring(0.5, 0.75, 0.27, 0.25, 16), ring(0.5, 0.26, 0.33, 0.26, 18)],
  9: [ring(0.5, 0.7, 0.34, 0.3, 18), [[0.84, 0.7], [0.83, 0.44], [0.75, 0.21], [0.57, 0.04], [0.36, 0], [0.16, 0.1]]],
  '.': [[[0.22, 0.02], [0.22, 0.03]]],
  '%': [[[0.13, 0.02], [0.87, 0.98]], ring(0.28, 0.78, 0.15, 0.18, 12), ring(0.72, 0.22, 0.15, 0.18, 12)],
  '/': [[[0.14, -0.04], [0.86, 1.04]]],
  '-': [[[0.14, 0.5], [0.86, 0.5]]],
  '·': [[[0.25, 0.46], [0.25, 0.47]]],
  ' ': [],
}

/** 글자별 진행폭(캡하이트 배수). 좁은/넓은 글자를 보정한다. */
const ADVANCE = { I: 0.52, M: 1.0, W: 1.02, 1: 0.74, '.': 0.46, ' ': 0.46, '·': 0.56, '-': 0.82, '/': 0.74, '%': 1.02 }
const adv = (ch) => ADVANCE[ch] ?? 0.94

/**
 * 문자열을 획 선분 목록으로 변환한다.
 * x는 왼쪽 시작점, y는 베이스라인(이미지 좌표 — 아래로 증가), size는 캡하이트.
 */
function layoutText(text, x, y, size, { tracking = 0 } = {}) {
  const segs = []
  let cx = x
  for (const ch of text.toUpperCase()) {
    const g = GLYPHS[ch]
    if (g === undefined) throw new Error(`획 폰트에 없는 글자: ${JSON.stringify(ch)}`)
    for (const poly of g) {
      for (let i = 0; i < poly.length - 1; i++) {
        segs.push([
          cx + poly[i][0] * size,
          y - poly[i][1] * size,
          cx + poly[i + 1][0] * size,
          y - poly[i + 1][1] * size,
        ])
      }
    }
    cx += (adv(ch) + tracking) * size
  }
  const width = cx - x - tracking * size
  return { segs, bbox: [x, y - size * 1.12, x + width, y + size * 0.14], width }
}

/** 획 묶음을 그린다. colorAt(px,py) → [r,g,b]. bbox 밖은 즉시 건너뛴다(속도). */
function strokeInto(dst, px, py, run, half, colorAt) {
  const [x0, y0, x1, y1] = run.bbox
  const m = half + 1
  if (px < x0 - m || px > x1 + m || py < y0 - m || py > y1 + m) return
  let d = Infinity
  for (const s of run.segs) {
    const t = sdSegment(px, py, s[0], s[1], s[2], s[3])
    if (t < d) d = t
  }
  const c = cov(d - half)
  if (c > 0) {
    const col = colorAt(px, py)
    over(dst, col[0], col[1], col[2], c)
  }
}

/* ── OG 이미지 (1200×630) ─────────────────────────────────────
   구성: 왼쪽에 브랜드 + "지워도 되는 용량"(주인공) + 잠근 용량(근거),
   오른쪽에 앱 창 카드와 3-존 막대. 새 카피 축과 같은 위계다. */
const OGW = 1200
const OGH = 630

const TILE = { cx: 84 + 32, cy: 76 + 32, hw: 32, hh: 32, r: 14 }
const CHECK = [
  [TILE.cx - 14, TILE.cy + 1, TILE.cx - 4, TILE.cy + 11],
  [TILE.cx - 4, TILE.cy + 11, TILE.cx + 15, TILE.cy - 11],
]
const WORDMARK = layoutText('TERACLEAN', 172, 120, 26, { tracking: 0.09 })
const KICKER = layoutText('SAFE TO DELETE', 84, 252, 19, { tracking: 0.24 })
const BIGNUM = layoutText('14.6 GB', 80, 348, 74, { tracking: 0.03 })
const LOCKED = layoutText('LOCKED 41.8 GB · UNTOUCHED', 84, 428, 17, { tracking: 0.13 })
const SPEC = layoutText('FREE · WINDOWS 10 / 11 · 30 DAY UNDO · 100% ON DEVICE', 84, 556, 17, { tracking: 0.11 })
const RULE = { x0: 84, x1: 84 + 470, y: 396 }

const CARD = { x0: 668, y0: 140, x1: 1116, y1: 492 }
const CARD_C = {
  cx: (CARD.x0 + CARD.x1) / 2,
  cy: (CARD.y0 + CARD.y1) / 2,
  hw: (CARD.x1 - CARD.x0) / 2,
  hh: (CARD.y1 - CARD.y0) / 2,
  r: 18,
}
const BAR_X = CARD.x0 + 40
const BAR_W = CARD.x1 - CARD.x0 - 80
const BAR_H = 13
const BARS = [
  { color: SAFE, frac: 0.26, y: 236 },
  { color: AMB, frac: 0.52, y: 300 },
  { color: LOCK, frac: 0.88, y: 364 },
]
// 카드 하단 '지켜드림' 줄 — 앱의 .m-kept 블록과 같은 역할(근거 층).
const KEPT = { x0: CARD.x0 + 40, x1: CARD.x1 - 40, y0: 410, y1: 456 }
const KEPT_C = {
  cx: (KEPT.x0 + KEPT.x1) / 2,
  cy: (KEPT.y0 + KEPT.y1) / 2,
  hw: (KEPT.x1 - KEPT.x0) / 2,
  hh: (KEPT.y1 - KEPT.y0) / 2,
  r: 11,
}
const KEPT_TEXT = layoutText('41.8 GB KEPT', KEPT.x0 + 40, KEPT.y1 - 17, 15, { tracking: 0.1 })
const KEPT_CHECK = [
  [KEPT.x0 + 16, KEPT_C.cy + 0.5, KEPT.x0 + 21, KEPT_C.cy + 5.5],
  [KEPT.x0 + 21, KEPT_C.cy + 5.5, KEPT.x0 + 30, KEPT_C.cy - 5.5],
]

/** 큰 수치의 그라디언트 — 사이트의 103deg acc→acc-2→acc-3와 같은 축. */
function bigNumColor(px) {
  const t = clamp01((px - BIGNUM.bbox[0]) / (BIGNUM.bbox[2] - BIGNUM.bbox[0]))
  return t < 0.55 ? mix(ACC, ACC2, t / 0.55) : mix(ACC2, ACC3, (t - 0.55) / 0.45)
}

function ogSample(x, y, dst) {
  // 배경: 브랜드 다크 + 오로라 글로우
  dst[0] = BG[0]
  dst[1] = BG[1]
  dst[2] = BG[2]
  dst[3] = 1
  const glow =
    0.22 * Math.exp(-(((x - 250) / 520) ** 2 + ((y - 120) / 300) ** 2)) +
    0.16 * Math.exp(-(((x - 900) / 460) ** 2 + ((y - 60) / 260) ** 2))
  dst[0] += ACC[0] * glow * 0.5
  dst[1] += ACC[1] * glow * 0.6
  dst[2] += ACC2[2] * glow * 0.7

  // 그리드 (히어로 grid-bg와 같은 56px 격자, 위쪽만 은은하게)
  const gridFade = clamp01(1 - y / 420) * 0.45
  if (gridFade > 0) {
    const gx = Math.min(x % 56, 56 - (x % 56))
    const gy = Math.min(y % 56, 56 - (y % 56))
    if (gx < 1 || gy < 1) over(dst, LINE[0], LINE[1], LINE[2], gridFade)
  }

  // 앱 창 카드
  const dCard = sdRoundRect(x, y, CARD_C.cx, CARD_C.cy, CARD_C.hw, CARD_C.hh, CARD_C.r)
  const cardCov = cov(dCard)
  if (cardCov > 0) {
    const t = clamp01((y - CARD.y0) / (CARD.y1 - CARD.y0))
    const c = mix(SURFACE, [11, 15, 22], t)
    over(dst, c[0], c[1], c[2], cardCov * 0.97)
    over(dst, LINE[0] + 14, LINE[1] + 16, LINE[2] + 19, cov(Math.abs(dCard) - 0.9)) // 테두리
    if (Math.abs(y - (CARD.y0 + 46)) < 1) over(dst, LINE[0], LINE[1], LINE[2], 0.9) // 타이틀바 구분선
  }
  // 창 신호등 점
  for (let i = 0; i < 3; i++) {
    const c = [LOCK, AMB, SAFE][i]
    const cc = cov(Math.hypot(x - (CARD.x0 + 26 + i * 19), y - (CARD.y0 + 23)) - 5)
    if (cc > 0) over(dst, c[0], c[1], c[2], cc)
  }

  // 3-존 막대: 트랙 + 채움
  for (const b of BARS) {
    const cy = b.y + BAR_H / 2
    if (Math.abs(y - cy) > BAR_H / 2 + 2) continue
    const tc = cov(sdRoundRect(x, y, BAR_X + BAR_W / 2, cy, BAR_W / 2, BAR_H / 2, BAR_H / 2))
    if (tc > 0) over(dst, 255, 255, 255, tc * 0.06)
    const fw = BAR_W * b.frac
    const fc = cov(sdRoundRect(x, y, BAR_X + fw / 2, cy, fw / 2, BAR_H / 2, BAR_H / 2))
    if (fc > 0) over(dst, b.color[0], b.color[1], b.color[2], fc)
  }

  // 카드 하단 '지켜드림' 줄
  const dKept = sdRoundRect(x, y, KEPT_C.cx, KEPT_C.cy, KEPT_C.hw, KEPT_C.hh, KEPT_C.r)
  const keptCov = cov(dKept)
  if (keptCov > 0) {
    over(dst, SAFE[0], SAFE[1], SAFE[2], keptCov * 0.07)
    over(dst, LINE[0] + 8, LINE[1] + 10, LINE[2] + 12, cov(Math.abs(dKept) - 0.9))
    let dc = Infinity
    for (const [ax, ay, bx, by] of KEPT_CHECK) dc = Math.min(dc, sdSegment(x, y, ax, ay, bx, by))
    const cc = cov(dc - 2)
    if (cc > 0) over(dst, SAFE[0], SAFE[1], SAFE[2], cc)
  }
  strokeInto(dst, x, y, KEPT_TEXT, 1.3, () => INK2)

  // 왼쪽 칼럼 구분선 (지울 용량 / 잠근 용량 사이)
  if (Math.abs(y - RULE.y) < 1 && x >= RULE.x0 && x <= RULE.x1) {
    over(dst, LINE[0] + 10, LINE[1] + 12, LINE[2] + 14, 1)
  }

  // 로고 타일 + 체크
  const tileCov = cov(sdRoundRect(x, y, TILE.cx, TILE.cy, TILE.hw, TILE.hh, TILE.r))
  if (tileCov > 0) {
    const t = clamp01((y - (TILE.cy - TILE.hh)) / (TILE.hh * 2))
    const c = mix(TEAL_TOP, TEAL_BOT, t)
    over(dst, c[0], c[1], c[2], tileCov)
    let dChk = Infinity
    for (const [ax, ay, bx, by] of CHECK) dChk = Math.min(dChk, sdSegment(x, y, ax, ay, bx, by))
    const chkCov = cov(dChk - 3.8)
    if (chkCov > 0) over(dst, WHITE[0], WHITE[1], WHITE[2], chkCov)
  }

  // 글자
  strokeInto(dst, x, y, WORDMARK, 2.3, () => INK)
  strokeInto(dst, x, y, KICKER, 1.6, () => ACC)
  strokeInto(dst, x, y, BIGNUM, 5.2, bigNumColor)
  strokeInto(dst, x, y, LOCKED, 1.4, () => INK2)
  strokeInto(dst, x, y, SPEC, 1.4, () => MUTED)
}

/* ── 파비콘: 로고 타일 + 체크 (SDF라 크기별로 직접 렌더) ────── */
function iconSample(x, y, N, dst) {
  dst[0] = dst[1] = dst[2] = dst[3] = 0
  const m = N * 0.055 // 여백을 거의 없애 작은 탭에서도 꽉 차 보이게
  const hw = N / 2 - m
  const c = cov(sdRoundRect(x, y, N / 2, N / 2, hw, hw, N * 0.26))
  if (c > 0) {
    const col = mix(TEAL_TOP, TEAL_BOT, clamp01(y / N))
    over(dst, col[0], col[1], col[2], c)
    const s = N / 32
    const chk = [
      [N / 2 - 7.2 * s, N / 2 + 0.4 * s, N / 2 - 2 * s, N / 2 + 5.6 * s],
      [N / 2 - 2 * s, N / 2 + 5.6 * s, N / 2 + 7.6 * s, N / 2 - 5.8 * s],
    ]
    let dc = Infinity
    for (const [ax, ay, bx, by] of chk) dc = Math.min(dc, sdSegment(x, y, ax, ay, bx, by))
    const cc = cov(dc - 2.1 * s)
    if (cc > 0) over(dst, WHITE[0], WHITE[1], WHITE[2], cc)
  }
}

/* ── 렌더 + PNG 인코딩 ──────────────────────────────────────── */
function render(w, h, sampler, ss) {
  const raw = Buffer.alloc(h * (1 + w * 4))
  const px = [0, 0, 0, 0]
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * 4)
    raw[rowStart] = 0 // 필터 바이트: None
    for (let x = 0; x < w; x++) {
      let R = 0, G = 0, B = 0, A = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          sampler(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss, px)
          // 프리멀티플라이해서 평균 — 경계에서 색이 번지지 않는다
          R += px[0] * px[3]
          G += px[1] * px[3]
          B += px[2] * px[3]
          A += px[3]
        }
      }
      const o = rowStart + 1 + x * 4
      raw[o] = A > 0 ? Math.min(255, Math.round(R / A)) : 0
      raw[o + 1] = A > 0 ? Math.min(255, Math.round(G / A)) : 0
      raw[o + 2] = A > 0 ? Math.min(255, Math.round(B / A)) : 0
      raw[o + 3] = Math.round(clamp01(A / (ss * ss)) * 255)
    }
  }
  return raw
}

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function encodePng(w, h, raw) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ── 출력 ───────────────────────────────────────────────────── */
mkdirSync('web/public', { recursive: true })
const out = [['web/public/og.png', OGW, OGH, encodePng(OGW, OGH, render(OGW, OGH, ogSample, 2))]]
for (const N of [32, 180]) {
  out.push([`web/public/favicon-${N}.png`, N, N, encodePng(N, N, render(N, N, (x, y, d) => iconSample(x, y, N, d), 4))])
}
for (const [path, w, h, buf] of out) {
  writeFileSync(path, buf)
  console.log(`${path} · ${w}×${h} · ${(buf.length / 1024).toFixed(1)}KB`)
}
