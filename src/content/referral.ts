/**
 * 업체 연결 — 혼자 안 되는 것까지 왔을 때
 *
 * 이 제품의 수익 모델이다. PC 정리로는 돈을 받지 않고, 나중에 청소·정리정돈이
 * 정말 필요해졌을 때 믿을 만한 곳을 연결하는 데서 수익을 낸다.
 * 그래서 이 모듈은 기능이 아니라 **신뢰 설계**다. 한 번이라도 광고처럼 보이면
 * "무료라더니 결국 이거였네"가 되고, 그 순간 앱 전체가 광고판이 된다.
 *
 * ── 지키는 규칙 5개 ───────────────────────────────────────────
 * 1) 먼저 들이밀지 않는다. 앱이 이미 아는 신호(같은 정리를 여러 번 건너뜀)가
 *    쌓였을 때만, 그것도 "필요하시면"으로만 꺼낸다.
 * 2) 우리가 대신 할 수 있는 건 연결하지 않는다. 바탕화면·다운로드·사진은
 *    앱이 하면 된다. 사람을 부를 일은 사람만 할 수 있는 것뿐이다.
 * 3) 수수료를 받는다는 사실을 카드에 그대로 쓴다. 숨겼다가 들키면 끝이다.
 * 4) 파일은 나가지 않는다. 보내는 건 사용자가 고른 항목과 직접 쓴 메모뿐이다.
 *    경로·파일명이 요약에 섞이지 않는지 테스트로 막는다.
 * 5) 아직 연결된 업체가 없다는 사실을 숨기지 않는다. 있는 척하면 그게 사기다.
 */

import {
  ROUTINES,
  dayNumber,
  enabledRoutines,
  lastDone,
  type TidyCategory,
  type TidyState,
} from './tidy.ts'

/**
 * 업종 묶음.
 *
 * ★ 왜 '정리정돈'에 이발·세탁이 들어가나
 *   이 제품이 파는 건 "치우는 일"이 아니라 **"주기가 있는데 자꾸 밀리는 일"**을
 *   대신 기억해 주는 것이다. 그 기준으로 보면 서랍 정리와 머리 자르기는 같은
 *   종류의 일이다 — 둘 다 주기가 있고, 밀리면 본인이 알고, 미루는 이유가
 *   '귀찮아서'가 아니라 '언제였는지 몰라서'다.
 *
 *   그리고 이쪽이 사업적으로 훨씬 두껍다. 정리수납은 몇 년에 한 번 부르지만
 *   미용실은 6주에 한 번이다. 주기가 짧을수록 앱을 켤 이유가 생기고,
 *   동네 단위로 업체가 많아 제휴를 처음 트기도 쉽다.
 *
 *     space   집·물건 (원래 있던 것)
 *     self    나 자신 — 주기가 제일 짧다. 여기가 관계를 유지하는 축이다
 *     wear    입는 것 — 옷장 정리 다음 단계라 흐름이 자연스럽다
 *     upkeep  집을 손보는 것 — 청소와 다르다. 고장 나기 전에 부르는 것
 *     out     내보내는 것 — 버리기·팔기·이사
 */
export type ServiceGroup = 'space' | 'self' | 'wear' | 'upkeep' | 'out'

export const SERVICE_GROUP_LABEL: Record<ServiceGroup, string> = {
  space: '집·물건 정리',
  self: '나를 돌보는 것',
  wear: '입는 것',
  upkeep: '집 손보기',
  out: '내보내기',
}

/**
 * 업체가 오는가, 내가 가는가.
 *
 * ★ 이게 화면을 통째로 가른다.
 *   방문(visit)은 **견적**이 먼저다 — 지역·평수·상태를 알려주고 값을 받는다.
 *   찾아가는 곳(shop)은 **예약**이 먼저다 — 값은 대개 정해져 있고 필요한 건 시간이다.
 *   둘을 같은 폼으로 받으면 미용실에 평수를 묻게 된다.
 */
export type ServiceMode = 'visit' | 'shop'

export interface ServiceKind {
  id: string
  label: string
  group: ServiceGroup
  mode: ServiceMode
  /** 언제 사람을 부르는 게 맞는가 */
  when: string
  /** 그 사람들이 실제로 해주는 일 */
  whatTheyDo: string
  /** 돈 이야기를 먼저 한다 — 나중에 놀라는 게 제일 나쁘다 */
  priceNote: string
}

export const SERVICES: ServiceKind[] = [
  /* ── 집·물건 ─────────────────────────────────────────────── */
  {
    id: 'organizer',
    label: '정리수납 전문가',
    group: 'space',
    mode: 'visit',
    when: '물건이 많아서가 아니라 "어디에 둘지"가 안 정해져서 매번 도로 어질러질 때.',
    whatTheyDo: '함께 물건을 분류하고, 버릴지 말지 결정을 돕고, 자리를 정해 수납 구조를 만들어 줍니다.',
    priceNote: '보통 공간·시간 단위로 견적이 나옵니다. 방문 전에 사진으로 대략 견적을 받는 곳이 많습니다.',
  },
  {
    id: 'cleaning',
    label: '집 청소',
    group: 'space',
    mode: 'visit',
    when: '정리는 됐는데 묵은 때·주방·화장실처럼 손이 많이 가는 청소가 남았을 때.',
    whatTheyDo: '부분 청소부터 이사 전후 전체 청소까지. 장비와 세제를 갖고 옵니다.',
    priceNote: '평수와 범위로 견적이 정해집니다. 부분 청소는 훨씬 저렴합니다.',
  },
  {
    id: 'pc-help',
    label: 'PC 점검·데이터 이전',
    group: 'space',
    mode: 'visit',
    when: '정리해도 용량이 계속 부족하거나, 새 PC로 자료를 옮겨야 할 때.',
    whatTheyDo: '저장장치 증설·교체, 자료 이전, 백업 설정을 해줍니다.',
    priceNote: '부품값과 작업비가 따로입니다. 부품은 직접 사시는 게 대개 쌉니다.',
  },

  /* ── 나를 돌보는 것 ───────────────────────────────────────
     ★ 여기 업종은 전부 사용자가 그 항목을 **직접 켰을 때만** 등장한다.
       묻지도 않고 몸 이야기를 꺼내면 그건 정리 도구가 아니라 참견이다. */
  {
    id: 'hair',
    label: '이발·미용',
    group: 'self',
    mode: 'shop',
    when: '마지막으로 자른 지 한 달 반쯤 지났을 때. 대개 "슬슬인가"를 몇 주 생각하다 늦습니다.',
    whatTheyDo: '커트·펌·염색. 지난번 스타일을 기억해 두는 곳이면 매번 설명할 일이 없어집니다.',
    priceNote: '값이 미리 정해져 있는 편입니다. 펌·염색은 머리 길이에 따라 추가되는 곳이 많으니 예약할 때 물어보세요.',
  },
  {
    id: 'nails',
    label: '네일·손발 관리',
    group: 'self',
    mode: 'shop',
    when: '자란 만큼 다시 손봐야 하는 주기가 돌아왔을 때. 보통 3~4주입니다.',
    whatTheyDo: '손발톱 정리·케어. 이미 한 것을 지우는 작업이 따로 붙는 곳이 많습니다.',
    priceNote: '기본 관리와 디자인 값이 따로입니다. 제거 비용이 추가되는지 미리 확인하세요.',
  },
  {
    id: 'dental',
    label: '치과 (스케일링·검진)',
    group: 'self',
    mode: 'shop',
    when: '마지막으로 받은 지 1년쯤 지났을 때. 1년에 한 번이라 오히려 더 잊습니다.',
    whatTheyDo: '스케일링과 정기 검진. 이 앱은 날짜만 세고, 무엇을 받을지는 판단하지 않습니다.',
    priceNote: '건강보험 적용 범위와 횟수는 제도에 따라 달라집니다. 예약할 때 확인하시는 게 정확합니다.',
  },
  {
    id: 'eyes',
    label: '안경·시력 검사',
    group: 'self',
    mode: 'shop',
    when: '안경을 맞춘 지 1년이 넘었거나, 요즘 눈이 쉽게 피로할 때.',
    whatTheyDo: '시력 측정, 도수 조정, 코받침·나사 같은 잔손질. 렌즈만 갈아 끼우기도 합니다.',
    priceNote: '시력 측정과 간단한 조정은 무료인 곳이 많습니다. 재보고 안 바꾸셔도 됩니다.',
  },
  {
    id: 'checkup',
    label: '건강검진',
    group: 'self',
    mode: 'shop',
    when: '마지막으로 받은 지 1~2년이 지났을 때. 대상 주기는 사람마다 다릅니다.',
    whatTheyDo: '검진 기관 예약과 수검. 대상 여부는 건강보험공단 안내에서 확인하실 수 있습니다.',
    priceNote: '국가검진 항목은 대개 본인 부담이 없고, 추가 항목만 따로 냅니다. 12월은 어디나 붐빕니다.',
  },

  /* ── 입는 것 ───────────────────────────────────────────── */
  {
    id: 'laundry',
    label: '세탁·드라이·보관',
    group: 'wear',
    mode: 'shop',
    when: '계절이 바뀌어 안 입을 옷을 넣어둘 때. 그냥 넣으면 다음 계절에 얼룩으로 돌아옵니다.',
    whatTheyDo: '드라이클리닝과 다음 계절까지의 보관. 집에 자리가 없을 때 보관까지 맡기는 편이 쌉니다.',
    priceNote: '옷 종류별로 값이 정해져 있습니다. 보관은 벌수·기간으로 따로 계산합니다.',
  },
  {
    id: 'repair-clothes',
    label: '옷 수선',
    group: 'wear',
    mode: 'shop',
    when: '기장이 안 맞아서, 또는 살이 빠지거나 쪄서 안 입게 된 옷이 옷장에 남아 있을 때.',
    whatTheyDo: '기장·품 수선, 지퍼·단추 교체. 안 입던 옷이 다시 입는 옷이 됩니다.',
    priceNote: '대개 새로 사는 값보다 훨씬 쌉니다. 수선집에 가져가 견적만 물어봐도 됩니다.',
  },
  {
    id: 'repair-leather',
    label: '구두·가방 수선',
    group: 'wear',
    mode: 'shop',
    when: '굽이나 밑창이 닳기 시작할 때. 더 닳으면 갈아서 못 쓰고 통째로 버리게 됩니다.',
    whatTheyDo: '굽·밑창 교체, 지퍼·손잡이 수선, 가죽 손질.',
    priceNote: '부위별로 값이 정해져 있습니다. 상태를 보고 정하므로 가져가서 물어보는 게 정확합니다.',
  },

  /* ── 집 손보기 ─────────────────────────────────────────── */
  {
    id: 'appliance-clean',
    label: '가전 분해 청소',
    group: 'upkeep',
    mode: 'visit',
    when: '에어컨을 켤 때 냄새가 나거나, 세탁기에서 빤 옷에 냄새가 남을 때.',
    whatTheyDo: '에어컨·세탁기를 분해해 안쪽까지 청소합니다. 겉만 닦는 것과는 다른 작업입니다.',
    priceNote: '대수와 기종(벽걸이·스탠드·드럼)으로 정해집니다. 성수기(여름 직전)에는 비싸고 예약도 밀립니다.',
  },
  {
    id: 'plumbing',
    label: '배수구·배관',
    group: 'upkeep',
    mode: 'visit',
    when: '물이 눈에 띄게 느리게 빠지거나, 냄새가 계속 올라올 때. 완전히 막히면 급한 일이 됩니다.',
    whatTheyDo: '배관 뚫기, 악취 원인 점검, 트랩 교체.',
    priceNote: '출장비와 작업비가 따로인 곳이 많습니다. 밤·주말은 할증이 붙습니다.',
  },
  {
    id: 'pest',
    label: '방충·방역',
    group: 'upkeep',
    mode: 'visit',
    when: '벌레를 한두 번 본 게 아니고 계속 보일 때. 이사 직후에 미리 하기도 합니다.',
    whatTheyDo: '약제 시공과 유입 경로 차단. 대개 몇 주 뒤 한 번 더 오는 것까지 한 묶음입니다.',
    priceNote: '평수와 횟수로 정해집니다. 1회짜리와 정기 계약의 값이 많이 다릅니다.',
  },
  {
    id: 'lock',
    label: '도어락·열쇠',
    group: 'upkeep',
    mode: 'visit',
    when: '건전지를 갈아도 반응이 이상하거나, 이사·비밀번호 노출로 바꿔야 할 때.',
    whatTheyDo: '도어락 교체·수리, 열쇠 복사, 잠긴 문 개방.',
    priceNote: '제품값과 시공비가 따로입니다. 긴급 개방은 시간대에 따라 할증이 큽니다.',
  },

  /* ── 내보내기 ─────────────────────────────────────────── */
  {
    id: 'declutter',
    label: '짐 정리·폐기물 수거',
    group: 'out',
    mode: 'visit',
    when: '버리기로 마음은 먹었는데 "이걸 어떻게 내보내지"에서 막힐 때.',
    whatTheyDo: '대형 폐기물 신고·운반·처리를 대신합니다. 재활용·중고 판매를 함께 봐주는 곳도 있습니다.',
    priceNote: '물량과 층수(엘리베이터 유무)로 정해집니다.',
  },
  {
    id: 'resale',
    label: '중고 매입·위탁 판매',
    group: 'out',
    mode: 'shop',
    when: '버리기는 아까운데 직접 팔 시간이 없을 때. 책·옷·가전·가구가 대부분입니다.',
    whatTheyDo: '값을 매겨 사 가거나, 대신 팔아주고 수수료를 뗍니다. 안 팔린 물건의 처리 방식은 곳마다 다릅니다.',
    priceNote: '직접 파는 것보다 적게 받습니다. 그 차이가 시간값이라고 보시면 됩니다.',
  },
  {
    id: 'moving',
    label: '이사',
    group: 'out',
    mode: 'visit',
    when: '정리의 끝이 이사인 경우. 짐을 줄이고 나서 견적을 받으면 값이 달라집니다.',
    whatTheyDo: '포장·운반·정리까지. 포장이사와 반포장이사는 하는 일과 값이 꽤 다릅니다.',
    priceNote: '짐 양·층수·거리로 정해집니다. 방문 견적을 두세 군데 받아보는 게 일반적입니다.',
  },
]

/** 묶음별로 나눠 준다 — 화면이 한 줄에 18개를 늘어놓지 않게 */
export function servicesByGroup(services = SERVICES): { group: ServiceGroup; label: string; items: ServiceKind[] }[] {
  const order: ServiceGroup[] = ['space', 'self', 'wear', 'upkeep', 'out']
  return order
    .map((g) => ({ group: g, label: SERVICE_GROUP_LABEL[g], items: services.filter((s) => s.group === g) }))
    .filter((x) => x.items.length > 0)
}

/* ────────────────────────────────────────────────────────────
   언제 꺼낼 것인가
   ──────────────────────────────────────────────────────────── */

/** 주기의 이 배수만큼 지나야 '혼자 안 되는 것'으로 본다. 한두 번 건너뛴 건 그냥 바쁜 거다. */
export const OVERDUE_FACTOR = 3

/**
 * 맡기는 항목(doer: 'pro')은 **한 배**, 즉 주기가 지나면 바로 신호로 친다.
 *
 * ★ 왜 규칙을 다르게 두나
 *   3배를 그대로 쓰면 6주 주기인 이발이 18주가 되어서야 뜬다. 그건 알림이
 *   아니라 뒷북이다. 그래도 이게 규칙 1("먼저 들이밀지 않는다")을 어기지 않는
 *   이유는, 이 항목들이 **사용자가 직접 켠 것**이기 때문이다. 켜는 행동 자체가
 *   "때 되면 알려줘"라는 부탁이라, 제때 알리는 게 약속을 지키는 쪽이다.
 *   반대로 내가 하는 일(self)에 이 규칙을 쓰면 그냥 잔소리가 된다 — 그래서 3배 그대로.
 */
export const PRO_OVERDUE_FACTOR = 1

export interface StuckRoutine {
  id: string
  title: string
  category: TidyCategory
  /** 권장 주기의 몇 배가 지났나 */
  timesOverdue: number
  /** 마지막으로 한 지 며칠 */
  daysSince: number
  /** 'pro'면 맡기는 일이다 — 앱도 본인도 그 자리에서 못 끝낸다 */
  doer: 'me' | 'pro'
  /** 이 항목이 바로 이어지는 업종 (pro 항목만) */
  serviceId?: string
}

/**
 * 계속 밀리는 항목을 찾는다.
 *
 * ★ 한 번도 안 한 항목은 세지 않는다. 앱을 처음 켠 사람에게
 *   "혼자 힘드시죠? 업체 불러드릴까요?"라고 하면 그건 그냥 영업이다.
 *   적어도 한 번은 해본 뒤 계속 밀리는 것만 신호로 친다.
 *
 * ★ 끈 항목도 세지 않는다. 냉장고를 목록에서 뺀 사람에게 냉장고를 근거로
 *   업체를 권하면, 끄기 버튼이 아무 의미가 없었던 게 된다.
 */
export function stuckRoutines(state: TidyState, today: string): StuckRoutine[] {
  const out: StuckRoutine[] = []
  for (const r of enabledRoutines(state)) {
    const last = lastDone(state, r.id)
    if (!last) continue
    const daysSince = dayNumber(today) - dayNumber(last)
    const times = Math.floor(daysSince / r.everyDays)
    const doer = r.doer ?? 'me'
    if (times >= (doer === 'pro' ? PRO_OVERDUE_FACTOR : OVERDUE_FACTOR)) {
      out.push({
        id: r.id,
        title: r.title,
        category: r.category,
        timesOverdue: times,
        daysSince,
        doer,
        serviceId: r.serviceId,
      })
    }
  }
  return out.sort((a, b) => b.timesOverdue - a.timesOverdue)
}

export interface Suggestion {
  service: ServiceKind
  /** 왜 이걸 제안하는지 — 사용자의 기록에서 나온 근거만 쓴다 */
  reason: string
}

/**
 * 무엇을 제안할지. 제안할 게 없으면 빈 배열 — 억지로 채우지 않는다.
 *
 * ★ 디지털 항목은 절대 업체로 넘기지 않는다. 바탕화면·다운로드·사진은
 *   앱이 대신 할 수 있다. 할 수 있는 걸 남한테 넘기고 수수료를 받으면
 *   그건 도구가 아니라 중개상이다.
 */
export function suggestServices(
  signals: { stuck: StuckRoutine[]; askedByUser?: boolean; lowDiskAfterCleanup?: boolean },
  services = SERVICES
): Suggestion[] {
  const out: Suggestion[] = []
  const byId = new Map(services.map((s) => [s.id, s]))
  const stuck = signals.stuck.filter((s) => s.category !== 'digital')

  /* ── 맡기는 항목이 먼저다 ───────────────────────────────────
     "머리 자른 지 7주 지났어요 → 미용실"은 이 앱이 가질 수 있는 가장 정확한
     근거다. 항목 하나가 업종 하나를 그대로 가리키므로 추측이 안 들어간다.
     반면 정리수납 제안은 "여러 개 밀렸으니 아마도"에 가깝다 —
     확실한 것을 먼저 놓는다. */
  for (const s of stuck) {
    if (s.doer !== 'pro' || !s.serviceId) continue
    const service = byId.get(s.serviceId)
    if (!service) continue
    /* 근거는 날짜만 말한다. 상태를 평가하는 문장("지저분해 보여요")은
       한 줄도 쓰지 않는다 — 그 한 줄이면 이 화면 전체가 참견이 된다. */
    out.push({
      service,
      reason: `${s.title}을(를) 기록하신 지 ${s.daysSince}일 됐어요. 켜두신 주기가 지났습니다.`,
    })
  }

  const homeStuck = stuck.filter((s) => s.category === 'home')
  const deskStuck = stuck.filter((s) => s.category === 'desk')

  if (homeStuck.length + deskStuck.length >= 2 || signals.askedByUser) {
    const titles = [...homeStuck, ...deskStuck].slice(0, 3).map((s) => s.title)
    out.push({
      service: byId.get('organizer')!,
      reason: signals.askedByUser && !titles.length
        ? '직접 요청하셨어요.'
        : `${titles.join('·')}이(가) 권장 주기를 여러 번 넘겼어요. 물건이 많아서가 아니라 자리가 안 정해져서일 수 있습니다.`,
    })
  }

  if (homeStuck.some((s) => ['fridge', 'wardrobe'].includes(s.id)) || signals.askedByUser) {
    out.push({
      service: byId.get('cleaning')!,
      reason: '손이 많이 가는 곳(주방·옷장)이 계속 밀리고 있어요. 한 번 정리해두면 유지가 쉬워집니다.',
    })
  }

  if (homeStuck.some((s) => s.id === 'wardrobe') || signals.askedByUser) {
    out.push({
      service: byId.get('declutter')!,
      reason: '버리기로 정한 것을 내보내는 단계에서 막히는 경우가 많습니다.',
    })
  }

  if (signals.lowDiskAfterCleanup) {
    out.push({
      service: byId.get('pc-help')!,
      reason: '정리를 하고도 디스크 여유가 부족합니다. 이건 정리가 아니라 저장장치 문제일 수 있어요.',
    })
  }

  // 같은 서비스를 두 번 넣지 않는다
  const seen = new Set<string>()
  return out.filter((s) => (seen.has(s.service.id) ? false : (seen.add(s.service.id), true)))
}

/* ────────────────────────────────────────────────────────────
   문의 요약 — 보내기 전에 사용자가 그대로 읽어볼 수 있어야 한다
   ──────────────────────────────────────────────────────────── */

export interface ReferralRequest {
  serviceId: string
  /** 시/구 정도만. 상세 주소는 받지 않는다 — 업체와 직접 이야기할 일이다. */
  region: string
  /** 사용자가 직접 쓴 메모 */
  note?: string
  /** 연락 수단(사용자가 입력한 것만) */
  contact?: string
  /**
   * 언제쯤 원하시는지 (사용자가 쓴 그대로, 예: '평일 저녁', '이번 주말').
   * 찾아가는 곳(mode: 'shop')은 이게 견적보다 중요하다 — 값은 이미 정해져 있고
   * 정할 게 시간뿐이라, 이걸 안 받으면 연락이 몇 번씩 오간다.
   */
  when?: string
}

export interface SummaryResult {
  ok: boolean
  text: string
  /** 왜 못 만들었는지 */
  problem?: string
}

/** 요약에 절대 들어가면 안 되는 것 — 경로·파일명이 새는 걸 막는다 */
const LEAK_PATTERNS = [/[A-Za-z]:\\/, /\/Users\//i, /\.(jpg|png|exe|zip|docx?|xlsx?|txt|pdf)\b/i]

/**
 * 보낼 내용을 만든다. 만들기만 하고 보내지 않는다 —
 * 화면에 그대로 보여주고, 사용자가 확인한 뒤에만 나간다.
 */
export function buildRequestSummary(
  req: ReferralRequest,
  services = SERVICES
): SummaryResult {
  const service = services.find((s) => s.id === req.serviceId)
  if (!service) return { ok: false, text: '', problem: '어떤 도움이 필요한지 골라주세요.' }
  if (!req.region.trim()) return { ok: false, text: '', problem: '어느 지역인지 알려주세요(시·구까지면 됩니다).' }

  const note = (req.note ?? '').trim()
  if (LEAK_PATTERNS.some((re) => re.test(note))) {
    return {
      ok: false,
      text: '',
      problem: '메모에 파일 경로처럼 보이는 내용이 있어요. 업체에 보낼 내용이라 빼는 게 좋겠습니다.',
    }
  }

  const when = (req.when ?? '').trim()
  if (LEAK_PATTERNS.some((re) => re.test(when))) {
    return { ok: false, text: '', problem: '원하시는 시기에 파일 경로처럼 보이는 내용이 있어요.' }
  }

  /* 방문은 견적이 먼저고(어디로 와서 뭘 보나), 찾아가는 곳은 예약이 먼저다
     (언제 갈 수 있나). 같은 양식으로 받으면 미용실에 평수를 묻게 된다. */
  const lines = [
    service.mode === 'shop' ? `[테라클린 예약 도움 요청]` : `[테라클린 정리 도움 요청]`,
    `필요한 도움: ${service.label}`,
    service.mode === 'shop' ? `찾아갈 지역: ${req.region.trim()}` : `방문 지역: ${req.region.trim()}`,
    when ? `원하는 시기: ${when}` : null,
    note ? `메모: ${note}` : null,
    req.contact?.trim() ? `연락처: ${req.contact.trim()}` : null,
    '',
    '※ 이 요청에는 파일 목록이나 컴퓨터 정보가 들어 있지 않습니다.',
  ].filter(Boolean)

  return { ok: true, text: lines.join('\n') }
}

/** 화면에 반드시 함께 뜨는 고지. 빼면 안 된다. */
export const DISCLOSURE = {
  fee: '연결이 성사되면 저희가 업체로부터 수수료를 받습니다. 사용자가 더 내는 돈은 없습니다.',
  status: '아직 제휴를 맺은 업체가 없습니다. 지금은 요청을 모으는 단계라, 연결까지 시간이 걸립니다.',
  privacy: '파일이나 컴퓨터 정보는 보내지 않습니다. 위에 적은 내용만 나갑니다.',
  optOut: '필요 없으시면 안 누르셔도 됩니다. 이 화면은 다시 권하지 않습니다.',
}
