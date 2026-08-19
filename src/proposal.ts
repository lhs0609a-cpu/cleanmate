/**
 * 제안 — 42만 개의 판정을 사람이 볼 수 있는 카드 몇 장으로 접는다
 *
 * ── 목표는 이 대화의 모양이다 ────────────────────────────────
 * 사용자가 "C드라이브 꽉 찼어, 지워도 되는 거 찾아봐"라고 했을 때 돌아온 답이
 * 이런 모양이었다:
 *
 *     1순위 — 확실히 지워도 되는 것 (약 100GB)
 *       37.6GB  MusicFactory가 만든 임시 WAV 633개  ← tmp 폴더, 7월부터 쌓임
 *        2.9GB  작업 폴더마다 복사된 폰트 705개
 *       15.3GB  개발 캐시 (npm·pnpm·playwright)
 *     2순위 — 지워도 되지만 확인받고 싶은 것
 *     절대 안 되는 것 — 검수 대기 결과물 19GB, 모델 본체 15GB
 *
 * 사용자는 "1순위만 실행"이라고 답했다. 그게 전부다.
 * **판정이 파일마다 붙어 있어도, 파일마다 물으면 아무도 못 쓴다.**
 *
 * ── 그래서 여기서 하는 일 ────────────────────────────────────
 * verdict.ts가 낸 판정을 묶어서 **카드 12장 이내**로 만든다. 묶는 기준은
 * 사람이 말할 때 쓰는 단위다:
 *
 *     "어디에 있는 무엇이 왜 지워도 되나"
 *      └ 핫스팟   └ 근거    └ 되살리는 법
 *
 * 핫스팟(sizetree)을 틀로 쓰는 이유: 그게 "용량이 몰린 자리"라서 사람이
 * 이미 그 단위로 인식한다. 경로 전체를 나열하면 다시 42만 줄이 된다.
 *
 * ── 목록이 길어지면 실패다 ───────────────────────────────────
 * 카드가 200장이면 체크박스 42만 개와 같은 문제다. 큰 것부터 자르고 나머지는
 * '그 외' 한 줄로 접는다. 접었다는 사실은 반드시 말한다 — 조용히 자르면
 * 사용자는 그게 전부인 줄 안다.
 */

import type { FileVerdict, Action, Recovery, Effort } from './verdict.ts'
import type { Hotspot } from './sizetree.ts'

export interface Proposal {
  /** 실행할 때 이 카드를 가리키는 값 */
  id: string
  /** 한 줄 제목 — "MusicFactory의 다시 만들어지는 것" */
  title: string
  /** 어디인가. 사용자가 "아 거기" 하고 알아볼 자리 */
  where: string
  bytes: number
  count: number
  action: Action
  recovery: Recovery
  effort: Effort
  /** 왜 이 판정인지 한 줄 */
  because: string
  /** 순위 — 1은 바로, 2는 한 번 보고, 3은 물어보고 */
  tier: 1 | 2 | 3
  /** 실행 대상. 카드 하나가 곧 실행 단위다 */
  paths: string[]
  /** 대표 예시 몇 개 — "정말 이런 것들인가"를 눈으로 확인하는 용도 */
  samples: { path: string; size: number }[]
}

export interface ProposalResult {
  proposals: Proposal[]
  /** 카드로 안 올라간 나머지. 조용히 자르지 않는다 */
  rest: { bytes: number; count: number; cards: number }
}

const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p

/**
 * 카드 제목에 쓸 이름 — **누구 것인지**를 앞에 붙인다.
 *
 * ★ 왜 필요한가: 마지막 폴더 이름만 쓰면 제목이 이렇게 나온다.
 *     "lib — 다시 받거나 빌드하면 되는 것"
 *     "x86_64 — 되살릴 수 없는 것"
 *   사용자는 이게 뭔지 알 수 없다. 실측에서 실제로 그렇게 나왔다.
 *
 *   경로에서 **주인**을 뽑아 앞에 세운다. AppData 아래 MusicFactory의 것이면
 *   "MusicFactory · lib"이 되어 그제야 알아볼 수 있다.
 */
export function ownerLabel(path: string): string {
  const segs = path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  const low = segs.map((x) => x.toLowerCase())
  const last = segs[segs.length - 1] ?? path

  /* 주인이 시작되는 자리 — 이 표지 **다음** 칸이 앱·프로젝트 이름이다. */
  const marks = ['local', 'roaming', 'locallow', 'program files', 'program files (x86)', 'programdata']

  /* ★ 자리 자체가 표지면 주인이 없다.
     C:/Users/me/AppData/Local 이 통째로 핫스팟이면 마지막 칸이 'Local'인데,
     그걸 그대로 쓰면 "AppData · Local"이라는 제목이 나온다(실측). 그건 앱 이름이
     아니라 그냥 윈도우 폴더라서 사용자에게 아무 말도 안 한다. */
  if (marks.includes(last.toLowerCase())) return '여러 앱'

  let owner = ''
  for (let i = low.length - 2; i >= 0; i--) {
    if (marks.includes(low[i])) { owner = segs[i + 1]; break }
    // 사용자 폴더 바로 아래(C:/Users/me/GVF-ComfyUI)도 주인으로 본다
    if (low[i] === 'users' && i + 2 < segs.length) { owner = segs[i + 2]; break }
  }
  if (!owner || owner.toLowerCase() === last.toLowerCase()) return last
  return `${owner} · ${last}`
}

const RECOVERY_TITLE: Record<Recovery, string> = {
  regenerates: '다시 만들어지는 임시·캐시',
  'copy-elsewhere': '다른 곳에도 있는 사본',
  'sibling-copy': '폴더마다 복사돼 들어온 것',
  'backed-up': '클라우드에도 있는 것',
  rebuildable: '다시 받거나 빌드하면 되는 것',
  none: '되살릴 수 없는 것',
}

/**
 * 순위는 '되살리는 품'과 '판정'에서 나온다. 따로 매기지 않는다 —
 * 두 벌로 관리하면 언젠가 어긋나고, 어긋난 쪽이 화면에 뜬다.
 */
function tierOf(action: Action, effort: Effort): 1 | 2 | 3 {
  if (action !== 'delete') return 3
  return effort === 'free' ? 1 : 2
}

export interface ProposeOptions {
  /** 카드 최대 장수. 넘으면 나머지는 '그 외'로 접는다 */
  limit?: number
  /** 이보다 작은 묶음은 카드로 안 만든다 */
  minBytes?: number
}

/**
 * 판정을 카드로 접는다.
 *
 * @param hotspots sizetree가 찾은 '용량이 몰린 자리'. 묶는 틀로 쓴다.
 */
export function propose(
  verdicts: FileVerdict[],
  hotspots: Hotspot[] = [],
  { limit = 12, minBytes = 200 * 1024 * 1024 }: ProposeOptions = {}
): ProposalResult {
  /* 핫스팟을 깊은 것부터 본다 — 파일은 자기를 감싼 **가장 안쪽** 핫스팟에
     속해야 한다. 얕은 것부터 보면 전부 최상위 하나로 뭉쳐서 의미가 사라진다. */
  const spots = [...hotspots]
    .map((h) => ({ ...h, key: norm(h.path) }))
    .sort((a, b) => b.key.length - a.key.length)

  const frameOf = (path: string): { key: string; label: string } => {
    const np = norm(path)
    for (const s of spots) if (np.startsWith(s.key + '/')) return { key: s.key, label: s.path }
    return { key: '', label: '' }
  }

  type Bucket = {
    key: string
    where: string
    action: Action
    recovery: Recovery
    effort: Effort
    because: string
    bytes: number
    paths: string[]
  }
  const buckets = new Map<string, Bucket>()

  /* ★ 실물 신원은 **카드 전체에 걸쳐** 한 번만 센다.
     묶음마다 따로 세면 실측에서 이렇게 나왔다 —
       6.46GB  coupang-thumbnail-worker-desktop · checkpoints
       6.46GB  megaload-desktop · checkpoints
       6.46GB  @stockfactory · checkpoints
     셋 다 같은 실물 하나(하드링크)라, 세 장을 다 지워도 6.46GB만 빈다.
     19.38GB라고 적어두면 눌러본 사람이 속는다. */
  const inoOwner = new Map<string, Bucket>()

  for (const v of verdicts) {
    // 안 건드리는 것은 제안이 아니다 — '지킨 것'으로 따로 보여준다.
    if (v.action === 'keep') continue
    const frame = frameOf(v.path)
    const key = `${frame.key}|${v.action}|${v.recovery}`
    let b = buckets.get(key)
    if (!b) {
      b = {
        key,
        where: frame.label,
        action: v.action,
        recovery: v.recovery,
        effort: v.effort,
        because: v.because,
        bytes: 0,
        paths: [],
      }
      buckets.set(key, b)
    }
    /* ★ 하드링크는 **한 카드가 링크를 전부 들고** 있어야 한다.
       바이트만 한 번 세고 경로를 카드마다 흩어두면, 그 카드를 눌러도 다른 링크가
       남아서 **1바이트도 안 빈다.** 처음 이 실물을 담은 카드가 나머지 링크까지
       가져간다 — 그래야 "6.46GB 지우기"가 진짜 6.46GB를 비운다. */
    if (v.ino) {
      const owner = inoOwner.get(v.ino)
      if (owner) {
        owner.paths.push(v.path) // 용량은 이미 셌다. 경로만 주인에게 보낸다.
        continue
      }
      inoOwner.set(v.ino, b)
    }
    b.bytes += v.size
    b.paths.push(v.path)
  }

  /* ★ 자르는 순서가 곧 쓸모를 가른다 (2026-08-19 실측에서 잡음)
     처음엔 용량순으로 12장을 잘랐다. 그랬더니 이 PC에서 **1순위 카드가 한 장도
     안 남았다** — 지워도 되는 게 16.43GB나 있는데, 더 큰 3순위 묶음들(모델·영상
     19GB짜리)이 열두 자리를 다 가져갔기 때문이다.
     3순위는 눌러도 안 지워지는 카드다(물어보는 쪽). 실행할 수 있는 것이 실행할
     수 없는 것에 밀려나면 목록이 있으나 마나다. 순위 먼저, 그 안에서 용량순. */
  const byTier = (x: Bucket) => tierOf(x.action, x.effort)
  const all = [...buckets.values()].sort((a, b) => byTier(a) - byTier(b) || b.bytes - a.bytes)
  const big = all.filter((b) => b.bytes >= minBytes)
  const chosen = big.slice(0, limit)
  const dropped = [...big.slice(limit), ...all.filter((b) => b.bytes < minBytes)]

  const sizeOf = new Map<string, number>()
  for (const v of verdicts) sizeOf.set(v.path, v.size)

  const proposals: Proposal[] = chosen.map((b, i) => {
    const where = b.where || '여러 곳'
    const who = b.where ? ownerLabel(b.where) : '여러 곳'
    /* 큰 것부터 3개를 예시로 싣는다. "정말 이런 것들인가"를 눈으로 확인하는
       자리이므로, 무작위가 아니라 **용량이 큰 것**을 보여줘야 판단에 쓰인다. */
    const samples = [...b.paths]
      .sort((x, y) => (sizeOf.get(y) ?? 0) - (sizeOf.get(x) ?? 0))
      .slice(0, 3)
      .map((p) => ({ path: p, size: sizeOf.get(p) ?? 0 }))

    return {
      id: `p${i}`,
      title: `${who} — ${RECOVERY_TITLE[b.recovery]}`,
      where,
      bytes: b.bytes,
      count: b.paths.length,
      action: b.action,
      recovery: b.recovery,
      effort: b.effort,
      because: b.because,
      tier: tierOf(b.action, b.effort),
      paths: b.paths,
      samples,
    }
  })

  return {
    proposals: proposals.sort((a, b) => a.tier - b.tier || b.bytes - a.bytes),
    rest: {
      bytes: dropped.reduce((n, b) => n + b.bytes, 0),
      count: dropped.reduce((n, b) => n + b.paths.length, 0),
      cards: dropped.length,
    },
  }
}
