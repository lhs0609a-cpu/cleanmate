/**
 * 파일 소유자 판별 — "이거 누구 거고, 지우면 뭐가 깨지나"
 *
 * ── 왜 kinds.ts로 부족했나 ────────────────────────────────────
 * kinds.ts는 "이게 무슨 종류냐"에 답한다(동영상·문서·개발 산출물). 그런데
 * 화면에 `torch_cuda.dll · 개발 중간 산출물 · 1.2GB`라고 떠 있으면 사용자는
 * 아무 결정도 못 한다. 종류를 알아도 **뭐가 깨지는지**를 모르기 때문이다.
 *
 * 사람이 실제로 필요한 건 이 순서다:
 *   ① 이건 어떤 프로그램 것이냐   → "배틀그라운드(게임)의 것입니다"
 *   ② 그 안에서 무슨 역할이냐     → "그래픽 셰이더 캐시입니다"
 *   ③ 지워도 되냐                 → "지워도 됩니다"
 *   ④ 지우면 무슨 일이 생기냐     → "다음에 켤 때 다시 만듭니다"
 *   ⑤ 어디까지 영향을 주냐        → "그 게임 첫 실행만. 세이브는 그대로"
 * 이 다섯이 채워지면 "삭제할까요?"가 강요가 아니라 질문이 된다.
 *
 * ── 설계에서 갈라놓은 두 축 ──────────────────────────────────
 *   프로그램(누가 쓰나)  = 무엇이 깨지는가, 영향 범위
 *   역할(무슨 파일인가)  = 무슨 일이 생기는가, 되돌아오는가
 * 이걸 섞으면 답이 흐려진다. 예를 들어 .venv 안의 torch_cuda.dll에서
 * "PyTorch"는 ②번 답이고, 깨지는 것은 그 dll을 쓰는 **프로젝트**다.
 * 그래서 torch·huggingface 같은 라이브러리는 역할 표에, 게임·브라우저 같은
 * 실행 주체는 프로그램 표에 넣는다.
 *
 * ── 모르면 모른다고 한다 ────────────────────────────────────
 * 프로그램 이름을 지어내면 신뢰가 한 번에 끝난다. 확정하지 못한 이름은
 * `identified: false`로 표시하고 문장이 "…로 보입니다"로 바뀐다.
 */

import { kindOf, kindByExt, impactOf } from './kinds.ts'

/** 지워도 되나 — 세 가지뿐이다. 애매한 등급을 늘리면 아무 뜻도 없어진다. */
export type OwnerVerdict =
  | 'safe' // 지워도 프로그램이 안 깨진다
  | 'ask'  // 그 프로그램을 아직 쓰시는지에 달렸다
  | 'keep' // 두는 게 맞다 — 되돌릴 수 없거나 데이터가 날아간다

export interface Owner {
  /** 누구 것인가. 모르면 빈 문자열 — 지어내지 않는다. */
  program: string
  /** 그게 뭐하는 건지 한 마디: '게임', '개발 프로젝트'. 모르면 빈 문자열 */
  programKind: string
  /** 그 프로그램 안에서 이 파일의 역할 */
  role: string
  /** 왜 그렇게 봤나 — 경로의 어느 조각을 근거로 삼았는지 */
  because: string
  verdict: OwnerVerdict
  /** 등급을 사람 말로 */
  verdictLabel: string
  /** 지우면 무슨 일이 생기나 — 한 문장. '주의하세요'는 답이 아니다 */
  onDelete: string
  /**
   * 영향 범위를 두 칸으로 가른다.
   *
   * ★ 왜 한 덩어리가 아닌가: 처음엔 문장 하나에 다 담았다. 그랬더니 화면이
   *   "프로그램 설정·저장 데이터가 섞여 있습니다. 지우면 그 앱의 설정이 초기화될 수
   *   있어요."처럼 길고, '지우면' 칸과 '영향 범위' 칸에 같은 말이 두 번 실렸다.
   *   사람이 실제로 찾는 건 두 가지다 — **뭐가 깨지나**, 그리고 **뭐가 안전하나**.
   *   갈라놓으면 화면이 ✕/✓ 두 줄로 그릴 수 있고, 눈으로 훑어도 결정이 된다.
   */
  breaks: string[]
  /** 그대로 남는 것. 이게 안심의 근거다 — 없으면 사용자는 최악을 가정한다 */
  intact: string[]
  /** 프로그램을 확정했나. false면 추정이므로 문장이 '…로 보입니다'가 된다 */
  identified: boolean
  /**
   * 낱개로 골라 지우는 게 뜻이 없는 파일이면, 그 사실을 한 문장으로. 아니면 빈 문자열.
   *
   * ★ 왜 필요했나: 목록에서 `torch_cuda.dll 1.2GB` 하나만 체크하면 1.2GB를 아낀 것
   *   같지만, 그 프로젝트는 6GB짜리 .venv를 통째로 지운 것과 **똑같이** 못 쓴다.
   *   회수한 용량은 1/5인데 피해는 같다. 그러면 낱개 선택이 사용자에게 손해다.
   *   이런 묶음은 "하나만 빼면 손해"라고 말해줘야 폴더째 지우든 두든 결정이 된다.
   */
  unit: string
}

const VERDICT_LABEL: Record<OwnerVerdict, string> = {
  safe: '지워도 됩니다',
  ask: '아직 쓰시는지에 달렸습니다',
  keep: '두시는 게 안전합니다',
}

/* ────────────────────────────────────────────────────────────
   ① 프로그램 — 누가 이걸 쓰나 (= 무엇이 깨지나)

   여기 들어오는 건 '실행 주체'다. 게임·브라우저·메신저처럼 사용자가
   이름을 아는 것들. 라이브러리(torch, huggingface)는 여기 넣지 않는다 —
   사용자는 PyTorch를 켜지 않는다.
   ──────────────────────────────────────────────────────────── */

interface ProgramRule {
  test: RegExp
  name: string
  kind: string
  /** 경로의 무엇을 보고 그렇게 판단했나 */
  because: string
}

/** 경로는 소문자·슬래시로 정규화된 상태로 들어온다. */
const PROGRAMS: ProgramRule[] = [
  /* ── 게임 ─────────────────────────────────────────────────
     게임 캐시는 용량이 크고 지워도 대개 안전해서 회수 효율이 가장 좋다.
     동시에 세이브를 잘못 지우면 되돌릴 수 없어서, 이름을 정확히 아는 게 중요하다. */
  { test: /\/(tslgame|pubg)/, name: '배틀그라운드', kind: '게임', because: 'TslGame·PUBG 폴더' },
  { test: /\/league of legends\/|\/leagueoflegends\//, name: '리그 오브 레전드', kind: '게임', because: 'League of Legends 폴더' },
  { test: /\/valorant\//, name: '발로란트', kind: '게임', because: 'VALORANT 폴더' },
  { test: /\/maplestory/, name: '메이플스토리', kind: '게임', because: 'MapleStory 폴더' },
  { test: /\/lostark\/|\/lost ark\//, name: '로스트아크', kind: '게임', because: '로스트아크 폴더' },
  { test: /\/overwatch\//, name: '오버워치', kind: '게임', because: 'Overwatch 폴더' },
  { test: /\/\.?minecraft\//, name: '마인크래프트', kind: '게임', because: '.minecraft 폴더' },
  { test: /\/(genshin ?impact|yuanshen)\//, name: '원신', kind: '게임', because: '원신 폴더' },
  { test: /\/fortnitegame\/|\/fortnite\//, name: '포트나이트', kind: '게임', because: 'Fortnite 폴더' },
  { test: /\/(diablo|starcraft|hearthstone|world of warcraft)/, name: '블리자드 게임', kind: '게임', because: '블리자드 게임 폴더' },
  { test: /\/roblox\//, name: '로블록스', kind: '게임', because: 'Roblox 폴더' },
  { test: /\/(counter-strike|cs2)\//, name: '카운터 스트라이크', kind: '게임', because: 'Counter-Strike 폴더' },
  { test: /\/grand theft auto|\/gta[5v]\//, name: 'GTA', kind: '게임', because: 'GTA 폴더' },
  { test: /\/elden ?ring\//, name: '엘든 링', kind: '게임', because: 'Elden Ring 폴더' },

  /* 게임 런처 — 개별 게임을 못 알아본 경우의 상위 답. 아래쪽에 둔다. */
  { test: /\/nexon\//, name: '넥슨 게임', kind: '게임', because: '넥슨 폴더 안' },
  { test: /\/riot games\//, name: '라이엇 게임', kind: '게임', because: 'Riot Games 폴더 안' },
  { test: /\/battle\.net\/|\/blizzard/, name: '블리자드 게임', kind: '게임', because: '배틀넷 폴더 안' },
  { test: /\/epic ?games\//, name: '에픽게임즈 게임', kind: '게임', because: 'Epic Games 폴더 안' },
  { test: /\/steamapps?\/|\/steam\//, name: 'Steam 게임', kind: '게임', because: 'Steam 폴더 안' },

  /* ── 브라우저 ───────────────────────────────────────────── */
  { test: /\/google\/chrome\//, name: '크롬', kind: '웹 브라우저', because: 'Chrome 폴더 안' },
  { test: /\/microsoft\/edge\//, name: '엣지', kind: '웹 브라우저', because: 'Edge 폴더 안' },
  { test: /\/naver\/(whale|네이버 ?웨일)\//, name: '네이버 웨일', kind: '웹 브라우저', because: 'Whale 폴더 안' },
  { test: /\/mozilla\/firefox\//, name: '파이어폭스', kind: '웹 브라우저', because: 'Firefox 폴더 안' },
  { test: /\/(bravesoftware|opera software|vivaldi)\//, name: '웹 브라우저', kind: '웹 브라우저', because: '브라우저 폴더 안' },

  /* ── 메신저·회의 ───────────────────────────────────────── */
  { test: /\/kakaotalk\/|\/카카오톡\//, name: '카카오톡', kind: '메신저', because: '카카오톡 폴더 안' },
  { test: /\/discord\//, name: '디스코드', kind: '메신저', because: 'Discord 폴더 안' },
  { test: /\/telegram/, name: '텔레그램', kind: '메신저', because: 'Telegram 폴더 안' },
  { test: /\/slack\//, name: '슬랙', kind: '업무용 메신저', because: 'Slack 폴더 안' },
  { test: /\/zoom\//, name: 'Zoom', kind: '화상회의', because: 'Zoom 폴더 안' },
  { test: /\/microsoft ?teams\//, name: 'Teams', kind: '화상회의·업무 메신저', because: 'Teams 폴더 안' },

  /* ── 영상·디자인 ───────────────────────────────────────── */
  { test: /\/(adobe )?premiere/, name: '프리미어 프로', kind: '영상 편집', because: 'Premiere 폴더 안' },
  { test: /\/after ?effects/, name: '애프터 이펙트', kind: '영상 편집', because: 'After Effects 폴더 안' },
  { test: /\/photoshop/, name: '포토샵', kind: '이미지 편집', because: 'Photoshop 폴더 안' },
  { test: /\/(davinci ?resolve|blackmagic)/, name: '다빈치 리졸브', kind: '영상 편집', because: 'DaVinci Resolve 폴더 안' },
  { test: /\/obs[- ]?studio\//, name: 'OBS', kind: '화면 녹화·방송', because: 'OBS 폴더 안' },
  { test: /\/(bandicam|반디캠)\//, name: '반디캠', kind: '화면 녹화', because: '반디캠 폴더 안' },
  { test: /\/capcut\//, name: '캡컷', kind: '영상 편집', because: 'CapCut 폴더 안' },
  { test: /\/adobe\//, name: '어도비 프로그램', kind: '디자인·영상 도구', because: 'Adobe 폴더 안' },
  { test: /\/(unity|unityhub)\//, name: '유니티', kind: '게임 개발 도구', because: 'Unity 폴더 안' },
  { test: /\/unreal ?engine\//, name: '언리얼 엔진', kind: '게임 개발 도구', because: 'Unreal Engine 폴더 안' },
  { test: /\/blender\//, name: '블렌더', kind: '3D 도구', because: 'Blender 폴더 안' },
  { test: /\/figma\//, name: '피그마', kind: '디자인 도구', because: 'Figma 폴더 안' },

  /* ── 개발 도구 ─────────────────────────────────────────── */
  { test: /\/(microsoft vs code|vscode|\/code)\//, name: 'VS Code', kind: '코드 편집기', because: 'VS Code 폴더 안' },
  { test: /\/jetbrains\//, name: 'JetBrains IDE', kind: '개발 도구', because: 'JetBrains 폴더 안' },
  { test: /\/(docker|\.docker)\//, name: 'Docker', kind: '개발 환경 도구', because: 'Docker 폴더 안' },
  { test: /\/android( |-)?(studio|sdk)\/|\/\.android\//, name: '안드로이드 개발 도구', kind: '개발 도구', because: 'Android SDK 폴더 안' },
  { test: /\/visual studio/, name: '비주얼 스튜디오', kind: '개발 도구', because: 'Visual Studio 폴더 안' },
  { test: /\/\.ollama\/|\/ollama\//, name: 'Ollama', kind: 'AI 모델 실행 도구', because: 'Ollama 폴더 안' },
  { test: /\/(stable[- ]diffusion|comfyui|automatic1111)/, name: '이미지 생성 AI 도구', kind: 'AI 도구', because: '이미지 생성 AI 폴더 안' },

  /* ── 마이크로소프트·시스템 ─────────────────────────────── */
  { test: /\/microsoft ?office\/|\/office1[456]\//, name: '오피스(워드·엑셀)', kind: '문서 프로그램', because: 'Office 폴더 안' },
  { test: /\/onedrive\//, name: '원드라이브', kind: '클라우드 동기화', because: 'OneDrive 폴더 안' },
  { test: /\/windows\/softwaredistribution\//, name: '윈도우 업데이트', kind: '윈도우 기능', because: '윈도우 업데이트 저장 폴더' },
  { test: /\/windows\/temp\//, name: '윈도우', kind: '운영체제', because: '윈도우 임시 폴더' },
  { test: /\/nvidia( corporation)?\//, name: '엔비디아 그래픽 드라이버', kind: '드라이버', because: 'NVIDIA 폴더 안' },
]

/**
 * 프로젝트 폴더 이름을 경로에서 직접 읽는다.
 *
 * node_modules·.venv 같은 표시가 있으면 그 **바로 앞 폴더**가 프로젝트다.
 * 이건 추측이 아니라 규칙이다 — 도구들이 항상 프로젝트 뿌리에 만든다.
 * 그래서 표에 없는 이름도 정확히 답할 수 있다: `ACE-Step-1.5\.venv\...`는
 * 'ACE-Step-1.5 프로젝트'다. 사용자가 폴더에 붙인 이름이 곧 가장 좋은 답이다.
 */
const PROJECT_MARKERS = /\/(node_modules|\.venv|venv|\.next|target|dist|build|out|__pycache__|\.gradle|\.tox)\//

function projectOwner(norm: string, raw: string): ProgramRule | null {
  const m = PROJECT_MARKERS.exec(norm)
  if (!m) return null
  // 표시 앞부분의 마지막 폴더 = 프로젝트 뿌리. 원본 경로에서 대소문자를 살려 꺼낸다.
  const segs = raw.replace(/\\/g, '/').slice(0, m.index).split('/').filter(Boolean)
  const name = segs[segs.length - 1]
  if (!name || /^[a-z]:$/i.test(name)) return null
  return {
    test: /(?:)/,
    name,
    kind: '작업 폴더',
    // 근거는 경로 조각으로 짧게: 'ACE-Step-1.5 › .venv'.
    // 문장으로 쓰면 카드 맨 아래 한 줄이 두 줄로 넘쳐서 아무도 안 읽는다.
    because: `${name} › ${m[1]}`,
  }
}

/**
 * AppData 아래 첫 폴더 이름으로 추정한다 — 마지막 수단.
 *
 * 프로그램들은 대개 자기 이름으로 폴더를 만든다. 다만 회사 이름을 쓰거나
 * 코드명을 쓰는 경우도 있어서 **확정이 아니다**. identified:false로 넘긴다.
 */
function appDataOwner(norm: string, raw: string): ProgramRule | null {
  const m = /\/appdata\/(local|locallow|roaming)\/([^/]+)\//.exec(norm)
  if (!m) return null
  // 대소문자를 살려 원본에서 꺼낸다('MusicFactory'를 'musicfactory'로 보여주지 않는다).
  // 위치는 세어서 구한다 — indexOf는 이름이 앞부분과 같으면 엉뚱한 곳을 짚는다.
  const idx = m.index + '/appdata/'.length + m[1].length + 1
  const name = raw.replace(/\\/g, '/').slice(idx, idx + m[2].length)
  if (!name || /^(temp|tmp|cache|packages|microsoft)$/i.test(name)) return null
  return { test: /(?:)/, name, kind: '프로그램', because: `AppData › ${name} (폴더 이름으로 추정)` }
}

/* ────────────────────────────────────────────────────────────
   ② 역할 — 무슨 파일이고, 지우면 어떻게 되나

   문장의 {프로그램} 자리에 ①에서 찾은 이름이 들어간다. 그래서 같은 캐시라도
   "크롬의 캐시" / "배틀그라운드의 캐시"로 읽힌다 — 결정에 필요한 건 그 차이다.
   ──────────────────────────────────────────────────────────── */

interface RoleRule {
  test: RegExp
  role: string
  /** 근거는 짧은 조각으로. 문장으로 쓰면 카드가 글 덩어리가 된다 */
  because: string
  verdict: OwnerVerdict
  /** 한 문장. 두 문장이 되면 아래 breaks/intact와 말이 겹친다 */
  onDelete: string
  breaks: string[]
  intact: string[]
  /** 낱개로 지워도 뜻이 없는 묶음이면 그 사실을 한 문장으로 (Owner.unit) */
  unit?: string
}

/**
 * 라이브러리 내부는 사용자 데이터가 아니다.
 *
 * node_modules 안에는 `config/`가 수백 개 있다. 그걸 '설정 파일'로 보면
 * 프로젝트 하나가 통째로 '두시는 게 안전합니다'로 잠긴다 — 정확히 반대다.
 * paths.ts가 같은 이유로 같은 예외를 두고 있다.
 * → 아래 '저장 파일'·'설정 파일' 규칙의 맨 앞 (?!…)가 그 예외다.
 */
const ROLES: RoleRule[] = [
  /* 사용자 데이터가 먼저다. 캐시로 오인해서 지우는 사고가 실제 피해의 대부분이다. */
  {
    /**
     * 'saved'를 넣으면 안 된다.
     *   언리얼 엔진 게임은 전부 `<게임>\Saved\` 아래에 Config·Logs·**ShaderCache**를
     *   함께 넣는다. 'saved'로 잡으면 배틀그라운드의 셰이더 캐시(지워도 되는 것)가
     *   세이브 파일(절대 못 지우는 것)로 뒤집힌다. 실제로 그렇게 뒤집혔다.
     *   그래서 세이브는 세이브라고 적힌 폴더만 잡는다.
     */
    test: /^(?!.*\/(node_modules|site-packages|\.venv|venv)\/).*\/(save|savegame|savegames|savedgames|savedata|저장|세이브)\//,
    role: '저장 파일(진행 상황)',
    because: '세이브 폴더',
    verdict: 'keep',
    onDelete: '★ {프로그램}의 진행 상황이 사라지고, 되돌릴 수 없습니다.',
    breaks: ['지금까지 한 것 전부', '처음부터 다시'],
    intact: [],
  },
  {
    test: /^(?!.*\/(node_modules|site-packages|\.venv|venv)\/).*\/(settings|preferences|config|프로필)\//,
    role: '설정 파일',
    because: '설정 폴더',
    verdict: 'keep',
    onDelete: '★ {프로그램}의 설정이 처음 상태로 돌아갑니다.',
    breaks: ['로그인·단축키·작업 환경'],
    intact: ['만들어 둔 파일'],
  },

  /* AI 스택 — 파일 하나가 수백 MB~수 GB라 목록 맨 위에 잘 올라온다.
     이 사용자들에게 "개발 중간 산출물"은 답이 아니다. */
  {
    // `@huggingface` — npm 스코프 접두사가 붙은 형태를 놓쳐서 578MB짜리 모델이
    // 'AI 모델 파일'로만 나왔다. 라이브러리가 캐시에 받아둔 것이라는 사실이
    // 빠지면 "다시 받으면 된다"는 답을 못 준다.
    test: /\/@?huggingface\/|\/hub\/models--/,
    role: '인터넷에서 받아둔 AI 학습 파일',
    because: 'AI 학습 파일을 받아두는 자리',
    verdict: 'safe',
    onDelete: '{프로그램이} 그 기능을 다시 쓸 때 인터넷에서 자동으로 받습니다.',
    breaks: ['첫 실행이 느려짐 (수백 MB~수 GB 재다운로드)', '인터넷이 없으면 그 기능 정지'],
    intact: ['직접 만든 파일·설정'],
  },
  {
    test: /(torch_cuda|torch_cpu|cudnn|cublas|cufft|curand|nvrtc|dnnl|onnxruntime|libtorch)/,
    role: 'AI 계산에 쓰는 프로그램 부품',
    because: '그래픽카드로 계산할 때 쓰는 부품',
    verdict: 'ask',
    onDelete: '{프로그램이} 실행되지 않습니다. 인터넷에서 다시 받으면 돌아옵니다 (수 GB·몇 분).',
    breaks: ['{프로그램} 실행'],
    intact: ['직접 쓴 코드·설정', '윈도우와 다른 프로그램'],
    unit: '이 파일 하나만 지워도 {프로그램은} 똑같이 안 돌아갑니다. 아낄 거면 부품 상자(.venv 폴더)째 지우는 편이 이득이에요.',
  },
  {
    test: /\.(onnx|safetensors|gguf|ckpt|pt|pth|tflite)$/,
    role: 'AI 모델 파일',
    because: 'AI 학습 파일 형식',
    verdict: 'ask',
    onDelete: '{프로그램}의 AI 기능이 멈춥니다. 받아온 모델이면 다시 받을 수 있습니다.',
    breaks: ['{프로그램}의 AI 기능', '직접 학습시킨 모델이면 못 되돌림'],
    intact: ['다른 프로그램'],
  },

  /* 개발 산출물 — "다시 만들 수 있다"까지만 말하면 부족하다. 얼마나 걸리는지가 결정을 만든다. */
  {
    test: /\/(\.venv|venv)\/|\/site-packages\//,
    role: '그 폴더 전용 부품 (.venv 상자 안)',
    because: '전용 부품 상자(.venv) 안',
    verdict: 'ask',
    onDelete: '{프로그램이} 실행되지 않습니다. 부품 상자를 다시 채우면 돌아옵니다 (몇 분).',
    breaks: ['{프로그램} 실행'],
    intact: ['직접 쓴 원본', '다른 폴더의 부품 상자'],
    unit: '부품 상자는 한 덩어리예요. 부품 몇 개만 골라 지우면 용량은 조금 줄고 그 폴더는 그대로 못 씁니다.',
  },
  {
    test: /\/node_modules\//,
    role: '받아둔 프로그램 부품 (node_modules 폴더)',
    because: '부품 폴더(node_modules) 안',
    verdict: 'ask',
    onDelete: '{프로그램을} 다시 열 때 부품을 자동으로 다시 받습니다 (1~3분).',
    breaks: ['다시 시작할 때 1~3분'],
    intact: ['직접 쓴 원본·설정'],
    unit: '부품 폴더도 한 덩어리예요. 일부만 지우면 어차피 전부 다시 받아야 합니다.',
  },
  {
    test: /\/(dist|build|out|target|\.next|__pycache__)\//,
    role: '만들어 낸 완성본',
    because: '완성본이 쌓이는 폴더',
    verdict: 'ask',
    onDelete: '원본이 남아 있어서 다시 만들면 그대로 나옵니다.',
    breaks: ['다시 만드는 시간'],
    intact: ['직접 쓴 원본', '이미 내보낸 것'],
  },
  {
    test: /\.npm\/_cacache|\/pip\/cache|\.gradle\/caches|\.m2\/repository|\.cargo\/registry|\.pnpm-store|\.yarn\/cache/,
    role: '설치 파일 보관함',
    because: '한 번 받은 설치 파일을 모아두는 자리',
    verdict: 'safe',
    onDelete: '다음에 설치할 때 인터넷에서 다시 받습니다.',
    breaks: ['다음 설치가 조금 느려짐'],
    intact: ['지금 돌아가는 프로젝트'],
  },

  /* 게임 — 캐시와 본체를 구분해야 한다. 둘의 결과가 완전히 다르다. */
  {
    test: /shader ?cache|\/dxcache\/|d3dscache|glcache|\/nv_cache\//,
    role: '게임이 미리 그려둔 화면 밑그림',
    because: '밑그림 저장 폴더',
    verdict: 'safe',
    onDelete: '{프로그램을} 다음에 켤 때 다시 만듭니다.',
    breaks: ['첫 실행 몇 분간 살짝 끊김'],
    intact: ['세이브·설정·진행 상황'],
  },
  {
    test: /\.(pak|ucas|utoc|vpk|bsa|bnk|sga)$/,
    role: '게임 본체 데이터',
    because: '게임 데이터 묶음 파일',
    verdict: 'ask',
    onDelete: '{프로그램이} 실행되지 않고, 게임 실행 프로그램이 빠진 걸 알아채 다시 받습니다 (수 GB).',
    breaks: ['{프로그램} 실행', '다시 받는 시간·데이터'],
    intact: ['세이브·설정'],
    unit: '하나만 지워도 게임이 빠진 파일을 전부 다시 받습니다. 정말 안 하실 게임이면 게임 목록에서 지우는 편이 깨끗해요.',
  },

  /* 흔한 부산물 — 이 아래는 "지워도 된다"가 정말 맞는 것들 */
  {
    test: /\/(cache|caches|gpucache|code cache|cachestorage|cache_data)\//,
    role: '임시 저장본',
    because: '임시 저장 폴더',
    verdict: 'safe',
    onDelete: '{프로그램이} 필요할 때 다시 만듭니다.',
    breaks: ['첫 실행이 조금 느려짐'],
    intact: ['로그인 상태·설정·만든 파일'],
  },
  {
    test: /\.log(\.\d+)?$|\/logs?\//,
    role: '동작 기록',
    because: '기록 파일',
    verdict: 'safe',
    onDelete: '{프로그램은} 그대로 동작합니다.',
    breaks: ['지난 오류를 추적하기 어려워짐'],
    intact: ['프로그램 동작 전부'],
  },
  {
    test: /\.(dmp|mdmp)$|\/(crashdumps?|crashreports?|minidump)\//,
    role: '멈췄을 때 남은 오류 기록',
    because: '프로그램이 갑자기 멈췄을 때의 기록',
    verdict: 'safe',
    onDelete: '{프로그램에} 아무 변화가 없습니다.',
    breaks: [],
    intact: ['전부 — 이미 지나간 오류의 기록입니다'],
  },
  {
    test: /thumbcache|iconcache|\/thumbnails?\//,
    role: '미리보기 그림 저장본',
    because: '작은 미리보기 그림 파일',
    verdict: 'safe',
    onDelete: '폴더를 열 때 미리보기를 다시 만듭니다.',
    breaks: ['미리보기가 처음 한 번 늦게 뜸'],
    intact: ['사진·영상 원본'],
  },
  {
    test: /\/(temp|tmp)\//,
    role: '임시 파일',
    because: '임시 폴더',
    verdict: 'safe',
    onDelete: '{프로그램이} 잠깐 쓰고 버리는 자리입니다.',
    breaks: ['설치·저장이 진행 중이라면 그 작업'],
    intact: ['그 밖의 전부'],
  },
  {
    test: /\/(update|updates|updater|pending|packages)\/.*\.(exe|msi|zip|nupkg|appx)$/,
    role: '내려받아 둔 업데이트 설치 파일',
    because: '업데이트 폴더의 설치 파일',
    verdict: 'safe',
    onDelete: '{프로그램은} 이미 업데이트를 마쳤으니 그대로 동작합니다.',
    breaks: ['다음 업데이트를 다시 받아야 함'],
    intact: ['설치된 프로그램'],
  },
]

/* ────────────────────────────────────────────────────────────
   조사 — 이름을 넣으면 문장이 틀어진다

   템플릿에 "{프로그램}을 다음에 켤 때"라고 적어두면 화면에는
   "배틀그라운드을 다음에 켤 때"가 뜬다. "ACE-Step-1.5이 실행되지 않습니다"도
   같은 사고다. 문장 하나가 어색하면 나머지 설명의 신뢰도까지 같이 떨어진다 —
   맞는 말을 하고 있어도 기계가 지어낸 것처럼 읽힌다.

   그래서 이름을 넣을 때 조사를 다시 고른다. 템플릿은 대표형 하나만 적고
   (…을 / …이 / …은), 받침에 따라 여기서 …를 / …가 / …는으로 바꾼다.
   ──────────────────────────────────────────────────────────── */

/**
 * 조사 짝 — [받침 있을 때, 없을 때]
 * 양쪽을 다 적어두면 템플릿이 어느 형태로 적혀 있어도 맞게 나온다.
 * 한쪽만 두면 "…를"로 적힌 템플릿이 받침 있는 이름에서 그대로 새어나간다.
 */
const JOSA: Record<string, [string, string]> = {
  이: ['이', '가'], 가: ['이', '가'],
  을: ['을', '를'], 를: ['을', '를'],
  은: ['은', '는'], 는: ['은', '는'],
  과: ['과', '와'], 와: ['과', '와'],
}

/**
 * 이름 끝에 받침이 있나.
 *
 * 한글은 계산으로 나온다(유니코드에 받침이 들어 있다). 숫자는 읽는 소리를
 * 따른다(1 일·3 삼·6 육 → 받침 있음 / 2 이·4 사·5 오 → 없음).
 *
 * 알파벳은 정답이 없다. 'Excel'은 '엑셀'(받침 있음)이지만 'Docker'는
 * '알'이 아니라 '도커'(받침 없음)로 읽힌다 — 낱자로 읽는 약어와 낱말로 읽는
 * 이름이 섞여 있어서 규칙 하나로는 다 맞출 수 없다. 프로그램 이름은 낱말인
 * 경우가 압도적으로 많으니 낱말 읽기를 기본으로 두고, 낱자로 읽어도 받침이
 * 남는 글자(l·m·n·s·x·z)만 받침으로 센다. r은 '-er/-or'로 끝나는 이름
 * (Docker·Player·Explorer)이 훨씬 흔해서 받침 없음으로 둔다.
 *
 * 끝의 묵음 e는 빼고 센다. 'cthumb-sample'은 '샘플레'가 아니라 '샘플'이고,
 * 'Chrome'은 '크롬'이다 — e를 그대로 세면 둘 다 받침 없음으로 잘못 나온다.
 * 실제로 "cthumb-sample가"가 화면에 떴다.
 */
function hasFinalConsonant(name: string): boolean {
  let s = name.trim()
  // 자음 뒤의 끝 e는 소리가 안 난다: sample→샘플(ㄹ), Chrome→크롬(ㅁ), Code→코드(없음)
  if (/[bcdfglmnprstvz]e$/i.test(s)) s = s.slice(0, -1)

  const last = s.slice(-1)
  const c = last.charCodeAt(0)
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0
  if (/[0-9]/.test(last)) return '013678'.includes(last)
  // 묵음 e 앞의 c는 /s/로 읽힌다: Ace→에이스(ㅅ), Space→스페이스(ㅅ)
  if (/[a-z]/i.test(last)) return (s !== name.trim() ? 'clmnsxz' : 'lmnsxz').includes(last.toLowerCase())
  return false // 기호·괄호로 끝나면 판단 근거가 없다. 덜 어색한 쪽으로.
}

/**
 * {프로그램} 자리에 이름을 넣고, 붙어 있는 조사를 이름에 맞게 고친다.
 *
 * 조사를 중괄호 안에 쓴 것(`{프로그램을}`)과 밖에 쓴 것(`{프로그램}을`)을 둘 다 받는다.
 * 한쪽만 받으면 다른 쪽이 조용히 치환되지 않고 화면에 중괄호가 그대로 뜬다 —
 * 실제로 그렇게 새어나갔다(테스트가 잡았다).
 * `{프로그램}의`·`{프로그램}에`처럼 안 변하는 조사는 건드리지 않는다.
 */
const PLACEHOLDER = /\{프로그램([이가을를은는과와])?\}([이가을를은는과와])?/g

function fill(t: string, who: string): string {
  const i = hasFinalConsonant(who) ? 0 : 1
  return t.replace(PLACEHOLDER, (_, inside?: string, outside?: string) => {
    const josa = inside ?? outside
    return who + (josa ? JOSA[josa][i] : '')
  })
}

/**
 * 이 파일은 누구 것이고, 지우면 무슨 일이 생기나.
 *
 * 역할을 못 알아본 파일은 kinds.ts로 넘긴다 — 사진·문서·동영상의 답은
 * 이미 거기 있다. 같은 지식을 두 곳에 적으면 반드시 갈라진다.
 */
export function ownerOf(path: string): Owner {
  const norm = path.replace(/\\/g, '/').toLowerCase()

  const known = PROGRAMS.find((r) => r.test.test(norm))
  const project = known ? null : projectOwner(norm, path)
  const prog = known ?? project ?? appDataOwner(norm, path)

  // 확정으로 볼 수 있는 건 둘이다: 표에 있는 프로그램, 그리고 경로에서 그대로
  // 읽어낸 프로젝트 폴더 이름. AppData 폴더 이름은 추정이다 — 회사명이나
  // 코드명을 쓰는 프로그램이 흔하다.
  const identified = !!known || !!project
  const program = prog?.name ?? ''
  const who = program || '이 파일을 쓰는 프로그램'

  const role = ROLES.find((r) => r.test.test(norm))
  if (role) {
    return {
      program,
      programKind: prog?.kind ?? '',
      role: role.role,
      // 근거는 둘 다 말한다: 누구 것인지 본 이유 + 무슨 파일인지 본 이유
      because: prog ? `${prog.because} · ${role.because}` : role.because,
      verdict: role.verdict,
      verdictLabel: VERDICT_LABEL[role.verdict],
      onDelete: fill(role.onDelete, who),
      breaks: role.breaks.map((a) => fill(a, who)),
      intact: role.intact.map((a) => fill(a, who)),
      identified,
      unit: role.unit ? fill(role.unit, who) : '',
    }
  }

  /* 역할을 모를 때 — 종류 지식으로 답한다. 아는 척은 하지 않는다.
   *
   * ★ 확장자를 먼저 본다. kindOf는 출처(경로)를 우선하는데, 여기서는 "누구 것인지"를
   *   위에서 이미 답했으므로 역할 자리에는 "무슨 파일인지"가 와야 한다. 안 갈랐더니
   *   `AppData\MusicFactory\releases\video.mp4`(99MB)가 '프로그램이 저장한 데이터'로
   *   떴다 — 동영상이라고 말해줘야 사용자가 판단할 수 있다. */
  const k = kindByExt(path) ?? kindOf(path)
  const im = impactOf(k.key)
  const verdict: OwnerVerdict =
    im.level === 'none' ? 'safe' : im.level === 'low' ? 'ask' : 'keep'
  return {
    program,
    programKind: prog?.kind ?? '',
    role: k.label,
    because: prog ? `${prog.because} · ${k.why}` : k.why,
    verdict,
    verdictLabel: VERDICT_LABEL[verdict],
    // ★ 같은 문장을 두 칸에 넣지 않는다. 전에는 onDelete와 affects가 둘 다
    //   im.affects였고, 화면에 똑같은 줄이 '지우면'·'영향 범위'로 두 번 떴다.
    onDelete: im.affects,
    breaks: [],
    intact: im.level === 'none' ? ['프로그램 동작 전부'] : [],
    identified,
    unit: '',
  }
}

/**
 * 한 줄 정체 — 목록에서 파일 이름 바로 밑에 붙는 문장.
 *
 * 확정한 것과 추정한 것의 말투를 반드시 다르게 한다. 추정을 확정처럼 쓰면
 * 한 번 틀렸을 때 나머지 전부가 의심받는다.
 */
export function ownerHeadline(o: Owner): string {
  if (!o.program) return `${o.role} — 어떤 프로그램 것인지는 확실하지 않습니다`
  const who = `${o.program}${o.programKind ? `(${o.programKind})` : ''}`
  return o.identified ? `${who}의 ${o.role}` : `${who}의 ${ro(o.role)} 보입니다`
}

/**
 * '…로' / '…으로'를 고른다. 받침이 없으면 '로', ㄹ 받침도 '로'다
 * ('파일로'가 맞고 '파일으로'는 틀리다). 그 밖의 받침은 '으로'.
 * 실제로 "동영상로 보입니다"가 화면에 떴다.
 */
function ro(word: string): string {
  const last = word.trim().slice(-1)
  const c = last.charCodeAt(0)
  const rieul = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 === 8
  return word + (!hasFinalConsonant(word) || rieul ? '로' : '으로')
}
