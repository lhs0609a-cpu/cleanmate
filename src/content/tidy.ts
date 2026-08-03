/**
 * 생활 정리 콘텐츠 — PC 밖의 정리까지
 *
 * 왜 정리 프로그램에 이게 들어가나:
 *   디스크를 비우고 나면 방이 보인다. 우리 로드맵은 PC 정리 → 집 청소 →
 *   정리정돈 전문가로 이어지는데, 그 사이를 이어주는 게 이 콘텐츠다.
 *   "청소 업체를 연결해드립니다"는 필요해진 사람에게만 의미가 있고,
 *   필요해지기 전까지 관계를 유지하는 건 매일 쓸 수 있는 무언가다.
 *
 * ── 설계 원칙 (PC 쪽과 같다) ──────────────────────────────────
 * 1) 근거를 먼저 쓴다. 각 항목에 '왜'가 없으면 그냥 잔소리다.
 * 2) 안 해도 된다는 선택지를 뺏지 않는다. 밀렸다고 빨간 경고를 띄우지 않는다 —
 *    할 일 앱이 사람을 지치게 하는 게 정확히 그 지점이다.
 * 3) 지어내지 않는다. "연구에 따르면 37% 향상" 같은 문장을 쓰지 않는다.
 *    검증할 수 없는 숫자는 신뢰를 깎는다(hiberfil 설명과 같은 원칙).
 * 4) 우리가 대신 해줄 수 있는 건 앱 화면으로 연결한다. 글만 주고 끝내지 않는다.
 *
 * 판단 로직은 전부 순수 함수다. 날짜 계산이 틀리면 "어제 했는데 또 하라고 한다"가
 * 되고, 그러면 사람은 바로 이 화면을 닫는다.
 */

export type TidyCategory = 'digital' | 'desk' | 'home'

/** 앱이 대신 해줄 수 있는 화면 — 글만 주고 끝내지 않는다 */
export type AppTab = 'home' | 'hidden' | 'startup' | 'programs' | 'move' | 'quar'

export interface TidyRoutine {
  id: string
  title: string
  category: TidyCategory
  /** 권장 주기(일) */
  everyDays: number
  /** 한 번에 걸리는 시간(분). 짧을수록 시작 문턱이 낮다 */
  minutes: number
  /** 왜 하는가 — 이게 없으면 잔소리다 */
  why: string
  /** 순서대로 따라 하면 끝나는 단계. 3~5개를 넘기지 않는다 */
  steps: string[]
  /** 이 항목에서 사람들이 가장 많이 막히는 지점 */
  tip?: string
  appTab?: AppTab
}

export const CATEGORY_LABEL: Record<TidyCategory, string> = {
  digital: '디지털',
  desk: '책상',
  home: '집',
}

/* ────────────────────────────────────────────────────────────
   콘텐츠

   순서는 '문턱이 낮은 것 → 큰 것'이다. 이불 정리(1분)가 맨 앞에 있는 건
   그게 제일 중요해서가 아니라, 하나를 끝내본 사람이 다음 걸 시작하기 때문이다.
   ──────────────────────────────────────────────────────────── */
export const ROUTINES: TidyRoutine[] = [
  {
    id: 'bed',
    title: '이불 정리',
    category: 'home',
    everyDays: 1,
    minutes: 1,
    why:
      '하루 중 가장 먼저 끝내는 일이 됩니다. 1분짜리 완료가 하나 있으면 그날 나머지 정리의 문턱이 낮아지고, ' +
      '저녁에 방에 들어왔을 때 "정리된 방"으로 돌아오게 됩니다.',
    steps: [
      '이불을 발치까지 한 번에 펴서 내립니다(각 잡지 마세요).',
      '베개를 머리맡에 나란히 둡니다.',
      '이불 위쪽을 30cm쯤 접어 내립니다. 여기까지가 끝입니다.',
    ],
    tip: '완벽하게 하려 들면 3일 안에 그만둡니다. "30초 안에 끝낸다"를 기준으로 삼으세요.',
  },
  {
    id: 'desk-surface',
    title: '책상 위 비우기',
    category: 'desk',
    everyDays: 1,
    minutes: 3,
    why:
      '책상은 수납장이 아니라 작업대입니다. 물건이 올라와 있으면 매번 "치우고 시작"하는 단계가 생기고, ' +
      '그 3분이 일을 미루는 이유가 됩니다. 하루를 끝낼 때 비워두면 내일은 바로 시작합니다.',
    steps: [
      '일을 끝낼 때 딱 3분만 씁니다.',
      '책상 위 물건을 셋으로 나눕니다 — 오늘 또 쓸 것 / 제자리가 있는 것 / 버릴 것.',
      '제자리가 있는 건 지금 갖다 놓고, 없는 건 상자 하나에 모읍니다.',
      '남기는 건 모니터·키보드·마우스·조명·물컵까지만.',
    ],
    tip:
      '"제자리가 없는 것"이 매번 나온다면 물건이 문제가 아니라 자리가 없는 겁니다. ' +
      '그것만 모아두면 서랍 정리 때 뭘 만들어야 할지가 보입니다.',
  },
  {
    id: 'desktop-icons',
    title: '컴퓨터 바탕화면 정리',
    category: 'digital',
    everyDays: 7,
    minutes: 10,
    why:
      '바탕화면은 "나중에 정리할 것"이 쌓이는 임시 창고가 됩니다. 파일이 늘수록 찾는 시간이 늘고, ' +
      '결국 검색으로만 여는 상태가 됩니다. 그러면 바탕화면은 아무 역할도 못 하면서 자리만 차지합니다.',
    steps: [
      '오늘 날짜로 폴더를 하나 만듭니다(예: 2026-08-바탕화면).',
      '지금 작업 중인 것 5개만 빼고 전부 그 폴더에 넣습니다.',
      '자주 쓰는 프로그램은 바로가기 대신 작업 표시줄에 고정합니다.',
      '한 달 뒤에도 그 폴더를 안 열었으면, 그건 안 쓰는 파일입니다.',
    ],
    tip: '한 개씩 판단하면 절대 안 끝납니다. 통째로 옮기고 필요한 것만 꺼내 쓰는 편이 빠릅니다.',
    appTab: 'home',
  },
  {
    id: 'downloads',
    title: '다운로드 폴더 비우기',
    category: 'digital',
    everyDays: 7,
    minutes: 5,
    why:
      '다운로드 폴더는 거쳐가는 곳인데 대부분 종착지가 됩니다. 다 쓴 설치 파일과 한 번 열어본 첨부파일이 ' +
      '수 GB씩 쌓이고, 정작 필요한 파일은 그 사이에 묻힙니다.',
    steps: [
      '이름순이 아니라 날짜순으로 정렬합니다.',
      '한 달 넘은 것 중 설치 파일(.exe·.msi·.zip)은 먼저 지웁니다 — 다시 받을 수 있습니다.',
      '남기고 싶은 문서·사진만 제자리(문서·사진 폴더)로 옮깁니다.',
      '나머지는 통째로 정리합니다.',
    ],
    appTab: 'home',
  },
  {
    id: 'startup-apps',
    title: '시작프로그램 점검',
    category: 'digital',
    everyDays: 90,
    minutes: 5,
    why:
      '프로그램을 깔 때마다 "컴퓨터 켤 때 같이 실행"이 하나씩 늘어납니다. 대부분 동의한 기억도 없는 것들이고, ' +
      '켜질 때마다 부팅이 느려집니다. 끄는 건 삭제가 아니라 되돌릴 수 있는 설정 변경입니다.',
    steps: [
      '테라클린의 시작프로그램 탭을 엽니다.',
      '정체를 아는 것만 끕니다 — 모르는 건 그대로 두세요.',
      '메신저를 끄면 알림을 못 받습니다. 그게 괜찮은지만 판단하면 됩니다.',
      '이상하면 바로 다시 켜면 됩니다.',
    ],
    tip: '백신·클라우드 동기화는 끄지 마세요. 보호와 백업이 멈춥니다.',
    appTab: 'startup',
  },
  {
    id: 'photos',
    title: '사진·스크린샷 정리',
    category: 'digital',
    everyDays: 30,
    minutes: 15,
    why:
      '사진첩이 무거워지는 건 추억이 많아서가 아니라 스크린샷·영수증 사진·연속 촬영본 때문입니다. ' +
      '이것들만 걷어내도 앨범이 다시 볼 만해집니다.',
    steps: [
      '스크린샷 앨범부터 엽니다. 대부분 그 자리에서 지울 수 있습니다.',
      '같은 장면을 여러 장 찍은 것은 제일 잘 나온 한 장만 남깁니다.',
      '영수증·서류 사진은 문서 폴더로 옮기거나 지웁니다.',
      '남길 것은 월별 폴더로 옮깁니다.',
    ],
    tip: '전체를 훑으려 하지 말고 스크린샷 앨범 하나만 끝내세요. 그것만으로도 눈에 띄게 줄어듭니다.',
  },
  {
    id: 'bookmarks',
    title: '즐겨찾기 정리',
    category: 'digital',
    everyDays: 90,
    minutes: 10,
    why:
      '"나중에 볼 것"으로 저장한 링크는 대부분 다시 안 봅니다. 500개가 넘어가면 즐겨찾기는 검색보다 느려지고, ' +
      '진짜 매일 쓰는 5개가 그 안에 묻힙니다.',
    steps: [
      '즐겨찾기 관리자를 엽니다.',
      '매일 쓰는 것만 즐겨찾기 바에 남깁니다(10개 이내).',
      '나머지는 "보관" 폴더 하나에 통째로 넣습니다. 지우지 않아도 됩니다.',
      '한 번도 안 연 링크가 대부분이라는 걸 확인하면 다음부터 저장이 줄어듭니다.',
    ],
  },
  {
    id: 'inbox',
    title: '메일함 비우기',
    category: 'digital',
    everyDays: 7,
    minutes: 15,
    why:
      '안 읽은 메일 숫자는 매번 "확인해야 할 게 남았다"는 신호를 보냅니다. 대부분은 광고인데도요. ' +
      '한 번 정리하는 것보다 들어오는 양을 줄이는 게 오래 갑니다.',
    steps: [
      '광고 메일을 열었을 때 지우지 말고 맨 아래 "수신거부"를 누릅니다.',
      '한 번에 다 하지 말고 이번 주에 온 것만 처리합니다.',
      '읽은 메일은 보관함으로 넘깁니다 — 지우지 않아도 됩니다.',
      '답장이 필요한 것만 받은편지함에 남깁니다.',
    ],
    tip: '수신거부 3개면 다음 주 메일이 눈에 띄게 줄어듭니다. 삭제보다 이게 효과가 큽니다.',
  },
  {
    id: 'desk-cables',
    title: '책상 전선 정리',
    category: 'desk',
    everyDays: 180,
    minutes: 20,
    why:
      '전선이 엉켜 있으면 청소할 때마다 책상을 못 옮기고, 뭘 뽑아야 할지 몰라서 그냥 둡니다. ' +
      '한 번 정리해두면 그 뒤로는 유지가 쉽습니다.',
    steps: [
      '전선을 전부 뽑습니다(무엇이 뭔지 모르는 게 정상입니다).',
      '하나씩 꽂으면서 라벨을 붙입니다 — 마스킹테이프에 이름만 써도 됩니다.',
      '멀티탭을 책상 위나 옆면에 고정합니다. 바닥에 두면 청소를 못 합니다.',
      '남는 길이는 케이블타이로 묶어 책상 뒤로 넘깁니다.',
    ],
  },
  {
    id: 'drawer',
    title: '서랍 한 칸만 비우기',
    category: 'desk',
    everyDays: 7,
    minutes: 10,
    why:
      '집 전체를 정리하려 들면 시작을 못 합니다. 한 칸은 10분이면 끝나고, 끝낸 칸이 하나 생기면 ' +
      '"여기는 정리된 곳"이라는 기준이 생겨서 나머지가 쉬워집니다.',
    steps: [
      '오늘은 한 칸만 정합니다.',
      '전부 꺼내서 책상 위에 올립니다. 빈 칸을 눈으로 보는 게 중요합니다.',
      '쓰는 것 / 안 쓰는 것 / 여기 있으면 안 되는 것으로 나눕니다.',
      '쓰는 것만 다시 넣습니다. 칸이 남아도 채우지 않습니다.',
    ],
    tip: '"언젠가 쓸 것"은 대부분 안 씁니다. 버리기 아까우면 상자에 넣고 날짜를 적어두세요.',
  },
  {
    id: 'bag',
    title: '가방 비우기',
    category: 'home',
    everyDays: 7,
    minutes: 5,
    why:
      '가방은 매일 들고 다니는 서랍입니다. 영수증·포장지·다 쓴 펜이 쌓여서 무거워지고, ' +
      '정작 필요한 걸 꺼내는 데 시간이 걸립니다.',
    steps: [
      '가방을 뒤집어 전부 꺼냅니다.',
      '종이류(영수증·전단)는 그 자리에서 버립니다.',
      '충전기·이어폰은 파우치 하나에 모읍니다.',
      '항상 들고 다닐 것만 다시 넣습니다.',
    ],
  },
  {
    id: 'fridge',
    title: '냉장고 비우기',
    category: 'home',
    everyDays: 7,
    minutes: 15,
    why:
      '냉장고는 "버리기 아까워서 넣어둔 것"이 쌓이는 곳입니다. 안 보이는 안쪽이 차 있으면 ' +
      '있는 재료를 또 사게 되고, 그게 다시 버려집니다.',
    steps: [
      '장 보러 가기 전날에 합니다 — 이때가 제일 비어 있습니다.',
      '문 쪽과 안쪽 맨 뒤부터 봅니다. 오래된 건 대부분 거기 있습니다.',
      '먼저 먹어야 할 것을 눈높이 앞줄로 옮깁니다.',
      '버릴 것을 버리고, 그 목록을 보고 장을 봅니다.',
    ],
  },
  {
    id: 'wardrobe',
    title: '옷장 계절 정리',
    category: 'home',
    everyDays: 180,
    minutes: 60,
    why:
      '지금 못 입는 계절 옷이 절반을 차지하면, 매일 아침 입을 옷을 고르는 게 그만큼 오래 걸립니다. ' +
      '계절이 바뀔 때 한 번만 옮겨두면 옷장이 두 배로 넓어집니다.',
    steps: [
      '지난 계절 내내 한 번도 안 입은 옷을 따로 뺍니다.',
      '지금 계절이 아닌 옷은 상자나 위 칸으로 올립니다.',
      '뺀 옷은 바로 버리지 말고 상자에 넣어 날짜를 적습니다.',
      '다음 계절에 그 상자를 안 열었으면 그때 처분합니다.',
    ],
    tip: '"살 빠지면 입을 옷"은 옷장이 아니라 상자에 두세요. 매일 보면 매일 미안해집니다.',
  },
  {
    id: 'paper',
    title: '종이·서류 정리',
    category: 'home',
    everyDays: 30,
    minutes: 10,
    why:
      '고지서·영수증·안내문은 "일단 여기 두자"가 쌓이는 대표적인 것들입니다. ' +
      '한 곳에 모아두기만 해도 찾는 시간이 사라집니다.',
    steps: [
      '집 안에 흩어진 종이를 한 곳에 모읍니다.',
      '보관해야 하는 것(계약·보증서·세금)만 골라 파일에 넣습니다.',
      '영수증·전단·지난 고지서는 버립니다.',
      '앞으로 들어오는 종이를 놓을 자리 하나를 정합니다.',
    ],
  },
]

/* ────────────────────────────────────────────────────────────
   진행 관리 — 전부 순수 함수

   날짜는 'YYYY-MM-DD' 문자열로만 다룬다. Date 객체를 돌리면 시간대 때문에
   "어제 했는데 오늘 또 하라고 한다"가 생긴다.
   ──────────────────────────────────────────────────────────── */

export interface TidyState {
  /** 항목 id → 완료한 날짜들(오름차순, 'YYYY-MM-DD') */
  done: Record<string, string[]>
}

export const emptyState = (): TidyState => ({ done: {} })

/** 'YYYY-MM-DD' → 일 단위 정수. 시간대·서머타임에 영향받지 않게 UTC로만 센다. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

export function todayISO(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function lastDone(state: TidyState, id: string): string | null {
  const list = state.done[id]
  return list?.length ? list[list.length - 1] : null
}

/**
 * 며칠 뒤가 권장일인가. 음수면 그만큼 지났다는 뜻.
 * 한 번도 안 한 항목은 null — '밀린 것'이 아니라 '아직 안 한 것'이다.
 * 처음 켠 사람에게 15개가 전부 빨갛게 밀려 있으면 그냥 앱을 닫는다.
 */
export function daysUntilDue(routine: TidyRoutine, state: TidyState, today: string): number | null {
  const last = lastDone(state, routine.id)
  if (!last) return null
  return routine.everyDays - (dayNumber(today) - dayNumber(last))
}

/** 오늘 해도 되는가 (권장일이 지났거나 오늘이거나, 아직 한 번도 안 했거나) */
export function isDue(routine: TidyRoutine, state: TidyState, today: string): boolean {
  const left = daysUntilDue(routine, state, today)
  return left === null || left <= 0
}

/**
 * 연속 기록 — 권장 주기를 지킨 횟수.
 *
 * 하루라도 빠지면 0이 되는 방식은 쓰지 않는다. 그건 사람을 그만두게 만든다.
 * 주기의 2배까지는 이어진 것으로 본다(주 1회 항목이면 2주까지).
 */
export function streak(routine: TidyRoutine, state: TidyState, today: string): number {
  const list = state.done[routine.id]
  if (!list?.length) return 0
  const limit = routine.everyDays * 2
  let count = 1
  let prev = dayNumber(list[list.length - 1])
  if (dayNumber(today) - prev > limit) return 0 // 이미 끊겼다
  for (let i = list.length - 2; i >= 0; i--) {
    const cur = dayNumber(list[i])
    if (prev - cur > limit) break
    count++
    prev = cur
  }
  return count
}

/** 오늘 완료로 기록한다. 같은 날 두 번 눌러도 하나로 친다. */
export function markDone(state: TidyState, id: string, today: string): TidyState {
  const list = state.done[id] ?? []
  if (list[list.length - 1] === today) return state
  return { done: { ...state.done, [id]: [...list, today].slice(-60) } }
}

/** 잘못 눌렀을 때 되돌린다 — 여기서도 되돌리기는 기본이다. */
export function undoDone(state: TidyState, id: string, today: string): TidyState {
  const list = state.done[id] ?? []
  if (list[list.length - 1] !== today) return state
  return { done: { ...state.done, [id]: list.slice(0, -1) } }
}

export interface TidyPlan {
  /** 지금 하면 좋은 것 — 짧은 것부터. 문턱을 낮춘다 */
  due: (TidyRoutine & { daysLate: number | null; streak: number })[]
  /** 아직 때가 아닌 것 */
  later: (TidyRoutine & { daysUntil: number; streak: number })[]
  doneToday: string[]
}

/**
 * 오늘의 목록을 만든다.
 *
 * 정렬 기준이 '많이 밀린 순'이 아니라 '짧은 것 순'인 이유:
 * 정리는 시작이 어려운 일이라, 1분짜리를 먼저 끝내는 게 20분짜리를 시작하게 만든다.
 */
export function planToday(state: TidyState, today: string, routines = ROUTINES): TidyPlan {
  const due: TidyPlan['due'] = []
  const later: TidyPlan['later'] = []
  const doneToday: string[] = []

  for (const r of routines) {
    if (lastDone(state, r.id) === today) {
      doneToday.push(r.id)
      continue
    }
    const left = daysUntilDue(r, state, today)
    const s = streak(r, state, today)
    if (left === null || left <= 0) due.push({ ...r, daysLate: left === null ? null : -left, streak: s })
    else later.push({ ...r, daysUntil: left, streak: s })
  }

  due.sort((a, b) => a.minutes - b.minutes)
  later.sort((a, b) => a.daysUntil - b.daysUntil)
  return { due, later, doneToday }
}
