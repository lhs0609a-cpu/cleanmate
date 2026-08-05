/**
 * 묶음 해부 — "이게 뭔데요?"에 답하기 위한 집계
 *
 * 질문 하나가 316,511개를 걸고 있는데 "지울까요?"만 물으면, 그건 우리가
 * 비판하던 도구와 똑같다. 사람이 판단하려면 최소한 이건 있어야 한다:
 *   1) 어디에 있나 — 폴더별로 얼마나
 *   2) 무슨 파일인가 — 확장자별로 얼마나
 *   3) 언제 것인가 — 가장 오래된 것과 최근 것
 *   4) 대표 예시 — 실제 이름 몇 개
 *
 * 전부 순수 함수다. 화면이 어떻게 생겼든 이 숫자는 같아야 하고,
 * 틀리면 사용자가 잘못된 근거로 파일을 지운다.
 */

export interface BreakdownItem {
  path: string
  size: number
  /** 마지막 수정 이후 경과 일수 */
  ageDays?: number
}

export interface Group {
  key: string
  count: number
  bytes: number
}

const GB = 1024 ** 3

/** 경로에서 폴더만. 파일명은 뺀다. */
export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return i > 0 ? path.slice(0, i) : path
}

/**
 * 폴더별로 묶는다.
 *
 * ★ 왜 '공통 조상'까지 접나: AppData\Local\Google\Chrome\User Data\Default\Cache\
 *   같은 경로가 12만 개면, 폴더 목록만 12만 줄이 된다. 사람이 읽을 수 있는
 *   깊이(기본 4단계)에서 잘라 묶어야 "구글 크롬이 만든 것"이라는 게 보인다.
 */
export function groupByFolder(items: BreakdownItem[], depth = 4, top = 6): Group[] {
  const map = new Map<string, Group>()
  for (const it of items) {
    const parts = folderOf(it.path).split(/[\\/]/).filter(Boolean)
    const key = parts.slice(0, depth).join('\\')
    const g = map.get(key)
    if (g) { g.count++; g.bytes += it.size }
    else map.set(key, { key, count: 1, bytes: it.size })
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes).slice(0, top)
}

/** 확장자별로 묶는다. 확장자가 없으면 '(확장자 없음)'. */
export function groupByExt(items: BreakdownItem[], top = 6): Group[] {
  const map = new Map<string, Group>()
  for (const it of items) {
    const name = it.path.split(/[\\/]/).pop() ?? ''
    const dot = name.lastIndexOf('.')
    const key = dot > 0 ? name.slice(dot).toLowerCase() : '(확장자 없음)'
    const g = map.get(key)
    if (g) { g.count++; g.bytes += it.size }
    else map.set(key, { key, count: 1, bytes: it.size })
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes).slice(0, top)
}

export interface AgeSpan {
  oldestDays: number
  newestDays: number
  /** 1년 넘은 것의 비율(%) — "오래됐다"는 말의 근거 */
  overYearPercent: number
}

/** 나이 분포. '오래된 자료'라고 말하려면 근거가 있어야 한다. */
export function ageSpan(items: BreakdownItem[]): AgeSpan | null {
  const ages = items.map((i) => i.ageDays).filter((a): a is number => typeof a === 'number')
  if (!ages.length) return null
  const overYear = ages.filter((a) => a >= 365).length
  return {
    oldestDays: Math.max(...ages),
    newestDays: Math.min(...ages),
    overYearPercent: Math.round((overYear / ages.length) * 100),
  }
}

export interface Breakdown {
  count: number
  bytes: number
  folders: Group[]
  exts: Group[]
  age: AgeSpan | null
  /** 큰 것부터 대표 예시 */
  samples: BreakdownItem[]
}

export function buildBreakdown(items: BreakdownItem[], sampleCount = 8): Breakdown {
  const sorted = [...items].sort((a, b) => b.size - a.size)
  return {
    count: items.length,
    bytes: items.reduce((s, i) => s + i.size, 0),
    folders: groupByFolder(items),
    exts: groupByExt(items),
    age: ageSpan(items),
    samples: sorted.slice(0, sampleCount),
  }
}

/** 사람이 읽는 크기. 화면과 엔진이 같은 문자열을 쓰게 여기서만 만든다. */
export function fmt(n: number): string {
  if (n >= GB) return (n / GB).toFixed(1) + 'GB'
  if (n >= 1024 ** 2) return Math.round(n / 1024 ** 2) + 'MB'
  return Math.round(n / 1024) + 'KB'
}
