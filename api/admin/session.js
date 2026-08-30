/**
 * 관리자 세션 — 들어오기·나가기·지금 들어와 있나
 *
 *   GET     지금 로그인 상태인가 (화면이 처음 뜰 때 부른다)
 *   POST    {password} → 쿠키 발급
 *   DELETE  나가기
 *
 * ★ 로그인 시도에 횟수 제한을 건다.
 *   비밀번호 하나로 잠근 화면에서 이게 없으면 그냥 시간문제다. 10분에 8번.
 *   사람이 오타를 내는 횟수는 여덟 번을 안 넘는다.
 */

import { json, fail, readJson, clientIp } from '../_lib/http.js'
import { allow } from '../_lib/store.js'
import {
  isAdmin, issueToken, sessionCookie, clearCookie, passwordMatches, passwordConfigured,
} from '../_lib/auth.js'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, { ok: true, admin: isAdmin(req) })
  }

  if (req.method === 'DELETE') {
    return json(res, 200, { ok: true, admin: false }, { 'Set-Cookie': clearCookie() })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE')
    return fail(res, 405, `${req.method}는 여기서 받지 않습니다.`)
  }

  if (!passwordConfigured()) {
    /* 비밀번호를 안 정해두면 관리자 화면이 잠기지 않는다. 빈 문자열로 통과시키는
       대신 아예 못 들어오게 하고, 왜 그런지 밝힌다 — 배포자가 읽을 문장이다. */
    return fail(res, 503, '서버에 ADMIN_PASSWORD가 설정돼 있지 않아 로그인할 수 없습니다.')
  }

  if (!(await allow('login', clientIp(req), 8, 600))) {
    return fail(res, 429, '시도가 너무 잦습니다. 10분 뒤에 다시 해주세요.')
  }

  let body = null
  try { body = await readJson(req, 4096) } catch { body = null }
  if (!passwordMatches(body?.password)) {
    return fail(res, 401, '비밀번호가 맞지 않습니다.')
  }

  return json(res, 200, { ok: true, admin: true }, { 'Set-Cookie': sessionCookie(issueToken()) })
}
