/**
 * 관리자 로그인 — 비밀번호 하나, 서명된 쿠키 하나
 *
 * ★ 왜 이렇게 작게 만드나
 *   보는 사람이 한 명이다. 계정·역할·비밀번호 재설정을 만들면 코드가 열 배로
 *   늘고, 늘어난 만큼 틀릴 자리가 생긴다. 필요한 건 "나만 본다" 하나다.
 *
 * ★ 그래도 지키는 것 셋 — 여기서 빠지면 관리자 화면이 공개 페이지가 된다
 *   1) 비밀번호 비교를 **일정 시간**으로 한다. 문자열 ===는 앞에서부터
 *      다르면 바로 끝나서, 응답 시간으로 한 글자씩 맞혀볼 수 있다.
 *   2) 쿠키에 **서명**을 붙인다. 서명이 없으면 브라우저에서 값을 고쳐
 *      아무나 관리자가 된다.
 *   3) HttpOnly·Secure·SameSite=Strict. 스크립트가 못 읽고, 다른 사이트에서
 *      우리 API를 대신 부를 수 없다.
 *
 * 환경변수:
 *   ADMIN_PASSWORD        — 필수. 없으면 로그인 자체를 막는다(빈 문자열로 뚫리지 않게).
 *   ADMIN_SESSION_SECRET  — 권장. 없으면 비밀번호에서 파생한다(단, 비밀번호를
 *                           바꾸면 기존 세션이 전부 끊긴다 — 그게 오히려 안전하다).
 */

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto'

const COOKIE = 'tc_admin'
const TTL_SEC = 12 * 60 * 60 // 12시간. 하루 종일 열어두는 화면이 아니다.

function secret() {
  const s = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD
  return s ? `teraclean:${s}` : null
}

export function passwordConfigured() {
  return !!process.env.ADMIN_PASSWORD
}

/** 길이가 달라도 안전하게 비교한다 — timingSafeEqual은 길이가 다르면 던진다. */
export function passwordMatches(given) {
  const real = process.env.ADMIN_PASSWORD
  if (!real || typeof given !== 'string') return false
  /* 두 값을 같은 길이의 해시로 바꿔 놓고 비교한다. 이러면 길이 차이도
     타이밍으로 새지 않고, timingSafeEqual이 던질 일도 없다. */
  const h = (v) => createHmac('sha256', 'teraclean:pw-compare').update(v).digest()
  return timingSafeEqual(h(given), h(real))
}

const b64u = (buf) => Buffer.from(buf).toString('base64url')

function sign(payload) {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

/** 세션 토큰을 만든다: <payload>.<서명> */
export function issueToken(now = Date.now()) {
  const payload = b64u(JSON.stringify({ exp: now + TTL_SEC * 1000, jti: randomUUID() }))
  return `${payload}.${sign(payload)}`
}

/** 토큰이 우리가 발급한 것이고 아직 안 지났는가 */
export function verifyToken(token, now = Date.now()) {
  if (!token || !secret()) return false
  const dot = token.lastIndexOf('.')
  if (dot < 1) return false
  const payload = token.slice(0, dot)
  /* ★ 길이를 '글자 수'가 아니라 '바이트 수'로 잰다.
     토큰은 쿠키에서 오고, 쿠키에는 아무 문자열이나 담긴다. 한글 43자는
     글자 수로는 서명(base64url 43자)과 같지만 바이트로는 129다 —
     그 상태로 timingSafeEqual에 넣으면 길이 불일치로 **던진다**. 그러면
     "로그인하세요"(401)가 아니라 500이 나간다. 잠근 문이 두드리는
     것만으로 부서지면 안 된다. */
  const given = Buffer.from(token.slice(dot + 1), 'utf8')
  const want = Buffer.from(sign(payload), 'utf8')
  // 여기서도 ===를 쓰지 않는다 — 서명 한 글자씩 맞혀보는 걸 막는다.
  if (given.length !== want.length) return false
  if (!timingSafeEqual(given, want)) return false
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof exp === 'number' && exp > now
  } catch {
    return false
  }
}

/**
 * 쿠키 헤더에서 값 하나를 꺼낸다.
 *
 * ★ 여기서 예외가 나면 관리자 API가 통째로 500이 된다.
 *   `decodeURIComponent('%')`는 URIError를 던진다. 쿠키 값은 아무나 아무렇게나
 *   보낼 수 있는 문자열이므로, 그대로 넣으면 `Cookie: tc_admin=%` 한 줄로
 *   requireAdmin 안쪽에서 예외가 튀어나가 401 대신 500이 나간다 —
 *   관리자 화면은 왜 안 되는지 모른 채 흰 화면이 된다.
 *   못 풀면 **원본 그대로** 준다. 어차피 서명 검증에서 걸러진다.
 */
function readCookie(header, name) {
  if (typeof header !== 'string') return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() !== name) continue
    const raw = part.slice(i + 1).trim()
    try { return decodeURIComponent(raw) } catch { return raw }
  }
  return null
}

export function isAdmin(req) {
  return verifyToken(readCookie(req.headers.cookie, COOKIE))
}

/**
 * 로그인·로그아웃 쿠키.
 * Secure를 항상 붙인다 — Vercel은 https뿐이고, 로컬 http에서 안 붙는 건
 * `vercel dev`가 알아서 처리한다. 조건부로 만들면 그 조건이 언젠가 틀린다.
 */
export function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL_SEC}`
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

/** 관리자 전용 함수의 첫 줄에 쓴다. 막았으면 true를 준다. */
export function requireAdmin(req, res) {
  if (isAdmin(req)) return false
  res.statusCode = 401
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify({ ok: false, error: '로그인이 필요합니다.' }))
  return true
}
