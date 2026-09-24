/**
 * 자료실 — 대상(target) 한 건의 생김새
 *
 * ══ 왜 이렇게 잘게 쪼개 두나 ═════════════════════════════════════
 *   페이지는 조합으로 만들지만, 조합해서 나온 문장이 전부 똑같으면 그건
 *   그냥 같은 페이지 30만 장이다. 그래서 "지워도 되나"와 "어디 있나"가
 *   서로 다른 사실을 꺼내 쓰도록, 사실을 필드 단위로 따로 적어 둔다.
 *   어떤 대상에 어떤 필드가 없으면 그 조합은 아예 페이지를 만들지 않는다.
 *   (combos.js 의 applicable 참고)
 *
 * ══ 지키는 것 ════════════════════════════════════════════════════
 *   경로·명령어·설정 위치는 확인한 것만 적는다. 모르면 비워 둔다.
 *   빈 필드는 "그 조합은 안 만든다"로 이어질 뿐, 지어낸 문장이 되지 않는다.
 *
 * @typedef {Object} Target
 * @property {string}   id        URL 조각. 영소문자·숫자·하이픈.
 * @property {string}   name      본문에서 부르는 이름 (짧게)
 * @property {string}   full      정식 명칭 (제목·첫 문장용)
 * @property {string[]} aliases   사람들이 검색창에 치는 다른 말
 * @property {string}   cat       분류 키 (CATS)
 * @property {string[]} paths     실제 경로. 없으면 []
 * @property {string}   what      이게 무엇인가 (1~3문장)
 * @property {string}   grow      왜 커지는가
 * @property {string}   size      전형적인 크기 (예: '2~20GB')
 * @property {'safe'|'care'|'risky'} safety
 * @property {string}   safetyNote 그 판정의 근거
 * @property {string}   loss      지우면 잃는 것
 * @property {boolean}  regen     지워도 다시 생기는가
 * @property {string[]} steps     손으로 지우는 절차
 * @property {string}   [cmd]     명령어 한 줄
 * @property {string}   [cmdNote] 그 명령어에 붙는 주의
 * @property {string}   find      크기를 확인하는 방법
 * @property {string}   [move]    다른 드라이브로 옮기는 방법
 * @property {string}   [shrink]  지우지 않고 줄이는 방법
 * @property {string}   [auto]    자동·예약 정리 방법
 * @property {string}   [keepOut] 같이 지우면 안 되는 것
 * @property {string}   [limit]   크기 상한을 정하는 방법
 * @property {string}   [settings] 앱 설정에서 줄이는 경로
 * @property {string}   [myth]    흔한 오해와 사실
 * @property {string}   [diff]    헷갈리는 다른 항목과의 구분
 * @property {string[]} [related] 관련 target id
 */

/** 분류 — 자료실 목차의 큰 단위. 네이버 C-Rank 를 생각하면 흩지 않는 게 낫다. */
export const CATS = {
  system:    { label: '윈도우가 잡아둔 자리', blurb: '탐색기에는 안 보이는데 수십 GB를 쓰는 것들.' },
  browser:   { label: '브라우저',            blurb: '웹을 보는 동안 조용히 쌓이는 캐시와 프로필.' },
  messenger: { label: '메신저·화상회의',      blurb: '주고받은 사진·영상이 원본 그대로 남는 자리.' },
  game:      { label: '게임·런처',            blurb: '한 번 깔면 수십 GB, 지워도 남는 조각들.' },
  creative:  { label: '영상·디자인 도구',      blurb: '작업하는 동안 만들어지는 미리보기와 중간 파일.' },
  dev:       { label: '개발 폴더',            blurb: '다시 만들 수 있는 것과 아닌 것을 가른다.' },
  ai:        { label: 'AI 모델·캐시',         blurb: '모델 파일 하나가 수십 GB인 새 식구들.' },
  vm:        { label: '가상머신·컨테이너',     blurb: '쓴 만큼 커지고, 지워도 안 줄어드는 디스크 이미지.' },
  cloud:     { label: '클라우드 동기화',       blurb: '클라우드에 있는데 내 디스크에도 있는 사본.' },
  office:    { label: '문서·메일',            blurb: '메일함과 문서 캐시가 수십 GB가 되는 경우.' },
  media:     { label: '사진·영상·다운로드',    blurb: '내가 만든 파일. 지우는 게 아니라 고르는 문제.' },
  korean:    { label: '국내 프로그램',         blurb: '국내에서 많이 쓰는 프로그램이 남기는 것들.' },
  backup:    { label: '백업·복원',            blurb: '보험인데 보험료가 디스크인 것들.' },
}

export const SAFETY = {
  safe:  { label: '지워도 됩니다',        tone: '다시 생기고, 잃는 게 거의 없습니다.' },
  care:  { label: '확인하고 지우세요',     tone: '지워도 되지만 대가가 있습니다.' },
  risky: { label: '함부로 지우면 안 됩니다', tone: '지우면 되돌리기 어려운 게 섞여 있습니다.' },
}

/** 데이터가 규칙을 지키는지 본다. 빌드 때 한 번 돌리고, 어기면 빌드를 세운다. */
export function validateTarget(t) {
  const errs = []
  const need = ['id', 'name', 'full', 'cat', 'what', 'grow', 'size', 'safety', 'safetyNote', 'loss', 'find']
  for (const k of need) if (!t[k]) errs.push(`${t.id ?? '(id없음)'}: ${k} 없음`)
  if (t.id && !/^[a-z0-9-]+$/.test(t.id)) errs.push(`${t.id}: id 는 영소문자·숫자·하이픈만`)
  if (t.cat && !CATS[t.cat]) errs.push(`${t.id}: 모르는 분류 ${t.cat}`)
  if (t.safety && !SAFETY[t.safety]) errs.push(`${t.id}: 모르는 안전도 ${t.safety}`)
  if (!Array.isArray(t.steps) || t.steps.length === 0) errs.push(`${t.id}: steps 가 비었음`)
  if (t.what && t.what.length < 25) errs.push(`${t.id}: what 이 너무 짧음`)
  return errs
}
