/**
 * 들어온 문의 보기·상태 바꾸기 (관리자 전용)
 *
 *   GET   ?limit=&cursor=&status=   최근 것부터
 *   PATCH {id, status?, note?}      처리 상태·메모
 *
 * ★ 상태를 왜 두나
 *   문의가 스무 개만 쌓여도 "어디까지 답했더라"를 못 세게 된다. 그러면
 *   답 못 받은 사람이 생기고, 그 사람은 두 번 다시 안 쓴다. 목록이 아니라
 *   **처리 여부**가 이 화면의 핵심이다.
 *
 * ★ 지우기는 없다.
 *   실수로 한 번 누르면 돌아오지 않는 버튼을, 하루에 몇 번씩 보는 화면에
 *   둘 이유가 없다. 끝난 건 '완료'로 접힌다 — 이 제품이 파일을 다루는 방식과
 *   같은 원칙이다(지우기 전에 보여주고, 되돌릴 수 있게).
 */

import { json, fail, readJson, trimStr } from '../_lib/http.js'
import { requireAdmin } from '../_lib/auth.js'
import { configured, cmd, pipeline } from '../_lib/store.js'

const STATUSES = new Set(['new', 'doing', 'done'])
const MAX_LIMIT = 100

export default async function handler(req, res) {
  if (requireAdmin(req, res)) return
  if (!configured()) return fail(res, 503, '저장소가 연결돼 있지 않습니다. Vercel에서 Upstash Redis를 연결해 주세요.')

  if (req.method === 'GET') return list(req, res)
  if (req.method === 'PATCH') return patch(req, res)

  res.setHeader('Allow', 'GET, PATCH')
  return fail(res, 405, `${req.method}는 여기서 받지 않습니다.`)
}

async function list(req, res) {
  const url = new URL(req.url, 'http://x')
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || 50))
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
  const status = url.searchParams.get('status')

  try {
    // 최근 것부터. ZRANGE ... REV 는 Redis 6.2+ 문법이고 Upstash가 지원한다.
    const ids = (await cmd('ZRANGE', 'inq:ids', '+inf', '-inf', 'BYSCORE', 'REV', 'LIMIT', offset, limit)) ?? []
    const total = Number(await cmd('ZCARD', 'inq:ids')) || 0
    if (!ids.length) return json(res, 200, { ok: true, items: [], total, offset, limit })

    const raw = await pipeline(ids.map((id) => ['GET', `inq:${id}`]))
    let items = raw
      .map((s) => { try { return s ? JSON.parse(s) : null } catch { return null } })
      .filter(Boolean)

    // 상태 거르기는 여기서 한다 — 상태별 색인을 따로 두면 둘이 어긋날 자리가 생긴다.
    if (STATUSES.has(status)) items = items.filter((i) => (i.status || 'new') === status)

    return json(res, 200, { ok: true, items, total, offset, limit })
  } catch (err) {
    return fail(res, 502, `문의를 읽지 못했습니다: ${err.message}`)
  }
}

async function patch(req, res) {
  let body = null
  try { body = await readJson(req, 8192) } catch { body = null }
  const id = trimStr(body?.id, 32)
  if (!id) return fail(res, 400, '어떤 문의인지 id가 필요합니다.')

  const status = STATUSES.has(body?.status) ? body.status : null
  const note = typeof body?.note === 'string' ? trimStr(body.note, 2000) : null
  if (!status && note === null) return fail(res, 400, '바꿀 내용이 없습니다.')

  try {
    const raw = await cmd('GET', `inq:${id}`)
    if (!raw) return fail(res, 404, '그런 문의가 없습니다.')
    const record = JSON.parse(raw)
    if (status) record.status = status
    if (note !== null) record.note = note
    record.updatedAt = new Date().toISOString()
    await cmd('SET', `inq:${id}`, JSON.stringify(record))
    return json(res, 200, { ok: true, item: record })
  } catch (err) {
    return fail(res, 502, `저장하지 못했습니다: ${err.message}`)
  }
}
