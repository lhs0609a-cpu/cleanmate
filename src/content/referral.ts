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

import { ROUTINES, dayNumber, lastDone, type TidyCategory, type TidyState } from './tidy.ts'

export interface ServiceKind {
  id: string
  label: string
  /** 언제 사람을 부르는 게 맞는가 */
  when: string
  /** 그 사람들이 실제로 해주는 일 */
  whatTheyDo: string
  /** 돈 이야기를 먼저 한다 — 나중에 놀라는 게 제일 나쁘다 */
  priceNote: string
}

export const SERVICES: ServiceKind[] = [
  {
    id: 'organizer',
    label: '정리수납 전문가',
    when: '물건이 많아서가 아니라 "어디에 둘지"가 안 정해져서 매번 도로 어질러질 때.',
    whatTheyDo: '함께 물건을 분류하고, 버릴지 말지 결정을 돕고, 자리를 정해 수납 구조를 만들어 줍니다.',
    priceNote: '보통 공간·시간 단위로 견적이 나옵니다. 방문 전에 사진으로 대략 견적을 받는 곳이 많습니다.',
  },
  {
    id: 'cleaning',
    label: '집 청소',
    when: '정리는 됐는데 묵은 때·주방·화장실처럼 손이 많이 가는 청소가 남았을 때.',
    whatTheyDo: '부분 청소부터 이사 전후 전체 청소까지. 장비와 세제를 갖고 옵니다.',
    priceNote: '평수와 범위로 견적이 정해집니다. 부분 청소는 훨씬 저렴합니다.',
  },
  {
    id: 'declutter',
    label: '짐 정리·폐기물 수거',
    when: '버리기로 마음은 먹었는데 "이걸 어떻게 내보내지"에서 막힐 때.',
    whatTheyDo: '대형 폐기물 신고·운반·처리를 대신합니다. 재활용·중고 판매를 함께 봐주는 곳도 있습니다.',
    priceNote: '물량과 층수(엘리베이터 유무)로 정해집니다.',
  },
  {
    id: 'pc-help',
    label: 'PC 점검·데이터 이전',
    when: '정리해도 용량이 계속 부족하거나, 새 PC로 자료를 옮겨야 할 때.',
    whatTheyDo: '저장장치 증설·교체, 자료 이전, 백업 설정을 해줍니다.',
    priceNote: '부품값과 작업비가 따로입니다. 부품은 직접 사시는 게 대개 쌉니다.',
  },
]

/* ────────────────────────────────────────────────────────────
   언제 꺼낼 것인가
   ──────────────────────────────────────────────────────────── */

/** 주기의 이 배수만큼 지나야 '혼자 안 되는 것'으로 본다. 한두 번 건너뛴 건 그냥 바쁜 거다. */
export const OVERDUE_FACTOR = 3

export interface StuckRoutine {
  id: string
  title: string
  category: TidyCategory
  /** 권장 주기의 몇 배가 지났나 */
  timesOverdue: number
}

/**
 * 계속 밀리는 항목을 찾는다.
 *
 * ★ 한 번도 안 한 항목은 세지 않는다. 앱을 처음 켠 사람에게
 *   "혼자 힘드시죠? 업체 불러드릴까요?"라고 하면 그건 그냥 영업이다.
 *   적어도 한 번은 해본 뒤 계속 밀리는 것만 신호로 친다.
 */
export function stuckRoutines(state: TidyState, today: string): StuckRoutine[] {
  const out: StuckRoutine[] = []
  for (const r of ROUTINES) {
    const last = lastDone(state, r.id)
    if (!last) continue
    const times = Math.floor((dayNumber(today) - dayNumber(last)) / r.everyDays)
    if (times >= OVERDUE_FACTOR) {
      out.push({ id: r.id, title: r.title, category: r.category, timesOverdue: times })
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

  const lines = [
    `[테라클린 정리 도움 요청]`,
    `필요한 도움: ${service.label}`,
    `지역: ${req.region.trim()}`,
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
