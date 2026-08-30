/**
 * 관리자 문이 실제로 잠겨 있는가 — 글자가 아니라 동작으로 확인한다
 *
 * ★ 왜 이 파일이 따로 필요한가
 *   web-contract.test.ts는 소스에 `requireAdmin(`이 적혀 있는지, `timingSafeEqual`
 *   이라는 낱말이 있는지를 본다. 그건 **문이 달려 있는지**를 보는 것이지
 *   **문이 잠기는지**를 보는 것이 아니다. 서명 검증이 통째로 망가져도, 만료가
 *   무시돼도, 깨진 쿠키 하나에 함수가 죽어도 그 테스트는 전부 통과한다.
 *
 *   그리고 이 문 뒤에는 문의한 사람들의 이름·연락처가 있다. 이 저장소에서
 *   테스트로 잠가야 할 것이 하나라도 있다면 그건 여기다.
 *
 *   그래서 여기서는 auth.js와 관리자 핸들러를 **실제로 불러서** 응답을 본다.
 *
 * ★ 저장소(Upstash)는 붙이지 않는다.
 *   store.js는 환경변수가 없으면 configured()가 false다. 그 상태에서
 *   관리자 API는 "저장소가 연결돼 있지 않습니다"(503)로 답한다 —
 *   즉 **401이 아니라 503이 나오면 로그인은 통과한 것**이다. 네트워크 없이
 *   인증만 갈라서 확인할 수 있다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

type Handler = (req: any, res: any) => Promise<void> | void

const PASSWORD = 'ㅇ0-아주-긴-임의의-관리자-비밀번호-0123456789'
process.env.ADMIN_PASSWORD = PASSWORD
process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret-0123456789abcdef'
delete process.env.UPSTASH_REDIS_REST_URL
delete process.env.UPSTASH_REDIS_REST_TOKEN

const auth = await import('../api/_lib/auth.js')
const sessionHandler = (await import('../api/admin/session.js')).default as Handler
const inquiriesHandler = (await import('../api/admin/inquiries.js')).default as Handler
const statsHandler = (await import('../api/admin/stats.js')).default as Handler

/** Vercel의 Node 핸들러에 넘길 최소한의 req/res (web-contract.test.ts와 같은 모양) */
function fakeRes() {
  const headers: Record<string, string> = {}
  return {
    statusCode: 0,
    body: '',
    headers,
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = String(v) },
    end(b?: string) { this.body = b ?? '' },
    json(): any { try { return JSON.parse(this.body) } catch { return null } },
  }
}

function req(opts: { method?: string; url?: string; cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.cookie !== undefined) headers.cookie = opts.cookie
  return {
    method: opts.method ?? 'GET',
    url: opts.url ?? '/api/admin/inquiries',
    headers,
    body: opts.body,
    socket: { remoteAddress: '203.0.113.9' },
  }
}

/* ── 비밀번호 ──────────────────────────────────────────────── */

test('★ 맞는 비밀번호만 통과한다 — 앞부분이 같아도 안 된다', () => {
  assert.equal(auth.passwordMatches(PASSWORD), true)
  assert.equal(auth.passwordMatches(PASSWORD.slice(0, -1)), false, '한 글자 짧은 것이 통과했다')
  assert.equal(auth.passwordMatches(PASSWORD + 'x'), false)
  assert.equal(auth.passwordMatches(''), false, '빈 문자열이 통과했다 — 제일 흔한 사고다')
  assert.equal(auth.passwordMatches(undefined), false)
  assert.equal(auth.passwordMatches(null), false)
  // 문자열이 아닌 값으로 비교 함수를 터뜨릴 수 없어야 한다(본문은 JSON이라 뭐든 올 수 있다).
  assert.equal(auth.passwordMatches(123), false)
  assert.equal(auth.passwordMatches({}), false)
})

test('★ 서버에 비밀번호가 없으면 아무것도 통과하지 못한다', () => {
  const saved = process.env.ADMIN_PASSWORD
  delete process.env.ADMIN_PASSWORD
  try {
    assert.equal(auth.passwordConfigured(), false)
    assert.equal(auth.passwordMatches(''), false, '비밀번호가 없을 때 빈 문자열로 들어와졌다')
    assert.equal(auth.passwordMatches(PASSWORD), false)
    assert.equal(auth.passwordMatches(undefined), false)
  } finally {
    process.env.ADMIN_PASSWORD = saved
  }
})

/* ── 세션 토큰 ────────────────────────────────────────────── */

test('★ 우리가 발급한 토큰만 통과한다 — 고치면 거절된다', () => {
  const token = auth.issueToken()
  assert.equal(auth.verifyToken(token), true, '방금 발급한 토큰이 거절됐다')

  const dot = token.lastIndexOf('.')
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)

  // 만료를 100년 뒤로 늘린 페이로드에 옛 서명을 붙인다 — 서명이 살아 있으면 막힌다.
  const forged = Buffer.from(
    JSON.stringify({ exp: Date.now() + 100 * 365 * 86_400_000, jti: 'x' })
  ).toString('base64url')
  assert.equal(auth.verifyToken(forged + '.' + sig), false, '페이로드를 고쳐도 통과했다 — 아무나 관리자가 된다')

  assert.equal(auth.verifyToken(payload), false, '서명을 뗀 토큰이 통과했다')
  assert.equal(auth.verifyToken(payload + '.'), false)
  assert.equal(auth.verifyToken(payload + '.' + 'A'.repeat(sig.length)), false, '아무 서명이나 통과했다')
  assert.equal(auth.verifyToken(''), false)
  assert.equal(auth.verifyToken(null), false)
  assert.equal(auth.verifyToken('.'), false)
  assert.equal(auth.verifyToken('아무거나'), false)
})

test('★ 지난 토큰은 통과하지 못한다 — 12시간이 지나면 다시 로그인이다', () => {
  const born = Date.now()
  const token = auth.issueToken(born)
  assert.equal(auth.verifyToken(token, born + 11 * 3600_000), true, '11시간 만에 끊겼다')
  assert.equal(auth.verifyToken(token, born + 13 * 3600_000), false, '12시간이 지나도 살아 있다')
})

test('★ 비밀 키를 바꾸면 옛 세션이 전부 끊긴다 — 유출됐을 때 되돌릴 방법이 이것뿐이다', () => {
  const old = auth.issueToken()
  const saved = process.env.ADMIN_SESSION_SECRET
  process.env.ADMIN_SESSION_SECRET = 'completely-different-secret-0123456789'
  try {
    assert.equal(auth.verifyToken(old), false, '키를 바꿔도 옛 토큰이 살아 있다')
  } finally {
    process.env.ADMIN_SESSION_SECRET = saved
  }
  assert.equal(auth.verifyToken(old), true, '키를 되돌렸는데 토큰이 안 살아난다')
})

/* ── 쿠키 읽기 ────────────────────────────────────────────── */

test('★ 다른 쿠키들 사이에서 우리 쿠키만 골라 읽는다', () => {
  const token = auth.issueToken()
  assert.equal(auth.isAdmin(req({ cookie: 'a=1; tc_admin=' + token + '; b=2' })), true, '여러 쿠키 중에서 못 찾았다')
  assert.equal(auth.isAdmin(req({ cookie: 'tc_admin=' + token })), true)
  assert.equal(auth.isAdmin(req({ cookie: 'xtc_admin=' + token })), false, '이름이 비슷한 쿠키에 속았다')
  assert.equal(auth.isAdmin(req({ cookie: 'tc_admin_x=' + token })), false)
  assert.equal(auth.isAdmin(req({})), false, '쿠키가 아예 없는데 통과했다')
  assert.equal(auth.isAdmin(req({ cookie: '' })), false)
})

test('★ 깨진 쿠키에 죽지 않는다 — 여기서 던지면 관리자 API가 통째로 500이 된다', () => {
  /* ★ 실제로 있던 구멍이다.
     쿠키 값은 아무나 아무렇게나 보낼 수 있는 문자열이다. 값을 그대로
     decodeURIComponent에 넣으면 '%' 한 글자에 URIError가 나고, 그 예외는
     isAdmin → requireAdmin → 핸들러 밖으로 그대로 튀어나간다. 그러면
     "로그인하세요"(401)가 아니라 500이 뜬다 — 관리자 화면은 왜 안 되는지
     모른 채 흰 화면이 되고, 서버는 요청마다 예외를 뱉는다.

     서명 비교도 같은 병이었다: 길이를 '글자 수'로 재고 실제 비교는
     '바이트'로 하므로, 한글 43자를 서명 자리에 넣으면 timingSafeEqual이
     길이 불일치로 던졌다. 잠근 문이 두드리는 것만으로 부서지면 안 된다. */
  const cases = [
    'tc_admin=%',
    'tc_admin=%zz',
    'tc_admin=abc%E0%A4%A',
    'tc_admin=eyJ4IjoxfQ.' + '가'.repeat(43), // 글자 수는 맞고 바이트 수는 다른 서명
    'tc_admin',
    '=;;=',
    'tc_admin=a.b; tc_admin=c.d',
  ]
  for (const cookie of cases) {
    assert.equal(auth.isAdmin(req({ cookie })), false, cookie + ' 로 들어와졌다')
  }
})

/* ── 쿠키 속성 ────────────────────────────────────────────── */

test('★ 세션 쿠키는 스크립트가 못 읽고 다른 사이트가 못 쓴다', () => {
  const c = auth.sessionCookie(auth.issueToken())
  assert.match(c, /^tc_admin=/)
  assert.match(c, /HttpOnly/, 'XSS 한 번이면 세션이 통째로 넘어간다')
  assert.match(c, /Secure/, '평문으로 흐르면 중간에서 주워 간다')
  assert.match(c, /SameSite=Strict/, '다른 사이트가 우리 관리자 API를 대신 부를 수 있다')
  assert.match(c, /Path=\//)
  assert.match(c, /Max-Age=\d+/, '만료가 없으면 브라우저에 영원히 남는다')

  const gone = auth.clearCookie()
  assert.match(gone, /Max-Age=0/, '나가기를 눌러도 쿠키가 안 지워진다')
  assert.match(gone, /HttpOnly/)
})

/* ── 관리자 핸들러 ────────────────────────────────────────── */

test('★ 로그인 없이는 관리자 API가 아무것도 내주지 않는다', async () => {
  const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 86_400_000 })).toString('base64url') + '.aaaa'
  const attempts = [
    { name: '쿠키 없음', cookie: undefined },
    { name: '빈 쿠키', cookie: '' },
    { name: '지어낸 토큰', cookie: 'tc_admin=' + forged },
    { name: '값만 admin', cookie: 'tc_admin=true' },
    { name: '깨진 쿠키', cookie: 'tc_admin=%' },
  ]
  const doors: [string, Handler, string][] = [
    ['문의 목록', inquiriesHandler, '/api/admin/inquiries'],
    ['통계', statsHandler, '/api/admin/stats'],
  ]
  for (const [label, handler, url] of doors) {
    for (const a of attempts) {
      const res = fakeRes()
      await handler(req({ url, cookie: a.cookie }), res)
      assert.equal(res.statusCode, 401, label + '이 ' + a.name + '에 ' + res.statusCode + '로 답했다: ' + res.body)
      assert.equal(res.json()?.ok, false)
      // 401이어도 본문에 데이터가 섞이면 안 된다 — 문의에는 사람 연락처가 들어 있다.
      assert.doesNotMatch(res.body, /items|installsTotal|contact/, label + '의 401 응답에 데이터가 섞였다')
    }
  }
})

test('★ 틀린 비밀번호로는 쿠키가 안 나온다', async () => {
  const res = fakeRes()
  await sessionHandler(req({ method: 'POST', body: { password: '아무거나' } }), res)
  assert.equal(res.statusCode, 401, '틀린 비밀번호에 ' + res.statusCode + '로 답했다')
  assert.equal(res.headers['set-cookie'], undefined, '틀렸는데 쿠키를 줬다')
})

test('★ 맞는 비밀번호로 받은 쿠키가 실제로 문을 연다', async () => {
  const login = fakeRes()
  await sessionHandler(req({ method: 'POST', body: { password: PASSWORD } }), login)
  assert.equal(login.statusCode, 200, '맞는 비밀번호가 거절됐다: ' + login.body)

  const setCookie = login.headers['set-cookie']
  assert.ok(setCookie, '로그인에 성공했는데 쿠키가 없다')
  const token = setCookie.slice('tc_admin='.length, setCookie.indexOf(';'))

  /* 저장소를 안 붙였으므로 여기서 나올 수 있는 답은 503("저장소가 없다")이다.
     핵심은 **401이 아니라는 것** — 인증은 통과했다는 뜻이다. */
  const after = fakeRes()
  await inquiriesHandler(req({ cookie: 'tc_admin=' + token }), after)
  assert.notEqual(after.statusCode, 401, '방금 받은 쿠키로도 문이 안 열린다')
  assert.equal(after.statusCode, 503, '저장소가 없을 때의 답이 바뀌었다: ' + after.statusCode + ' ' + after.body)

  // 로그인 상태 확인도 같은 쿠키로 답해야 한다(화면이 처음 뜰 때 이걸 부른다).
  const who = fakeRes()
  await sessionHandler(req({ method: 'GET', cookie: 'tc_admin=' + token }), who)
  assert.equal(who.json()?.admin, true, '로그인했는데 화면엔 로그인 안 한 것으로 보인다')

  const anon = fakeRes()
  await sessionHandler(req({ method: 'GET' }), anon)
  assert.equal(anon.json()?.admin, false, '쿠키 없이도 로그인한 것으로 보인다')
})

test('★ 서버에 비밀번호가 없으면 로그인 자체가 막히고, 왜인지 말한다', async () => {
  const saved = process.env.ADMIN_PASSWORD
  delete process.env.ADMIN_PASSWORD
  try {
    for (const password of ['', undefined, 'ADMIN_PASSWORD']) {
      const res = fakeRes()
      await sessionHandler(req({ method: 'POST', body: { password } }), res)
      assert.equal(res.statusCode, 503, '비밀번호가 없는데 ' + res.statusCode + '로 답했다')
      // 배포한 사람이 읽고 고칠 수 있어야 한다 — "Internal Server Error"면 아무도 못 고친다.
      assert.match(res.json()?.error ?? '', /ADMIN_PASSWORD/, '왜 안 되는지 안 알려준다')
    }
  } finally {
    process.env.ADMIN_PASSWORD = saved
  }
})

test('★ 나가기를 누르면 쿠키가 지워진다', async () => {
  const res = fakeRes()
  await sessionHandler(req({ method: 'DELETE' }), res)
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['set-cookie'] ?? '', /tc_admin=; .*Max-Age=0/, '나가기가 쿠키를 안 지운다')
  assert.equal(res.json()?.admin, false)
})

test('★ 관리자 API는 캐시되지 않는다 — 공유 캐시에 남으면 다음 사람이 본다', async () => {
  const res = fakeRes()
  await inquiriesHandler(req({}), res)
  assert.match(res.headers['cache-control'] ?? '', /no-store/, '관리자 응답이 캐시될 수 있다')
})
