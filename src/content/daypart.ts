/**
 * 지금 몇 시인가 — 생활 정리 화면만 갖는 축
 *
 * ★ 왜 이게 이 탭을 다른 탭과 가르나
 *   숨은 공간·시작프로그램·같은 파일은 **몇 시에 열든 같은 화면**이다. 디스크에
 *   있는 것을 훑어서 보여주는 일이라 시각이 끼어들 자리가 없다. 그래서 그 탭들은
 *   전부 "목록 + 판단 + 실행"이라는 같은 옷을 입고 있고, 그게 맞다.
 *
 *   생활 정리는 다르다. 이불은 아침에 개고, 책상은 일을 끝낼 때 비우고,
 *   싱크대 배수망은 설거지 마지막에 비운다. **같은 목록이라도 아침 여덟 시와
 *   밤 열한 시에 같은 걸 맨 위에 올리면 그건 틀린 화면이다.**
 *
 * ★ 밤에는 오히려 "안 하셔도 된다"고 말한다.
 *   할 일 앱이 사람을 지치게 하는 지점이 정확히 여기다 — 밤 열한 시에 열었더니
 *   "12개 밀렸어요"가 뜨는 것. 이 앱은 그 시간에 재촉하지 않는다. 그게 원칙이고,
 *   그 원칙을 지킬 수 있는 유일한 방법이 지금 몇 시인지 아는 것이다.
 *
 * 전부 순수 함수다. 시각 판단이 틀리면 하루 종일 틀린 인사를 한다.
 */

import type { TidyRoutine } from './tidy.ts'

export type DayPart = 'morning' | 'day' | 'evening' | 'night'

/**
 * 경계는 '보통 사람의 하루'로 잡았다. 지어낸 근거를 붙이지 않는다 —
 * 이건 통계가 아니라 화면이 말투를 고르는 기준일 뿐이고, 틀려도 손해가
 * 인사 한 줄이라 그렇게 둔다.
 */
export function dayPart(now = new Date()): DayPart {
  const h = now.getHours()
  if (h >= 5 && h < 11) return 'morning'
  if (h >= 11 && h < 17) return 'day'
  if (h >= 17 && h < 22) return 'evening'
  return 'night'
}

export interface Greeting {
  part: DayPart
  /** 큰 글씨 한 줄 */
  hi: string
  /** 그 아래 한 줄. 지금 시각에 뭘 하면 좋은지 */
  sub: string
  /**
   * 지금은 권하지 않는 시간인가.
   * ★ true면 화면이 목록을 앞세우지 않는다. 밤에 "12개 남았어요"를 띄우면
   *   그 사람은 그날 자책하고 다음 날 앱을 안 연다.
   */
  quiet: boolean
}

export function greeting(part: DayPart = dayPart()): Greeting {
  switch (part) {
    case 'morning':
      return {
        part,
        hi: '좋은 아침이에요',
        sub: '1분짜리 하나만 끝내두면 그날 나머지가 쉬워집니다.',
        quiet: false,
      }
    case 'day':
      return {
        part,
        hi: '오늘 하루 중간이네요',
        sub: '짧은 것 하나 끼워 넣기 좋은 시간이에요.',
        quiet: false,
      }
    case 'evening':
      return {
        part,
        hi: '하루를 마무리하는 시간이에요',
        sub: '책상만 비워두면 내일은 치우지 않고 바로 시작합니다.',
        quiet: false,
      }
    default:
      return {
        part,
        hi: '늦은 시간이네요',
        sub: '오늘은 안 하셔도 됩니다. 내일 하시면 돼요.',
        quiet: true,
      }
  }
}

/**
 * 지금 시각에 맞는 것을 앞으로 올린다.
 *
 * ★ 원래 순서를 뒤엎지 않는다. 안정 정렬이라 시간대가 같은 것끼리는
 *   들어온 순서(짧은 것 순)가 그대로 남는다 — 문턱을 낮추는 정렬이 이 앱의
 *   기본이고, 시간대는 그 위에 얹는 힌트지 그걸 대체하는 규칙이 아니다.
 *
 * ★ 'day'와 'night'에는 맞춰 올릴 것이 없다. 낮·밤에만 하는 정리는
 *   콘텐츠에 없고, 없는 걸 지어내 올리면 순서가 무작위로 보인다.
 */
export function sortByTime<T extends TidyRoutine>(list: T[], part: DayPart = dayPart()): T[] {
  if (part !== 'morning' && part !== 'evening') return [...list]
  const fits = (r: T) => (r.bestTime === part ? 0 : 1)
  return [...list].sort((a, b) => fits(a) - fits(b))
}

/** 지금 시각에 맞는 것이 몇 개인가 — 화면이 "지금 하기 좋은 것"을 셀 때 쓴다 */
export function fittingCount(list: TidyRoutine[], part: DayPart = dayPart()): number {
  if (part !== 'morning' && part !== 'evening') return 0
  return list.filter((r) => r.bestTime === part).length
}
