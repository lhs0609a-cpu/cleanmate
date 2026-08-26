/**
 * 브랜드 마크 — 한 곳에서만 정의한다
 *
 * ★ 왜 이 파일이 생겼나
 *   마크가 다섯 군데에 따로 그려져 있었다: 앱 아이콘(make-logo), 파비콘과 OG
 *   이미지(make-brand), 트레이 아이콘(손으로 만들어 커밋), 랜딩 헤더(✓ 글자),
 *   앱 헤더(글자만). 로고를 바꾸려면 다섯 곳을 다 고쳐야 하고, 하나를 빠뜨리면
 *   **어디선가는 옛 로고가 그대로 남는다.** 실제로 그렇게 됐다.
 *
 *   그래서 도형을 여기 한 번만 적고, PNG를 굽는 쪽도 HTML에 박는 SVG도
 *   전부 여기서 가져간다. 어긋나면 테스트가 잡는다(src/brand-mark.test.ts).
 *
 * ── 마크: 브래킷 T ──────────────────────────────────────────
 *   대괄호 두 개가 T를 감싼다. 대괄호는 "여기까지가 범위다"라는 뜻이고,
 *   T는 테라클린의 T다. 이 제품이 하는 일이 정확히 그것이다 — 건드릴 범위를
 *   먼저 긋고, 그 안에서만 지운다.
 *
 *   굵기를 갈라놨다(대괄호 얇게, T 굵게). 같은 굵기로 그리면 24px에서
 *   대괄호와 T가 한 덩어리로 뭉쳐 'ㅍ' 비슷한 것이 된다 — T가 먼저 읽혀야 한다.
 *
 * ── 좌표계 ──────────────────────────────────────────────────
 *   타일 한 변을 1로 본 비율이고, 원점은 타일 중심이다. 쓰는 쪽에서
 *   타일 크기만 곱하면 어느 해상도에서도 같은 그림이 나온다.
 */

/** 대괄호 획 (얇은 쪽) — 꺾인 선이라 선분 셋으로 나눠 그린다. 최솟값을 쓰면 모서리가 둥글게 이어진다. */
export const BRACKET = [
  // 왼쪽
  [-0.145, -0.31, -0.3, -0.31],
  [-0.3, -0.31, -0.3, 0.31],
  [-0.3, 0.31, -0.145, 0.31],
  // 오른쪽
  [0.145, -0.31, 0.3, -0.31],
  [0.3, -0.31, 0.3, 0.31],
  [0.3, 0.31, 0.145, 0.31],
]

/** T 획 (굵은 쪽) — 가로획과 세로획 */
export const TEE = [
  [-0.105, -0.12, 0.105, -0.12],
  [0, -0.12, 0, 0.145],
]

/** 획 반두께(타일 한 변 기준). 대괄호 < T — 이 차이가 작은 크기에서 T를 살린다. */
export const BRACKET_HALF = 0.05
export const TEE_HALF = 0.06

/** 타일 모서리 둥글기(타일 한 변 기준) */
export const TILE_RADIUS = 0.235

/** 브랜드 청록 — 타일 그라디언트 위/아래 */
export const TEAL_TOP = [14, 138, 147]
export const TEAL_BOT = [8, 96, 103]

/**
 * 작은 크기에서는 대괄호를 뗀다 — 광학 사이징.
 *
 * ★ 실측해보고 정했다(16·24·32·48을 나란히 구워 눈으로 봤다). 24px 아래에서는
 *   대괄호 안쪽 여백이 획 두께보다 좁아져서 [T] 전체가 한 덩어리로 뭉갠다.
 *   같은 그림을 우겨넣는 것보다, 그 크기에서 **읽히는 것**을 보여주는 게 맞다.
 *   T 하나는 16px에서도 T로 읽힌다.
 *
 *   글꼴이 크기별로 다른 원도를 쓰는 것과 같은 이야기다 — 축소가 아니라 다른 그림이다.
 */
export const SIMPLE_BELOW = 44

/** 대괄호를 뗀 자리를 T가 채운다. 작아진 게 아니라 커져야 같은 무게로 읽힌다. */
const SIMPLE_SCALE = 1.5

/**
 * 픽셀 좌표로 펼친다.
 * @param size 타일 한 변(px)
 * @param opts.simple 대괄호를 빼고 T만. 기본은 타일 크기로 자동 판단한다.
 * @param opts.cx,opts.cy 타일 중심(px)
 */
export function markAt(size, opts = {}) {
  const { cx = 0, cy = 0 } = opts
  const simple = opts.simple ?? size < SIMPLE_BELOW
  const k = simple ? SIMPLE_SCALE : 1
  const map = (segs) =>
    segs.map(([ax, ay, bx, by]) => [
      cx + ax * k * size,
      cy + ay * k * size,
      cx + bx * k * size,
      cy + by * k * size,
    ])
  return {
    simple,
    bracket: simple ? [] : map(BRACKET),
    tee: map(TEE),
    bracketHalf: BRACKET_HALF * size,
    teeHalf: TEE_HALF * k * size,
  }
}

/**
 * 같은 도형의 SVG 경로 — HTML에 인라인으로 박는 용도.
 * 64 뷰박스 기준(웹에서 흔한 격자라 손으로 읽기 쉽다).
 *
 * ★ HTML에 손으로 그린 SVG를 넣지 않는 이유: 그 순간 정의가 둘이 되고,
 *   둘은 반드시 어긋난다. 여기서 뽑아 붙이고 테스트로 잠근다.
 */
export function markSvg() {
  const S = 64
  const at = (v) => +(32 + v * S).toFixed(2)
  const d = (segs) =>
    segs
      .map(([ax, ay, bx, by]) => `M${at(ax)} ${at(ay)}L${at(bx)} ${at(by)}`)
      .join('')
  return {
    viewBox: `0 0 ${S} ${S}`,
    // 꺾이는 자리를 선분으로 나눠 그리므로 linecap·linejoin을 round로 둬야 이어진다.
    bracketD: d(BRACKET),
    teeD: d(TEE),
    bracketWidth: +(BRACKET_HALF * 2 * S).toFixed(2),
    teeWidth: +(TEE_HALF * 2 * S).toFixed(2),
    tileRadius: +(TILE_RADIUS * S).toFixed(2),
  }
}
