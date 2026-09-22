import { requireAdmin } from '../_lib/auth.js'
import { json, fail, methodGuard, readJson } from '../_lib/http.js'
import { configured } from '../_lib/store.js'
import { readItems, getItem, publicItem, transition } from '../_lib/community.js'

export default async function handler(req, res) {
  if (requireAdmin(req, res) || methodGuard(req, res, ['GET', 'PATCH'])) return
  if (!configured()) return fail(res, 503, '커뮤니티 저장소를 연결해 주세요.')
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost')
      const index = url.searchParams.get('status') === 'reported' ? 'community:reported' : 'community:pending'
      const items = await readItems(index, 0, 100)
      return json(res, 200, { ok: true, items: items.map(i => ({ ...publicItem(i), status: i.status, reports: i.reports, lastReport: i.lastReport })) })
    }
    if (!req.headers['content-type']?.includes('application/json')) return fail(res, 415, 'JSON 형식이 필요합니다.')
    const body = await readJson(req, 2048)
    if (!['published', 'hidden'].includes(body?.status)) return fail(res, 400, '공개 또는 숨김을 선택해 주세요.')
    const item = await getItem(body.id)
    if (!item || item.status === 'deleted') return fail(res, 404, '글을 찾을 수 없습니다.')
    const result = await transition(item, body.status)
    if (result !== 1) return fail(res, 409, '원글이 공개 상태인지 확인하고 새로고침해 주세요.')
    return json(res, 200, { ok: true })
  } catch { return fail(res, 503, '커뮤니티를 처리하지 못했습니다. 다시 시도해 주세요.') }
}
