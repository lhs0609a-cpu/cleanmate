import { json, fail, methodGuard, readJson } from './_lib/http.js'
import { configured, cmd } from './_lib/store.js'
import { CATEGORIES, validId, key, publicItem, getItem, readItems, withinLimit, makeItem, owns, insert, transition } from './_lib/community.js'

export default async function handler(req, res) {
  if (methodGuard(req, res, ['GET', 'POST', 'DELETE'])) return
  if (!configured()) return fail(res, 503, '커뮤니티 연결을 준비 중입니다. 잠시 뒤 다시 방문해 주세요.')
  try {
    const url = new URL(req.url, 'http://localhost')
    if (req.method === 'GET') {
      const id = url.searchParams.get('id')
      if (id) {
        const item = await getItem(id)
        if (!item || item.type !== 'post' || item.status !== 'published') return fail(res, 404, '공개된 글을 찾을 수 없습니다.')
        const offset = Math.max(0, Math.min(10000, Number(url.searchParams.get('offset')) || 0))
        const replies = (await readItems(`community:replies:${id}`, offset, 21)).filter(i => i.status === 'published')
        return json(res, 200, { ok: true, item: publicItem(item), replies: replies.slice(0, 20).map(publicItem), more: replies.length > 20 })
      }
      const offset = Math.max(0, Math.min(10000, Number(url.searchParams.get('offset')) || 0))
      const category = url.searchParams.get('category')
      const rows = (await readItems(CATEGORIES.includes(category) ? `community:posts:${category}` : 'community:posts', offset, 21)).filter(i => i.status === 'published')
      return json(res, 200, { ok: true, items: rows.slice(0, 20).map(publicItem), more: rows.length > 20 })
    }
    if (!req.headers['content-type']?.includes('application/json')) return fail(res, 415, 'JSON 형식이 필요합니다.')
    const body = await readJson(req, 16000)
    if (!body || Array.isArray(body)) return fail(res, 400, '내용을 확인해 주세요.')
    if (!await withinLimit(req, req.method === 'DELETE' ? 'delete' : 'write', 8)) return fail(res, 429, '잠시 뒤 다시 시도해 주세요.')
    if (req.method === 'DELETE') {
      const item = await getItem(body.id)
      if (!item || !owns(item, body.password)) return fail(res, 403, '글 번호 또는 삭제 비밀번호가 맞지 않습니다.')
      if (item.status !== 'deleted') await transition(item, 'deleted')
      return json(res, 200, { ok: true })
    }
    if (body.action === 'report') {
      const item = await getItem(body.id)
      if (!item || item.status !== 'published') return fail(res, 404, '공개된 글을 찾을 수 없습니다.')
      if (!['spam', 'personal', 'abuse', 'danger'].includes(body.reason)) return fail(res, 400, '신고 사유를 선택해 주세요.')
      await cmd('EVAL', `local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
        local item=cjson.decode(raw); if item.status~='published' then return 0 end
        item.reports=(item.reports or 0)+1; item.lastReport=ARGV[1];
        redis.call('SET',KEYS[1],cjson.encode(item)); redis.call('ZADD',KEYS[2],ARGV[2],item.id); return 1`,
        2, key(item.id), 'community:reported', body.reason, Date.now())
      return json(res, 200, { ok: true })
    }
    if (body.action !== 'create' || body.consent !== true || body.website) return fail(res, 400, '게시 동의와 입력 내용을 확인해 주세요.')
    const text = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max
    if (!text(body.author, 2, 24) || !text(body.body, 5, 4000) || !text(body.password, 8, 128)) return fail(res, 400, '닉네임 2~24자, 본문 5~4,000자, 삭제 비밀번호 8~128자를 입력해 주세요.')
    let parent = null
    if (body.parent) {
      if (!validId(body.parent)) return fail(res, 400, '답글을 달 게시글을 확인해 주세요.')
      parent = await getItem(body.parent)
      if (!parent || parent.type !== 'post' || parent.status !== 'published') return fail(res, 404, '공개된 게시글에만 댓글을 쓸 수 있습니다.')
    } else if (!text(body.title, 3, 100) || !CATEGORIES.includes(body.category)) return fail(res, 400, '제목 3~100자와 게시판을 선택해 주세요.')
    const item = makeItem({ author: body.author.trim(), body: body.body.trim(), title: parent ? '' : body.title.trim(),
      password: body.password, parent: parent?.id, category: parent?.category || body.category })
    await insert(item)
    return json(res, 201, { ok: true, id: item.id, status: 'pending', message: '접수했습니다. 운영자 확인 후 공개됩니다. 삭제할 때 필요한 글 번호를 보관해 주세요.' })
  } catch (err) {
    return fail(res, err?.tooLong ? 413 : 503, err?.tooLong ? '입력 내용이 너무 깁니다.' : '지금은 처리할 수 없습니다. 입력한 내용은 그대로 두고 다시 시도해 주세요.')
  }
}
