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

export type TidyCategory = 'digital' | 'desk' | 'home' | 'gear' | 'self' | 'upkeep'

/** 앱이 대신 해줄 수 있는 화면 — 글만 주고 끝내지 않는다 */
export type AppTab = 'home' | 'hidden' | 'startup' | 'programs' | 'move' | 'quar'

/**
 * 누가 하는 일인가.
 *
 * ★ 이 축이 왜 필요한가
 *   '정리정돈'은 물건에만 있는 게 아니다. 머리를 자르는 것, 계절 옷을 맡기는 것,
 *   에어컨 속을 청소하는 것도 **주기가 있고, 밀리면 티가 나고, 혼자는 못 하는**
 *   같은 종류의 일이다. 그런데 지금까지 이 목록은 전부 '내가 하는 것'이었다.
 *
 *   둘을 한 목록에 섞으면 화면이 거짓말을 한다 — '했어요'만 있는 카드에
 *   이발이 끼면 사용자는 그 자리에서 할 수 있는 일로 읽는다. 그래서 나눈다:
 *
 *     me   지금 이 자리에서 내가 한다 → '했어요'
 *     pro  예약하거나 맡긴다        → '예약할 때가 됐어요'
 *
 *   이 구분은 수익 모델과도 정확히 겹친다. `pro` 항목은 앱이 절대 대신 못 하는
 *   일이라, 업체로 연결해도 referral.ts의 규칙 2("우리가 할 수 있는 건 안 넘긴다")를
 *   어기지 않는다.
 */
export type TidyDoer = 'me' | 'pro'

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
  /**
   * 꼼꼼히 볼 곳 — 눈에 안 띄어서 매번 빠지는 자리.
   *
   * ★ 단계(steps)와 다르다. 단계는 '순서'고 이건 '빠뜨리는 자리'다.
   *   사람들이 정리를 하고도 얼마 안 가 도로 어질러졌다고 느끼는 이유가
   *   대개 여기다 — 보이는 곳만 치우면 보이는 곳만 깨끗해진다.
   *   한 곳도 지어내지 않는다. 실제로 그 자리에 뭐가 쌓이는 곳만 적는다.
   */
  spots?: string[]
  appTab?: AppTab
  /**
   * 하루 중 언제 하는 게 맞나. 없으면 아무 때나.
   *
   * ★ 이 필드가 생활 정리를 다른 탭과 가른다. 파일 탭들은 몇 시에 열든 같은
   *   화면인데, 이불은 아침에 개고 책상은 일을 끝낼 때 비운다. 콘텐츠의
   *   steps가 이미 그렇게 쓰여 있는 것들만 붙인다 — 없는 시간대를 지어내
   *   붙이면 목록 순서가 무작위로 보인다.
   */
  bestTime?: 'morning' | 'evening'
  /** 없으면 'me' — 지금까지의 항목은 전부 내가 하는 것이었다 */
  doer?: TidyDoer
  /** doer가 'pro'일 때 어떤 업종으로 이어지나 (referral.ts의 SERVICES.id) */
  serviceId?: string
  /**
   * 기본으로 안 보인다. 사용자가 직접 켠 것만 목록에 뜬다.
   *
   * ★ 왜 몸에 대한 항목은 기본으로 켜지 않나
   *   서랍이 밀린 것과 머리를 안 자른 것은 같은 무게가 아니다. 앱이 묻지도
   *   않고 "머리 자를 때 됐어요"를 띄우면, 그건 정리 도구가 아니라 참견이다.
   *   켜는 순간부터는 사용자가 부탁한 일이 되므로 그때는 제때 알려준다.
   */
  optIn?: boolean
}

export const CATEGORY_LABEL: Record<TidyCategory, string> = {
  digital: '디지털',
  desk: '책상',
  home: '집',
  gear: '소모품·기기',
  self: '나',
  upkeep: '손봐야 할 것',
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
    bestTime: 'morning',
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
    spots: [
      '베개 밑 — 충전기·리모컨이 여기로 들어간다',
      '침대와 벽 사이 틈',
      '이불 발치에 말려 들어간 옷',
    ],
    tip: '완벽하게 하려 들면 3일 안에 그만둡니다. "30초 안에 끝낸다"를 기준으로 삼으세요.',
  },
  {
    id: 'desk-surface',
    title: '책상 위 비우기',
    category: 'desk',
    bestTime: 'evening',
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
    spots: [
      '모니터 받침 밑',
      '키보드와 모니터 사이 좁은 띠',
      '의자 밑 바닥',
      '책상 옆면에 붙여둔 종이',
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
    spots: [
      '책상 뒤 바닥 — 여기가 대부분이다',
      '멀티탭 주변에 쌓인 먼지',
      '책상 다리에 감아둔 남는 줄',
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
    spots: [
      '맨 아래 칸 뒤쪽',
      '칸막이 사이에 낀 작은 것들',
      '서랍 위에 얹어둔 것(서랍이 아니라 선반이 됐다)',
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
    spots: [
      '앞주머니 — 영수증이 여기 모인다',
      '안쪽 지퍼 칸',
      '바닥에 깔린 부스러기',
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
    spots: [
      '문 쪽 맨 아래 칸',
      '야채칸 밑',
      '안쪽 맨 뒤 — 오래된 건 거의 여기 있다',
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
    spots: [
      '옷장 맨 위 칸',
      '서랍 맨 뒤',
      '옷걸이에 겹쳐 걸어둔 것',
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
    spots: [
      '냉장고 문에 붙여둔 종이',
      '현관 신발장 위',
      '가방·차 안에 둔 영수증',
    ],
  },


  /* ── 소모품·기기 (category: 'gear') ─────────────────────────
     ★ 사람들이 실제로 놓치는 건 '책상 정리'가 아니다.
       책상이 어질러진 건 눈에 보여서 언젠가는 치운다. 진짜로 몇 년씩 안 하는
       건 **주기가 있는데 아무도 안 알려주는 것들**이다 — 로봇청소기 먼지통,
       세탁기 거름망, 후드 기름때, 수세미. 이것들은 공통점이 셋이다.

         1) 안 해도 당장 아무 일이 안 난다 → 그래서 계속 미뤄진다
         2) 냄새·성능 저하로 알아챌 땐 이미 한참 지났다
         3) 한 번 하면 3~10분이면 끝난다

       "생활 전반이 깔끔하다"는 느낌은 큰 정리가 아니라 여기서 갈린다.
       그리고 이건 앱이 제일 잘하는 일이다 — 날짜를 대신 세는 것.

     ★ 기기 항목은 optIn이다. 로봇청소기가 없는 사람에게 먼지통을 묻는 건
       그냥 틀린 알림이고, 틀린 알림이 두 번 뜨면 목록 전체를 안 보게 된다.
     ★ 위생 수치를 지어내지 않는다. "세균 N배" 같은 문장은 한 줄도 안 쓴다 —
       출처를 못 대는 숫자는 이 앱에서 금지다. 대신 **눈·코로 확인되는 것**만 쓴다.
     ──────────────────────────────────────────────────────────── */
  {
    id: 'towels',
    title: '수건 갈기',
    category: 'gear',
    bestTime: 'morning',
    everyDays: 3,
    minutes: 2,
    why:
      '집에서 냄새가 제일 먼저 나기 시작하는 물건입니다. 젖은 채로 걸려 있는 시간이 길어서, ' +
      '"아직 쓸 만한데"로 며칠 더 쓰면 그 냄새가 욕실 전체 냄새가 됩니다.',
    steps: [
      '지금 걸린 수건을 걷어 빨래통에 넣습니다.',
      '새 수건을 겁니다. 겹치지 않게 펴서 걸어야 마릅니다.',
      '발매트도 같이 봅니다 — 대개 수건보다 오래 걸려 있습니다.',
    ],
    spots: [
      '세면대 옆 손수건 — 가장 자주 젖고 가장 늦게 갈린다',
      '발매트',
      '수건걸이 자체 (수건보다 걸이가 더 오래됐을 수 있다)',
    ],
    tip: '주기를 못 지키겠으면 수건 개수를 늘리세요. 부족해서 오래 쓰는 경우가 대부분입니다.',
  },
  {
    id: 'sink-strainer',
    title: '싱크대 배수망 비우기',
    category: 'gear',
    bestTime: 'evening',
    everyDays: 3,
    minutes: 3,
    why:
      '주방 냄새의 출처가 거의 여기입니다. 음식물이 물에 잠긴 채로 있어서 하루만 지나도 표가 나고, ' +
      '더 두면 배수구 안쪽까지 번져서 그때는 망만 비워도 냄새가 안 빠집니다.',
    steps: [
      '설거지 마지막에 망을 통째로 들어 비웁니다.',
      '망을 뒤집어 솔로 한 번 문지릅니다 — 10초면 됩니다.',
      '망 아래 걸림턱도 손가락으로 훑어봅니다. 여기가 진짜입니다.',
    ],
    spots: [
      '망을 들어낸 자리의 걸림턱 (망보다 여기가 더 낀다)',
      '개수대와 상판 사이 실리콘 이음새',
      '수전 뿌리 쪽',
    ],
  },
  {
    id: 'dish-sponge',
    title: '수세미·행주 갈기',
    category: 'gear',
    everyDays: 14,
    minutes: 3,
    why:
      '닦는 물건이 더러우면 닦을수록 옮기는 셈이 됩니다. 눈으로는 잘 안 보이고 ' +
      '**냄새로 먼저** 알게 되는데, 냄새가 났다면 이미 바꿀 때가 지난 것입니다.',
    steps: [
      '수세미 냄새를 맡아봅니다 — 이게 가장 정확한 판단 기준입니다.',
      '행주는 삶거나 새것으로 바꿉니다.',
      '기름용·설거지용을 따로 쓰면 둘 다 오래 갑니다.',
    ],
    spots: [
      '수세미를 올려두는 받침 (물이 고여 있다)',
      '고무장갑 안쪽',
      '식기건조대 물받이',
    ],
  },
  {
    id: 'shower-drain',
    title: '욕실 배수구 걷어내기',
    category: 'gear',
    everyDays: 7,
    minutes: 3,
    why:
      '머리카락은 며칠이면 뭉칩니다. 물이 눈에 띄게 느려지고 나서 손대면 그때는 안쪽까지 들어가 있고, ' +
      '더 두면 사람을 불러야 합니다. 지금 3분이 나중에 출장비를 아낍니다.',
    steps: [
      '덮개를 열고 머리카락을 걷어냅니다(집게나 비닐장갑을 쓰면 덜 싫습니다).',
      '덮개 안쪽 트랩도 들어 올려 봅니다 — 대개 여기에 더 있습니다.',
      '물을 한 번 세게 흘려 빠지는 속도를 확인합니다.',
    ],
    spots: [
      '덮개 밑 트랩 안쪽 — 걷어낸 것보다 여기가 많다',
      '세면대 팝업 마개 아래',
      '샤워부스 문턱 홈',
    ],
    tip: '"물이 느려졌다"가 시작 신호입니다. 완전히 막히면 그때는 우리가 할 수 있는 게 없습니다.',
  },
  {
    id: 'bedding',
    title: '침구 세탁',
    category: 'gear',
    everyDays: 14,
    minutes: 20,
    why:
      '하루에 예닐곱 시간씩 얼굴이 닿는 물건인데, 눈에 안 띄게 더러워져서 주기를 놓치기 쉽습니다. ' +
      '갈고 난 날 밤에 차이가 바로 느껴지는 몇 안 되는 항목입니다.',
    steps: [
      '베갯잇부터 뺍니다 — 이것만 자주 갈아도 체감이 큽니다.',
      '커버·시트를 벗겨 세탁기에 넣습니다.',
      '매트리스 위를 한 번 쓸어냅니다.',
      '새것을 씌우고 끝냅니다. 다음날로 미루면 그냥 안 씌운 채로 잡니다.',
    ],
    spots: [
      '베개 속통 (커버만 갈고 속통은 몇 년째인 경우가 많다)',
      '매트리스 커버',
      '침대 프레임 헤드보드 위 먼지',
    ],
    tip: '전부 하려면 안 하게 됩니다. 베갯잇만 일주일에 한 번 가는 것부터 시작하세요.',
  },
  {
    id: 'toothbrush',
    title: '칫솔모 갈기',
    category: 'gear',
    everyDays: 90,
    minutes: 2,
    why:
      '모가 벌어지면 닦이는 면이 줄어드는데, 매일 보는 물건이라 벌어진 걸 못 알아챕니다. ' +
      '언제 바꿨는지 기억나지 않으면 대개 바꿀 때가 지난 것입니다.',
    steps: [
      '위에서 내려다봅니다 — 모가 바깥으로 퍼져 있으면 교체 시점입니다.',
      '새것으로 바꿉니다. 전동칫솔이면 헤드만 갈면 됩니다.',
      '칫솔꽂이 바닥도 같이 씻습니다.',
    ],
    spots: ['칫솔꽂이 바닥에 고인 물', '치약 뚜껑 주변', '컵 바닥'],
  },
  {
    id: 'entrance',
    title: '현관·신발장',
    category: 'gear',
    everyDays: 30,
    minutes: 15,
    why:
      '집에 들어올 때 처음 보는 곳이라 여기가 정리돼 있으면 집 전체가 정리된 것처럼 느껴집니다. ' +
      '반대로 신발이 널려 있으면 안쪽을 아무리 치워도 그 인상이 안 바뀝니다.',
    steps: [
      '지금 계절에 안 신는 신발을 신발장 안으로 넣습니다.',
      '한 켤레도 안 신은 신발은 따로 빼둡니다.',
      '바닥을 쓸고 닦습니다 — 흙먼지가 집 안으로 들어오는 입구입니다.',
      '우산·택배 상자처럼 "잠깐 둔 것"을 치웁니다.',
    ],
    spots: [
      '신발장 맨 아래 칸 (안 신는 신발이 여기 쌓인다)',
      '문 뒤 구석',
      '중문·현관문 손잡이 주변',
    ],
  },

  /* ── 기기가 있으면 (optIn) ──────────────────────────────────
     없는 기기를 물어보면 그건 틀린 알림이다. 틀린 알림이 두 번 뜨면
     사람은 목록 전체를 안 보게 된다. 그래서 전부 켜야 나온다. */
  {
    id: 'robot-bin',
    title: '로봇청소기 먼지통 비우기',
    category: 'gear',
    optIn: true,
    everyDays: 7,
    minutes: 3,
    why:
      '통이 차면 로봇은 계속 돌지만 빨아들이지는 않습니다. **돌고 있으니 청소되고 있다고 믿는 것**이 ' +
      '이 기기의 유일한 함정입니다. 소리가 커지거나 흡입이 약해졌다면 대개 이것입니다.',
    steps: [
      '먼지통을 빼서 비웁니다.',
      '통 안쪽 필터를 꺼내 톡톡 텁니다(물세척 가능 여부는 설명서를 보세요).',
      '먼지통 입구에 낀 머리카락을 걷어냅니다.',
    ],
    spots: [
      '먼지통 안쪽 필터 — 비우기만 하고 필터는 안 터는 경우가 대부분이다',
      '충전 단자 (여기가 더러우면 충전이 안 된다)',
      '충전대 주변 바닥',
    ],
    tip: '자동 먼지통이 있어도 이 항목은 남습니다 — 본체 필터는 여전히 사람이 텁니다.',
  },
  {
    id: 'robot-brush',
    title: '로봇청소기 브러시·바퀴',
    category: 'gear',
    optIn: true,
    everyDays: 30,
    minutes: 10,
    why:
      '머리카락이 브러시 축에 감기면 브러시가 헛돕니다. 먼지통을 아무리 비워도 ' +
      '바닥이 안 닦이는 상태가 되는데, 뒤집어 보기 전까지는 알 방법이 없습니다.',
    steps: [
      '뒤집어서 브러시를 분리합니다.',
      '축 양 끝에 감긴 머리카락을 가위로 잘라 걷어냅니다 — 여기가 핵심입니다.',
      '앞바퀴(구슬 모양)를 빼서 감긴 것을 제거합니다.',
      '센서 창을 마른 천으로 닦습니다.',
    ],
    spots: [
      '브러시 축 양 끝 캡 안쪽',
      '앞 구동 바퀴 (여기 감기면 자꾸 같은 자리를 돈다)',
      '낙하 방지 센서 창 — 먼지가 끼면 문턱에서 멈춘다',
    ],
  },
  {
    id: 'vacuum-filter',
    title: '무선청소기 먼지통·필터',
    category: 'gear',
    optIn: true,
    everyDays: 14,
    minutes: 10,
    why:
      '흡입력이 떨어졌을 때 대부분은 고장이 아니라 필터입니다. 새로 사기 전에 여기부터 봅니다.',
    steps: [
      '먼지통을 비우고 안쪽 원통 필터를 뺍니다.',
      '물세척이 되는 필터면 씻어서 **완전히 말린 뒤** 넣습니다(덜 마른 채로 넣으면 냄새가 납니다).',
      '흡입구와 연장관 안쪽에 걸린 것을 확인합니다.',
    ],
    spots: [
      '원통 필터 주름 사이',
      '먼지통 뚜껑 고무 패킹',
      '바닥 브러시 헤드 안쪽 축',
    ],
  },
  {
    id: 'aircon-filter',
    title: '에어컨 필터 씻기',
    category: 'gear',
    optIn: true,
    everyDays: 30,
    minutes: 15,
    why:
      '필터가 막히면 바람이 약해지고 전기를 더 씁니다. 이건 직접 할 수 있는 부분이고, ' +
      '분해가 필요한 안쪽 청소와는 다른 일입니다.',
    steps: [
      '전원을 뽑습니다.',
      '앞 커버를 열고 필터를 빼서 물로 헹굽니다.',
      '그늘에서 완전히 말린 뒤 끼웁니다.',
      '커버 안쪽과 바람 나오는 날개도 닦습니다.',
    ],
    spots: [
      '바람 나오는 날개(루버) 안쪽 — 여기 곰팡이가 먼저 보인다',
      '필터 틀 모서리',
      '실외기 주변에 쌓인 낙엽·먼지',
    ],
    tip: '켤 때 냄새가 나면 필터가 아니라 안쪽입니다. 그건 분해 청소를 불러야 합니다.',
  },
  {
    id: 'purifier-filter',
    title: '공기청정기 필터 점검',
    category: 'gear',
    optIn: true,
    everyDays: 90,
    minutes: 10,
    why:
      '교체 알림이 뜨는 기기도 있지만 사용량 기준이라 실제 상태와 어긋납니다. ' +
      '한 번 꺼내 보면 바꿀 때인지 바로 압니다.',
    steps: [
      '뒷면 커버를 열고 필터를 꺼냅니다.',
      '프리필터(그물망)는 씻거나 청소기로 빨아들입니다 — 이건 교체가 아니라 청소입니다.',
      '헤파필터는 색이 확연히 변했으면 교체합니다.',
      '언제 갈았는지 필터에 날짜를 적어두면 다음이 쉽습니다.',
    ],
    spots: ['프리필터 그물망', '흡입구 주변 틈', '본체 뒷면 벽 쪽'],
  },
  {
    id: 'washer-filter',
    title: '세탁기 거름망·통세척',
    category: 'gear',
    optIn: true,
    everyDays: 30,
    minutes: 20,
    why:
      '빤 옷에서 냄새가 나면 세제 문제가 아니라 세탁기 안쪽입니다. ' +
      '거름망은 대부분 한 번도 안 열어본 곳이라 처음 열면 놀랍니다.',
    steps: [
      '드럼이면 앞 아래쪽 작은 문 뒤의 거름망을, 통돌이면 통 안쪽 그물망을 꺼냅니다.',
      '걸린 것을 비우고 씻습니다.',
      '통세척 코스를 빈 상태로 돌립니다.',
      '문 고무 패킹 접힌 안쪽을 닦고, 문을 열어둔 채 말립니다.',
    ],
    spots: [
      '드럼 문 고무 패킹 접힌 안쪽 — 곰팡이가 여기서 시작한다',
      '세제 넣는 서랍 (빼면 통째로 씻을 수 있다)',
      '급수 호스 연결부 필터',
    ],
    tip: '세탁이 끝나면 문을 열어두세요. 이거 하나로 다음 청소 주기가 길어집니다.',
  },
  {
    id: 'humidifier',
    title: '가습기 물통 씻기',
    category: 'gear',
    optIn: true,
    everyDays: 3,
    minutes: 5,
    why:
      '물이 고인 채로 며칠 두면 안쪽에 막이 생기고, 그 상태로 그걸 방에 뿜습니다. ' +
      '쓰는 철에는 주기가 짧은 게 정상입니다.',
    steps: [
      '남은 물을 버립니다 — 물을 채워둔 채로 두지 않습니다.',
      '통 안쪽을 솔로 문질러 헹굽니다.',
      '진동자·분무구 주변을 닦습니다.',
      '안 쓸 때는 완전히 말려서 보관합니다.',
    ],
    spots: ['통 바닥 모서리', '분무구 안쪽', '물통 뚜껑 고무 패킹'],
  },
  {
    id: 'water-filter',
    title: '정수기 필터 확인',
    category: 'gear',
    optIn: true,
    everyDays: 180,
    minutes: 5,
    why:
      '방문 관리를 받고 있으면 업체가 챙기지만, 직접 쓰는 제품이면 아무도 안 알려줍니다. ' +
      '교체 주기는 제품마다 달라서 여기서는 **확인할 때**만 알려드립니다.',
    steps: [
      '마지막 교체일을 확인합니다(본체 스티커나 앱에 적혀 있는 경우가 많습니다).',
      '제품 설명서의 권장 주기와 비교합니다.',
      '지났으면 주문하거나 방문 일정을 잡습니다.',
    ],
    spots: ['출수구 끝 (여기는 필터와 상관없이 따로 닦아야 한다)', '물받이 트레이', '본체 뒷면 먼지'],
  },
  {
    id: 'hood-filter',
    title: '주방 후드 기름때',
    category: 'gear',
    optIn: true,
    everyDays: 60,
    minutes: 20,
    why:
      '기름은 시간이 지날수록 굳어서, 미루면 미룰수록 같은 일이 훨씬 오래 걸립니다. ' +
      '두 달마다 20분이 1년 뒤 두 시간보다 쌉니다.',
    steps: [
      '전원을 끄고 필터(철망)를 빼냅니다.',
      '뜨거운 물에 주방세제를 풀어 20분 담가둡니다 — 문지르는 시간이 확 줄어듭니다.',
      '솔로 문질러 헹구고 완전히 말립니다.',
      '후드 안쪽 면과 아래쪽 테두리를 닦습니다.',
    ],
    spots: [
      '후드 안쪽 팬 날개',
      '후드 아래 테두리 (여기서 기름이 떨어진다)',
      '후드 위 벽면·상부장 아랫면',
    ],
  },
  {
    id: 'microwave',
    title: '전자레인지·인덕션',
    category: 'gear',
    optIn: true,
    everyDays: 14,
    minutes: 10,
    why:
      '음식이 튄 자국은 다음에 가열할 때마다 다시 익어서 점점 안 지워집니다. ' +
      '굳기 전에 닦는 게 유일한 방법입니다.',
    steps: [
      '전자레인지: 물 담은 컵을 2~3분 돌려 김을 채운 뒤 닦으면 그냥 닦입니다.',
      '천장 면을 꼭 봅니다 — 여기가 가장 많이 튀고 가장 안 닦습니다.',
      '인덕션은 전용 스크레이퍼로 굳은 것을 밀어냅니다.',
      '받침 접시와 회전 링도 분리해 씻습니다.',
    ],
    spots: [
      '전자레인지 천장 면',
      '문 안쪽 아래 홈',
      '인덕션 테두리 실리콘 이음새',
      '가스레인지 삼발이 밑 상판',
    ],
  },

  /* ── 맡기는 것 (doer: 'pro') ─────────────────────────────────
     여기부터는 앱도, 대개는 본인도 그 자리에서 못 하는 일이다. 할 수 있는 건
     **날짜를 기억하는 것**뿐이고, 사실 그게 이 항목들의 전부다 —
     사람들이 미용실에 늦게 가는 이유는 게을러서가 아니라 언제 갔는지를
     기억 못 해서다.

     ★ 전부 optIn: true — 켜기 전엔 화면에 없다.
     ★ 문구는 전부 '주기'로만 말한다. 상태 평가("지저분해 보여요")는 한 줄도
       쓰지 않는다. 그건 정리 도구가 할 말이 아니고, 한 번 들으면 앱을 지운다.
     ──────────────────────────────────────────────────────────── */
  {
    id: 'haircut',
    title: '머리 자르기',
    category: 'self',
    doer: 'pro',
    serviceId: 'hair',
    optIn: true,
    everyDays: 42,
    minutes: 60,
    why:
      '자란 건 매일 보는 사람이 제일 늦게 알아챕니다. 그래서 "슬슬 가야 하나"를 몇 주씩 생각만 하다가 ' +
      '결국 급할 때 아무 데나 가게 됩니다. 마지막으로 자른 날만 적어두면 그 고민이 통째로 사라집니다.',
    steps: [
      '마지막으로 자른 날부터 몇 주가 지났는지 봅니다 — 이 항목이 대신 세고 있습니다.',
      '지난번 사진이 있으면 찾아둡니다. 말로 설명하는 것보다 훨씬 빠릅니다.',
      '예약합니다. 예약을 안 받는 곳이면 붐비지 않는 시간을 먼저 정합니다.',
    ],
    tip:
      '"조금만 다듬어 주세요"는 사람마다 뜻이 다릅니다. 길이를 숫자(cm)나 사진으로 말하면 ' +
      '"생각보다 많이 잘렸다"가 잘 안 생깁니다.',
  },
  {
    id: 'nails',
    title: '손발톱 정리',
    category: 'self',
    doer: 'pro',
    serviceId: 'nails',
    optIn: true,
    everyDays: 28,
    minutes: 50,
    why:
      '직접 하든 맡기든 주기가 비슷하게 돌아오는 일입니다. 날짜를 적어두면 ' +
      '"저번에 언제 했더라"를 매번 떠올리지 않아도 됩니다.',
    steps: [
      '지난번 날짜를 확인합니다.',
      '직접 할지 맡길지 정합니다 — 둘 다 이 항목의 완료입니다.',
      '맡긴다면 원하는 길이·모양을 미리 정해둡니다.',
    ],
  },
  {
    id: 'dental',
    title: '치과 스케일링',
    category: 'self',
    doer: 'pro',
    serviceId: 'dental',
    optIn: true,
    everyDays: 365,
    minutes: 40,
    why:
      '한 해에 한 번이라 더 잊습니다. 다음에 생각날 때는 이미 한참 지나 있고, ' +
      '"올해 받았던가?"를 확인할 방법이 마땅치 않습니다. 여기에 날짜만 남겨두면 됩니다.',
    steps: [
      '작년에 받은 날짜를 확인합니다.',
      '건강보험 적용 여부·횟수는 해마다 제도가 바뀔 수 있으니 예약할 때 확인하세요.',
      '예약합니다. 이 항목은 받은 날을 적는 게 전부입니다.',
    ],
    tip: '이건 기록이지 진료 안내가 아닙니다. 아프거나 이상하면 주기와 상관없이 바로 가세요.',
  },
  {
    id: 'eyesight',
    title: '시력·안경 점검',
    category: 'self',
    doer: 'pro',
    serviceId: 'eyes',
    optIn: true,
    everyDays: 365,
    minutes: 30,
    why:
      '시력은 천천히 변해서 본인은 잘 모릅니다. 안 맞는 도수를 오래 쓰면 ' +
      '눈이 쉽게 피로해지는데, 대개 "요즘 피곤해서"로 넘깁니다. 1년에 한 번 재보면 됩니다.',
    steps: [
      '안경·렌즈를 맞춘 날짜를 확인합니다.',
      '안경점에서 시력만 재보는 건 대개 무료입니다 — 바꾸지 않아도 됩니다.',
      '코받침·나사처럼 헐거워진 곳도 그 자리에서 봐줍니다.',
    ],
  },
  {
    id: 'checkup',
    title: '건강검진',
    category: 'self',
    doer: 'pro',
    serviceId: 'checkup',
    optIn: true,
    everyDays: 730,
    minutes: 180,
    why:
      '대상자 안내문은 대개 연초에 한 번 오고, 그때 못 가면 12월에 몰립니다. ' +
      '받은 날짜를 적어두면 다음 차례가 언제인지를 안내문 없이도 압니다.',
    steps: [
      '마지막으로 받은 날짜를 확인합니다.',
      '대상 여부와 주기는 사람마다 다릅니다 — 건강보험공단 안내를 확인하세요.',
      '12월은 어디나 붐빕니다. 상반기에 잡으면 원하는 날에 갑니다.',
    ],
    tip: '이 항목은 날짜만 셉니다. 무엇을 받을지, 받아야 하는지는 여기서 판단하지 않습니다.',
  },
  {
    id: 'season-clothes',
    title: '계절 옷 세탁·보관',
    category: 'upkeep',
    doer: 'pro',
    serviceId: 'laundry',
    optIn: true,
    everyDays: 180,
    minutes: 30,
    why:
      '입지 않은 채로 넣어둔 코트가 다음 계절에 얼룩과 냄새로 돌아옵니다. ' +
      '옷장 계절 정리에서 "뺀 옷"이 나왔다면 그다음 단계가 이것입니다.',
    steps: [
      '옷장 정리에서 다음 계절까지 안 입을 옷을 골라둡니다.',
      '한 번이라도 입은 겉옷은 보관 전에 세탁합니다 — 눈에 안 보이는 얼룩이 시간이 지나 올라옵니다.',
      '맡기면 대개 보관 서비스도 함께 됩니다. 집에 자리가 없을 때 이게 더 쌉니다.',
    ],
    tip: '가죽·모피·패딩은 집에서 빨면 되돌릴 수 없습니다. 이건 맡기는 쪽이 확실합니다.',
  },
  {
    id: 'shoe-care',
    title: '신발·가방 손보기',
    category: 'upkeep',
    doer: 'pro',
    serviceId: 'repair-leather',
    optIn: true,
    everyDays: 180,
    minutes: 20,
    why:
      '굽이나 밑창은 닳는 걸 넘기면 갈아서 못 쓰고 통째로 버리게 됩니다. ' +
      '한 켤레 수선비가 새로 사는 값보다 훨씬 쌉니다 — 정리는 버리는 것만이 아닙니다.',
    steps: [
      '신발장에서 굽·밑창이 한쪽만 닳은 것을 골라냅니다.',
      '가방은 손잡이·지퍼·모서리를 봅니다. 이 셋이 대부분입니다.',
      '수선집에 가져가 견적만 물어봐도 됩니다.',
    ],
  },
  {
    id: 'appliance-clean',
    title: '에어컨·세탁기 속청소',
    category: 'upkeep',
    doer: 'pro',
    serviceId: 'appliance-clean',
    optIn: true,
    everyDays: 365,
    minutes: 15,
    why:
      '겉은 닦아도 안쪽은 열어볼 수가 없습니다. 세탁기는 빨래에서 냄새가 나기 시작할 때, ' +
      '에어컨은 켤 때 냄새가 날 때가 이미 한참 지난 상태입니다.',
    steps: [
      '작년에 언제 했는지 확인합니다.',
      '에어컨은 더워지기 전(4~5월), 세탁기는 아무 때나 됩니다 — 성수기에 부르면 비싸고 늦습니다.',
      '분해 청소인지 겉만 하는 것인지 예약할 때 확인하세요. 값이 다른 이유가 그것입니다.',
    ],
    tip: '필터 청소는 직접 하는 것이고, 여기서 말하는 건 분해가 필요한 안쪽입니다.',
  },
  {
    id: 'drain',
    title: '배수구 손보기',
    category: 'upkeep',
    doer: 'pro',
    serviceId: 'plumbing',
    optIn: true,
    everyDays: 90,
    minutes: 15,
    why:
      '물이 안 내려가고 나서 부르면 급한 일이 되고, 급한 일은 비쌉니다. ' +
      '느려지기 시작할 때가 직접 해볼 수 있는 마지막 시점입니다.',
    steps: [
      '욕실·주방 배수구에서 머리카락·기름때를 먼저 걷어냅니다.',
      '물이 빠지는 속도를 봅니다. 눈에 띄게 느리면 안쪽 문제입니다.',
      '냄새가 계속 올라오거나 두 곳 이상이 동시에 느리면 사람을 부르는 게 맞습니다.',
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
  /**
   * 사용자가 직접 켜고 끈 항목. 없으면 기본값(optIn 항목은 꺼짐, 나머지는 켜짐).
   *
   * ★ 켠 것만이 아니라 **끈 것도** 여기 남는다. 기본으로 켜진 항목을 끄면
   *   false가 들어간다 — 냉장고가 없는 집도 있고, 책상 대신 식탁에서 일하는
   *   사람도 있다. 우리가 정한 14개를 전부 해야 하는 목록으로 두면 그건 남의
   *   기준이고, 남의 기준으로 밀린 목록은 그냥 안 보게 된다.
   */
  on?: Record<string, boolean>
}

export const emptyState = (): TidyState => ({ done: {} })

/** 이 항목이 지금 이 사람의 목록에 있는가 */
export function isRoutineOn(state: TidyState, r: TidyRoutine): boolean {
  const explicit = state.on?.[r.id]
  if (typeof explicit === 'boolean') return explicit
  return !r.optIn
}

/** 켠 항목만. 화면·통계·업체 제안이 전부 이걸 거쳐야 한 화면 안에서 숫자가 안 어긋난다. */
export function enabledRoutines(state: TidyState, routines = ROUTINES): TidyRoutine[] {
  return routines.filter((r) => isRoutineOn(state, r))
}

/**
 * 항목을 켜거나 끈다.
 *
 * ★ 끄면서 기록을 지우지 않는다. 다시 켰을 때 "언제 했더라"가 남아 있어야
 *   하고, 무엇보다 **끄기가 되돌릴 수 있는 일**이어야 한다. 이 앱이 파일을
 *   다루는 방식과 같은 원칙이다 — 지우기 전에 보여주고, 되돌릴 수 있게.
 */
export function setRoutineOn(state: TidyState, id: string, on: boolean): TidyState {
  return { ...state, on: { ...(state.on ?? {}), [id]: on } }
}

/** 'YYYY-MM-DD' → 일 단위 정수. 시간대·서머타임에 영향받지 않게 UTC로만 센다. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

/**
 * 오늘 — **그 사람이 사는 시간대**로 센다.
 *
 * ★ 실물에서 잡힌 사고 (2026-08-31 아침 07:54 KST).
 *   여기가 `toISOString()`이었다. 그건 UTC 날짜다. 한국은 UTC+9라서
 *   **자정부터 오전 9시까지는 앱이 어제를 살고 있었다.**
 *
 *     · 아침에 이불을 정리하고 '했어요'를 누르면 **어제 날짜로** 기록된다
 *     · 그래서 '오늘 완료'로 안 넘어가고 목록에 계속 남아 있다
 *     · 달력의 점도 하루 앞 칸에 찍힌다
 *     · 매일 아침 하는 사람일수록 더 자주 겪는다 — 이 앱을 제일 잘 쓰는 사람이다
 *
 *   dayNumber()가 UTC를 쓰는 것은 그대로 둔다. 그건 'YYYY-MM-DD' 문자열을
 *   정수로 바꾸는 계산이라 시간대가 끼면 안 되는 자리다. 반대로 여기는
 *   **지금이 며칠인가**를 묻는 자리라 반드시 사람의 시간대여야 한다.
 */
export function todayISO(now = Date.now()): string {
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
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

/**
 * 오늘 완료로 기록한다. 같은 날 두 번 눌러도 하나로 친다.
 *
 * ★ `...state`를 반드시 편다. 기록만 새로 만들어 돌려주면 켜고 끈 설정(on)이
 *   통째로 날아간다 — 이발을 켜고 '했어요'를 누른 순간 그 항목이 목록에서
 *   사라지는, 아무도 원인을 못 찾을 종류의 버그다. (테스트가 이걸 잡았다.)
 */
export function markDone(state: TidyState, id: string, today: string): TidyState {
  const list = state.done[id] ?? []
  if (list[list.length - 1] === today) return state
  return { ...state, done: { ...state.done, [id]: [...list, today].slice(-60) } }
}

/** 잘못 눌렀을 때 되돌린다 — 여기서도 되돌리기는 기본이다. */
export function undoDone(state: TidyState, id: string, today: string): TidyState {
  const list = state.done[id] ?? []
  if (list[list.length - 1] !== today) return state
  return { ...state, done: { ...state.done, [id]: list.slice(0, -1) } }
}

export interface TidyPlan {
  /** 지금 하면 좋은 것 — 짧은 것부터. 문턱을 낮춘다 */
  due: (TidyRoutine & { daysLate: number | null; streak: number })[]
  /**
   * 예약할 때가 된 것 (doer: 'pro').
   *
   * ★ due와 한 통에 담지 않는 이유: 이 카드에 붙는 버튼이 다르다. 내가 하는
   *   일은 '했어요'지만 맡기는 일은 지금 이 자리에서 못 끝낸다. 섞어두면
   *   "했어요"를 누를 수 없는 카드가 목록에 껴서, 목록 전체가 못 미더워진다.
   */
  book: (TidyRoutine & { daysLate: number | null; streak: number })[]
  /** 아직 때가 아닌 것 */
  later: (TidyRoutine & { daysUntil: number; streak: number })[]
  doneToday: string[]
  /** 지금 켜져 있는 항목 수 — 화면의 '전체 N개'가 이걸 써야 목록과 안 어긋난다 */
  enabled: number
}

/**
 * 오늘의 목록을 만든다.
 *
 * 정렬 기준이 '많이 밀린 순'이 아니라 '짧은 것 순'인 이유:
 * 정리는 시작이 어려운 일이라, 1분짜리를 먼저 끝내는 게 20분짜리를 시작하게 만든다.
 *
 * 끈 항목은 아예 안 나온다 — 끄고도 목록에 남으면 끈 게 아니다.
 */
export function planToday(state: TidyState, today: string, routines = ROUTINES): TidyPlan {
  const due: TidyPlan['due'] = []
  const book: TidyPlan['book'] = []
  const later: TidyPlan['later'] = []
  const doneToday: string[] = []
  const list = enabledRoutines(state, routines)

  for (const r of list) {
    if (lastDone(state, r.id) === today) {
      doneToday.push(r.id)
      continue
    }
    const left = daysUntilDue(r, state, today)
    const s = streak(r, state, today)
    if (left === null || left <= 0) {
      const entry = { ...r, daysLate: left === null ? null : -left, streak: s }
      ;(r.doer === 'pro' ? book : due).push(entry)
    } else later.push({ ...r, daysUntil: left, streak: s })
  }

  due.sort((a, b) => a.minutes - b.minutes)
  /* 맡기는 것은 '짧은 것 순'이 의미가 없다 — 어차피 오늘 못 끝낸다.
     오래 지난 것부터 보여준다. 한 번도 안 해본 건(daysLate null) 맨 뒤다. */
  book.sort((a, b) => (b.daysLate ?? -1) - (a.daysLate ?? -1))
  later.sort((a, b) => a.daysUntil - b.daysUntil)
  return { due, book, later, doneToday, enabled: list.length }
}

/* ── 습관 기록 (게임처럼, 다만 재촉하지 않게) ──────────────────
   ★ 설계 원칙 — 이 화면은 "잘하고 있나"를 보여주는 자리지 "왜 안 했냐"를
     따지는 자리가 아니다. 그래서 셋을 지킨다.

     1) 등급은 **누적 횟수**로만 오른다. 연속 기록으로 등급을 매기면 하루
        아파서 못 한 사람이 등급을 잃는다 — 그건 벌이지 보상이 아니다.
     2) 등급은 **내려가지 않는다.** 한 번 몸에 붙은 건 안 사라진다.
     3) 이어가는 날수는 **하루 빠짐을 봐준다**(streak()과 같은 규칙). 이틀
        연속 비어야 끊긴다. 사람은 하루쯤 거른다.

     그리고 "연구에 따르면 N%" 같은 지어낸 수치는 여기에도 안 쓴다. 셀 수 있는
     것만 센다 — 몇 번 했고, 며칠째고, 가장 길었던 게 며칠인지. */

/** 등급 — 누적 완료 횟수로만 오른다. 숫자가 아니라 이름으로 말한다. */
export const HABIT_RANKS = [
  { at: 0, name: '시작' },
  { at: 5, name: '손에 익는 중' },
  { at: 20, name: '몸에 붙는 중' },
  { at: 50, name: '습관' },
  { at: 120, name: '오래된 습관' },
] as const

/** 이어가는 날수를 셀 때 봐주는 간격. 하루는 걸러도 이어진다. */
const GAP_FORGIVEN = 2

export interface HabitStats {
  /** 여태 완료한 총 횟수 (기록에 남아 있는 만큼) */
  doneTotal: number
  /** 최근 7일 — 오래된 날이 먼저. 화면의 점 일곱 개가 이걸 그린다 */
  days7: { date: string; count: number }[]
  /** 지금 이어가는 중인 날수 */
  currentDays: number
  /** 가장 길게 이어간 날수 */
  bestDays: number
  rank: { name: string; index: number }
  /** 다음 등급까지 남은 횟수. 마지막 등급이면 null */
  next: { name: string; remain: number } | null
}

/** 완료 기록이 있는 날들 (중복 없이, 오름차순 일 번호) */
function activeDayNumbers(state: TidyState): number[] {
  const days = new Set<number>()
  for (const list of Object.values(state.done)) {
    for (const d of list) days.add(dayNumber(d))
  }
  return [...days].sort((a, b) => a - b)
}

/** 하루 빠짐을 봐주면서 가장 긴 구간을 센다. */
function longestRun(days: number[]): number {
  if (!days.length) return 0
  let best = 1
  let cur = 1
  for (let i = 1; i < days.length; i++) {
    if (days[i] - days[i - 1] <= GAP_FORGIVEN) cur++
    else cur = 1
    if (cur > best) best = cur
  }
  return best
}

export function habitStats(state: TidyState, today: string): HabitStats {
  const days = activeDayNumbers(state)
  const doneTotal = Object.values(state.done).reduce((n, l) => n + l.length, 0)

  // 지금 이어가는 중인가 — 마지막 기록이 너무 오래되지 않았어야 한다.
  let currentDays = 0
  if (days.length && dayNumber(today) - days[days.length - 1] <= GAP_FORGIVEN) {
    currentDays = 1
    for (let i = days.length - 2; i >= 0; i--) {
      if (days[i + 1] - days[i] > GAP_FORGIVEN) break
      currentDays++
    }
  }

  const t = dayNumber(today)
  const perDay = new Map<number, number>()
  for (const list of Object.values(state.done)) {
    for (const d of list) {
      const n = dayNumber(d)
      perDay.set(n, (perDay.get(n) ?? 0) + 1)
    }
  }
  const days7 = Array.from({ length: 7 }, (_, i) => {
    const n = t - (6 - i)
    return { date: new Date(n * 86_400_000).toISOString().slice(0, 10), count: perDay.get(n) ?? 0 }
  })

  let index = 0
  for (let i = 0; i < HABIT_RANKS.length; i++) if (doneTotal >= HABIT_RANKS[i].at) index = i
  const upcoming = HABIT_RANKS[index + 1]

  return {
    doneTotal,
    days7,
    currentDays,
    bestDays: Math.max(longestRun(days), currentDays),
    rank: { name: HABIT_RANKS[index].name, index },
    next: upcoming ? { name: upcoming.name, remain: upcoming.at - doneTotal } : null,
  }
}
