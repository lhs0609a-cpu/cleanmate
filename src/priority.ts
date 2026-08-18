/**
 * 순위 — "무엇부터 지우면 되나"를 한 줄로 답한다
 *
 * ── 왜 만들었나 (2026-08-18, 실측에서 나온 문제) ──────────────
 * 디스크가 99% 찬 PC를 실제로 훑어봤더니 화면이 이렇게 말했다:
 *
 *     존A 확실히 지워도 됨   :   5.72GB
 *     존B 물어봐야 함       : 285.18GB   ← 여기에 다 들어 있다
 *     존C 잠금             :   9.25GB
 *
 * 285GB짜리 더미 하나를 내밀고 "물어볼게요"라고 하는 건 답이 아니다. 그 안에는
 * **한 번 보면 바로 지울 수 있는 것**(앱이 만든 임시 폴더, 프로그램이 다시 만드는
 * 자료)과 **사람만 아는 것**(직접 만든 영상, 세이브 파일)이 섞여 있었다.
 * 섞어두면 둘 다 못 지운다 — 무서워서.
 *
 * 그래서 등급을 나눈다. 존(A/B/C)은 **안전도**를 말하고, 순위는 **행동 순서**를
 * 말한다. 사용자가 알고 싶은 건 후자다: "그래서 뭐부터 누르면 되는데?"
 *
 * ── 순위를 지어내지 않는다 ──────────────────────────────────
 * 새 판정을 만들지 않았다. 엔진이 이미 내리는 두 판정을 조합할 뿐이다:
 *   - classify.ts의 존   : SAFE(규칙 확증) / AMBIG / LOCKED
 *   - owners.ts의 판정   : safe(지워도 안 깨짐) / ask(쓰시는지에 달림) / keep(두는 게 맞음)
 *
 *   1순위 = 존A                    → 규칙이 확증한 캐시·임시. 바로.
 *   2순위 = 존B + owner가 'safe'    → 프로그램이 다시 만든다. 한 번 보고.
 *   3순위 = 존B의 나머지            → 사람만 안다. 질문으로.
 *   안 지움 = 존C                  → 건드리면 깨진다. 목록에도 안 올린다.
 *
 * 판정이 하나 바뀌면 순위도 따라 바뀐다. 두 벌로 관리하지 않는다.
 *
 * ── 'keep'을 순위에서 빼지 않는 이유 ────────────────────────
 * ownerOf는 **모르는 경로에 'keep'을 기본값으로** 준다(보수적으로 설계됐다).
 * 그래서 keep을 "안 지움"으로 보내버리면 존B 285GB가 통째로 목록에서 사라진다.
 * 그건 안전한 게 아니라 **선택지를 뺏는 것**이다 — 사용자가 자기 파일을 지울
 * 권리는 있고, 이 제품은 여태 그걸 질문으로 돌려줬다.
 *
 * 그래서 keep은 3순위 **안에** 두고, 대신 몇 개가 그런지를 caution으로 따로 센다.
 * 숨기지 않고 표시한다 — 그게 이 제품이 낱개 목록에서 이미 하던 방식이다.
 */

import type { Classified } from './types.ts'
import { ownerOf } from './owners.ts'

/** 1·2·3만 쓴다. 등급을 늘리면 "4순위는 뭐지"가 되고 아무 뜻도 없어진다. */
export type TierId = 1 | 2 | 3

/** 순위 안에서 '무엇이 들어 있나'를 의미별로 접은 것. 경로 수만 개를 나열하지 않는다. */
export interface TierGroup {
  meaning: string
  bytes: number
  count: number
}

export interface Tier {
  id: TierId
  /** "1순위" */
  label: string
  /** 무엇을 하면 되는지 한 줄. 버튼 옆에 그대로 쓴다. */
  title: string
  /** 왜 이 순위인지. 근거 없는 등급은 그냥 강요다. */
  because: string
  bytes: number
  count: number
  /** 되돌릴 수 있나. 화면이 확인 문구의 수위를 여기서 고른다. */
  reversible: boolean
  /** 큰 것부터, 최대 6줄. 화면이 다시 정렬하지 않아도 되게 여기서 끝낸다. */
  groups: TierGroup[]
  /**
   * 이 순위 안에서 저희가 "두시는 게 안전합니다"로 본 것.
   *
   * 막지는 않는다 — 자기 파일을 지울 권리는 사용자에게 있다. 다만 **몇 개인지는
   * 말한다.** 이 숫자가 0이 아니면 화면은 한 번 더 확인받아야 한다.
   */
  cautionCount: number
  cautionBytes: number
}

/** 순위 밖 — 지우지 않는 것. "지킨 양"을 보여주는 자리에 쓴다. */
export interface Untouched {
  bytes: number
  count: number
  groups: TierGroup[]
}

export interface Tiers {
  tiers: Tier[]
  untouched: Untouched
}

const TIER_TEXT: Record<TierId, { title: string; because: string; reversible: boolean }> = {
  1: {
    title: '바로 지워도 됩니다',
    because: '규칙으로 확인한 캐시·임시 파일이에요. 프로그램이 필요할 때 다시 만듭니다.',
    reversible: true, // 다시 만들어지므로 사실상 되돌릴 수 있다
  },
  2: {
    title: '한 번만 보고 지우세요',
    because: '어느 프로그램 것인지 확인했고, 지워도 그 프로그램은 안 깨집니다. 다만 다시 받거나 다시 만드는 데 시간이 걸릴 수 있어요.',
    reversible: false,
  },
  3: {
    title: '여쭤보고 정합니다',
    because: '직접 만드셨는지, 아직 쓰시는지는 저희가 알 수 없어요. 물어보고 고르신 것만 지웁니다.',
    reversible: false,
  },
}

/**
 * 의미별로 접는다. 큰 것부터 6줄까지만 — 그 아래는 읽지 않는다.
 *
 * ★ 개수는 자르기 **전 전체**를 센다. 6줄만 세면 "5.7GB라더니 목록은 2GB뿐"이 된다.
 */
function fold(items: { meaning: string; size: number }[]): TierGroup[] {
  const by = new Map<string, TierGroup>()
  for (const it of items) {
    const g = by.get(it.meaning)
    if (g) { g.bytes += it.size; g.count++ }
    else by.set(it.meaning, { meaning: it.meaning, bytes: it.size, count: 1 })
  }
  return [...by.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 6)
}

/**
 * 순위를 매긴다.
 *
 * @param safe  존A 항목 — 규칙이 확증한 자동 정리 대상
 * @param ambig 존B 항목 — 여기서 2순위와 3순위로 갈린다
 * @param locked 존C 집계 — 개수·용량만 받는다(항목을 들고 있을 이유가 없다)
 */
export function buildTiers(
  safe: { meaning: string; size: number }[],
  ambig: Classified[],
  locked: { bytes: number; count: number; groups?: TierGroup[] } = { bytes: 0, count: 0 }
): Tiers {
  type Item = { meaning: string; size: number; caution: boolean }
  const t2: Item[] = []
  const t3: Item[] = []

  for (const c of ambig) {
    const o = ownerOf(c.path)
    /* ★ 'safe'라고 **말한 것만** 2순위로 올린다. 나머지는 전부 3순위다.
       ownerOf는 모르는 경로에 'keep'을 기본으로 주므로, 모르는 것은 저절로
       3순위로 떨어진다. 모르는 것을 "거의 지워도 됩니다"로 올리는 게 이 제품이
       절대 하면 안 되는 실수다(classify.ts의 R1 안전장치와 같은 원칙). */
    const item: Item = {
      meaning: o.role || c.verdict.meaning,
      size: c.size,
      caution: o.verdict === 'keep',
    }
    if (o.verdict === 'safe') t2.push(item)
    else t3.push(item)
  }

  const sum = (a: { size: number }[]) => a.reduce((n, x) => n + x.size, 0)

  const mk = (id: TierId, items: Item[]): Tier => {
    const caution = items.filter((i) => i.caution)
    return {
      id,
      label: `${id}순위`,
      ...TIER_TEXT[id],
      bytes: sum(items),
      count: items.length,
      groups: fold(items),
      cautionCount: caution.length,
      cautionBytes: sum(caution),
    }
  }

  /* 비어 있는 순위는 안 내보낸다. "2순위 0개"를 그리면 화면에 할 일이 없는 칸이
     생기고, 사용자는 그 칸을 읽느라 시간을 쓴다. */
  const tiers = [
    mk(1, safe.map((s) => ({ ...s, caution: false }))),
    mk(2, t2),
    mk(3, t3),
  ].filter((t) => t.count > 0)

  return {
    tiers,
    /* 지키는 것은 존C뿐이다. 항목이 아니라 집계로 온다 — 존C의 한 줄은 파일
       하나가 아니라 수천 개의 합계라서, 항목처럼 세면 개수가 1로 찍힌다. */
    untouched: {
      bytes: locked.bytes,
      count: locked.count,
      groups: [...(locked.groups ?? [])].sort((a, b) => b.bytes - a.bytes).slice(0, 6),
    },
  }
}
