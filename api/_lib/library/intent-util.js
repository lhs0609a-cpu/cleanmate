/**
 * 자료실 — 의도(intent) 를 조립할 때 쓰는 공통 조각
 *
 * 각 intent 는 여기 있는 조각을 골라 쓴다. 조각 자체가 대상(target)의
 * 서로 다른 필드를 읽기 때문에, 같은 조각을 써도 대상이 다르면 다른 문장이 나온다.
 */

import { jo } from './text.js'
import { SAFETY } from './schema.js'

/** 경로를 보여주는 문단 + 코드 블록. 경로가 없으면 null 을 돌려준다. */
export function pathSection(t, heading = '어디에 있나') {
  if (!t.paths?.length) return null
  return {
    h: heading,
    p: [
      t.paths.length === 1
        ? `${t.name}의 자리는 한 곳입니다. 탐색기 주소창에 아래 경로를 그대로 붙여 넣으면 바로 열립니다.`
        : `${jo(t.name, '은')} 한 곳에만 있지 않습니다. 아래 ${t.paths.length}곳을 모두 확인해야 실제 크기가 나옵니다.`,
      '경로에 들어 있는 %LOCALAPPDATA% 같은 부분은 탐색기 주소창에서 알아서 풀립니다. 직접 계정 이름을 찾아 들어갈 필요는 없습니다.',
    ],
    code: t.paths.join('\n'),
  }
}

/** 안전도 판정 문단. 모든 "지워도 되나" 계열이 여기로 모인다. */
export function safetySection(t) {
  const s = SAFETY[t.safety]
  return {
    h: '지워도 되는가',
    badge: { tone: t.safety, label: s.label },
    p: [
      `${jo(t.name, '은')} ${s.label}. ${s.tone}`,
      t.safetyNote,
      t.regen
        ? `지운 뒤에도 프로그램을 다시 쓰면 같은 자리에 다시 생깁니다. 그래서 "한 번 지우면 끝"이 아니라 "얼마나 자주 지울 것인가"의 문제입니다.`
        : `한 번 지우면 다시 만들어지지 않습니다. 필요해지면 직접 다시 받거나 다시 만들어야 합니다.`,
    ],
  }
}

/** 잃는 것 — 지우기 전에 알아야 하는 대가. */
export function lossSection(t) {
  return {
    h: '지우면 무엇을 잃나',
    p: [t.loss, t.keepOut ? `같이 지우면 안 되는 것이 있습니다. ${t.keepOut}` : null].filter(Boolean),
  }
}

/** 손으로 지우는 절차. */
export function stepsSection(t, heading = '지우는 순서') {
  return {
    h: heading,
    p: [`아래 순서대로 하면 됩니다. 중간에 프로그램이 켜져 있으면 일부 파일이 "사용 중"으로 남으니, 먼저 닫고 시작하세요.`],
    steps: t.steps,
  }
}

/** 크기를 재는 방법. */
export function findSection(t) {
  return {
    h: '지금 얼마나 차지하는지 확인하기',
    p: [t.find, `숫자를 한 번 적어 두세요. 정리한 뒤 다시 재서 비교해야 효과를 알 수 있고, 다음 달에 같은 자리가 또 커졌다면 그건 지울 게 아니라 설정을 바꿔야 하는 항목입니다.`],
  }
}

/** 명령어 한 줄. */
export function cmdSection(t) {
  if (!t.cmd) return null
  return {
    h: '명령어로 한 번에',
    p: [
      `창을 여러 개 열지 않고 끝내려면 아래 한 줄이면 됩니다.`,
      t.cmdNote ?? '실행하기 전에 무엇을 지우는 명령인지 한 번 읽어 보세요. 되돌리기 버튼이 없습니다.',
    ],
    code: t.cmd,
  }
}

/** 이 환경에서 달라지는 점. env 가 없으면 null. */
export function envSection(t, e) {
  if (!e) return null
  return {
    h: `${e.label}에서는 무엇이 다른가`,
    p: [e.ctx, e.tip, `이 환경에서 남겨 둘 여유 용량은 ${e.headroom} 정도로 잡으세요. ${e.watch}`],
  }
}

/** 표 — 한눈에 보는 요약. 모든 페이지 공통이지만 값은 전부 다르다. */
export function factTable(t, e) {
  const rows = [
    ['무엇인가', t.full],
    ['분류', t.catLabel ?? '-'],
    ['전형적인 크기', t.size],
    ['안전도', SAFETY[t.safety].label],
    ['지운 뒤 다시 생기나', t.regen ? '생깁니다' : '생기지 않습니다'],
  ]
  if (t.paths?.length) rows.push(['자리', t.paths[0]])
  if (e) rows.push(['이 문서의 기준 환경', e.label])
  return { head: ['항목', '내용'], rows }
}

/** 짧은 직답을 만들 때 쓰는 마무리 한 줄. */
export function tail(t, e) {
  return e
    ? `${e.label} 기준으로 정리했습니다.`
    : `환경에 따라 세부 경로가 다를 수 있어, 아래에 환경별 문서를 같이 걸어 두었습니다.`
}

/** FAQ 에 늘 들어가는 공통 질문 두 개. 답은 대상마다 다르다. */
export function commonFaq(t) {
  return [
    {
      q: `${jo(t.name, '을')} 지우면 프로그램이 망가지나요?`,
      a: t.safety === 'risky'
        ? `망가질 수 있습니다. ${t.safetyNote}`
        : `망가지지 않습니다. ${t.loss} 그 이상은 없습니다.`,
    },
    {
      q: `지운 뒤에도 용량이 안 줄어드는데요?`,
      a: `휴지통을 비웠는지 먼저 보세요. 그래도 그대로면 지운 파일을 아직 잡고 있는 프로그램이 있다는 뜻입니다. 재부팅 한 번이면 대개 반영됩니다. 재부팅 뒤에도 같다면 그 자리를 차지하는 건 ${jo(t.name, '이')} 아니라 다른 것입니다.`,
    },
  ]
}
