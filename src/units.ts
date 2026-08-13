/**
 * 결정 단위 — "145,401개 중 어느 걸 고르시겠어요?"가 질문이 될 수 없는 이유
 *
 * ── 무엇이 잘못돼 있었나 ─────────────────────────────────────
 * 실물 화면에 이렇게 떴다:
 *
 *   개발 폴더 145,401곳(16.6GB)이 오래 조용하네요. 이 프로젝트들 아직 작업하시나요?
 *   → 145401개를 목록으로 보여드릴게요.
 *   [ ] torch_cuda.dll   1.2GB
 *   [ ] dnnl.lib         676MB
 *   ...
 *
 * 14만 개를 낱개 체크박스로 고르라는 건 정리가 아니다. 게다가 **낱개로 고르는
 * 것 자체가 손해다** — .venv에서 dll 하나를 빼면 용량은 1/5만 줄고 프로젝트는
 * 통째로 지운 것과 똑같이 안 돌아간다(owners.ts의 unit 경고).
 *
 * 개발 산출물의 진짜 단위는 파일이 아니라 **폴더**다:
 *   ACE-Step-1.5 › .venv   5.1GB   ← 이게 하나의 결정이다
 *
 * ── 규칙은 추측이 아니다 ─────────────────────────────────────
 * node_modules·.venv·dist 같은 표시는 도구가 **항상 프로젝트 뿌리에** 만든다.
 * 그래서 표시를 만나면 그 앞이 프로젝트고, 표시 폴더가 곧 결정 단위다.
 * owners.ts가 프로그램 이름을 뽑을 때 쓰는 규칙과 같은 사실을 쓴다.
 *
 * ── 못 묶은 건 못 묶었다고 한다 ──────────────────────────────
 * 표시가 없는 파일까지 상위 폴더로 억지로 묶지 않는다. 그러면 '문서' 폴더 하나가
 * 만들어져서 "이 폴더 통째로 정리"가 사용자 문서를 가리키게 된다. 안 묶인 것은
 * 낱개 목록으로 넘긴다 — 그게 낱개 목록이 존재하는 이유다.
 */

export interface UnitItem {
  path: string
  size: number
  ageDays?: number
}

export interface Unit {
  /** 결정 단위 폴더 — 이 경로를 통째로 다룬다 */
  path: string
  /** 사람이 읽는 이름: 'ACE-Step-1.5 › .venv' */
  label: string
  /** 프로젝트 이름만 */
  project: string
  /** 어떤 표시로 잡았나 (.venv, node_modules …) */
  marker: string
  /** 이게 무엇인지 한 마디 */
  what: string
  /** 지우면 어떻게 되나 — 얼마나 걸리는지까지 */
  onDelete: string
  count: number
  bytes: number
  /** 가장 최근에 손댄 게 며칠 전인가. 모르면 null */
  newestDays: number | null
  /**
   * 옮기기만 권하는 카드인가.
   *
   * ★ 왜 필요한가: '.venv'는 지워도 되는 게 확실하다(다시 만들면 된다). 그런데
   *   그냥 큰 파일이 모여 있는 폴더는 **안에 뭐가 있는지 우리가 모른다.**
   *   `AppData\Local\MusicFactory\releases`가 만들어둔 결과물일 수도 있다.
   *   그런 폴더에 "통째로 정리" 버튼을 달면, 우리가 모르는 것을 지우라고
   *   권하는 셈이다. 옮기기는 다르다 — 아무것도 안 없어지니까.
   */
  moveOnly?: boolean
}

interface MarkerSpec {
  what: string
  onDelete: string
}

/**
 * 결정 단위를 만드는 표시들.
 *
 * 순서가 중요하다 — 경로에서 **가장 먼저 나오는** 표시가 단위가 된다.
 * `proj\.venv\Lib\site-packages\...`는 site-packages가 아니라 .venv가 단위다.
 * 안쪽을 단위로 잡으면 "가상환경의 일부만 지우기"가 되어 처음 문제로 돌아간다.
 */
const MARKERS: Record<string, MarkerSpec> = {
  node_modules: {
    what: '설치해 둔 라이브러리',
    onDelete: '다시 열 때 npm install 한 번이면 돌아옵니다 (1~3분).',
  },
  '.venv': {
    what: '파이썬 가상환경',
    onDelete: '가상환경을 다시 만들면 돌아옵니다 (pip install, 몇 분).',
  },
  venv: {
    what: '파이썬 가상환경',
    onDelete: '가상환경을 다시 만들면 돌아옵니다 (pip install, 몇 분).',
  },
  'site-packages': {
    what: '파이썬 라이브러리',
    onDelete: 'pip install로 다시 받습니다 (몇 분).',
  },
  target: { what: '빌드 결과물', onDelete: '다시 빌드하면 그대로 만들어집니다.' },
  dist: { what: '빌드 결과물', onDelete: '다시 빌드하면 그대로 만들어집니다.' },
  build: { what: '빌드 결과물', onDelete: '다시 빌드하면 그대로 만들어집니다.' },
  out: { what: '빌드 결과물', onDelete: '다시 빌드하면 그대로 만들어집니다.' },
  '.next': { what: '빌드 캐시', onDelete: '다음 실행 때 다시 만듭니다.' },
  __pycache__: { what: '파이썬 캐시', onDelete: '실행하면 다시 생깁니다.' },
  '.gradle': { what: '그레이들 캐시', onDelete: '다음 빌드 때 다시 받습니다.' },
  '.tox': { what: '테스트 환경', onDelete: '다시 만들면 돌아옵니다.' },
}

const MARKER_NAMES = Object.keys(MARKERS)

/** 이보다 작은 묶음은 카드로 만들지 않는다 — 큰 결정만 카드가 된다. */
export const UNIT_MIN_BYTES = 100 * 1024 * 1024 // 100MB

interface Split {
  unitPath: string
  project: string
  marker: string
}

/**
 * 경로를 '결정 단위 폴더'와 그 앞의 프로젝트로 가른다. 표시가 없으면 null.
 * 대소문자는 비교할 때만 낮추고, 보여줄 때는 원본을 그대로 쓴다.
 */
export function splitUnit(path: string): Split | null {
  const parts = path.split(/[\\/]/)
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i].toLowerCase()
    if (!MARKER_NAMES.includes(seg)) continue
    // 뿌리 바로 아래(C:\node_modules)면 프로젝트라고 부를 게 없다 — 이름을 지어내지 않는다.
    const project = i > 0 ? parts[i - 1] : ''
    if (/^[a-z]:$/i.test(project)) return null
    return {
      unitPath: parts.slice(0, i + 1).join('\\'),
      project,
      marker: parts[i],
    }
  }
  return null
}

export interface UnitSplit {
  units: Unit[]
  /** 어느 단위에도 안 들어간 것 — 낱개 목록으로 간다 */
  looseCount: number
  looseBytes: number
}

/**
 * 파일 목록을 결정 단위로 접는다.
 *
 * 큰 것부터 준다. 작은 묶음(UNIT_MIN_BYTES 미만)은 카드로 만들지 않고 낱개로 보낸다 —
 * 300MB짜리 카드 40개는 다시 '읽을 수 없는 목록'이다.
 */
export function foldIntoUnits(items: UnitItem[], top = 8): UnitSplit {
  const map = new Map<string, Unit & { key: string }>()
  let looseCount = 0
  let looseBytes = 0

  for (const it of items) {
    const s = splitUnit(it.path)
    if (!s) {
      looseCount++
      looseBytes += it.size
      continue
    }
    const key = s.unitPath.toLowerCase()
    const spec = MARKERS[s.marker.toLowerCase()]
    const g = map.get(key)
    if (g) {
      g.count++
      g.bytes += it.size
      if (typeof it.ageDays === 'number' && (g.newestDays === null || it.ageDays < g.newestDays)) {
        g.newestDays = it.ageDays
      }
    } else {
      map.set(key, {
        key,
        path: s.unitPath,
        label: s.project ? `${s.project} › ${s.marker}` : s.marker,
        project: s.project,
        marker: s.marker,
        what: spec.what,
        onDelete: spec.onDelete,
        count: 1,
        bytes: it.size,
        newestDays: typeof it.ageDays === 'number' ? it.ageDays : null,
      })
    }
  }

  const all = [...map.values()].sort((a, b) => b.bytes - a.bytes)
  const units: Unit[] = []
  for (const u of all) {
    if (units.length < top && u.bytes >= UNIT_MIN_BYTES) {
      const { key, ...rest } = u
      units.push(rest)
    } else {
      // 카드가 안 된 묶음은 사라지지 않는다. 낱개 쪽으로 넘어간다.
      looseCount += u.count
      looseBytes += u.bytes
    }
  }
  return { units, looseCount, looseBytes }
}

/**
 * 큰 파일이 몰려 있는 폴더 — **옮기기 후보**.
 *
 * ── 왜 필요했나 ──────────────────────────────────────────────
 * 실측에서 이렇게 나왔다: `AppData\Local\MusicFactory\releases`에 17.6GB가
 * 쌓여 있는데, 파일 하나하나는 "옮기면 그 앱이 못 찾아요"라 전부 이동 불가였다.
 * 맞는 판정이다 — 파일만 빼가면 앱이 깨지니까. 그런데 **폴더째 옮기고 원래
 * 자리에 바로가기를 남기면** 앱은 그대로 찾아간다(relocate.ts의 정션).
 * 즉 "옮길 수 없다"가 아니라 "낱개로는 못 옮긴다"였는데, 화면은 앞엣말만 했다.
 *
 * 그래서 표시(.venv 같은 것)가 없어도 큰 게 몰려 있는 폴더를 후보로 올린다.
 * 단, **지우라고는 하지 않는다**(moveOnly) — 그 안에 뭐가 있는지는 모르니까.
 */
export function folderCandidates(
  items: UnitItem[],
  opts: { minBytes?: number; minFiles?: number; top?: number } = {}
): Unit[] {
  const minBytes = opts.minBytes ?? 1024 ** 3 // 1GB — 옮길 값어치가 있는 크기
  // 2개면 충분하다. 8GB짜리 두 개가 든 폴더를 "흩어져 있다"고 뺄 이유가 없다.
  const minFiles = opts.minFiles ?? 2
  const map = new Map<string, Unit & { key: string }>()

  for (const it of items) {
    if (splitUnit(it.path)) continue // 표시가 있는 건 위쪽 규칙이 이미 다뤘다
    const i = Math.max(it.path.lastIndexOf('\\'), it.path.lastIndexOf('/'))
    if (i <= 0) continue
    const dir = it.path.slice(0, i)
    const key = dir.toLowerCase()
    const g = map.get(key)
    if (g) {
      g.count++
      g.bytes += it.size
      if (typeof it.ageDays === 'number' && (g.newestDays === null || it.ageDays < g.newestDays)) {
        g.newestDays = it.ageDays
      }
    } else {
      const name = dir.split(/[\\/]/).filter(Boolean).slice(-2).join(' › ')
      map.set(key, {
        key,
        path: dir,
        label: name,
        project: '',
        marker: '',
        what: '큰 파일이 모여 있는 폴더',
        onDelete: '지우지 않고 자리만 옮깁니다. 원래 경로로는 그대로 열려요.',
        count: 1,
        bytes: it.size,
        newestDays: typeof it.ageDays === 'number' ? it.ageDays : null,
        moveOnly: true,
      })
    }
  }

  return [...map.values()]
    .filter((u) => u.bytes >= minBytes && u.count >= minFiles)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, opts.top ?? 4)
    .map(({ key, ...rest }) => rest)
}

/**
 * "마지막으로 손댄 게 언제인가"를 사람 말로. 이게 '아직 쓰는 프로젝트인가'의
 * 유일한 관측 가능한 신호다 — 나머지는 사용자만 안다.
 */
export function lastTouched(days: number | null): string {
  if (days === null) return '언제 손댔는지 알 수 없어요'
  if (days < 7) return '최근에도 쓰고 계세요'
  if (days < 30) return `${days}일 전에 마지막으로 손댔어요`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}개월째 손대지 않았어요`
  return `${Math.floor(days / 365)}년 넘게 손대지 않았어요`
}
