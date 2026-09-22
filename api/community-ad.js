import { json, fail, methodGuard, readJson } from './_lib/http.js'
import { requireAdmin } from './_lib/auth.js'
import { configured, cmd } from './_lib/store.js'
import { withinLimit } from './_lib/community.js'
import { randomUUID } from 'node:crypto'

export function validateSponsor(input) {
  if (!input || typeof input !== 'object' || typeof input.active !== 'boolean') return null
  if (!input.active) return { active: false }
  for (const [field, max] of [['advertiser', 50], ['title', 80], ['description', 160]]) {
    if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > max) return null
  }
  try { const url = new URL(input.url); if (url.protocol !== 'https:' || url.username || url.password) return null } catch { return null }
  return { active: true, advertiser: input.advertiser.trim(), title: input.title.trim(), description: input.description.trim(), url: input.url }
}
export default async function handler(req, res) {
  if (methodGuard(req, res, ['GET', 'POST', 'PUT'])) return
  const admin = req.method === 'PUT' || (req.method === 'GET' && new URL(req.url, 'http://localhost').searchParams.has('admin'))
  if (admin && requireAdmin(req, res)) return
  if (!configured()) return admin ? fail(res, 503, '저장소를 연결해 주세요.') : json(res, 200, { ok: true, sponsor: null })
  try {
    if (req.method === 'PUT') {
      if (!req.headers['content-type']?.includes('application/json')) return fail(res, 415, 'JSON 형식이 필요합니다.')
      const sponsor = validateSponsor(await readJson(req, 4096))
      if (!sponsor) return fail(res, 400, '광고주·제목·설명과 HTTPS 연결 주소를 확인해 주세요.')
      sponsor.id = randomUUID()
      await cmd('SET', 'community:sponsor', JSON.stringify(sponsor))
      return json(res, 200, { ok: true, sponsor })
    }
    const raw = await cmd('GET', 'community:sponsor')
    const sponsor = raw ? JSON.parse(raw) : null
    if (req.method === 'GET') {
      const counts = admin && sponsor?.id ? await cmd('MGET', `community:ad:${sponsor.id}:view`, `community:ad:${sponsor.id}:click`) : null
      return json(res, 200, { ok: true, sponsor: admin || sponsor?.active ? sponsor : null,
        ...(admin ? { metrics: { views: Number(counts?.[0] || 0), clicks: Number(counts?.[1] || 0) } } : {}) })
    }
    if (!req.headers['content-type']?.includes('application/json')) return fail(res, 415, 'JSON 형식이 필요합니다.')
    const body = await readJson(req, 1024)
    if (!sponsor?.active || body?.id !== sponsor.id || !['view', 'click'].includes(body?.event)) return fail(res, 400, '활성 광고를 확인해 주세요.')
    if (!await withinLimit(req, `ad-${sponsor.id}-${body.event}`, 10, 3600)) return json(res, 200, { ok: true })
    await cmd('INCR', `community:ad:${sponsor.id}:${body.event}`)
    return json(res, 200, { ok: true })
  } catch { return fail(res, 503, '광고 설정을 처리하지 못했습니다.') }
}
