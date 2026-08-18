/**
 * 반복 구조 — "같은 모양이 N번 있다"를 찾는다
 *
 * ── 왜 필요한가 (2026-08-18 실측) ─────────────────────────────
 * MusicFactory의 work 아래에는 UUID 이름의 폴더가 **477개** 있었고, 전부 같은
 * 모양이었다: gen.src.wav · gen.wav · gen_trim.wav · audio.flac · video.mp4 …
 *
 * 이건 사람이 만든 게 아니라 **기계가 찍어낸 작업 폴더**다. 그리고 여기서
 * 화면의 질문이 통째로 잘못돼 있었다는 게 드러난다 — 지금 화면은 파일을 낱개로
 * 보여주고 체크박스를 내민다. 477개 폴더 × 13개 파일 = 6,200번 고르라는 뜻이다.
 *
 * 결정은 6,200개가 아니라 **하나**다: "gen.src.wav는 지워도 되나?"
 * 그 답 하나가 410개 파일 26GB를 정리한다.
 *
 * ── 규칙이 아니라 관측이다 ───────────────────────────────────
 * 파일 이름을 하나도 안 외운다. 다음 세 가지만 센다.
 *   · 이 이름이 형제 폴더 몇 곳에 나오나 (presence)
 *   · 폴더 안에서 몇 번째로 오래됐나 (ageRank)
 *   · 형제마다 크기가 같은가 (같으면 '복사돼 들어온 것')
 *
 * 그래서 처음 보는 앱이 처음 보는 이름을 써도 그대로 걸린다. 경로 규칙을
 * 하나씩 더하는 방식(.cache에 점을 허용하고 tmp 조각을 더하는 식)은 앱이
 * 하나 늘 때마다 지는 싸움이다.
 *
 * ── 단정하지 않는다 ──────────────────────────────────────────
 * 여기서 나오는 role은 **후보 표시**다. "지워도 된다"는 판정은 이것만으로
 * 내리지 않는다 — 되살릴 수 있는지(중복본이 있나, 다시 만들어지나)를 확인한
 * 뒤에야 판정이 된다. 관측과 판정을 섞으면 그때부터 숫자를 못 믿는다.
 */

export interface RepeatFile {
  path: string
  size: number
  mtimeMs: number
}

/* ★ 여기서 한 번 크게 틀렸다 — 기록해 둔다 (2026-08-19)
 *
 *   처음엔 'final'(결과물) / 'intermediate'(중간물)을 **수정시각 순서**로
 *   갈랐다. "폴더에서 가장 나중에 만들어진 게 결과물"이라는 그럴듯한 추론이었다.
 *   실측에 걸어보니 이렇게 나왔다:
 *
 *     releases/검수대기 : video.mp4 19.36GB → 'intermediate'
 *
 *   검수를 기다리는 **결과물 348편**이었다. link.json이 그 뒤에 쓰였다는 이유
 *   하나로 "만드는 과정에서 거쳐간 것"이 됐다. 이 판정을 믿고 지웠으면
 *   되돌릴 수 없는 손해였다. work 폴더에서도 audio.flac(결과물)이 video.mp4보다
 *   먼저 만들어졌다는 이유로 중간물이 됐다.
 *
 *   수정시각 순서는 **파이프라인 순서지 중요도 순서가 아니다.** 둘을 같다고
 *   본 게 잘못이고, 그건 관측이 아니라 추론이다. classify.ts가 "추론으로 얻은
 *   판단은 절대 SAFE가 될 수 없다"고 못 박은 바로 그 자리다.
 *
 *   그래서 역할 추론을 뺐다. 남긴 것은 **증거로 확인되는 하나**뿐이다:
 *   형제마다 크기까지 같으면 그건 '복사돼 들어온 것'이고, 원본이 남는다.
 *   나머지는 전부 'unique' — 되살릴 수 없다고 본다. 모르는 쪽을 안전한 쪽으로
 *   기울이는 게 이 제품의 규칙이다.
 *
 *   나이 순위(ageRank)는 **출력에 남긴다.** 판정에는 안 쓰고, 사용자가 구조를
 *   이해하는 데 쓰는 관측치다. 판정과 관측을 섞지 않는다. */
export type RepeatRole =
  /** 형제마다 크기까지 같다 — 같은 것이 폴더마다 복사돼 들어왔다. 원본이 남는다 */
  | 'shared'
  /** 이 폴더에만 있는 것. 지우면 되살릴 방법이 없다 */
  | 'unique'

export interface RepeatEntry {
  /** 형제 폴더 기준 상대 경로. 'gen.src.wav' 또는 'subfonts/NotoSansKR-VF.ttf' */
  rel: string
  /** 이 이름을 가진 폴더 수 */
  present: number
  /** 형제 전체 대비 비율 (0~1) */
  presence: number
  /** 이 이름의 파일들이 차지하는 총 용량 — 결정의 무게 */
  bytes: number
  avgSize: number
  /** 폴더 안에서의 평균 시간 순위. 0=가장 먼저 만들어짐, 1=가장 나중 */
  ageRank: number
  role: RepeatRole
  /** 왜 그렇게 봤는지 한 줄. 근거 없는 판정은 강요다 */
  because: string
}

export interface RepeatFamily {
  /** 형제들이 사는 부모 폴더 */
  parent: string
  /** 형제 폴더 경로들 */
  dirs: string[]
  count: number
  totalBytes: number
  entries: RepeatEntry[]
  /**
   * 결과물이 빠진 폴더 — **여기 것은 건드리면 안 된다.**
   *
   * ★ 실측에서 이게 사람 목숨을 구했다: work 폴더 477개 중 6개는 렌더링이
   *   중간에 끊겨서 audio.flac·video.mp4가 없었다. 거기서 중간물을 지웠다면
   *   그 작업은 **유일본이 사라진다.** 같은 모양이 반복된다는 사실이,
   *   '모양이 덜 갖춰진 폴더'를 찾는 근거도 함께 준다.
   */
  incomplete: string[]
}

const norm = (p: string) => p.replace(/\\/g, '/')

/** 부모 경로. 없으면 null. */
function parentOf(p: string): string | null {
  const i = p.lastIndexOf('/')
  return i > 0 ? p.slice(0, i) : null
}

export interface RepeatOptions {
  /** 이만큼 형제가 있어야 '반복'으로 본다. 2~3개는 그냥 우연이다. */
  minSiblings?: number
  /** 이 비율 이상의 폴더에 있어야 '이 구조의 일부'로 본다 */
  corePresence?: number
  /**
   * '이 이름이 없으면 미완성'으로 볼 기준.
   *
   * ★ corePresence(0.5)를 그대로 쓰면 안 된다. 실측에서 76%짜리 이름
   *   (background_1.jpg)까지 필수로 봐서 408개 중 **228개가 미완성**으로
   *   찍혔다. 그건 "거의 다 미완성"이라 아무 정보가 아니다.
   *   거의 모든 폴더가 갖고 있는 것만 필수로 본다.
   */
  completePresence?: number
  /** 이 묶음의 총 용량이 이보다 작으면 아예 안 올린다 */
  minBytes?: number
}

/**
 * 반복되는 형제 폴더 무리를 찾고, 그 안의 파일 이름별로 관측치를 낸다.
 *
 * 비용: 파일마다 조상을 한 번 거슬러 올라갈 뿐이다(경로 문자열 연산).
 * 디스크를 다시 읽지 않으므로 스캔에 얹으면 사실상 공짜다.
 */
export function findRepeats(
  files: RepeatFile[],
  { minSiblings = 5, corePresence = 0.5, completePresence = 0.95, minBytes = 100 * 1024 * 1024 }: RepeatOptions = {}
): RepeatFamily[] {
  /* 1) 파일이 실제로 들어 있는 폴더와, 그 폴더의 부모를 모은다.
        형제 수는 '파일을 가진 폴더'로만 센다 — 빈 폴더까지 세면 우연히 형제가
        많아 보이는 자리가 생긴다. */
  const dirHasFile = new Set<string>()
  for (const f of files) {
    const d = parentOf(norm(f.path))
    if (d) dirHasFile.add(d)
  }

  /* 2) 형제 후보: 같은 부모 아래 폴더들.
        ★ 손자까지 넣지 않는다. work/<uuid>/subfonts 도 파일을 갖고 있지만,
          반복의 단위는 <uuid>지 subfonts가 아니다. subfonts는 <uuid> 안의
          상대 경로로 잡힌다. */
  const byParent = new Map<string, Set<string>>()
  for (const d of dirHasFile) {
    let cur: string | null = d
    // 이 폴더와 그 조상들을 부모별로 등록한다 (손자 폴더도 형제로 접히게)
    while (cur) {
      const p: string | null = parentOf(cur)
      if (!p) break
      let s = byParent.get(p)
      if (!s) { s = new Set(); byParent.set(p, s) }
      s.add(cur)
      cur = p
    }
  }

  /* 3) 형제가 충분히 많은 부모만 남긴다. 그 자식들이 '반복 단위'다. */
  const siblingOf = new Map<string, string>() // 형제 폴더 경로 → 그 형제 자신
  const families = new Map<string, string[]>()
  for (const [parent, kids] of byParent) {
    if (kids.size < minSiblings) continue
    const list = [...kids]
    families.set(parent, list)
    for (const k of list) {
      // 더 깊은(= 더 구체적인) 형제가 이미 잡혔으면 덮어쓰지 않는다
      if (!siblingOf.has(k)) siblingOf.set(k, k)
    }
  }
  if (!families.size) return []

  /* 4) 파일마다 자기가 속한 형제를 찾는다. 조상을 거슬러 올라가다 처음 만나는
        형제가 그 파일의 소속이다. 가장 가까운 형제를 쓴다 — 그래야
        work/<uuid>/subfonts/x.ttf 가 <uuid> 소속으로 잡히고 상대경로가 남는다. */
  const perFamily = new Map<string, Map<string, { rel: string; size: number; mtimeMs: number }[]>>()
  for (const f of files) {
    const np = norm(f.path)
    let cur = parentOf(np)
    let sib: string | null = null
    while (cur) {
      if (siblingOf.has(cur)) { sib = cur; break }
      cur = parentOf(cur)
    }
    if (!sib) continue
    const parent = parentOf(sib)!
    let fam = perFamily.get(parent)
    if (!fam) { fam = new Map(); perFamily.set(parent, fam) }
    let arr = fam.get(sib)
    if (!arr) { arr = []; fam.set(sib, arr) }
    arr.push({ rel: np.slice(sib.length + 1), size: f.size, mtimeMs: f.mtimeMs })
  }

  /* 5) 무리마다 이름별 관측치를 낸다. */
  const out: RepeatFamily[] = []
  for (const [parent, fam] of perFamily) {
    const dirs = [...fam.keys()]
    if (dirs.length < minSiblings) continue

    const stat = new Map<string, { n: number; bytes: number; rank: number; sizes: Set<number> }>()
    for (const [, list] of fam) {
      // 폴더 안에서 시간 순위를 매긴다. 하나뿐이면 순위가 의미없으니 중간값.
      const sorted = [...list].sort((a, b) => a.mtimeMs - b.mtimeMs)
      const denom = Math.max(1, sorted.length - 1)
      sorted.forEach((f, i) => {
        let s = stat.get(f.rel)
        if (!s) { s = { n: 0, bytes: 0, rank: 0, sizes: new Set() }; stat.set(f.rel, s) }
        s.n++
        s.bytes += f.size
        s.rank += sorted.length === 1 ? 0.5 : i / denom
        s.sizes.add(f.size)
      })
    }

    const totalBytes = [...stat.values()].reduce((n, s) => n + s.bytes, 0)
    if (totalBytes < minBytes) continue

    const raw = [...stat.entries()].map(([rel, s]) => ({
      rel,
      present: s.n,
      presence: s.n / dirs.length,
      bytes: s.bytes,
      avgSize: s.bytes / s.n,
      ageRank: s.rank / s.n,
      sameSize: s.sizes.size === 1 && s.n >= minSiblings,
    }))

    /* 이 구조의 '핵심 이름' = 대부분의 폴더에 들어 있는 것.
       판정에는 안 쓰고, 아래 두 곳에만 쓴다 — 미완성 폴더 찾기, 그리고 화면 설명. */
    const core = raw.filter((e) => e.presence >= corePresence)

    const entries: RepeatEntry[] = raw.map((e) => {
      /* 증거로 확인되는 것 하나만 판정한다.
         형제 폴더마다 **크기까지 같은 것**이 들어 있으면, 그건 어딘가에서
         복사돼 들어온 것이다(실측: 같은 폰트가 233벌). 한 벌만 남기고 나머지를
         치워도 원본은 남는다 — 지우기 전에 해시로 한 번 더 확인한다.

         그 밖의 모든 것은 unique다. 시간 순서로 "이건 중간물이니 지워도 된다"고
         말하지 않는다. 그 추론이 검수 대기 중인 결과물 19.36GB를 중간물로
         찍었다(위 머리말 참조). */
      const shared = e.sameSize && e.presence >= 0.3
      return {
        rel: e.rel,
        present: e.present,
        presence: e.presence,
        bytes: e.bytes,
        avgSize: e.avgSize,
        ageRank: e.ageRank,
        role: (shared ? 'shared' : 'unique') as RepeatRole,
        because: shared
          ? `${e.present}개 폴더에 **크기까지 같은 것**이 들어 있어요 — 어딘가에서 복사돼 들어온 것으로 보입니다. 한 벌은 남습니다.`
          : `이 폴더에만 있는 것으로 보여요. 지우면 되살릴 방법이 없습니다.`,
      }
    })

    /* 모양이 덜 갖춰진 폴더 = 아직 안 끝났거나 중간에 끊긴 작업.
       ★ 실측에서 이게 사고를 막았다: work 폴더 477개 중 6개는 렌더링이 끊겨서
         결과물이 없었다. 거기 있는 건 유일본이므로 목록에서 통째로 뺀다.
         '핵심 이름'을 하나라도 빠뜨린 폴더가 그것이다. */
    const coreRels = raw.filter((e) => e.presence >= completePresence).map((e) => e.rel)
    const incomplete = dirs.filter((d) => {
      const have = new Set((fam.get(d) ?? []).map((f) => f.rel))
      return coreRels.some((r) => !have.has(r))
    })

    out.push({
      parent,
      dirs,
      count: dirs.length,
      totalBytes,
      entries: entries.sort((a, b) => b.bytes - a.bytes),
      incomplete,
    })
  }

  return out.sort((a, b) => b.totalBytes - a.totalBytes)
}
