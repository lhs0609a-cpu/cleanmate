/**
 * 크기 트리 — "어디가 큰가"에 답한다
 *
 * ── 왜 필요한가 (2026-08-18 실측에서 나온 문제) ────────────────
 * 화면은 여태 **의미별로만** 접었다: "프로그램이 저장한 자료 37.33GB".
 * 그 말을 듣고 사용자가 할 수 있는 일이 없다. 어디에 있는지를 안 말했으니까.
 *
 * 실측에서 37.6GB를 찾은 방법은 규칙이 아니었다. 이 순서였다:
 *     AppData\Local 233GB → MusicFactory 176GB → work 89GB · ACE-Step 58GB
 * 큰 폴더로 계속 내려가다가 **여러 갈래로 갈리는 지점**에서 멈췄다.
 * 그게 사람이 "여기가 문제구나"라고 인식하는 자리다.
 *
 * ── 설계 ─────────────────────────────────────────────────────
 * 이건 규칙이 아니라 **관측**이다. 경로 이름을 하나도 안 본다. 크기만 본다.
 * 그래서 내일 새로 나온 앱이 처음 보는 폴더에 100GB를 쌓아도 그대로 걸린다.
 *
 * 비용: 스캔이 이미 모든 파일을 걷고 있으므로 디스크 I/O가 0이다.
 * 파일마다 조상 폴더를 거슬러 올라가며 더하는 것뿐이다.
 */

/** 트리를 세우는 데 필요한 최소한. 스캔 결과가 그대로 들어온다. */
export interface SizedFile {
  path: string
  size: number
}

export interface Hotspot {
  path: string
  bytes: number
  files: number
  /** 훑은 전체 대비 몫 (0~1) */
  share: number
}

/** 경로 구분자를 통일한다. 비교는 소문자로, 보여주는 건 원본으로. */
function parentOf(path: string): string | null {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  if (i <= 0) return null
  // 'C:\' 같은 드라이브 루트에서 더 못 올라간다
  const parent = path.slice(0, i)
  if (/^[a-zA-Z]:$/.test(parent)) return parent + '\\'
  return parent
}

export interface DirNode {
  path: string
  bytes: number
  files: number
  children: Set<string>
}

/**
 * 폴더별 누적 크기를 쌓는다.
 *
 * ★ 파일마다 **모든 조상**에 더한다. 그래야 상위 폴더가 아래 전부를 합한 값을
 *   갖고, "위에서부터 큰 쪽으로 내려가기"가 가능해진다. 자기 폴더에만 더하면
 *   AppData\Local은 0으로 나오고 트리를 못 탄다.
 */
export function buildSizeTree(files: SizedFile[]): Map<string, DirNode> {
  const dirs = new Map<string, DirNode>()

  const touch = (path: string): DirNode => {
    let n = dirs.get(path)
    if (!n) {
      n = { path, bytes: 0, files: 0, children: new Set() }
      dirs.set(path, n)
    }
    return n
  }

  for (const f of files) {
    let dir = parentOf(f.path)
    let child: string | null = null
    while (dir) {
      const n = touch(dir)
      n.bytes += f.size
      n.files++
      if (child) n.children.add(child)
      child = dir
      const next: string | null = parentOf(dir)
      if (next === dir) break // 루트에서 제자리걸음하면 멈춘다
      dir = next
    }
  }
  return dirs
}

/**
 * 핫스팟 — **용량이 몰려 있는 가장 깊은 폴더**를 찾는다.
 *
 * 위에서부터 내려가되, 자식 하나가 부모의 대부분(dominance)을 차지하면 계속
 * 내려간다. 여러 갈래로 갈리면 거기서 멈추고 그 폴더를 보고한다.
 *
 * ★ 왜 "가장 큰 폴더"를 그냥 주지 않나: 그러면 항상 `C:\Users`가 나온다.
 *   그건 사용자가 이미 아는 사실이라 아무 정보가 아니다. 알고 싶은 건
 *   "그 안 어디"다.
 *
 * @param minShare  전체의 이만큼은 돼야 보고한다. 작은 것까지 올리면 목록이 된다.
 * @param dominance 자식 하나가 부모의 이만큼을 차지하면 더 내려간다.
 */
export function findHotspots(
  dirs: Map<string, DirNode>,
  totalBytes: number,
  { minShare = 0.03, dominance = 0.6, limit = 12 }: { minShare?: number; dominance?: number; limit?: number } = {}
): Hotspot[] {
  if (!totalBytes) return []

  /* ★ 위에서부터 타고 내려가는 대신 **순수 술어**로 바꿨다.
     타고 내려가는 방식은 하강 경로에서 갈라진 가지를 통째로 놓친다 — 실측에서
     MusicFactory로 내려가느라 형제인 Android 12.3GB가 목록에 아예 안 올라왔다.
     "여기가 갈리는 지점인가"는 그 폴더만 보면 판단할 수 있으므로 순회가 필요없다. */
  const out: Hotspot[] = []
  for (const n of dirs.values()) {
    const share = n.bytes / totalBytes
    if (share < minShare) continue // 작은 건 목록만 길어진다

    // 자식 하나가 압도적이면 여기가 아니라 그 자식이 진짜 자리다.
    let biggest = 0
    for (const c of n.children) {
      const cn = dirs.get(c)
      if (cn && cn.bytes > biggest) biggest = cn.bytes
    }
    if (biggest >= n.bytes * dominance) continue

    out.push({ path: n.path, bytes: n.bytes, files: n.files, share })
  }

  return out.sort((a, b) => b.bytes - a.bytes).slice(0, limit)
}
