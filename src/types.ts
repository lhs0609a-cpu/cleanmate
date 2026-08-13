/**
 * 테라클린 코어 타입
 *
 * 설계 원칙(기획서 03): 모든 항목은 확신도 기반 3-존 중 하나로 분류된다.
 * 존 A = 알아서 처리 / 존 C = 아예 잠금 / 존 B = 여기서만 사람에게 물어본다.
 */

/** 확신도 존. 이름이 곧 행동을 규정한다. */
export type Zone =
  | 'SAFE'   // 존 A — 재생성됨, 손실 없음. 자동 처리 후보
  | 'AMBIG'  // 존 B — 사용자만 아는 것. 질문 엔진의 유일한 대상
  | 'LOCKED' // 존 C — 시스템/설정/미동기화. AI가 뭐라 해도 삭제 불가

/**
 * 결정적 미지수 — "이 항목이 애매한 건 무엇 하나를 모르기 때문인가?"
 * 대부분의 존 B는 이 소수로 환원된다. 이 목록이 제품의 핵심 자산이다.
 */
export type Unknown =
  | 'U1_BACKED_UP'      // 이거 다른 데 백업돼 있나요?
  | 'U2_PROJECT_ACTIVE' // 이 프로젝트 아직 작업하세요?
  | 'U3_APP_IN_USE'     // 이 프로그램 아직 쓰세요?
  | 'U4_NEED_LATER'     // 이 자료 나중에 또 볼 일 있나요?
  | 'U5_FOLDER_INTENT'  // 이 폴더는 임시 창고인가요, 보관함인가요?
  | 'U6_WHICH_ORIGINAL' // 이 둘 중 어느 게 원본인가요?
  | 'U7_MOVE_OR_DELETE' // 지울까요, 옮길까요?

/** 스캐너가 수집하는 원시 사실. 판단이 섞이지 않는다. */
export interface FileEntry {
  path: string
  size: number
  mtime: Date
  /** 마지막 접근일. macOS는 신뢰도 낮아 보조 신호로만 쓴다. */
  atime: Date
  ext: string
  /** 마지막 수정 이후 경과 일수 — 나이 기반 판단의 1차 신호 */
  ageDays: number
}

/** 분류 결과 — 반드시 '왜'가 따라붙는다(투명성 원칙, 기획서 08). */
export interface Verdict {
  zone: Zone
  /** 사람이 읽을 수 있는 정체. "이게 뭔지" */
  meaning: string
  /** 이 등급인 근거 한 줄. UI에 항상 노출된다. */
  reason: string
  /** 존 B일 때만: 무엇을 모르기에 애매한가 */
  unknown?: Unknown
  /** 규칙 DB가 확증했는가. false면 추론이므로 보수적으로 다룬다. */
  ruleBacked: boolean
}

export interface Classified extends FileEntry {
  verdict: Verdict
}

/** 같은 미지수를 공유하는 항목들의 묶음 = 잠재 질문 하나 */
export interface Cluster {
  unknown: Unknown
  items: Classified[]
  totalBytes: number
  count: number
  /** 레버리지 점수 — 높을수록 좋은 질문 */
  leverage: number
}

/** 사용자에게 실제로 던지는 질문 */
export interface Question {
  unknown: Unknown
  text: string
  options: QuestionOption[]
  /** 이 질문이 걸고 있는 용량·개수 */
  stakeBytes: number
  stakeCount: number
  /** "왜 이 질문을 하는지" 근거 (투명성) */
  rationale: string
}

/**
 * 답변의 결과. 삭제가 아니라 '재분류'만 한다 —
 * 어떤 답도 즉시 완전삭제를 유발하지 않는다(엔진 안전규칙).
 *
 *   CANDIDATE          정리 후보. 격리를 거친다(30일 되돌리기).
 *   MOVE               다른 드라이브로 이동 후보. 지우지 않는다(relocate.ts).
 *   KEEP               그대로 둔다.
 *   REVIEW_ONE_BY_ONE  목록으로 보여주고 하나씩 고르게 한다.
 */
export type Outcome = 'CANDIDATE' | 'MOVE' | 'KEEP' | 'REVIEW_ONE_BY_ONE'

export interface QuestionOption {
  label: string
  outcome: Outcome
  /** 이 선택 시 무슨 일이 일어나는가 (사전 미리보기) */
  preview: string
}

/* ────────────────────────────────────────────────────────────
   설명 레이어 — "마음놓고 지우려면" 필요한 것

   사람이 삭제 전에 실제로 묻는 건 7가지다. 한 줄짜리 reason으로는
   1.5개밖에 못 답한다. 못 답하는 것들이 정확히 사람이 무서워하는 것들이다.
   ──────────────────────────────────────────────────────────── */

/** 되돌리기 난이도. 'none'도 숨기지 않는다 — 정직이 신뢰다. */
export type Recovery =
  | 'auto-regenerates' // 그냥 다시 생김 (캐시·썸네일)
  | 'one-command'      // 명령 한 줄로 원상복구 (hiberfil 등)
  | 'quarantine-30d'   // 격리에서 되돌림 (M11)
  | 'none'             // 되돌릴 수 없음 — 반드시 그렇게 말한다

/**
 * 설명 — 사실은 이 구조가 소유하고, LLM은 '표현'만 다듬는다.
 *
 * 왜 LLM에게 사실을 안 맡기나:
 *   설명은 사용자가 검색해서 검증할 수 있다. 한 번 지어내면 신뢰가 끝난다.
 *   소형 온디바이스 모델은 "빠른 시작이 hiberfil.sys를 쓴다" 같은 걸 모르고,
 *   모르면 지어낸다. 그래서 사실은 DB, 표현만 LLM — engine.ts의 질문 선정과
 *   똑같은 원칙이다.
 *
 * ★ 안전장치: usedBy를 못 쓰는 규칙은 SAFE 자격이 없다.
 *   "뭐가 이걸 쓰는지" 모른다 = "뭐가 깨지는지" 모른다는 뜻이다.
 *   Alfred 워크플로 참사도, DriveFS 26.5GB 오탐도 전부 이걸 몰라서 났다.
 *   설명을 강제하면 엉터리 SAFE 규칙이 구조적으로 못 들어온다.
 */
export interface Explanation {
  /** ① 이게 뭔가요 — 전문용어 없이 */
  what: string
  /** ② 왜 생겼나요 / 왜 이렇게 큰가요 — "내가 뭘 잘못했나?"에 답한다 */
  why: string
  /** ③ ★뭐가 이걸 쓰나요 — 연관. 위험 판단의 근거이자 설명의 핵심 */
  usedBy: string[]
  /** ④⑤ 지우면 뭐가 달라지나요 — 양면 정직. 손해를 반드시 포함한다 */
  ifRemoved: string[]
  /** ⑥ 되돌릴 수 있나요 */
  recovery: Recovery
  recoveryNote: string
  /** ⑦ 안 지우면요 — '안 지운다'는 선택지를 절대 뺏지 않는다 */
  ifKept: string
}

/**
 * 회수 방법. 숨은 공간은 '파일 삭제'가 아니라 '명령 실행'이다.
 * 그래서 격리(M11)가 없어도 안전하게 다룰 수 있다 — 되돌리기가 명령 한 줄이라서.
 */
export interface SystemAction {
  /** 사람 말로: 무슨 일이 일어나는가 */
  describe: string
  command: string
  needsAdmin: boolean
  /** 되돌리는 명령. 이게 없으면 SystemAction으로 만들지 않는다. */
  undo: string
  undoDescribe: string
  /**
   * 엔진이 아는 실행 이름. **화면은 이 이름만 보낼 수 있다.**
   *
   * ★ 왜 command 문자열을 그대로 실행하지 않나: 그러면 화면에서 온 아무 문자열이나
   *   관리자 권한으로 실행하는 통로가 생긴다. command는 사람에게 보여주는 글이고,
   *   실제로 도는 건 엔진 안에 하드코딩된 명령이다(AssistAction과 같은 원칙).
   */
  run?: 'hibernate-off'
  undoRun?: 'hibernate-on'
}

/**
 * 되돌리는 명령이 없어서 SystemAction으로 만들 수 없는 항목의 정식 경로.
 *
 * SystemAction은 undo를 요구한다(위 주석). 그 규칙을 느슨하게 만드는 대신,
 * "우리가 지우는 게 아니라 윈도우의 정식 도구를 대신 띄워준다"는 별도 개념을 둔다.
 *   - 되돌릴 수 없는 것(휴지통 비우기)은 irreversible로 표시하고 UI가 반드시 확인받는다.
 *   - 우리 코드가 그 폴더의 파일을 직접 지우는 경로는 존재하지 않는다.
 */
export interface AssistAction {
  label: string
  /** 엔진이 아는 정식 도구. 임의 명령을 받지 않는다(문자열 실행 통로를 안 만든다). */
  command: 'empty-recycle-bin' | 'open-cleanmgr' | 'open-system-protection' | 'open-virtual-memory'
  irreversible: boolean
  note: string
}

/**
 * 프로브가 찾은 것 — 파일이 아니라 '항목'이다.
 *
 * 왜 FileEntry가 아닌가: hiberfil.sys는 node의 stat()이 EPERM으로 튕겨서
 * 스캐너의 files[]에 애초에 못 들어온다(실측). 숨은 공간은 파일 트리가
 * 아니라 시스템 API로만 보인다 → 스캔과 별개의 경로다. (기획서 17장)
 *
 * 왜 클러스터링을 안 하나: 클러스터링은 '같은 미지수를 공유하는 파일이
 * 수백 개'일 때 필요한 것이다. 숨은 공간은 항목이 5~6개뿐이고
 * 하나하나가 이미 수 GB짜리 고레버리지 질문이다. 묶을 게 없다.
 */
export interface Finding {
  id: string
  /** 사람이 읽는 이름 */
  title: string
  bytes: number
  zone: Zone
  explain: Explanation
  /** 회수 방법. 없으면 = 아직 안전한 경로를 모른다 → 건드리지 않는다. */
  action?: SystemAction
  /** 되돌리기가 없어 SystemAction을 못 만드는 항목의 정식 도구 경로 */
  assist?: AssistAction
}
