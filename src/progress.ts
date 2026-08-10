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
