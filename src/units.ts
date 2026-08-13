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
  /** 되돌리는 데 드는 것 한 마디: 'pip install 몇 분' */
  undoCost: string
  /**
   * 이 프로젝트를 아직 쓰고 있나 — **관측된 사실만.**
   *
   * ★ 왜 확률을 안 쓰나: "안 쓸 확률 87%" 같은 숫자를 만들 근거가 우리에겐 없다.
   *   사용자가 이걸 쓸지 안 쓸지의 정답 데이터가 없으니 그건 계산이 아니라 지어내기고,
   *   무엇보다 **사용자가 검증할 수 없는 숫자**다. "왜 87%예요?"에 답을 못 한다.
   *   한 번 틀리면 나머지 설명까지 같이 의심받는다 — 이 앱이 신뢰로 버는 걸 깎는다.
   *
   * 대신 셀 수 있는 걸 센다. 아래는 전부 파일 시스템에서 실제로 읽은 값이고,
   * 사용자가 탐색기를 열어 그대로 확인할 수 있다.
   */
  activity?: UnitActivity
}

/**
 * 프로젝트가 살아 있는지의 관측값.
 *
 * ★ .venv 파일의 수정일은 '쓴 날'이 아니라 **'설치한 날'**이다. 그래서
 *   "26일 전에 마지막으로 바뀌었어요"는 "26일 전에 pip install 했다"는 뜻이지
 *   "26일 전까지 작업했다"가 아니다. "아직 작업하시나요?"의 답이 될 수 없다.
 *   진짜 답은 옆에 있다 — **표시 폴더 바깥의 소스 파일**이 언제 바뀌었나.
 */
export interface UnitActivity {
  /**
   * 무엇을 센 값인가.
   *   'source' — 프로젝트의 사람이 쓴 파일(코드·설정·문서)
   *   'folder' — 그 폴더 자신의 파일들
   * 섞으면 문장이 거짓이 된다. "소스는 그대로"와 "폴더는 매일 바뀐다"는 다른 말이다.
   */
  scope: 'source' | 'folder'
  /** 센 파일 수 */
  sourceFiles: number
  /** 그중 최근 RECENT_DAYS 안에 바뀐 것 */
  recentSources: number
  /** 비율(%) — 지어낸 확률이 아니라 센 개수의 비율이다 */
  recentPercent: number
  /** 소스를 마지막으로 고친 게 며칠 전인가. 모르면 null */
  sourceDays: number | null
  /**
   * 최근 것들이 **며칠에 걸쳐** 생겼나.
   *
   * ★ 이게 없으면 숫자가 거짓말을 한다. 실측에서 바로 걸렸다:
   *   ACE-Step-1.5의 소스 1,161개가 전부 '최근 30일'에 들어와 100%가 나왔는데,
   *   실제로는 **28일 전 하루에 한꺼번에 깔린 것**이었다. 오늘 고친 건 1개뿐.
   *   설치·전개 한 번과 매일 고쳐 온 것이 같은 숫자로 보이면 신호가 아니다.
   *   며칠에 걸쳐 있는지를 세면 둘이 갈린다.
   */
  spreadDays: number
  /** 가장 많이 몰린 날이 며칠 전인가 (설치일로 읽히는 날) */
  busiestDay: number | null
  /** 그날 하루에 생긴 개수 */
  busiestCount: number
}

/** '최근'의 기준. 한 달 안에 손댄 프로젝트는 쓰는 중으로 본다. */
export const RECENT_DAYS = 30

interface MarkerSpec {
  what: string
  onDelete: string
  /** 되돌리는 데 실제로 드는 것. 한 마디로 */
  undoCost: string
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
    what: '인터넷에서 받아둔 프로그램 부품',
    onDelete: '그 폴더를 다시 열 때 부품을 자동으로 다시 받습니다 (1~3분).',
    undoCost: '다시 받는 데 1~3분',
  },
  '.venv': {
    what: '그 폴더 전용 부품 상자',
    onDelete: '부품을 다시 받아 채우면 그대로 돌아옵니다 (몇 분).',
    undoCost: '다시 받는 데 몇 분',
  },
  venv: {
    what: '그 폴더 전용 부품 상자',
    onDelete: '부품을 다시 받아 채우면 그대로 돌아옵니다 (몇 분).',
    undoCost: '다시 받는 데 몇 분',
  },
  'site-packages': {
    what: '받아둔 프로그램 부품 모음',
    onDelete: '인터넷에서 다시 받습니다 (몇 분).',
    undoCost: '다시 받는 데 몇 분',
  },
  target: { what: '만들어 낸 완성본', onDelete: '원본이 남아 있어서 다시 만들면 그대로 나옵니다.', undoCost: '다시 만들기 한 번' },
  dist: { what: '만들어 낸 완성본', onDelete: '원본이 남아 있어서 다시 만들면 그대로 나옵니다.', undoCost: '다시 만들기 한 번' },
  build: { what: '만들어 낸 완성본', onDelete: '원본이 남아 있어서 다시 만들면 그대로 나옵니다.', undoCost: '다시 만들기 한 번' },
  out: { what: '만들어 낸 완성본', onDelete: '원본이 남아 있어서 다시 만들면 그대로 나옵니다.', undoCost: '다시 만들기 한 번' },
  '.next': { what: '빨리 열려고 미리 만들어 둔 것', onDelete: '다음에 열 때 다시 만듭니다.', undoCost: '알아서 다시 생김' },
  __pycache__: { what: '빨리 켜지려고 미리 만들어 둔 것', onDelete: '실행하면 다시 생깁니다.', undoCost: '알아서 다시 생김' },
  '.gradle': { what: '받아둔 프로그램 부품', onDelete: '다음에 만들 때 인터넷에서 다시 받습니다.', undoCost: '다시 받는 데 몇 분' },
  '.tox': { what: '시험용 부품 상자', onDelete: '다시 만들면 돌아옵니다.', undoCost: '다시 만드는 데 몇 분' },
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
        undoCost: spec.undoCost,
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
  const map = new Map<string, Unit & { key: string; recent: number }>()
  /** 폴더별 '며칠 전에 몇 개' — 설치 한 번과 계속 쌓이는 것을 가른다 */
  const byDay = new Map<string, Map<number, number>>()

  for (const it of items) {
    if (splitUnit(it.path)) continue // 표시가 있는 건 위쪽 규칙이 이미 다뤘다
    const i = Math.max(it.path.lastIndexOf('\\'), it.path.lastIndexOf('/'))
    if (i <= 0) continue
    const dir = it.path.slice(0, i)
    const key = dir.toLowerCase()
    const recent = typeof it.ageDays === 'number' && it.ageDays <= RECENT_DAYS ? 1 : 0
    if (recent) {
      const hist = byDay.get(key) ?? new Map<number, number>()
      hist.set(it.ageDays!, (hist.get(it.ageDays!) ?? 0) + 1)
      byDay.set(key, hist)
    }
    const g = map.get(key)
    if (g) {
      g.count++
      g.bytes += it.size
      g.recent += recent
      if (typeof it.ageDays === 'number' && (g.newestDays === null || it.ageDays < g.newestDays)) {
        g.newestDays = it.ageDays
      }
    } else {
      const name = dir.split(/[\\/]/).filter(Boolean).slice(-2).join(' › ')
      map.set(key, {
        key,
        recent,
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
        // 안에 뭐가 있는지 모르는 폴더다. 되돌리는 비용도 모른다 — 그래서 옮기기만 권한다.
        undoCost: '',
      })
    }
  }

  return [...map.values()]
    .filter((u) => u.bytes >= minBytes && u.count >= minFiles)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, opts.top ?? 4)
    .map(({ key, recent, ...rest }) => ({
      ...rest,
      /* 데이터 폴더의 신호는 그 폴더 자신의 파일이다. 여기에 프로젝트 소스 규칙을
         갖다 대면 셀 게 없어서 아무 말도 못 한다 — 정작 "지금도 쓰이는 폴더인가"가
         옮기기 전에 제일 알고 싶은 것인데. */
      activity: {
        scope: 'folder' as const,
        sourceFiles: rest.count,
        recentSources: recent,
        sourceDays: rest.newestDays,
        ...spreadOf(byDay.get(key) ?? new Map(), recent, rest.count),
      },
    }))
}

/* ────────────────────────────────────────────────────────────
   실사용 신호 — "아직 작업하시나요?"를 우리가 관측한다
   ──────────────────────────────────────────────────────────── */

/**
 * 사람이 직접 쓰는 파일인가 — 코드·설정·문서.
 *
 * ★ 왜 좁히나 (실측에서 바로 드러났다): 처음엔 표시 폴더 바깥을 전부 셌다.
 *   그랬더니 `ACE-Step-1.5`가 "소스 1,746개 중 최근 30일에 바뀐 것 1,746개(100%)"로
 *   나왔다. 그 프로젝트가 활발해서가 아니라 **그 앱이 로그와 산출물을 매일
 *   거기에 쓰고 있어서**다. 그러면 모든 프로젝트가 '작업 중'이 되고, 신호가
 *   아니라 배경음이 된다.
 *
 *   사람이 손으로 고치는 파일만 센다. 프로그램이 뱉는 것(로그·출력·캐시)은 뺀다.
 */
const SOURCE_EXTS = new Set([
  '.py', '.ipynb', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte',
  '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.sql',
  '.html', '.css', '.scss', '.json', '.toml', '.yaml', '.yml', '.ini', '.cfg', '.env',
  '.md', '.rst', '.sh', '.bat', '.ps1', '.gradle', '.xml',
])

/** 프로그램이 뱉는 자리 — 여기 있는 건 사람이 고친 게 아니다. */
const GENERATED_DIR = /[\\/](logs?|log|cache|caches|tmp|temp|output|outputs|results?|runs?|checkpoints?|wandb|\.pytest_cache|\.mypy_cache|\.idea|\.vscode)[\\/]/i

export function isSourceLike(path: string): boolean {
  if (GENERATED_DIR.test(path)) return false
  const name = path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  return SOURCE_EXTS.has(name.slice(dot).toLowerCase())
}

/** 폴더 하나의 활동 요약. 스캔하면서 한 파일씩 채운다. */
export interface DirStat {
  files: number
  recent: number
  newestDays: number | null
  /** 최근 것들이 며칠 전에 몇 개씩 생겼나 — 설치 한 번과 매일 작업을 가른다 */
  recentByDay: Map<number, number>
}

/** 폴더별 활동 장부. 키는 소문자 폴더 경로. */
export type SourceDirs = Map<string, DirStat>

/**
 * 스캔이 지나가는 파일 하나를 장부에 적는다.
 *
 * ★ 스캔 도중에 적는 이유: 프로젝트마다 폴더를 다시 열어 훑으면 몇 분이 더 든다.
 *   어차피 한 번 지나가는 파일이니 그때 세면 추가 비용이 0이다.
 *
 * 표시 폴더 안쪽(.venv·node_modules)은 적지 않는다. 거기 파일의 수정일은
 * '쓴 날'이 아니라 '설치한 날'이라, 세어봐야 "아직 작업하나"에 답이 안 된다.
 */
export function noteSourceFile(dirs: SourceDirs, path: string, ageDays: number | undefined, recentDays = RECENT_DAYS): void {
  if (splitUnit(path)) return
  if (!isSourceLike(path)) return // 로그·산출물을 세면 모든 프로젝트가 '작업 중'이 된다
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  if (i <= 0) return
  const key = path.slice(0, i).toLowerCase()
  const d = dirs.get(key) ?? { files: 0, recent: 0, newestDays: null, recentByDay: new Map<number, number>() }
  d.files++
  if (typeof ageDays === 'number') {
    if (ageDays <= recentDays) {
      d.recent++
      d.recentByDay.set(ageDays, (d.recentByDay.get(ageDays) ?? 0) + 1)
    }
    if (d.newestDays === null || ageDays < d.newestDays) d.newestDays = ageDays
  }
  dirs.set(key, d)
}

/** 프로젝트 뿌리 아래 폴더들을 합쳐 활동 값을 만든다. 아무것도 못 세면 null. */
export function activityForRoot(dirs: SourceDirs, root: string): UnitActivity | null {
  const prefix = root.toLowerCase()
  const with_ = prefix.endsWith('\\') ? prefix : prefix + '\\'
  let sourceFiles = 0
  let recentSources = 0
  let sourceDays: number | null = null
  const byDay = new Map<number, number>()

  for (const [dir, d] of dirs) {
    if (dir !== prefix && !dir.startsWith(with_)) continue
    sourceFiles += d.files
    recentSources += d.recent
    if (d.newestDays !== null && (sourceDays === null || d.newestDays < sourceDays)) sourceDays = d.newestDays
    for (const [day, n] of d.recentByDay) byDay.set(day, (byDay.get(day) ?? 0) + n)
  }
  if (!sourceFiles) return null
  return { scope: 'source', sourceFiles, recentSources, sourceDays, ...spreadOf(byDay, recentSources, sourceFiles) }
}

/** 날짜별 개수 → 퍼진 정도. 한 날에 몰렸으면 그건 작업이 아니라 설치다. */
export function spreadOf(byDay: Map<number, number>, recent: number, total: number) {
  let busiestDay: number | null = null
  let busiestCount = 0
  for (const [day, n] of byDay) {
    if (n > busiestCount) { busiestCount = n; busiestDay = day }
  }
  return {
    recentPercent: total ? Math.round((recent / total) * 100) : 0,
    spreadDays: byDay.size,
    busiestDay,
    busiestCount,
  }
}

/** 최근 것이 하루에 몰려 있나 — 설치·전개 한 번으로 읽을 근거. */
export function looksLikeOneShot(a: UnitActivity): boolean {
  return a.spreadDays > 0 && a.spreadDays <= 2 && a.busiestCount >= Math.max(20, a.recentSources * 0.7)
}

/** 단위 카드에 활동 값을 붙인다. 프로젝트 뿌리 = 표시 폴더의 부모. */
export function attachActivity(units: Unit[], dirs: SourceDirs): Unit[] {
  return units.map((u) => {
    // 폴더 카드는 자기 파일로 이미 셌다(folderCandidates). 덮어쓰지 않는다 —
    // 부모 폴더의 소스를 갖다 붙이면 옆 프로젝트의 활동이 이 폴더 것처럼 보인다.
    if (!u.marker) return u
    const i = Math.max(u.path.lastIndexOf('\\'), u.path.lastIndexOf('/'))
    const a = activityForRoot(dirs, i > 0 ? u.path.slice(0, i) : u.path)
    return a ? { ...u, activity: a } : u
  })
}

/**
 * 실사용 신호를 한 줄로. **못 세었으면 아무 말도 안 한다** — 빈 문자열.
 *
 * 여기서 "안 쓰실 것 같아요" 같은 단정을 하지 않는다. 우리가 본 것만 쓰고,
 * 결론은 사용자가 낸다. 우리가 본 것도 정확히 몇 개 중 몇 개인지 밝힌다 —
 * 그래야 사용자가 탐색기를 열어 확인할 수 있고, 확인할 수 있어야 믿을 수 있다.
 */
export function activitySentence(a: UnitActivity | undefined, recentDays = RECENT_DAYS): string {
  if (!a || !a.sourceFiles) return ''
  const what = a.scope === 'source' ? '직접 만드신 파일' : '이 폴더의 파일'

  const tail = `(${what} ${a.sourceFiles.toLocaleString()}개 중 최근 ${recentDays}일에 ${
    a.scope === 'folder' ? '생기거나 바뀐' : '바뀐'
  } 것 ${a.recentSources.toLocaleString()}개 · ${a.recentPercent}%)`

  const ago = (d: number) => (d < 365 ? `${Math.floor(d / 30)}개월` : `${Math.floor(d / 365)}년`)

  /* ★ 하루에 몰린 건 작업이 아니라 설치다. 이걸 안 가르면 "100% 최근"이
     "매일 쓰는 중"으로 읽힌다 — 실제로는 28일 전 하루에 깔린 것이었다. */
  if (looksLikeOneShot(a)) {
    const rest = a.recentSources - a.busiestCount
    return `${a.busiestDay}일 전 하루에 ${a.busiestCount.toLocaleString()}개가 한꺼번에 ${
      a.scope === 'folder' ? '쌓였어요' : '들어왔어요'
    } — 그 뒤로 ${rest ? `${rest.toLocaleString()}개만 ` : ''}바뀌었습니다 ${tail}`
  }

  if (a.scope === 'folder') {
    // 데이터 폴더는 '고친다'가 아니라 '쌓인다'. 결론도 반대다 —
    // 지금도 쓰이는 폴더면 옮길 때 그 프로그램을 먼저 닫아야 한다.
    const head =
      a.spreadDays >= 3
        ? '지금도 쌓이는 중이에요 — 옮기실 거면 그 프로그램을 먼저 닫아주세요'
        : a.sourceDays === null
          ? '언제 쌓인 것인지 알 수 없어요'
          : `${ago(a.sourceDays)}째 새로 쌓인 게 없어요`
    return `${head} ${tail}`
  }

  const head =
    a.sourceDays === null
      ? '직접 만드신 파일이 언제 바뀌었는지 못 읽었어요'
      : a.spreadDays >= 3
        ? `최근 ${recentDays}일 중 ${a.spreadDays}일에 걸쳐 직접 고치셨어요 — 아직 쓰시는 폴더입니다`
        : a.sourceDays <= recentDays
          ? `${a.sourceDays}일 전에 직접 고치신 게 있어요`
          : `직접 만드신 파일도 ${ago(a.sourceDays)}째 그대로예요`
  return `${head} ${tail}`
}

/**
 * "마지막으로 손댄 게 언제인가"를 사람 말로. 이게 '아직 쓰는 프로젝트인가'의
 * 유일한 관측 가능한 신호다 — 나머지는 사용자만 안다.
 */
export function lastTouched(days: number | null): string {
  if (days === null) return '언제 손댔는지 알 수 없어요'
  if (days < 7) return '최근에도 쓰고 계세요'
  if (days < 30) return `${days}일 전에 마지막으로 바뀌었어요`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}개월째 아무것도 안 바뀌었어요`
  return `${Math.floor(days / 365)}년 넘게 아무것도 안 바뀌었어요`
}
