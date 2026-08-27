/**
 * 진행률과 남은 시간 — "몇 %고 얼마나 남았나"
 *
 * ── 왜 여태 없었나 ──────────────────────────────────────────
 * 폴더를 훑기 전에는 파일이 몇 개인지 알 수 없다. 그래서 화면은 경과 시간만
 * 보여줬다("7분 16초"). 코드에도 그렇게 적혀 있었다 — "없는 진행률을 지어내느니
 * 경과 시간을 정직하게 보여준다."
 *
 * 정직했지만 불친절했다. 7분이 지난 화면에서 사용자가 알 수 없는 것:
 * 반이나 왔는지, 1분 남았는지 20분 남았는지, 멈춘 건 아닌지.
 * "지어내지 않겠다"가 "아무것도 말하지 않겠다"가 되면 안 된다.
 *
 * ── 그래서 무엇을 100으로 세나 ──────────────────────────────
 * 지난번 스캔에서 폴더마다 파일이 몇 개였는지 기록해두고, 그걸 총량으로 쓴다.
 * 파일 개수는 하루 만에 크게 바뀌지 않으니 두 번째 스캔부터는 꽤 정확하다.
 *
 * 첫 스캔에는 기록이 없다. 그때는 폴더 개수만 안다(7곳 중 3번째). 이건 진짜
 * 진행이지만 폴더마다 크기가 100배씩 달라서 거칠다 — 앱 데이터에서 한참 멈춘 듯
 * 보인다. 그래서 근거(basis)를 함께 돌려주고, 화면이 무엇을 세고 있는지
 * 말할 수 있게 한다. 모르는 걸 아는 척하지 않는 방법은 침묵이 아니라 표시다.
 */

/** 폴더 하나에 대해 '지난번엔 파일이 몇 개였나' */
export interface RootWeight {
  path: string
  files: number
}

export interface ProgressInput {
  /** 지금 몇 번째 폴더인가 (0부터) */
  rootIndex: number
  /** 훑을 폴더가 모두 몇 곳인가 */
  rootCount: number
  /** 지금 폴더에서 여태 찾은 파일 수 */
  rootFiles: number
  /** 앞서 끝낸 폴더들에서 찾은 파일 수 합계 */
  doneFiles: number
  elapsedMs: number
  /** 지난번 기록. 없거나 폴더가 안 맞으면 무시된다 */
  weights?: RootWeight[]
  /** 이번에 훑는 폴더 경로들 — 기록과 짝을 맞추는 데 쓴다 */
  paths: string[]
}

export interface ProgressView {
  /**
   * 0~99. 100은 끝났을 때만 쓴다 — 99에서 기다리는 편이 100에서 기다리는 것보다 낫다.
   *
   * null이면 **정말 모른다**는 뜻이다. 폴더를 하나만 훑는 첫 스캔이 그렇다:
   * 기록이 없으니 총량을 모르고, 폴더 개수로 셀 수도 없다(1곳뿐이라 0% 아니면 100%).
   * 그때 0%를 계속 띄우면 "멈췄다"로 읽힌다 — 아무 말도 안 하는 게 낫다.
   */
  pct: number | null
  /** 남은 시간(초). 모르면 null — 지어내지 않는다 */
  etaSec: number | null
  /**
   * 무엇을 근거로 셌나.
   *   'learned' 지난번 파일 수 기준 (정확한 편)
   *   'roots'   폴더 개수만 기준 (첫 스캔. 거칠다)
   *   'unknown' 셀 근거가 없다 (pct는 null)
   */
  basis: 'learned' | 'roots' | 'unknown'
  files: number
}

/** 이번 스캔의 폴더 목록에 맞는 지난번 기록만 골라낸다. */
function weightsFor(paths: string[], weights?: RootWeight[]): number[] | null {
  if (!weights?.length) return null
  const map = new Map(weights.map((w) => [w.path, w.files]))
  const picked = paths.map((p) => map.get(p) ?? 0)
  // 한 곳이라도 기록이 없으면 총량을 못 만든다 — 반쪽 기록으로 계산하면
  // 그 폴더에 닿는 순간 진행률이 튄다. 차라리 폴더 개수로 센다.
  if (picked.some((n) => n <= 0)) return null
  return picked
}

/**
 * 지금 몇 %고 얼마나 남았나.
 *
 * 진행률은 절대 뒤로 가지 않고 100에 닿지 않는다. 뒤로 가면 사용자는 앱이
 * 고장났다고 읽고, 100에서 멈춰 있으면 끝난 줄 알고 기다린다.
 */
export function computeProgress(inp: ProgressInput): ProgressView {
  const files = inp.doneFiles + inp.rootFiles
  const w = weightsFor(inp.paths, inp.weights)

  if (!w) {
    // 폴더가 한 곳뿐이면 폴더 개수로 셀 수가 없다 — 끝날 때까지 0%다.
    // 0%를 7분간 띄우는 건 "멈췄다"고 말하는 것과 같다. 모른다고 하고
    // 파일 수와 경과 시간만 보여준다(그것도 여태 없던 정보다).
    if (inp.rootCount <= 1) return { pct: null, etaSec: null, basis: 'unknown', files }
    // 첫 스캔 — 폴더 개수만 안다. 폴더 안에서 얼마나 왔는지는 알 길이 없다.
    const pct = Math.min(99, Math.floor((inp.rootIndex / inp.rootCount) * 100))
    return { pct, etaSec: null, basis: 'roots', files }
  }

  // 지금 폴더 안에서의 진행은 지난번 그 폴더의 파일 수로 잰다.
  // 파일이 늘었을 수 있으니 1을 넘지 않게 눌러둔다(막대가 튀어나가지 않게).
  const cur = w[inp.rootIndex] ?? 0
  const within = cur > 0 ? Math.min(1, inp.rootFiles / cur) : 0
  const doneWeight = w.slice(0, inp.rootIndex).reduce((s, n) => s + n, 0) + cur * within
  // 총량도 실제보다 작을 수 있다. 이미 지나온 양보다 작아지면 총량을 늘린다 —
  // 그러면 진행률이 99에 붙어 천천히 기고, 뒤로 가지는 않는다.
  const total = Math.max(w.reduce((s, n) => s + n, 0), doneWeight)

  const ratio = total > 0 ? doneWeight / total : 0
  const pct = Math.min(99, Math.floor(ratio * 100))

  // 남은 시간: 여태 속도가 유지된다고 본다. 시작 직후엔 표본이 없어 안 낸다.
  let etaSec: number | null = null
  if (inp.elapsedMs > 3000 && doneWeight > 0 && total > doneWeight) {
    const perWeight = inp.elapsedMs / doneWeight
    etaSec = Math.round((perWeight * (total - doneWeight)) / 1000)
  }
  return { pct, etaSec, basis: 'learned', files }
}

/* ────────────────────────────────────────────────────────────
   화면마다 다른 일, 같은 약속

   ★ 왜 여기에 더 붙나
     진행률이 붙은 건 스캔뿐이었다. 나머지 화면 — 안 쓴 프로그램, 숨은 공간,
     시작프로그램, 되돌리기, 드라이브 옮기기 — 은 전부 "…읽는 중…" 한 줄로
     몇 분을 버텼다. 실물에서 그 줄만 띄운 채 멈춰 있는 화면을 봤다.

     그런데 일마다 셀 수 있는 근거가 다르다. 폴더 크기를 재는 건 몇 개 중
     몇 개인지 셀 수 있고(stepProgress), 파워셸에 통째로 맡기는 조회는
     안에서 무슨 일이 일어나는지 볼 수가 없다(timeProgress).

     근거가 다르다고 어떤 화면은 %를 못 보여주는 건 사용자 사정이 아니다.
     그래서 근거를 두 가지로 넓히되, 무엇으로 셌는지는 항상 같이 말한다.
   ──────────────────────────────────────────────────────────── */

/** 무엇을 근거로 진행률을 냈나 */
export type TaskBasis =
  /** 몇 개 중 몇 개 — 진짜로 세고 있다 */
  | 'counted'
  /** 지난번에 걸린 시간 기준 — 실측 기록이지 추정이 아니다 */
  | 'learned-time'
  /** 단계 수만 안다(3단계 중 2단계). 단계마다 길이가 달라 거칠다 */
  | 'steps'
  /** 셀 근거가 없다 — pct는 null이고 경과 시간만 보여준다 */
  | 'unknown'

export interface TaskView {
  /** 0~99. 100은 끝났을 때만. null이면 정말 모른다 */
  pct: number | null
  etaSec: number | null
  basis: TaskBasis
}

/**
 * 셀 수 있는 일 — 몇 개 중 몇 개를 했나.
 *
 * 폴더 크기 실측처럼 "할 일 목록이 먼저 정해지는" 작업에 쓴다.
 * 총량을 알고 세는 거라 이게 제일 정확하다.
 */
export function stepProgress(done: number, total: number, elapsedMs: number): TaskView {
  if (!(total > 0)) return { pct: null, etaSec: null, basis: 'unknown' }
  const d = Math.max(0, Math.min(done, total))
  const pct = Math.min(99, Math.floor((d / total) * 100))

  // 남은 시간: 여태 속도가 유지된다고 본다. 표본이 없으면 안 낸다 —
  // 한 개 하고 계산하면 숫자가 요동쳐서 오히려 못 믿게 된다.
  let etaSec: number | null = null
  if (elapsedMs > 2000 && d > 0 && d < total) {
    etaSec = Math.round(((elapsedMs / d) * (total - d)) / 1000)
  }
  return { pct, etaSec, basis: 'counted' }
}

/**
 * 지난번에 이 일이 얼마나 걸렸나 (ms). 명령 이름별로 하나씩 쌓인다.
 */
export interface TaskStat {
  cmd: string
  ms: number
}

/**
 * ★ 학습한 시간이 진행률의 90%까지를 맡는 지점.
 *
 *   지난번과 똑같이 걸리면 90%에서 끝난다. 왜 100이 아니라 90인가 —
 *   컴퓨터 사정은 매번 다르고, 지난번보다 조금이라도 오래 걸리는 순간
 *   100%에 붙어버리면 그건 "끝났는데 안 끝났다"가 된다. 그게 진행 표시가
 *   신뢰를 잃는 제일 흔한 방식이다.
 */
const LEARNED_SHARE = 90

/**
 * 셀 수 없는 일 — 지난번에 걸린 시간으로 잰다.
 *
 * ── 이게 "지어낸 진행률"이 아닌 이유 ────────────────────────
 * 이 파일 머리말에 "없는 진행률을 지어내지 않는다"고 적어뒀고 그건 그대로다.
 * 여기서 쓰는 건 **지난번에 실제로 걸린 시간**이다. 파일 개수를 기록해뒀다가
 * 총량으로 쓰는 것(computeProgress)과 똑같은 논리이고, 다만 세는 단위가
 * 개수가 아니라 초일 뿐이다. 기록이 없는 첫 실행에는 pct가 null이다 —
 * 그때는 아는 척하지 않는다.
 *
 * ── 지난번보다 오래 걸리면 ──────────────────────────────────
 * 90%를 넘긴 뒤에는 남은 10%를 기어간다. 멈춘 것처럼 보이지 않으면서도
 * 99에 닿지 않는다. 그리고 남은 시간은 그 순간부터 안 말한다 —
 * 근거가 빗나갔는데 계속 숫자를 대면 그건 거짓말이 된다.
 */
export function timeProgress(elapsedMs: number, learnedMs?: number): TaskView {
  if (!learnedMs || learnedMs <= 0) return { pct: null, etaSec: null, basis: 'unknown' }
  const e = Math.max(0, elapsedMs)

  if (e < learnedMs) {
    const pct = Math.min(LEARNED_SHARE, Math.floor((e / learnedMs) * LEARNED_SHARE))
    return { pct, etaSec: Math.round((learnedMs - e) / 1000), basis: 'learned-time' }
  }

  /* 초과 구간 — 남은 9%를 점점 느리게 채운다(반감기: 학습한 시간의 절반).
     지수라 99에 영원히 닿지 않는다. 수식이 아니라 성질이 요점이다:
     계속 움직이되 끝났다고 말하지 않는다. */
  const over = e - learnedMs
  const crawled = (99 - LEARNED_SHARE) * (1 - Math.pow(0.5, over / (learnedMs / 2)))
  return {
    pct: Math.min(99, Math.floor(LEARNED_SHARE + crawled)),
    etaSec: null, // 지난번 기록을 이미 넘겼다 — 이제부터는 정말 모른다
    basis: 'learned-time',
  }
}

/**
 * 단계만 아는 일 — 5단계 중 3단계.
 *
 * 단계마다 걸리는 시간이 100배씩 다를 수 있어서 거칠다. 그래도 "지금 무엇을
 * 하는 중"을 같이 말할 수 있어서, 아무 말도 없는 것보다는 훨씬 낫다.
 */
export function phaseProgress(index: number, count: number): TaskView {
  if (!(count > 1)) return { pct: null, etaSec: null, basis: 'unknown' }
  const i = Math.max(0, Math.min(index, count))
  return { pct: Math.min(99, Math.floor((i / count) * 100)), etaSec: null, basis: 'steps' }
}

/**
 * 사람이 읽는 시간. 초를 끝까지 보여준다 —
 * "약 2분"은 1분 1초일 수도 2분 59초일 수도 있어서 기다릴 계획을 못 세운다.
 */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}초`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}분 ${s % 60}초`
  return `${Math.floor(m / 60)}시간 ${m % 60}분`
}
