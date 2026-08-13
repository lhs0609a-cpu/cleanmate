/**
 * 고레버리지 질문 엔진 — 제품의 심장
 *
 * 핵심 통찰: 파일이 애매한 건 무작위가 아니다. 대개 '딱 하나의 모르는 사실'
 * 때문이고, 같은 미지수를 공유하는 파일이 수백 개다.
 * → 미지수로 묶고, 가장 많이 해결하는 것부터 물어본다.
 *
 * 핵심 기술 결정(기획서 04):
 *   질문 '선정'은 여기서 로컬·결정론적으로 계산한다 → 재현 가능하고,
 *   "왜 이 질문인지" 설명할 수 있고, 네트워크가 필요 없다.
 *   LLM은 나중에 질문 '표현'(문구 다듬기)에만 쓴다. 선정 권한은 주지 않는다.
 */

import type { Classified, Cluster, Question, Unknown, Outcome } from './types.ts'

/** 질문 상한 — 넘기면 피로 → 만족도 급락 */
const MAX_QUESTIONS = 4
/** 이 정도도 안 되는 묶음은 물어볼 가치가 없다 */
const MIN_CLUSTER_BYTES = 100 * 1024 * 1024 // 100MB

const GB = 1024 ** 3

export function fmtBytes(n: number): string {
  if (n >= GB) return (n / GB).toFixed(1) + 'GB'
  if (n >= 1024 ** 2) return Math.round(n / 1024 ** 2) + 'MB'
  return Math.round(n / 1024) + 'KB'
}

/* ── 미지수별 질문 템플릿 ────────────────────────────────────
   '답변 용이성'과 '정보이득'은 미지수의 성질에서 나온다.
   예/아니오로 딱 갈리는 질문이 정보이득이 높다.            */
interface UnknownSpec {
  /** 답이 애매함을 얼마나 확실히 가르는가 (0~1) */
  infoGain: number
  /** 사용자가 얼마나 쉽게 답하는가 (0~1) */
  ease: number
  question: (bytes: string, count: number) => string
  rationale: string
  yesLabel: string
  yesPreview: (bytes: string, count: number) => string
  noLabel: string
  /**
   * 첫 번째 선택지가 실제로 뜻하는 결과. 기본은 CANDIDATE(정리 후보).
   *
   * ★ 이걸 명시할 수 있어야 하는 이유: 첫 선택지를 무조건 CANDIDATE로 박아두면,
   *   라벨이 "옮길래요"·"확인할게요"처럼 정리와 반대인 질문에서 사용자 의도가
   *   뒤집힌다. 실제로 U7에서 "옮길래요"(= 지우지 말고 이동)가 삭제 후보로,
   *   "지워도 돼요"가 보존으로 매핑돼 있었다. 삭제 도구에서 이런 반전은
   *   그냥 버그가 아니라 사고다.
   */
  yesOutcome?: Outcome
  /**
   * 이 질문에만 있는 추가 선택지. 예/아니오로 안 갈리는 질문이 있다 —
   * "지울까요?"에 대한 답이 "지우기 싫은데 옮기고는 싶다"일 수 있다.
   */
  extraOption?: {
    label: string
    outcome: Outcome
    preview: (bytes: string, count: number) => string
  }
}

const SPECS: Record<Unknown, UnknownSpec> = {
  U1_BACKED_UP: {
    infoGain: 0.95, // 백업 여부는 이분법적으로 확실히 가른다
    ease: 0.9,
    question: (b, c) => `대용량 파일 ${c}개(${b})를 찾았어요. 이런 영상·자료를 다른 곳(외장하드나 클라우드)에도 백업해두시나요?`,
    rationale: '백업이 있는지는 저희가 알 수 없고, 사용자만 아는 사실이라 여쭤봅니다.',
    yesLabel: '네, 백업해둬요',
    yesPreview: (b, c) => `${c}개(${b})를 삭제 후보로 옮깁니다. 바로 지우지 않고 목록을 먼저 보여드려요.`,
    noLabel: '아니요',
  },
  U2_PROJECT_ACTIVE: {
    infoGain: 0.9,
    ease: 0.85,
    question: (b, c) => `개발 폴더 ${c}곳(${b})이 오래 조용하네요. 이 프로젝트들 아직 작업하시나요?`,
    rationale: '지워도 다시 설치·빌드할 수 있지만, 지금 쓰는 프로젝트인지는 사용자만 압니다.',
    yesLabel: '아니요, 안 써요',
    yesPreview: (b, c) => `${c}곳(${b})을 삭제 후보로. 나중에 필요하면 다시 설치하면 됩니다.`,
    noLabel: '아직 써요',
  },
  U3_APP_IN_USE: {
    infoGain: 0.85,
    ease: 0.95,
    question: (b, c) => `설치 파일 ${c}개(${b})가 있어요. 프로그램을 이미 설치했다면 이 설치 파일들은 필요 없는데, 지울까요?`,
    rationale: '설치가 끝났으면 설치 파일은 역할이 끝납니다. 다시 받을 수도 있고요.',
    yesLabel: '네, 지워도 돼요',
    yesPreview: (b, c) => `설치 파일 ${c}개(${b})를 삭제 후보로.`,
    noLabel: '보관할래요',
  },
  U4_NEED_LATER: {
    infoGain: 0.6, // "나중에 볼 일"은 답해도 여전히 애매할 수 있다
    ease: 0.7,
    question: (b, c) => `오랫동안 열지 않은 자료 ${c}개(${b})가 있어요. 이런 오래된 자료, 나중에 다시 볼 일이 있으신가요?`,
    rationale: '오래 안 열렸다는 것만으로는 중요도를 알 수 없어서 여쭤봅니다.',
    yesLabel: '아니요, 안 볼 것 같아요',
    yesPreview: (b, c) => `${c}개(${b})를 검토 목록으로. 하나씩 확인하고 결정하실 수 있어요.`,
    noLabel: '볼 수도 있어요',
  },
  U5_FOLDER_INTENT: {
    infoGain: 0.8,
    ease: 0.8,
    question: (b, c) => `다운로드·바탕화면에 오래된 파일 ${c}개(${b})가 쌓여 있어요. 이 폴더들은 잠깐 거쳐가는 임시 창고인가요, 아니면 보관함인가요?`,
    rationale: '폴더의 용도를 알면 그 안의 파일 전체를 한 번에 판단할 수 있습니다.',
    yesLabel: '임시 창고예요',
    yesPreview: (b, c) => `오래된 ${c}개(${b})를 삭제 후보로. 최근 것은 건드리지 않아요.`,
    noLabel: '보관함이에요',
  },
  U6_WHICH_ORIGINAL: {
    infoGain: 0.9,
    ease: 0.5, // 하나씩 봐야 해서 답하기 번거롭다
    question: (b, c) => `같은 내용으로 보이는 파일 ${c}개(${b})가 있는데, 어느 게 원본인지 확실하지 않아요. 확인해주시겠어요?`,
    rationale: '자동 판단에 실패한 중복이라 원본을 잘못 지울 위험이 있습니다.',
    yesLabel: '확인할게요',
    // '확인할게요'는 정리 동의가 아니라 '하나씩 보겠다'는 뜻이다.
    yesOutcome: 'REVIEW_ONE_BY_ONE',
    yesPreview: (b, c) => `${c}개를 하나씩 비교해서 보여드려요.`,
    noLabel: '나중에',
  },
  U7_MOVE_OR_DELETE: {
    infoGain: 0.85,
    ease: 0.85,
    question: (b, c) =>
      `아주 큰 파일 ${c}개(${b})가 있어요. 지우기는 아까운데 — 지울까요, 다른 드라이브로 옮길까요?`,
    rationale: '용량은 크지만 필요할 수 있어서, 지우기 전에 옮기는 선택지를 함께 드립니다.',
    // 정리에 동의하는 쪽을 첫 선택지로 둔다. 반대로 두면 "옮길래요"(= 지우지 말 것)가
    // 삭제 후보가 된다 — 실제로 그렇게 돼 있었다.
    yesLabel: '네, 지워도 돼요',
    yesPreview: (b, c) => `${c}개(${b})를 삭제 후보로. 바로 지우지 않고 목록을 먼저 보여드려요.`,
    noLabel: '아니요, 그대로 둘래요',
    extraOption: {
      label: '다른 드라이브로 옮길래요',
      outcome: 'MOVE',
      preview: (b, c) => `${c}개(${b})를 이동 후보로. 지우지 않고 옮길 드라이브를 고르실 수 있어요.`,
    },
  },
}

/** 존 B를 결정적 미지수별로 묶는다 */
export function cluster(ambig: Classified[]): Cluster[] {
  const buckets = new Map<Unknown, Classified[]>()

  for (const item of ambig) {
    const u = item.verdict.unknown
    if (!u) continue
    const arr = buckets.get(u)
    if (arr) arr.push(item)
    else buckets.set(u, [item])
  }

  const clusters: Cluster[] = []
  for (const [unknown, items] of buckets) {
    const totalBytes = items.reduce((s, i) => s + i.size, 0)
    clusters.push({
      unknown,
      items,
      totalBytes,
      count: items.length,
      leverage: leverageScore(unknown, totalBytes, items.length),
    })
  }
  return clusters.sort((a, b) => b.leverage - a.leverage)
}

/**
 * 레버리지 점수 = 이 질문 하나가 얼마나 많이 해결하는가
 *
 *   (용량 + 개수) × 정보이득 × 답변용이성
 *
 * 용량에 log를 씌우는 이유: 40GB짜리 질문이 4GB짜리보다 10배 중요하진 않다.
 * 개수도 함께 보는 이유: 용량은 작아도 파일이 많으면 정리 체감이 크다.
 */
export function leverageScore(unknown: Unknown, bytes: number, count: number): number {
  const spec = SPECS[unknown]
  const byteScore = Math.log10(1 + bytes / (1024 ** 2)) // MB 기준 로그
  const countScore = Math.log10(1 + count) * 0.5
  return (byteScore + countScore) * spec.infoGain * spec.ease
}

/**
 * 상위 클러스터를 질문으로 변환.
 *
 * 안전 규칙: 어떤 답도 즉시 삭제를 유발하지 않는다. 재분류만 한다.
 * '아니오/모르겠음'은 항상 보존(KEEP) 쪽으로 안전하게 폴백한다.
 */
export function buildQuestions(clusters: Cluster[]): Question[] {
  return clusters
    .filter((c) => c.totalBytes >= MIN_CLUSTER_BYTES)
    .slice(0, MAX_QUESTIONS)
    .map((c) => {
      const spec = SPECS[c.unknown]
      const b = fmtBytes(c.totalBytes)
      return {
        unknown: c.unknown,
        text: spec.question(b, c.count),
        rationale: spec.rationale,
        stakeBytes: c.totalBytes,
        stakeCount: c.count,
        options: [
          {
            label: spec.yesLabel,
            outcome: spec.yesOutcome ?? 'CANDIDATE',
            preview: spec.yesPreview(b, c.count),
          },
          // 질문별 추가 선택지 (예: "옮길래요"). 보존 선택지보다 앞에 둔다 —
          // 뭔가 해주는 선택지끼리 붙어 있어야 읽기 쉽다.
          ...(spec.extraOption
            ? [
                {
                  label: spec.extraOption.label,
                  outcome: spec.extraOption.outcome,
                  preview: spec.extraOption.preview(b, c.count),
                },
              ]
            : []),
          {
            label: spec.noLabel,
            outcome: 'KEEP' as const,
            preview: '그대로 두겠습니다. 아무것도 건드리지 않아요.',
          },
          // 첫 선택지가 이미 '하나씩 보기'면 같은 선택지를 두 번 주지 않는다.
          ...(spec.yesOutcome === 'REVIEW_ONE_BY_ONE'
            ? []
            : [
                {
                  label: '하나씩 볼게요',
                  outcome: 'REVIEW_ONE_BY_ONE' as const,
                  /**
                   * ★ "145,401개를 목록으로 보여드릴게요"라고 적어놓고 실제로는 큰 것부터
                   *   40개만 폈다(engine-cli의 buildBreakdown(mine, 40)). 지키지도 못할
                   *   약속이었다 — 14만 줄은 사람이 훑을 수 있는 목록이 아니고, 그릴 수도 없다.
                   *   할 수 있는 말로 바꾼다. 못 지킬 약속은 기능이 아니라 거짓말이다.
                   */
                  preview: `${c.count}개 중 큰 것부터 목록으로 보여드릴게요. 고른 것만 정리합니다.`,
                },
              ]),
        ],
      }
    })
}

/* ────────────────────────────────────────────────────────────
   답변 → 행동

   질문 엔진의 마지막 조각이다. 여태 답을 받아도 화면에 문구만 뜨고
   아무 일도 안 일어났다 — 존 B가 통째로 정리 경로 없이 남아 있었다.

   ★ 매핑을 순수 함수로 뺀 이유: 여기가 틀리면 "그대로 두세요"라고 답한
     파일이 격리된다. 되돌릴 수는 있지만, 사용자 의도와 반대로 움직인
     도구를 다시 믿기는 어렵다. (실제로 U7에서 선택지 순서 때문에
     의도가 뒤집힌 적이 있다 — SPECS의 yesOutcome 주석 참고)
   ──────────────────────────────────────────────────────────── */

/** 답 하나가 실제로 무엇을 하는가 */
export type AnswerAction =
  | 'quarantine' // 격리로 옮긴다(30일 되돌리기)
  | 'move'       // 다른 드라이브로 옮긴다 — 대상 드라이브를 물어야 한다
  | 'keep'       // 아무것도 안 한다
  | 'review'     // 목록으로 보여주고 하나씩 고르게 한다

export function actionFor(outcome: Outcome): AnswerAction {
  switch (outcome) {
    case 'CANDIDATE': return 'quarantine'
    case 'MOVE': return 'move'
    case 'REVIEW_ONE_BY_ONE': return 'review'
    case 'KEEP': return 'keep'
  }
}

/** 파일을 실제로 건드리는 답인가. UI가 확인을 받아야 할지 판단하는 데 쓴다. */
export function touchesFiles(outcome: Outcome): boolean {
  const a = actionFor(outcome)
  return a === 'quarantine' || a === 'move'
}

export interface EngineReport {
  questions: Question[]
  /** 질문으로 못 다룬 나머지 — 강제하지 않고 수동 검토로 남긴다 */
  leftover: { count: number; bytes: number }
  /** 검증 지표: 질문당 해결 가능 용량 (GB/질문) — 높을수록 고레버리지 */
  gbPerQuestion: number
}

export function run(ambig: Classified[]): EngineReport {
  const clusters = cluster(ambig)
  const questions = buildQuestions(clusters)

  const covered = new Set(questions.map((q) => q.unknown))
  const leftoverClusters = clusters.filter((c) => !covered.has(c.unknown))
  const stake = questions.reduce((s, q) => s + q.stakeBytes, 0)

  return {
    questions,
    leftover: {
      count: leftoverClusters.reduce((s, c) => s + c.count, 0),
      bytes: leftoverClusters.reduce((s, c) => s + c.totalBytes, 0),
    },
    gbPerQuestion: questions.length ? stake / GB / questions.length : 0,
  }
}
