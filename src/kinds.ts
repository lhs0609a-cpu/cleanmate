/**
 * 파일 종류 판별 — "그래서 이게 뭔데?"에 사람 말로 답한다
 *
 * 확장자만 보여주는 건(.js 30개, .png 5개) 개발자 화면이다. 사용자가 알고
 * 싶은 건 "게임 자료인지, 동영상인지, 카톡으로 받은 건지"다.
 *
 * ── 판별 순서 (중요) ──────────────────────────────────────────
 * 1) 경로에 든 '출처'를 먼저 본다. 같은 .mp4라도 OBS 녹화본과 카톡으로 받은
 *    영상은 사용자에게 완전히 다른 물건이다. 확장자보다 출처가 더 많은 걸 말한다.
 * 2) 그다음 확장자로 큰 갈래를 정한다.
 * 3) 둘 다 모르면 '기타'다. 아는 척하지 않는다 — 틀린 이름표는 없는 것보다 나쁘다.
 */

export interface Kind {
  /** 집계 키 */
  key: string
  /** 화면에 그대로 쓰는 이름 */
  label: string
  /** 왜 그렇게 봤는지 — 근거를 숨기지 않는다 */
  why: string
}

const K = (key: string, label: string, why: string): Kind => ({ key, label, why })

/* ── 출처(경로)로 아는 것들 ────────────────────────────────────
   경로 한 조각이 확장자 열 개보다 많은 걸 말해준다. */
const BY_PATH: { test: RegExp; kind: Kind }[] = [
  { test: /[\\/]steamapps?[\\/]|[\\/]steam[\\/]/i,
    kind: K('game-steam', '게임 자료 (Steam)', '경로에 Steam 폴더가 있습니다') },
  { test: /[\\/](epic ?games|riot ?games|battle\.net|nexon|minecraft|\.minecraft|origin games|gog galaxy)[\\/]/i,
    kind: K('game', '게임 자료', '게임 런처·게임 폴더 안에 있습니다') },
  { test: /[\\/]kakaotalk[\\/]|[\\/]카카오톡[\\/]/i,
    kind: K('kakao', '카카오톡으로 받은 파일', '카카오톡 저장 폴더에 있습니다') },
  { test: /[\\/](discord|telegram|whatsapp|line)[\\/]/i,
    kind: K('messenger', '메신저로 받은 파일', '메신저 저장 폴더에 있습니다') },
  { test: /[\\/](zoom|microsoft teams|obs[- ]?studio|bandicam|반디캠)[\\/]|zoom_\d|회의 ?녹화/i,
    kind: K('recording', '회의·화면 녹화본', '녹화 프로그램이 저장한 자리입니다') },
  { test: /[\\/](screenshots?|스크린샷|화면 ?캡처|sharex|picpick)[\\/]/i,
    kind: K('screenshot', '스크린샷', '캡처 저장 폴더에 있습니다') },
  { test: /[\\/](dcim|camera ?roll|카메라 ?롤)[\\/]/i,
    kind: K('camera', '카메라로 찍은 사진·영상', '카메라 저장 폴더에 있습니다') },
  { test: /[\\/]adobe[\\/]|[\\/](premiere|photoshop|illustrator|after ?effects)/i,
    kind: K('adobe', '어도비 작업 파일', '어도비 프로그램 폴더·작업물입니다') },
  { test: /[\\/]node_modules[\\/]|[\\/]\.git[\\/]|[\\/](build|dist|target|\.next|\.venv)[\\/]/i,
    kind: K('dev', '개발 중간 산출물', '개발 도구가 만든 폴더입니다 — 다시 만들 수 있습니다') },
  { test: /[\\/](onedrive|google ?drive|drivefs|dropbox|icloud)[\\/]/i,
    kind: K('cloud', '클라우드 동기화 폴더', '클라우드 폴더 안에 있습니다') },
  { test: /[\\/](cache|caches|gpucache|code ?cache|temp|tmp)[\\/]/i,
    kind: K('cache', '앱이 만든 임시·캐시', '캐시·임시 폴더 안에 있습니다') },
  { test: /[\\/]appdata[\\/]/i,
    kind: K('appdata', '프로그램이 저장한 데이터', 'AppData(프로그램 저장소) 안에 있습니다') },
]

/* ── 확장자로 아는 것들 ──────────────────────────────────────── */
const BY_EXT: { exts: string[]; kind: Kind }[] = [
  { exts: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.flv', '.mpg', '.mpeg', '.ts'],
    kind: K('video', '동영상', '동영상 파일입니다') },
  { exts: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.tif', '.tiff'],
    kind: K('image', '사진·이미지', '이미지 파일입니다') },
  { exts: ['.raw', '.cr2', '.nef', '.arw', '.dng', '.psd', '.ai'],
    kind: K('image-raw', '원본 사진·편집 파일', '카메라 원본이나 편집 원본입니다') },
  { exts: ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.wma'],
    kind: K('audio', '음악·소리', '오디오 파일입니다') },
  { exts: ['.hwp', '.hwpx', '.doc', '.docx', '.odt', '.rtf', '.txt', '.md'],
    kind: K('doc', '문서', '글 문서입니다') },
  { exts: ['.xls', '.xlsx', '.csv', '.ods'], kind: K('sheet', '표·엑셀', '표 문서입니다') },
  { exts: ['.ppt', '.pptx', '.key', '.odp'], kind: K('slide', '발표 자료', '슬라이드 문서입니다') },
  { exts: ['.pdf'], kind: K('pdf', 'PDF 문서', 'PDF입니다') },
  { exts: ['.zip', '.rar', '.7z', '.tar', '.gz', '.alz', '.egg'],
    kind: K('archive', '압축 파일', '압축 파일입니다') },
  { exts: ['.exe', '.msi', '.dmg', '.pkg', '.appx', '.msix'],
    kind: K('installer', '설치 파일', '프로그램 설치용 파일입니다') },
  { exts: ['.iso', '.img', '.vhd', '.vhdx', '.vmdk'],
    kind: K('disk', '디스크 이미지', '디스크·가상머신 이미지입니다') },
  { exts: ['.log', '.dmp', '.mdmp'], kind: K('log', '기록·오류 로그', '프로그램이 남긴 기록입니다') },
  { exts: ['.js', '.ts', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rs', '.json', '.html', '.css'],
    kind: K('code', '코드·설정 파일', '프로그램 소스나 설정입니다') },
  { exts: ['.srt', '.smi', '.ass', '.vtt'], kind: K('subtitle', '자막', '자막 파일입니다') },
  { exts: ['.epub', '.mobi', '.azw3'], kind: K('ebook', '전자책', '전자책 파일입니다') },
  { exts: ['.ttf', '.otf', '.woff', '.woff2'], kind: K('font', '글꼴', '폰트 파일입니다') },
]

const UNKNOWN = K('other', '기타', '무슨 파일인지 저희도 모릅니다')

/**
 * 확장자만 보고 판단한다. 못 알아보면 null.
 *
 * ★ 왜 따로 필요한가: kindOf는 출처(경로)를 먼저 본다. 묶어서 보여줄 때는 그게 맞다
 *   — 같은 .mp4라도 OBS 녹화본과 카톡 영상은 다른 물건이니까.
 *
 *   그런데 파일 하나를 설명할 때는 반대가 된다. owners.ts가 "누구 것인지"를 이미
 *   따로 답하기 때문에, 역할 자리에는 "무슨 파일인지"가 와야 한다. 그걸 안 갈라놨더니
 *   `AppData\MusicFactory\releases\video.mp4`(99MB 동영상)가 화면에
 *   '프로그램이 저장한 데이터'로 떴다 — 경로 규칙이 확장자를 이겨서다.
 */
export function kindByExt(path: string): Kind | null {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : ''
  if (!ext) return null
  for (const r of BY_EXT) if (r.exts.includes(ext)) return r.kind
  return null
}

/** 이 파일이 뭔지 사람 말로. 모르면 '기타' — 아는 척하지 않는다. */
export function kindOf(path: string): Kind {
  for (const r of BY_PATH) if (r.test.test(path)) return r.kind
  return kindByExt(path) ?? UNKNOWN
}

export interface KindGroup {
  key: string
  label: string
  why: string
  count: number
  bytes: number
  /** 지우면 어떤 결과가 오나 */
  impact: KindImpact
}

/** 종류별로 묶는다. 용량 큰 순 — 위에서부터 읽으면 큰 덩어리가 먼저 보인다. */
export function groupByKind(
  items: { path: string; size: number }[],
  top = 6
): KindGroup[] {
  const map = new Map<string, KindGroup>()
  for (const it of items) {
    const k = kindOf(it.path)
    const g = map.get(k.key)
    if (g) { g.count++; g.bytes += it.size }
    else map.set(k.key, { key: k.key, label: k.label, why: k.why, count: 1, bytes: it.size, impact: impactOf(k.key) })
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes).slice(0, top)
}

/**
 * 묶음 전체를 한 문장으로. 질문 위에 붙여서 "이게 뭔지"를 먼저 알려준다.
 * 예: "대부분 동영상이고(78%), 게임 자료도 섞여 있습니다."
 */
export function describeMix(groups: KindGroup[], totalBytes: number): string {
  if (!groups.length) return ''
  const pct = (b: number) => Math.round((b / totalBytes) * 100)
  const first = groups[0]
  const head = `대부분 ${first.label}입니다(${pct(first.bytes)}%)`
  const rest = groups.slice(1, 3).filter((g) => pct(g.bytes) >= 5)
  if (!rest.length) return head + '.'
  return `${head}. ${rest.map((g) => `${g.label} ${pct(g.bytes)}%`).join(' · ')}도 섞여 있습니다.`
}

/* ────────────────────────────────────────────────────────────
   지우면 어떤 결과가 오나 — 종류별 파급 판정

   사용자가 결정을 못 내리는 이유는 단 셋이다:
     "이게 정확히 뭐냐 / 지워도 되냐 / 지우면 뭐가 영향받냐"
   종류를 알면 이 셋에 구체적으로 답할 수 있다. 일반론("주의하세요")은
   답이 아니다 — 무엇이 어떻게 되는지를 말해야 결정이 된다.
   ──────────────────────────────────────────────────────────── */

/** 파급 등급. 색과 문구가 같은 말을 해야 한다. */
export type ImpactLevel = 'none' | 'low' | 'medium' | 'high'

export interface KindImpact {
  level: ImpactLevel
  /** 등급을 사람 말로 */
  levelLabel: string
  /** 다시 생기나 */
  regen: string
  /** 무엇이 영향을 받나 — 구체적으로 */
  affects: string
}

const IMPACT: Record<string, KindImpact> = {
  cache: { level: 'none', levelLabel: '영향 없음', regen: '지우면 앱이 다시 만듭니다',
    affects: '아무 프로그램도 깨지지 않습니다. 해당 앱이 처음 한 번 조금 느려질 수 있어요.' },
  log: { level: 'none', levelLabel: '영향 없음', regen: '필요하면 다시 쌓입니다',
    affects: '문제 진단용 기록이라 지워도 프로그램 동작은 그대로입니다.' },
  appdata: { level: 'medium', levelLabel: '영향 있음', regen: '항목에 따라 다릅니다',
    affects: '프로그램 설정·저장 데이터가 섞여 있습니다. 지우면 그 앱의 설정이 초기화될 수 있어요.' },
  dev: { level: 'low', levelLabel: '영향 작음', regen: '명령 한 줄로 다시 만듭니다',
    affects: '소스 코드는 그대로입니다. 그 프로젝트를 다시 열 때 설치·빌드 시간(보통 몇 분)이 듭니다.' },
  installer: { level: 'low', levelLabel: '영향 작음', regen: '인터넷에서 다시 받으면 됩니다',
    affects: '이미 설치된 프로그램은 아무 영향 없이 그대로 동작합니다.' },
  'game-steam': { level: 'low', levelLabel: '영향 작음', regen: 'Steam에서 다시 내려받습니다',
    affects: '게임은 계속 쓸 수 있지만, 다음에 켤 때 수 GB를 다시 받아야 할 수 있습니다.' },
  game: { level: 'medium', levelLabel: '영향 있음', regen: '게임에 따라 다릅니다',
    affects: '세이브 파일이 섞여 있으면 진행 상황이 사라질 수 있습니다.' },
  screenshot: { level: 'low', levelLabel: '영향 작음', regen: '되살릴 수 없습니다',
    affects: '대개 한 번 쓰고 마는 캡처지만, 남겨둘 것이 섞여 있는지 목록에서 확인하세요.' },
  video: { level: 'high', levelLabel: '되돌릴 수 없음', regen: '되살릴 수 없습니다',
    affects: '★ 백업이 없으면 영영 사라집니다. 직접 만들거나 받은 영상입니다.' },
  image: { level: 'high', levelLabel: '되돌릴 수 없음', regen: '되살릴 수 없습니다',
    affects: '★ 백업이 없으면 영영 사라집니다. 사진은 다시 만들 수 없습니다.' },
  'image-raw': { level: 'high', levelLabel: '되돌릴 수 없음', regen: '되살릴 수 없습니다',
    affects: '★ 카메라 원본·편집 원본입니다. 지우면 재편집이 불가능합니다.' },
  camera: { level: 'high', levelLabel: '되돌릴 수 없음', regen: '되살릴 수 없습니다',
    affects: '★ 직접 찍은 사진·영상입니다. 백업이 없으면 끝입니다.' },
  audio: { level: 'high', levelLabel: '되돌릴 수 없음', regen: '되살릴 수 없습니다',
    affects: '★ 구매·녹음한 것이면 다시 못 구할 수 있습니다.' },
  doc: { level: 'high', levelLabel: '되돌릴 수 없음', regen: '되살릴 수 없습니다',
    affects: '★ 직접 쓴 문서입니다. 계약서·서류가 섞여 있을 수 있으니 목록을 확인하세요.' },
  sheet: { level: 'high', levelLabel: '되돌릴 수 없음', regen: '되살릴 수 없습니다',
    affects: '★ 직접 만든 표입니다. 회계·정산 자료가 섞여 있을 수 있습니다.' },
  slide: { level: 'high', levelLabel: '되돌릴 수 없음', regen: '되살릴 수 없습니다',
    affects: '★ 직접 만든 발표 자료입니다.' },
  pdf: { level: 'medium', levelLabel: '영향 있음', regen: '받은 것이면 다시 받을 수 있습니다',
    affects: '계약서·명세서처럼 다시 못 받는 것이 섞여 있을 수 있습니다.' },
  archive: { level: 'medium', levelLabel: '영향 있음', regen: '출처에 따라 다릅니다',
    affects: '안에 뭐가 들었는지는 열어봐야 압니다. 백업본이 압축돼 있는 경우가 많습니다.' },
  recording: { level: 'high', levelLabel: '되돌릴 수 없음', regen: '되살릴 수 없습니다',
    affects: '★ 회의·강의 녹화본입니다. 다시 녹화할 수 없습니다.' },
  kakao: { level: 'medium', levelLabel: '영향 있음', regen: '대화방에서 다시 받을 수 있습니다',
    affects: '단, 카카오톡은 기간이 지나면 다시 받을 수 없습니다(보통 며칠~2주).' },
  messenger: { level: 'medium', levelLabel: '영향 있음', regen: '대화방에서 다시 받을 수 있습니다',
    affects: '오래된 대화의 파일은 만료돼 다시 못 받을 수 있습니다.' },
  adobe: { level: 'high', levelLabel: '되돌릴 수 없음', regen: '되살릴 수 없습니다',
    affects: '★ 편집 작업 파일입니다. 지우면 그 작업을 다시 못 엽니다.' },
  cloud: { level: 'high', levelLabel: '위험 — 클라우드도 함께', regen: '되살리기 어렵습니다',
    affects: '★ 동기화 폴더입니다. 여기서 지우면 클라우드에서도 지워져 다른 기기에서도 사라집니다.' },
  disk: { level: 'medium', levelLabel: '영향 있음', regen: '다시 받거나 다시 만들어야 합니다',
    affects: '가상머신·설치 이미지입니다. 가상머신 안의 작업물이 통째로 들어 있을 수 있습니다.' },
  code: { level: 'medium', levelLabel: '영향 있음', regen: '직접 쓴 것이면 되살릴 수 없습니다',
    affects: '설정 파일이면 프로그램 동작이 바뀔 수 있고, 직접 쓴 코드면 되살릴 수 없습니다.' },
  subtitle: { level: 'low', levelLabel: '영향 작음', regen: '다시 받을 수 있습니다',
    affects: '영상은 그대로 재생됩니다. 자막만 없어집니다.' },
  ebook: { level: 'medium', levelLabel: '영향 있음', regen: '구매처에서 다시 받을 수 있습니다',
    affects: '구매 이력이 있으면 다시 받을 수 있지만, 직접 만든 것이면 되살릴 수 없습니다.' },
  font: { level: 'low', levelLabel: '영향 작음', regen: '다시 설치하면 됩니다',
    affects: '그 글꼴을 쓰던 문서가 다른 글꼴로 표시될 수 있습니다.' },
  other: { level: 'medium', levelLabel: '모릅니다', regen: '알 수 없습니다',
    affects: '★ 저희도 무슨 파일인지 모릅니다. 확신이 없으면 그대로 두시는 편이 안전합니다.' },
}

/** 그 종류를 지우면 어떤 결과가 오나. 모르는 종류는 '모릅니다'로 답한다. */
export function impactOf(kindKey: string): KindImpact {
  return IMPACT[kindKey] ?? IMPACT.other
}
