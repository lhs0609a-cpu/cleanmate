/**
 * 상담·제휴 문의 접수
 *
 * ★ 이 함수가 절대 하면 안 되는 것: **받았다고 해놓고 안 받는 것.**
 *   폼은 사람이 시간을 들여 쓴 것이고, 보낸 사람은 답을 기다린다. 저장에
 *   실패했는데 "접수됐습니다"를 띄우면 그 사람은 영영 답을 못 받는다.
 *   그래서 저장이 안 되면 실패로 답하고, 화면이 대체 연락처를 안내한다.
 *
 * 스팸을 막는 방법 셋 — 캡차를 안 쓴다(사람도 같이 막힌다):
 *   1) 허니팟: 사람 눈에 안 보이는 칸이 채워져 있으면 봇이다.
 *   2) 너무 빠른 제출: 폼이 뜨자마자 3초 안에 보내는 건 사람이 아니다.
 *   3) IP당 횟수 제한.
 *   셋 다 걸리면 200으로 답한다 — 봇에게 "막혔다"고 알려주면 우회를 시도한다.
 */

import { json, fail, methodGuard, readJson, clientIp, trimStr, todayUTC } from './_lib/http.js'
import { configured, pipeline, allow } from './_lib/store.js'

/** 문의 종류 — 화면의 선택지와 여기가 어긋나면 관리자 화면에서 '기타'만 쌓인다 */
const KINDS = new Set(['partner', 'service', 'bug', 'etc'])

export default async function handler(req, res) {
  if (methodGuard(req, res, ['POST'])) return

  let body
  try {
    body = await readJson(req)
  } catch (err) {
    /* 사람이 읽을 문장만 그대로 내보낸다. 내부 오류 메시지를 폼 밑에 띄우면
       (영어로) 무슨 일이 난 건지 모른 채 그 사람은 창을 닫는다. */
    if (err?.tooLong) return fail(res, 413, err.message)
    return fail(res, 400, '내용을 읽지 못했습니다.')
  }
  if (!body) return fail(res, 400, '내용을 읽지 못했습니다.')

  // ── 1) 봇 거르기 — 조용히 통과시킨다
  const tooFast = typeof body.elapsedMs === 'number' && body.elapsedMs >= 0 && body.elapsedMs < 3000
  if (trimStr(body.website, 200) || tooFast) {
    return json(res, 200, { ok: true, id: null })
  }

  // ── 2) 값 확인 — 화면에서도 확인하지만, 화면은 우회할 수 있다
  const name = trimStr(body.name, 60)
  const contact = trimStr(body.contact, 160)
  const message = trimStr(body.message, 4000)
  const kind = KINDS.has(body.kind) ? body.kind : 'etc'
  const company = trimStr(body.company, 120)

  if (!name) return fail(res, 400, '이름(또는 상호)을 적어주세요.')
  if (!contact) return fail(res, 400, '연락 받으실 곳(이메일 또는 전화번호)을 적어주세요.')
  if (message.length < 5) return fail(res, 400, '어떤 내용인지 한 줄만 더 적어주세요.')

  // ── 3) 횟수 제한 — 같은 사람이 10분에 5번까지
  const ip = clientIp(req)
  if (!(await allow('inquiry', ip, 5, 600))) {
    return fail(res, 429, '조금 뒤에 다시 보내주세요. 잠깐 사이에 여러 번 접수됐습니다.')
  }

  if (!configured()) {
    /* 저장소가 없으면 정직하게 못 받았다고 한다. 여기서 200을 주는 순간
       이 함수는 '문의를 조용히 버리는 함수'가 된다. */
    return fail(res, 503, '지금은 접수가 되지 않습니다. 잠시 뒤 다시 시도해 주세요.')
  }

  const now = Date.now()
  const record = {
    id: '', // 아래에서 채운다
    at: new Date(now).toISOString(),
    kind,
    name,
    company,
    contact,
    message,
    /* 어디서 들어왔는지 — 어느 문구가 문의를 만드는지 보려는 것.
       추적용 식별자는 저장하지 않는다. 경로 하나면 충분하다. */
    from: trimStr(body.from, 80),
    status: 'new',
    note: '',
  }

  try {
    const [seq] = await pipeline([['INCR', 'inq:seq']])
    record.id = String(seq)
    await pipeline([
      ['SET', `inq:${record.id}`, JSON.stringify(record)],
      ['ZADD', 'inq:ids', now, record.id],
      ['INCR', `inq:count:${todayUTC(now)}`],
    ])
  } catch {
    return fail(res, 503, '지금은 접수가 되지 않습니다. 잠시 뒤 다시 시도해 주세요.')
  }

  return json(res, 200, { ok: true, id: record.id })
}
