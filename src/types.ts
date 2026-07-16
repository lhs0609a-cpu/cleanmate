/**
 * 클린메이트 코어 타입
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

export interface QuestionOption {
  label: string
  /**
   * 답변의 결과. 삭제가 아니라 '재분류'만 한다 —
   * 어떤 답도 즉시 완전삭제를 유발하지 않는다(엔진 안전규칙).
   */
  outcome: 'CANDIDATE' | 'KEEP' | 'REVIEW_ONE_BY_ONE'
  /** 이 선택 시 무슨 일이 일어나는가 (사전 미리보기) */
  preview: string
}
