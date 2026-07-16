/**
 * 경로 지식 DB — 제품의 핵심 자산
 *
 * "이 경로 = 이 의미 = 이 안전도" 매핑. 이게 두꺼울수록:
 *   - 콜드스타트(R2)가 해결된다 (첫 실행부터 똑똑함, 학습 데이터 0이어도)
 *   - LLM 오분류(R1)에 덜 의존한다 (규칙이 확증한 것만 자동 처리)
 *
 * 규칙 순서 = 우선순위. 위에서부터 첫 매치가 이긴다.
 * LOCKED 규칙을 맨 위에 둔다 — 안전이 속도보다 우선.
 *
 * 근거 표기: [R] = 딥리서치로 검증된 사실
 */

import type { Zone, Unknown } from '../types.ts'

export interface PathRule {
  id: string
  /** 경로(소문자, 슬래시 정규화)에 대해 매치 */
  test: RegExp
  zone: Zone
  meaning: string
  reason: string
  unknown?: Unknown
  /**
   * 파일 삭제로 처리하면 안 되고 전용 경로가 필요한 항목.
   * (기획서 M16 팽창 범인 — powercfg / DISM / compact 등)
   */
  specialHandler?: string
}

/* ────────────────────────────────────────────────────────────
   존 C — 절대 건드리지 않는다. AI가 뭐라 해도 삭제 불가.
   ──────────────────────────────────────────────────────────── */
const LOCKED_RULES: PathRule[] = [
  {
    id: 'win.system',
    test: /^[a-z]:\/windows\/(system32|syswow64|boot|fonts|servicing)\//,
    zone: 'LOCKED',
    meaning: 'Windows 핵심 시스템 파일',
    reason: '지우면 부팅이 안 되거나 시스템이 망가집니다.',
  },
  {
    id: 'win.winsxs',
    // [R] 수동 삭제 시 부팅 불능·업데이트 불가. DISM으로만.
    test: /^[a-z]:\/windows\/winsxs\//,
    zone: 'LOCKED',
    meaning: 'Windows 컴포넌트 스토어(WinSxS)',
    reason:
      '표시 크기(15~25GB)는 하드링크 때문에 과장된 것이고, 수동 삭제하면 부팅 불능이 됩니다. DISM 정식 경로로만 줄일 수 있어요.',
    specialHandler: 'dism.startComponentCleanup',
  },
  {
    id: 'win.installer',
    // [R] 고아 .msp가 수백 GB까지 팽창하지만 맹목 삭제는 위험(활성 사용).
    test: /^[a-z]:\/windows\/installer\//,
    zone: 'LOCKED',
    meaning: 'Windows 설치 관리자 캐시',
    reason:
      '고아 패치 파일이 수백 GB까지 쌓이기도 하지만, 설치된 프로그램이 실제로 쓰는 파일이라 그냥 지우면 위험합니다. 격리 후 검증 방식이 필요해요.',
    specialHandler: 'installer.quarantineOrphans',
  },
  {
    id: 'win.pagefile-hiberfil',
    // [R] hiberfil은 RAM의 ~40%. powercfg로만 안전 제거.
    test: /^[a-z]:\/(hiberfil\.sys|pagefile\.sys|swapfile\.sys)$/,
    zone: 'LOCKED',
    meaning: '시스템 예약 파일(최대절전/가상메모리)',
    reason:
      '직접 삭제할 수 없고 해서도 안 됩니다. 최대절전 파일은 powercfg 명령으로만 안전하게 없앨 수 있어요.',
    specialHandler: 'powercfg.hibernateOff',
  },
  {
    id: 'win.programfiles',
    test: /^[a-z]:\/program files( \(x86\))?\//,
    zone: 'LOCKED',
    meaning: '설치된 프로그램',
    reason: '프로그램 본체입니다. 지우려면 정식 제거를 해야 해요.',
  },
  {
    id: 'win.appdata-programs',
    // 사용자 영역에 설치되는 앱(Electron 등). 이 안의 node_modules는
    // '사용자 프로젝트'가 아니라 앱의 일부다 — 지우면 앱이 깨진다.
    // 프로토타입 실측에서 잡은 오탐: AppData\Local의 node_modules 635곳을
    // 사용자 프로젝트로 오인했다.
    test: /\/appdata\/local\/(programs|microsoft\/(teams|onedrive)|discord|slack|jetbrains|programs)\//,
    zone: 'LOCKED',
    meaning: '설치된 프로그램(사용자 영역)',
    reason:
      '사용자 폴더에 설치된 프로그램 본체입니다. 안에 node_modules 같은 게 보여도 앱의 일부라 지우면 프로그램이 깨져요.',
  },
  {
    id: 'dev.vhdx',
    // [R] WSL/Docker 가상디스크는 안에서 지워도 줄어들지 않는다(high-water-mark).
    //     삭제·이동은 환경 파괴. wsl --shutdown 후 compact로만 회수.
    test: /\.vhdx$|\/appdata\/local\/docker\/wsl\//,
    zone: 'LOCKED',
    meaning: 'WSL/Docker 가상 디스크',
    reason:
      '리눅스·Docker 환경이 통째로 들어있는 파일이에요. 옮기거나 지우면 환경이 깨집니다. 안에서 파일을 지워도 이 파일은 저절로 줄지 않아서, 전용 compact 명령으로만 공간을 되찾을 수 있어요.',
    specialHandler: 'vhdx.compact',
  },
  {
    id: 'win.recovery',
    test: /^[a-z]:\/(recovery|\$recycle\.bin|system volume information)\//,
    zone: 'LOCKED',
    meaning: '시스템 복구/휴지통 영역',
    reason: '시스템이 관리하는 영역입니다.',
  },
  {
    id: 'app.settings-file',
    // [R] 오삭제의 실제 피해 벡터는 OS 파일이 아니라 '앱 설정·사용자 데이터'.
    test: /\/(settings|preferences|config|profile|license|credentials)\.(json|xml|ini|plist|db|sqlite|dat)$/,
    zone: 'LOCKED',
    meaning: '앱 설정 파일',
    reason:
      '캐시처럼 보이지만 지우면 프로그램 설정이 날아갑니다. 이런 걸 캐시로 오인해 지운 사고가 실제로 많았어요.',
  },
  {
    id: 'app.userwork-dir',
    // [R] CleanMyMac이 Alfred 워크플로를 날려 사용자가 전부 잃은 사례.
    //     'workflows'가 경로 끝이 아니라 '디렉토리'로 쓰이는 게 실제 형태다.
    //     node_modules 안의 config는 제외 — 거기까지 잠그면 프로젝트 묶음이 흩어진다.
    test: /^(?!.*\/node_modules\/).*\/(workflows?|preferences|snippets|templates)\//,
    zone: 'LOCKED',
    meaning: '사용자가 만든 작업물(워크플로·설정)',
    reason:
      '직접 만드신 워크플로나 설정이 들어있는 폴더예요. 지우면 되돌리기 어려운 작업물이 사라집니다.',
  },
  {
    id: 'cloud.drivefs',
    // [R] Google Drive for desktop 캐시는 %LOCALAPPDATA%\Google\DriveFS.
    //     업로드 완료 전에 지우면 데이터 손실.
    //
    // ★ 프로토타입 실측에서 이 규칙의 부재가 곧바로 사고로 이어졌다:
    //   metadata_sqlite_db 등 26.5GB를 '평범한 큰 파일'로 보고 "옮길까요?"라고
    //   제안했다. 옮겼다면 드라이브 동기화가 통째로 깨졌을 것이다.
    //   경로가 'Google Drive'(공백)가 아니라 'Google\DriveFS'라서 놓쳤다.
    test: /\/google\/drivefs\//,
    zone: 'LOCKED',
    meaning: '구글 드라이브 동기화 데이터베이스·캐시',
    reason:
      '구글 드라이브가 "어떤 파일이 어디 있는지" 기억하는 장부예요. 크다고 지우거나 옮기면 동기화가 깨지고, 아직 업로드 안 된 파일이 사라질 수 있습니다. 캐시 크기는 드라이브 설정에서 제한하는 게 안전해요.',
    specialHandler: 'cloud.driveFsCacheLimit',
  },
  {
    id: 'cloud.sync',
    // [R] OneDrive는 로컬 삭제=클라우드도 삭제(양방향). 공간 확보는 '온라인 전용화'로.
    test: /\/(onedrive|dropbox|google ?drive|googledrive|icloud ?drive)\//,
    zone: 'LOCKED',
    meaning: '클라우드 동기화 폴더',
    reason:
      '여기서 지우면 클라우드에서도 지워집니다. 공간만 비우려면 삭제가 아니라 "온라인 전용으로 전환"을 써야 해요.',
    specialHandler: 'cloud.freeUpSpace',
  },
  {
    id: 'macos.sip',
    test: /^\/(system|usr\/(?!local)|bin|sbin)\//,
    zone: 'LOCKED',
    meaning: 'macOS 보호 시스템 경로(SIP)',
    reason: 'SIP가 보호하는 영역이라 root도 수정할 수 없습니다.',
  },
]

/* ────────────────────────────────────────────────────────────
   존 A — 재생성되고 손실이 없다. 자동 처리 후보.
   보수적으로: '확실히 캐시인 것'만 여기 넣는다.
   ──────────────────────────────────────────────────────────── */
const SAFE_RULES: PathRule[] = [
  {
    id: 'win.temp',
    // [R] AppData\Local\Temp는 상대적으로 안전. 단 Temp 폴더 자체는 유지.
    test: /\/(appdata\/local\/temp|windows\/temp)\//,
    zone: 'SAFE',
    meaning: '임시 파일',
    reason: '프로그램이 잠깐 쓰고 버리는 파일이에요. 지워도 다시 만들어집니다.',
  },
  {
    id: 'app.cache',
    // [R] AppData 안에서는 Cache/Temp/GPUCache 하위만 안전.
    test: /\/(cache|caches|gpucache|code cache|cachestorage)\//,
    zone: 'SAFE',
    meaning: '앱 캐시',
    reason: '인터넷이나 원본에서 다시 받을 수 있는 임시 저장본입니다.',
  },
  {
    id: 'browser.cache',
    test: /\/(chrome|edge|firefox|brave|whale|opera)\/.*\/(cache|code cache|gpucache)/,
    zone: 'SAFE',
    meaning: '브라우저 캐시',
    reason:
      '다시 받을 수 있어요. 다만 지우면 자주 가는 사이트가 처음엔 조금 느리게 열릴 수 있습니다.',
  },
  {
    id: 'thumbnails',
    test: /\/(thumbnails?|thumbcache_\d+\.db|iconcache.*\.db)/,
    zone: 'SAFE',
    meaning: '썸네일 캐시',
    reason: '미리보기 이미지 저장본이에요. 필요하면 자동으로 다시 만들어집니다.',
  },
  {
    id: 'crashdump',
    test: /\.(dmp|mdmp)$|\/(crashdumps?|crashreports?|minidump)\//,
    zone: 'SAFE',
    meaning: '오류 보고 덤프',
    reason: '프로그램이 죽었을 때 남긴 기록이에요. 없어도 아무 문제 없습니다.',
  },
  {
    id: 'logs',
    test: /\.log(\.\d+)?$|\/logs?\//,
    zone: 'SAFE',
    meaning: '로그 파일',
    reason: '프로그램 동작 기록이에요. 문제 진단용이라 지워도 됩니다.',
  },
  {
    id: 'pkg.cache',
    test: /\/(\.npm\/_cacache|\.yarn\/cache|\.pnpm-store|\.cargo\/registry\/cache|\.gradle\/caches|\.m2\/repository|pip\/cache|__pycache__)\//,
    zone: 'SAFE',
    meaning: '패키지 매니저 캐시',
    reason: '다시 받을 수 있는 개발 도구 캐시입니다.',
  },
  {
    id: 'macos.derived',
    test: /\/library\/developer\/xcode\/deriveddata\//,
    zone: 'SAFE',
    meaning: 'Xcode 빌드 산출물',
    reason: '다시 빌드하면 만들어집니다.',
  },
]

/* ────────────────────────────────────────────────────────────
   존 B — 사용자만 아는 것. 각 규칙은 '무엇을 모르는지'를 지정한다.
   이 unknown이 곧 질문의 씨앗이 된다.
   ──────────────────────────────────────────────────────────── */
const AMBIG_RULES: PathRule[] = [
  {
    id: 'dev.node_modules',
    test: /\/node_modules\//,
    zone: 'AMBIG',
    meaning: '개발 의존성 폴더(node_modules)',
    reason: '다시 설치할 수 있지만, 그 프로젝트를 아직 쓰시는지는 제가 알 수 없어요.',
    unknown: 'U2_PROJECT_ACTIVE',
  },
  {
    id: 'dev.build',
    test: /\/(target|build|dist|out|\.next|\.venv|venv)\//,
    zone: 'AMBIG',
    meaning: '빌드 산출물',
    reason: '다시 빌드하면 되지만, 이 프로젝트가 살아있는지는 확인이 필요해요.',
    unknown: 'U2_PROJECT_ACTIVE',
  },
  {
    id: 'downloads.installer',
    test: /\/downloads?\/.*\.(exe|msi|dmg|pkg|deb|rpm)$/,
    zone: 'AMBIG',
    meaning: '다운로드한 설치 파일',
    reason: '프로그램을 이미 설치했다면 설치 파일은 필요 없어요.',
    unknown: 'U3_APP_IN_USE',
  },
  {
    id: 'downloads.media',
    test: /\/(downloads?|다운로드)\/.*\.(mp4|mkv|avi|mov|wmv|flv|webm|zip|rar|7z|iso)$/,
    zone: 'AMBIG',
    meaning: '다운로드한 대용량 파일',
    reason: '중요한 건지, 백업이 있는지는 사용자만 알 수 있어요.',
    unknown: 'U1_BACKED_UP',
  },
  {
    id: 'media.large',
    test: /\.(mp4|mkv|avi|mov|wmv|raw|psd|ai|iso)$/,
    zone: 'AMBIG',
    meaning: '대용량 미디어 파일',
    reason: '지우기 아까울 수 있어요. 다른 곳에 백업이 있는지가 관건입니다.',
    unknown: 'U1_BACKED_UP',
  },
  {
    id: 'docs.old',
    test: /\.(docx?|xlsx?|pptx?|pdf|hwp|txt)$/,
    zone: 'AMBIG',
    meaning: '문서',
    reason: '나중에 다시 볼 자료인지는 사용자만 알 수 있어요.',
    unknown: 'U4_NEED_LATER',
  },
]

export const PATH_RULES: PathRule[] = [
  ...LOCKED_RULES, // 안전이 먼저
  ...SAFE_RULES,
  ...AMBIG_RULES,
]

/**
 * 스캔조차 하지 않고 통째로 건너뛰는 경로.
 * "존 C는 보여주지도 않는다" — 실수의 여지를 원천 차단.
 */
export const SKIP_DIRS: RegExp[] = [
  /^[a-z]:\/windows\//,
  /^[a-z]:\/program files( \(x86\))?\//,
  /^[a-z]:\/\$recycle\.bin/,
  /^[a-z]:\/system volume information/,
  /^\/(system|bin|sbin|private\/var\/db)\//,
]

/** 경로를 규칙 매칭용으로 정규화: 소문자 + 슬래시 통일 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}
