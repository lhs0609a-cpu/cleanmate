/**
 * 화면과 서버 사이의 약속이 끊기지 않았는가
 *
 * ★ 왜 필요한가
 *   랜딩·관리자 화면은 이제 서버 함수(api/)를 부른다. 화면과 서버는 다른
 *   파일에 있고 타입으로 이어져 있지도 않다 — 엔드포인트 이름 한 글자만
 *   달라져도 **빌드는 통과하고 배포도 되고, 화면만 조용히 죽는다.**
 *   상담 폼이 그렇게 죽으면 그 사실을 알 방법이 없다. 아무도 문의를 못 보내는데
 *   "문의가 안 들어오네"로 읽히기 때문이다.
 *
 *   그리고 이 저장소가 파는 건 신뢰다. 그래서 여기서 같이 잠근다:
 *     · 관리자 API 중 인증을 안 거치는 게 하나라도 있으면 실패
 *     · 앱이 서버로 보내는 값에 파일 관련 정보가 섞이면 실패
 *     · 익명 통계 설명이 화면에서 사라지면 실패(숨기고 보내지 않는다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cache = new Map<string, string>()
const read = (p: string) => {
  let v = cache.get(p)
  if (v === undefined) {
    v = readFileSync(join(root, p), 'utf8')
    cache.set(p, v)
  }
  return v
}

/** api/ 아래의 함수 파일들 → 실제 URL 경로 */
function apiRoutes(): string[] {
  const out: string[] = []
  const walk = (rel: string) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      // _lib은 함수가 아니라 공용 코드다 — Vercel도 밑줄로 시작하면 라우트로 안 만든다.
      if (e.name.startsWith('_')) continue
      if (e.isDirectory()) walk(`${rel}/${e.name}`)
      else if (e.name.endsWith('.js')) out.push(`/${rel}/${e.name.replace(/\.js$/, '')}`)
    }
  }
  walk('api')
  return out
}

/** 소스가 fetch로 부르는 /api/... 경로들 (쿼리스트링·템플릿 뒷부분은 뗀다) */
function calledEndpoints(src: string): string[] {
  const found = new Set<string>()
  for (const m of src.matchAll(/['"`](\/api\/[a-zA-Z0-9/_-]*)/g)) found.add(m[1])
  return [...found]
}

test('★ 화면이 부르는 서버 함수가 전부 존재한다 — 이름 한 글자면 폼이 조용히 죽는다', () => {
  const routes = new Set(apiRoutes())
  for (const file of ['web/src/landing.ts', 'web/src/admin.ts', 'web/src/app.ts']) {
    for (const ep of calledEndpoints(read(file))) {
      // app.ts는 절대 URL로 부른다 — 경로 부분만 비교한다.
      const path = ep.replace(/^https?:\/\/[^/]+/, '')
      assert.ok(routes.has(path), `${file}이 없는 엔드포인트를 부른다: ${path}\n있는 것: ${[...routes].join(', ')}`)
    }
  }
})

test('★ 관리자 API에 인증 없는 문이 없다', () => {
  for (const e of readdirSync(join(root, 'api/admin'))) {
    if (!e.endsWith('.js')) continue
    const src = read(`api/admin/${e}`)
    /* session.js는 로그인 자체를 하는 곳이라 requireAdmin을 못 쓴다.
       대신 비밀번호 비교와 횟수 제한이 있는지를 본다. */
    if (e === 'session.js') {
      assert.match(src, /passwordMatches\(/, '로그인이 비밀번호를 확인하지 않는다')
      assert.match(src, /allow\('login'/, '로그인 시도에 횟수 제한이 없다 — 시간문제다')
      continue
    }
    assert.match(src, /requireAdmin\(req,\s*res\)/, `api/admin/${e}가 인증을 안 거친다`)
  }
})

test('★ 비밀번호를 ===로 비교하지 않는다 — 응답 시간으로 한 글자씩 새어 나간다', () => {
  const src = read('api/_lib/auth.js')
  assert.match(src, /timingSafeEqual/, '일정 시간 비교를 안 쓴다')
  assert.match(src, /HttpOnly/, '세션 쿠키를 스크립트가 읽을 수 있다')
  assert.match(src, /SameSite=Strict/, '다른 사이트에서 우리 API를 대신 부를 수 있다')
})

test('★ 문의를 못 받았으면 받았다고 하지 않는다', () => {
  const src = read('api/inquiry.js')
  /* 저장소가 없거나 저장이 실패했을 때 200을 주면, 이 함수는
     '문의를 조용히 버리는 함수'가 된다. 보낸 사람은 답을 영영 못 받는다. */
  assert.match(src, /if \(!configured\(\)\)[\s\S]{0,200}fail\(res, 503/, '저장소가 없을 때 실패로 답하지 않는다')
  assert.match(src, /catch \{\s*\n\s*return fail\(res, 503/, '저장에 실패해도 성공으로 답한다')
})

test('★ 앱이 서버로 보내는 건 익명 신호 셋뿐이다 — 파일이 한 조각도 안 붙는다', () => {
  const src = read('web/src/app.ts')
  const i = src.indexOf('async function sendPing()')
  assert.ok(i > 0, '신호를 보내는 자리를 못 찾았다')
  const body = src.slice(i, i + 1200)

  const m = body.match(/JSON\.stringify\(\{([^}]*)\}\)/)
  assert.ok(m, 'ping 본문을 못 찾았다')
  const keys = [...m![1].matchAll(/([a-zA-Z]+)\s*:/g)].map((x) => x[1]).sort()
  assert.deepEqual(keys, ['installId', 'os', 'version'], `ping 본문에 다른 게 섞였다: ${keys.join(', ')}`)

  // 브라우저 데모는 세지 않는다 — 데모를 눌러본 사람을 '사용자'로 세면 우리가 우리를 속인다.
  assert.match(body, /if \(!inTauri/, '브라우저에서도 신호를 보낸다')
  // 끌 수 있어야 한다.
  assert.match(body, /statsEnabled\(\)/, '끄기 설정을 확인하지 않는다')
})

test('★ 익명 통계를 화면에서 밝힌다 — 숨기고 보내면 나머지 약속도 못 믿는다', () => {
  const html = read('web/app.html')
  assert.match(html, /이 앱이 밖으로 보내는 게 있나요/, '무엇을 보내는지 화면에 없다')
  assert.match(html, /안 보내는 것:/, '무엇을 안 보내는지 화면에 없다')
  assert.match(html, /id="stats-toggle"/, '끄는 버튼이 화면에 없다')
})

test('★ 앱 화면은 여전히 네트워크가 막혀 있다 — 관리자만 열어준다', () => {
  const cfg = JSON.parse(read('vercel.json'))
  const header = (src: string, key: string) =>
    cfg.headers.find((h: any) => h.source === src)?.headers.find((h: any) => h.key === key)?.value ?? ''
  const csp = (src: string) => header(src, 'Content-Security-Policy')

  assert.match(csp('/app.html'), /connect-src 'none'/, '웹 체험 화면이 네트워크를 열었다')
  assert.match(csp('/admin.html'), /connect-src 'self'/, '관리자 화면이 자기 API를 못 부른다')
  // 로그인으로 막혀 있어도 색인은 따로 막는다 — 검색 결과에 주소가 뜰 이유가 없다.
  assert.match(header('/admin.html', 'X-Robots-Tag'), /noindex/i, '관리자 화면이 색인될 수 있다')
  assert.match(read('web/admin.html'), /name="robots" content="noindex/, '관리자 HTML에 noindex가 없다')
  // 글꼴을 넣어서 배포하므로 font-src도 self여야 한다(외부 CDN을 부르지 않는다).
  for (const s of ['/app.html', '/admin.html']) {
    assert.match(csp(s), /font-src 'self'/, `${s}의 글꼴 출처가 안 잠겨 있다`)
  }
})

test('★ 상담 폼이 랜딩에 있고, GitHub 계정을 요구하지 않는다', () => {
  const html = read('web/index.html')
  assert.match(html, /id="inq-form"/, '상담 폼이 사라졌다')
  for (const id of ['inq-name', 'inq-contact', 'inq-message']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} 칸이 없다`)
  }
  // 허니팟이 사라지면 스팸이 그대로 들어온다(캡차를 안 쓰기 때문이다).
  assert.match(html, /id="inq-website"/, '허니팟 칸이 없다')
  assert.match(read('api/inquiry.js'), /body\.website/, '서버가 허니팟을 안 본다')
})

test('★ 랜딩이 못 읽은 숫자를 0으로 채우지 않는다', () => {
  const src = read('web/src/landing.ts')
  const i = src.indexOf('async function fillPublicStats')
  const body = src.slice(i, i + 900)
  /* 이 랜딩의 숫자는 전부 실측이다(40.7GB·14.6GB). 한 칸이라도 지어내면
     나머지도 같이 의심받는다. 못 읽으면 칸을 통째로 숨긴다. */
  assert.match(body, /data\.downloads !== 'number' \|\| data\.downloads <= 0\) return/, '0이나 못 읽은 값을 그려버린다')
  assert.match(read('web/index.html'), /id="stat-dl" hidden/, '기본이 보임이다 — 못 읽으면 0이 보인다')
})

/* ── 생활 정리 화면 ────────────────────────────────────────────
   방 지도·달력은 판단(src/content/room.ts)과 그리기(web/src/app.ts)와
   색(web/app.html)이 세 파일에 흩어져 있다. 하나만 빠져도 화면이 빈다. */

test('★ 생활 정리 화면이 목록만 있던 시절로 돌아가지 않았다', () => {
  const view = read('web/src/tidy-view.ts')
  for (const fn of ['roomHtml', 'calendarHtml', 'monthHtml']) {
    assert.match(view, new RegExp(`export function ${fn}\\(`), `${fn}을 그리는 자리가 없다`)
  }
  // 그리는 함수가 있어도 화면이 안 부르면 없는 것과 같다.
  const app = read('web/src/app.ts')
  assert.match(app, /\$\{roomHtml\(d\.room\)\}/, '생활 정리 화면이 방 지도를 안 그린다 — 목록만 남았다')
  assert.match(app, /\$\{calendarHtml\(/, '달력을 안 그린다')
  assert.match(app, /\$\{monthHtml\(/, '이번 달 요약을 안 그린다')
})

test('★ 하루 몫만 내고, 나머지는 "다른 날에"라고 쓴다', () => {
  /* 실물(2026-09-01): "오늘 할 것 20"이 스무 줄로 펼쳐져 있었다. 사실이지만
     그대로 쌓으면 빚 목록이고, 스무 줄을 본 사람은 하나도 안 하고 닫는다. */
  const app = read('web/src/app.ts')
  assert.match(app, /dailyPicks\(ordered\)/, '하루 몫으로 안 자른다')
  assert.match(app, /나머지 \$\{quota\.rest\.length\}개는 다른 날에/, '나머지를 빚처럼 쓴다')
  assert.match(app, /합쳐서 \$\{quota\.minutes\}분/, '오늘 몫이 몇 분인지 안 쓴다')
  // 다 보고 싶은 사람의 길은 남겨둔다.
  assert.match(app, /id="tidy-more"/, '전부 볼 방법이 없다')
})

test('★ 내 루틴을 만들 통로가 화면에 있다', () => {
  const app = read('web/src/app.ts')
  assert.match(app, /id="mine-form"/, '내 루틴을 만들 폼이 없다')
  assert.match(app, /data-del="/, '내가 만든 것을 지울 수가 없다')
  assert.match(app, /engine\('tidy-add'/, '데스크톱에서 만들 방법이 없다')
  assert.match(app, /addCustomRoutine\(readLocalTidy\(\)/, '브라우저가 같은 함수를 안 쓴다')
  for (const c of ["case 'tidy-add':", "case 'tidy-del':"]) {
    assert.ok(read('src/engine-cli.ts').includes(c), `엔진에 ${c}가 없다`)
  }
  // 지우기는 되돌릴 수 없다 — 한 번 묻는다.
  assert.match(app, /정말 지울까요\? \(기록도 함께\)/, '되돌릴 수 없는 일을 한 번에 한다')
})

test('★ 이번 주 일곱 칸이 오늘 화면에 있다', () => {
  /* 달력은 '기록' 탭에 3개월치가 있지만 일부러 열어야 보인다. 매일 여는
     화면에서 쌓이는 감각을 주는 건 지금 눈앞에 있는 것뿐이다. */
  const app = read('web/src/app.ts')
  const i = app.indexOf('const todayHtml =')
  assert.ok(i > 0)
  assert.match(app.slice(i, i + 1400), /weekHtml\(d\.habit\)/, '오늘 화면에 이번 주가 없다')
  // 3개월 달력은 '기록' 탭에 그대로 남아 있어야 한다.
  const j = app.indexOf('const logTab =')
  assert.match(app.slice(j, j + 400), /calendarHtml\(/, '기록 탭에서 달력이 사라졌다')
})

test('★ 목록 고르기 순서를 손으로 적지 않는다', () => {
  /* 실물: 'gear' 분류를 만들어놓고 화면의 순서 배열에 넣는 걸 빠뜨려서
     로봇청소기·세탁기 필터 열 개를 켤 방법이 아예 없었다. */
  const app = read('web/src/app.ts')
  assert.match(app, /const catOrder = Object\.keys\(CATEGORY_LABEL\)/, '분류 순서를 손으로 적었다')
  assert.doesNotMatch(app, /\['home', 'desk', 'digital'/, '옛 목록이 남아 있다')
})

test('★ 생활 정리가 파일 탭과 다른 옷을 입는다', () => {
  /* 실물 지적(2026-08-31): "너무 다른 거랑 똑같아." 맞는 말이었다.
     숨은 공간·시작프로그램·같은 파일과 정확히 같은 구조였다 — 흰 카드,
     목록, 오른쪽 큰 실행 버튼. 그런데 파일 탭은 '일하는 화면'(훑고 판단하고
     실행)이고 생활 정리는 '사는 화면'(하나 하고 닫는다)이다. 같은 옷을 입히면
     "오늘 할 것 14개"가 스캔 결과처럼 읽힌다 — 열 때마다 빚 독촉장이 된다. */
  const app = read('web/src/app.ts')

  // 이 화면 전체가 제 스코프 안에 있어야 파일 탭 스타일이 안 새어 들어온다.
  assert.match(app, /host\.innerHTML = `<div class="life">/, '생활 정리가 제 옷을 안 입었다')
  assert.match(app, /segHtml\(tidySeg\)/, '오늘/내 방/기록으로 안 나눴다 — 한 화면에 여덟 블록이다')
  assert.match(app, /rowHtml\(r, \{ state/, '항목이 아직 카드다')

  // 시각 — 다른 탭에는 없는 축이다. 이게 빠지면 그냥 목록으로 돌아간다.
  assert.match(app, /dayPart\(\)/, '몇 시인지 안 본다')
  assert.match(app, /sortByTime\(due, part\)/, '지금 시각에 맞는 것을 앞에 안 올린다')
  assert.match(app, /greetHtml\(g, doneToday\.length\)/, '인사가 없다')

  const css = read('web/app.html')
  assert.match(css, /\.life\{max-width:var\(--measure-wide\)/, '읽는 폭을 안 좁혔다')
  assert.match(css, /\.lrow \.ck\{/, "'했어요'가 아직 실행 버튼이다")
  // 이 옷에도 빨강은 없다.
  const start = css.indexOf('  .life{')
  const end = css.indexOf('  .life .card,')
  assert.ok(start > 0 && end > start, '생활 정리 CSS 블록을 못 찾았다')
  assert.doesNotMatch(css.slice(start, end), /var\(--lock\)/, '생활 정리가 경고색을 쓴다')
})

test('★ 생활 정리 탭이 조용히 죽지 않는다 — 실물에서 빈 화면으로 잡혔다', () => {
  /* 2026-08-31 실물: 생활 정리 탭에 "'생활 정리' 탭을 열면 …"라는 안내문만
     남아 있었다. 탭을 이미 열었는데도. 원인은 loadTidy에 오류 처리가 한 줄도
     없었다는 것 — 다른 탭 로더는 전부 catch로 이유를 쓰는데 여기만 없었다.
     엔진 호출이 실패하면 예외가 go() 밖으로 날아가고 화면은 손도 안 댄 채 남는다. */
  const app = read('web/src/app.ts')
  const i = app.indexOf('async function loadTidy')
  assert.ok(i > 0, 'loadTidy를 못 찾았다')
  const body = app.slice(i, i + 2600)

  assert.match(body, /catch \(err\)/, '생활 정리가 실패를 삼킨다 — 빈 화면만 남는다')
  assert.match(body, /불러오지 못했어요/, '왜 안 됐는지 화면에 안 쓴다')
  assert.match(body, /id="tidy-retry"/, '다시 해볼 방법이 없다')
  // 안내문("탭을 열면 …")은 탭을 연 순간 거짓이 된다. 반드시 먼저 치운다.
  const first = body.slice(0, body.indexOf('await tidyPlan'))
  assert.match(first, /host\.innerHTML = /, '기다리는 동안 안내문이 그대로 남는다')
  assert.match(first, /class="prog"/, '기다리는 자리에 막대가 없다')
  // 다만 없는 %를 지어내지 않는다 — 파일 하나 읽기에는 잴 진행률이 없다.
  assert.doesNotMatch(first, /startPanel\(/, '진행률이 없는 일에 진행률 패널을 붙였다')
})

test('★ "정리정돈 시작" 흐름이 화면에 붙어 있다', () => {
  /* 이 흐름이 없으면 생활 정리 탭은 다시 '항목 마흔 개짜리 목록'이 된다.
     그리고 목록은 고르는 것부터가 일이라 사람이 하나도 안 고른다. */
  const app = read('web/src/app.ts')
  assert.match(app, /id="coach-body"/, '코치 칸이 화면에 없다')
  assert.match(app, /renderCoachPanel\(\)/, '코치 칸을 그리는 자리가 없다')
  assert.match(app, /startHtml\(\)/, '시작 버튼을 안 그린다')
  assert.match(app, /sessionHtml\(/, '같이 하기 화면을 안 그린다')
  assert.match(app, /reportHtml\(d\.coach\?\.report\)/, '이번 달 리포트를 안 그린다')
  // 목록을 다시 그려도 코치가 살아 있어야 한다 — 세션 중에 사라지면 타이머가 날아간다.
  const after = app.slice(app.indexOf('renderReferral(d)'), app.indexOf('renderReferral(d)') + 260)
  assert.match(after, /renderCoachPanel\(\)/, '목록을 다시 그린 뒤 코치 칸을 되살리지 않는다')
})

test('★ 오늘 한 곳을 고르는 규칙이 한 군데에만 있다', () => {
  /* 데스크톱은 engine('tidy-coach'), 브라우저는 coachBoard() — 둘 다 같은
     순수 함수를 부른다. 화면에 규칙을 한 벌 더 두면 한쪽만 고쳐진다
     (업체 제안에서 실제로 그랬다). */
  const app = read('web/src/app.ts')
  assert.match(app, /engine\('tidy-coach'/, '데스크톱이 엔진을 안 부른다')
  assert.match(app, /coachBoard\(readLocalTidy\(\), today, coachSkip\)/, '브라우저가 같은 함수를 안 쓴다')
  assert.match(read('src/engine-cli.ts'), /case 'tidy-coach':/, '엔진에 코치 명령이 없다')
})

test('★ 분석 화면에 가짜 진행률이 없다 — 계산은 순간에 끝난다', () => {
  /* 막대를 돌리면 "오래 걸리는 일을 하는 중"이라고 말하는 셈이고 그건 거짓말이다.
     이 저장소의 로딩 규칙(loading-progress.test.ts)과 반대 방향의 잠금이다 —
     저기서는 "기다리게 해놓고 아무 말도 안 하지 마라", 여기서는
     "안 기다려도 되는데 기다리는 척하지 마라". */
  const view = read('web/src/coach-view.ts')
  const i = view.indexOf('export function analyzingHtml')
  assert.ok(i > 0)
  const body = view.slice(i, i + 900)
  assert.doesNotMatch(body, /prog-bar|width:\s*\$\{|%<\/|setInterval/, '분석 화면이 진행률을 그린다')
  assert.match(body, /s\.result/, '실제로 센 값을 안 쓴다')
})

test('★ 넘기기·그만두기가 벌처럼 보이지 않는다', () => {
  const view = read('web/src/coach-view.ts')
  assert.match(view, /넘기셔도 아무 일 없습니다/, '넘기는 게 괜찮다고 안 말한다')
  assert.match(view, /기록에 아무것도 안 남습니다/, '그만둬도 괜찮다고 안 말한다')
  // 이 화면 전체에 경고색이 없다.
  const css = read('web/app.html')
  const start = css.indexOf('  .coach{')
  const end = css.indexOf('  .rp-focus li span{')
  assert.ok(start > 0 && end > start, '코치 CSS 블록을 못 찾았다')
  assert.doesNotMatch(css.slice(start, end), /var\(--lock\)/, '코치 화면이 경고색을 쓴다')
})

test('★ 꼼꼼히 볼 곳이 콘텐츠에 실제로 들어 있다', () => {
  /* "어디를 놓치나"가 이 제품이 파는 것의 절반이다. spots가 비면
     오늘 여기 카드와 세션 화면의 그 블록이 통째로 사라진다. */
  const tidy = read('src/content/tidy.ts')
  const count = (tidy.match(/^\s{4}spots: \[/gm) ?? []).length
  assert.ok(count >= 15, `꼼꼼히 볼 곳이 붙은 항목이 ${count}개뿐이다`)
})

test('★ 데스크톱과 브라우저가 같은 묶음을 만든다 — 한쪽에만 방 지도가 뜨지 않게', () => {
  /* 데스크톱은 engine-cli가, 브라우저는 app.ts가 각각 만든다. 한쪽이
     tidyBoard를 빼먹으면 그 환경에서만 화면 절반이 사라진다. */
  assert.match(read('src/engine-cli.ts'), /\.\.\.tidyBoard\(state, today\)/, '엔진의 tidy-list가 방 지도를 안 준다')
  assert.match(read('src/engine-cli.ts'), /\.\.\.tidyBoard\(next, today\)/, "'했어요' 뒤에 방 지도가 사라진다")
  assert.match(read('src/engine-cli.ts'), /habit: habitStats\(next, today\)/, "'했어요' 뒤에 습관 기록이 사라진다")
  assert.match(read('web/src/app.ts'), /\.\.\.tidyBoard\(state, today\)/, '브라우저 쪽이 방 지도를 안 만든다')
})

test("★ '나' 항목을 켤 통로가 화면에 있다 — 없으면 그 항목들은 영원히 안 보인다", () => {
  /* 이발·치과 같은 항목은 기본이 꺼짐이다(tidy.ts의 optIn). 묻지도 않고 몸
     이야기를 꺼내지 않으려고 그렇게 뒀는데, 켜는 버튼이 화면에서 사라지면
     그 항목들은 코드에만 있고 아무도 못 본다 — 만들어놓고 안 만든 것과 같다. */
  const app = read('web/src/app.ts')
  assert.match(app, /data-pick="/, '목록에 넣고 빼는 버튼이 없다')
  assert.match(app, /내 목록 고르기/, '고르는 자리가 화면에 없다')
  assert.match(app, /engine\('tidy-set'/, '데스크톱에서 켜고 끌 방법이 없다')
  assert.match(read('src/engine-cli.ts'), /case 'tidy-set':/, '엔진에 켜고 끄는 명령이 없다')
})

test('★ 맡길 것을 오늘 할 것과 섞지 않는다 — 못 누르는 카드가 목록을 못 믿게 만든다', () => {
  const app = read('web/src/app.ts')
  assert.match(app, /맡길 때가 된 것/, '맡길 것 묶음이 화면에 없다')
  assert.match(app, /d\.book/, '엔진이 준 맡길 목록을 화면이 안 쓴다')
  // 처음 켠 항목엔 '했어요'가 아니라 '언제였는지'를 묻는다(안 물으면 첫 알림이 한 주기 늦는다).
  assert.match(app, /마지막으로 한 게 언제쯤인가요/, '처음 켠 항목의 시작점을 안 묻는다')
  assert.match(app, /data-since="/, '지난 날짜로 기록할 통로가 없다')
})

test('★ 엔진의 tidy-set도 같은 묶음을 낸다 — 한쪽만 방 지도가 사라지지 않게', () => {
  const cli = read('src/engine-cli.ts')
  const i = cli.indexOf("case 'tidy-set':")
  assert.ok(i > 0, 'tidy-set이 없다')
  const body = cli.slice(i, i + 1400)
  assert.match(body, /\.\.\.planToday\(next, today\)/, '켜고 끈 뒤 목록을 다시 안 준다')
  assert.match(body, /\.\.\.tidyBoard\(next, today\)/, '켜고 끈 뒤 방 지도가 사라진다')
})

test('★ "밀린 것"을 세는 규칙이 한 군데에만 있다 — 두 군데면 한쪽만 고쳐진다', () => {
  /* 실제로 그랬다. 데스크톱에서는 화면이 목록을 보고 직접 다시 셌는데,
     맡기는 항목의 규칙(주기 1배)을 추가했을 때 그쪽만 새 신호를 통째로 못 봤다.
     앱은 멀쩡히 돌고 제안만 영영 안 뜨는, 아무도 못 알아채는 종류의 고장이다. */
  const app = read('web/src/app.ts')
  const i = app.indexOf('function renderReferral')
  assert.ok(i > 0)
  const body = app.slice(i, i + 1400)
  assert.match(body, /plan\.stuck/, '화면이 엔진이 준 신호를 안 쓴다')
  assert.doesNotMatch(body, /everyDays \* 2|timesOverdue: 3/, '화면이 밀린 규칙을 다시 계산한다')
  // 양쪽 다 같은 함수에서 낸다.
  assert.match(read('src/engine-cli.ts'), /stuck: stuckRoutines\(/, '엔진이 신호를 안 준다')
  assert.match(app, /stuck: stuckRoutines\(state, today\)/, '브라우저 쪽이 신호를 안 만든다')
})

test('★ 맡기는 카드도 경고색을 안 쓴다 — 밀린 게 아니라 때가 온 것이다', () => {
  const css = read('web/app.html')
  const i = css.indexOf('  .tk.book{')
  assert.ok(i > 0, '맡기는 카드 스타일이 없다')
  const block = css.slice(i, css.indexOf('  .pick{'))
  assert.doesNotMatch(block, /var\(--lock\)|var\(--amb\)/, '맡기는 카드가 경고색을 쓴다')
})

test('★ 방 지도에 빨강이 없다 — 오래된 곳은 경고가 아니라 흐려질 뿐이다', () => {
  const css = read('web/app.html')
  const start = css.indexOf('  .room{')
  const end = css.indexOf('  .tk{')
  assert.ok(start > 0 && end > start, '방 지도 CSS 블록을 못 찾았다')
  const block = css.slice(start, end)
  /* --lock은 이 앱에서 "건드리면 안 됨"을 뜻하는 빨강이다. 생활 정리는
     사람을 나무라는 화면이 아니므로 여기에 그 색이 들어오면 안 된다. */
  assert.doesNotMatch(block, /var\(--lock\)|var\(--amb\)/, '방 지도·달력이 경고색을 쓴다')
})

test('★ 새 화면들도 가로로 안 터진다 — 목업의 긴 경로 하나가 줄을 무너뜨린 적이 있다', () => {
  /* layout-guard.test.ts와 같은 병이다. 안 끊기는 긴 문자열(경로·이메일)이
     제 칸의 최소 폭을 창보다 넓게 만들면, 같은 줄의 형제가 0으로 눌리고
     눌린 칸에서 글자가 한 자씩 떨어진다. 격자·플렉스 칸은 눌릴 수 있어야 한다. */
  const landing = read('web/index.html')
  assert.match(landing, /overflow-wrap:anywhere/, '랜딩에 마지막 안전망이 없다')
  assert.match(landing, /\.krow > \*\{min-width:0\}/, '차별점 목록 칸이 안 줄어든다')
  assert.match(landing, /\.card\{[^}]*min-width:0/, '벤토 카드가 안 줄어든다')
  // 문의 폼의 입력칸은 폭이 100%여야 부모를 안 밀어낸다.
  assert.match(landing, /\.field input,\.field textarea\{[\s\S]{0,300}width:100%/, '입력칸이 부모를 밀어낼 수 있다')

  const admin = read('web/admin.html')
  assert.match(admin, /overflow-wrap:anywhere/, '관리자 화면에 안전망이 없다')
  assert.match(admin, /\.drow > \*\{min-width:0\}/, '분포 목록 칸이 안 줄어든다')
  assert.match(admin, /\.inq-h > \*\{min-width:0\}/, '문의 머리 칸이 안 줄어든다')
})

test('★ 랜딩과 앱이 같은 글꼴 파일을 쓴다 — 랜딩만 웹폰트를 받아오지 않는다', () => {
  for (const f of ['web/index.html', 'web/app.html', 'web/admin.html']) {
    const html = read(f)
    assert.match(html, /@font-face\{[\s\S]{0,200}\/fonts\/PretendardVariable\.woff2/, `${f}가 글꼴을 안 넣는다`)
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\./, `${f}가 외부에서 글꼴을 받는다`)
  }
})

/* ── 앱 → 서버로 나가는 길이 실제로 뚫려 있는가 ─────────────────
   랜딩·관리자는 자기 도메인의 API를 부르니 확인할 게 없다. 데스크톱 앱만
   다르다 — 앱 화면의 출처(`http://tauri.localhost`)와 신호가 가는 도메인이
   달라서, 서버가 교차 출처를 허용하지 않으면 브라우저가 프리플라이트에서
   막는다. 그리고 sendPing은 실패를 조용히 삼킨다(그게 맞다). 그래서 이건
   **테스트가 아니면 아무도 모르는 종류의 고장**이다: 앱은 멀쩡히 돌고,
   대시보드의 '설치된 기기'만 영원히 0이다.

   그래서 정규식으로 소스를 보는 대신 핸들러를 실제로 불러 응답을 본다. */

const APP_ORIGIN = 'http://tauri.localhost'

/** Vercel의 Node 핸들러에 넘길 최소한의 req/res */
function fakeRes() {
  const headers: Record<string, string> = {}
  return {
    statusCode: 0,
    body: '',
    headers,
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = String(v) },
    end(b?: string) { this.body = b ?? '' },
  }
}

const pingHandler = (await import('../api/ping.js')).default as
  (req: any, res: any) => Promise<void>

test('★ 앱이 보내는 신호가 프리플라이트에서 막히지 않는다 — 막히면 아무 소리 없이 0이 된다', async () => {
  const res = fakeRes()
  await pingHandler({ method: 'OPTIONS', headers: { origin: APP_ORIGIN } }, res)

  assert.equal(res.statusCode, 204, 'OPTIONS에 답하지 않는다 — 본 요청은 나가지도 않는다')
  assert.equal(res.headers['access-control-allow-origin'], APP_ORIGIN, '앱 출처를 허용하지 않는다')
  // 본문에 Content-Type: application/json을 붙이므로 이 헤더가 없으면 그대로 막힌다.
  assert.match(res.headers['access-control-allow-headers'] ?? '', /content-type/i, 'Content-Type을 허용하지 않는다')
  assert.match(res.headers['access-control-allow-methods'] ?? '', /POST/, 'POST를 허용하지 않는다')
})

test('★ 실제 신호에도 허용 헤더가 붙는다 — 프리플라이트만 통과시키면 본 요청에서 막힌다', async () => {
  const res = fakeRes()
  await pingHandler({
    method: 'POST',
    headers: { origin: APP_ORIGIN },
    body: { installId: '00000000-0000-4000-8000-000000000000', version: '0.23.0', os: 'windows' },
    socket: { remoteAddress: '203.0.113.7' },
  }, res)

  assert.equal(res.statusCode, 200, `신호가 거절됐다: ${res.body}`)
  assert.equal(res.headers['access-control-allow-origin'], APP_ORIGIN, '본 요청 응답에 허용 헤더가 없다')
  assert.match(res.headers['vary'] ?? '', /origin/i, '출처별 응답인데 Vary가 없다 — 캐시가 섞인다')
})

test('★ 아무 웹페이지나 우리 숫자를 늘릴 수는 없다 — 대시보드에 "실측"이라고 적혀 있다', async () => {
  for (const origin of ['https://evil.example', 'https://cleanmate-henna.vercel.app.evil.example']) {
    const res = fakeRes()
    await pingHandler({ method: 'OPTIONS', headers: { origin } }, res)
    assert.equal(res.headers['access-control-allow-origin'], undefined, `${origin}에 문을 열어줬다`)
  }
})

test('★ 교차 출처로 여는 문은 신호 하나뿐이다 — 문의·관리자는 같은 도메인에서만 부른다', () => {
  for (const route of ['api/inquiry.js', 'api/public-stats.js', 'api/admin/session.js', 'api/admin/inquiries.js', 'api/admin/stats.js']) {
    assert.doesNotMatch(read(route), /appCors\(/, `${route}가 교차 출처를 연다 — 부르는 건 우리 화면뿐이다`)
  }
  assert.match(read('api/ping.js'), /appCors\(req, res\)/, '신호 함수가 교차 출처를 안 연다')
  // 앱은 절대 URL로 부른다. 상대 경로가 되면(= 같은 도메인) 데스크톱에서 자기 자신을 부르게 된다.
  assert.match(read('web/src/app.ts'), /const PING_URL = 'https:\/\//, '신호 주소가 절대 URL이 아니다')
})
