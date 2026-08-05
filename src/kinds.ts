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

/** 이 파일이 뭔지 사람 말로. 모르면 '기타' — 아는 척하지 않는다. */
export function kindOf(path: string): Kind {
  for (const r of BY_PATH) if (r.test.test(path)) return r.kind

  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : ''
  if (ext) for (const r of BY_EXT) if (r.exts.includes(ext)) return r.kind

  return UNKNOWN
}

export interface KindGroup {
  key: string
  label: string
  why: string
  count: number
  bytes: number
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
    else map.set(k.key, { key: k.key, label: k.label, why: k.why, count: 1, bytes: it.size })
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
