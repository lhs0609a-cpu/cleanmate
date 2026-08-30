/**
 * 관리자 통계 — 몇 명이 받아 갔고, 몇 대가 실제로 켜고 있나
 *
 * ★ 이 화면이 지키는 원칙: **모르는 건 모른다고 쓴다.**
 *   퍼널의 칸마다 출처가 다르고, 어떤 칸은 아예 못 잰다.
 *
 *     내려받음   GitHub 릴리스 자산의 download_count — 실측
 *     설치됨     앱이 처음 켜질 때 보낸 익명 신호의 고유 수 — 실측
 *     오늘/이번 달 켠 수                                — 실측
 *     "설치했지만 안 켠 사람"                            — 못 잼(신호가 없다)
 *
 *   내려받았지만 설치 안 한 사람은 우리가 절대 못 센다. 그 칸을 추정치로
 *   채우면 대시보드 전체가 추측이 된다. 그래서 두 숫자를 나란히 놓고
 *   차이만 보여준다 — 해석은 사람이 한다.
 */

import { json, fail, todayUTC } from '../_lib/http.js'
import { requireAdmin } from '../_lib/auth.js'
import { configured, pipeline } from '../_lib/store.js'
import { downloadStats } from '../_lib/github.js'

/** 오늘로부터 n일 전까지의 날짜들 (오래된 것 먼저) */
function lastDays(n, today = todayUTC()) {
  const base = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))
  return Array.from({ length: n }, (_, i) => new Date(base - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10))
}

/** 최근 n개월 'YYYY-MM' (오래된 것 먼저) */
function lastMonths(n, today = todayUTC()) {
  const y = +today.slice(0, 4)
  const m = +today.slice(5, 7)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

export default async function handler(req, res) {
  if (requireAdmin(req, res)) return
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return fail(res, 405, `${req.method}는 여기서 받지 않습니다.`)
  }

  const today = todayUTC()
  const days = lastDays(30, today)
  const months = lastMonths(6, today)

  /* 다운로드는 GitHub, 나머지는 Redis. 둘 중 하나가 죽어도 나머지는 보여준다 —
     한쪽이 안 된다고 화면 전체를 비우면 아무것도 못 본다. */
  const [downloads, redis] = await Promise.all([
    downloadStats().catch(() => null),
    configured() ? readRedis(days, months) : Promise.resolve(null),
  ])

  return json(res, 200, {
    ok: true,
    at: new Date().toISOString(),
    today,
    downloads,
    ...(redis ?? { storeConnected: false }),
  })
}

async function readRedis(days, months) {
  try {
    const cmds = [
      ['PFCOUNT', 'inst:all'],
      ['SMEMBERS', 'inst:versions'],
      ['SMEMBERS', 'inst:oses'],
      ['ZCARD', 'inq:ids'],
      ...days.map((d) => ['PFCOUNT', `inst:d:${d}`]),
      ...days.map((d) => ['GET', `inst:new:${d}`]),
      ...days.map((d) => ['GET', `inq:count:${d}`]),
      ...months.map((m) => ['PFCOUNT', `inst:m:${m}`]),
    ]
    const r = await pipeline(cmds)

    let i = 0
    const installsTotal = Number(r[i++]) || 0
    const versions = Array.isArray(r[i]) ? r[i] : []
    i++
    const oses = Array.isArray(r[i]) ? r[i] : []
    i++
    const inquiriesTotal = Number(r[i++]) || 0

    const active = days.map((d, k) => ({ date: d, count: Number(r[i + k]) || 0 }))
    i += days.length
    const fresh = days.map((d, k) => ({ date: d, count: Number(r[i + k]) || 0 }))
    i += days.length
    const inquiries = days.map((d, k) => ({ date: d, count: Number(r[i + k]) || 0 }))
    i += days.length
    const monthly = months.map((m, k) => ({ month: m, count: Number(r[i + k]) || 0 }))

    // 버전·OS별 고유 설치 수는 목록을 먼저 받아야 키를 안다 — 그래서 한 번 더 왕복한다.
    const breakdownCmds = [
      ...versions.map((v) => ['PFCOUNT', `inst:v:${v}`]),
      ...oses.map((o) => ['PFCOUNT', `inst:os:${o}`]),
    ]
    const b = breakdownCmds.length ? await pipeline(breakdownCmds) : []
    const byVersion = versions
      .map((v, k) => ({ version: v, count: Number(b[k]) || 0 }))
      .sort((a, c) => c.count - a.count)
    const byOs = oses
      .map((o, k) => ({ os: o, count: Number(b[versions.length + k]) || 0 }))
      .sort((a, c) => c.count - a.count)

    return {
      storeConnected: true,
      installsTotal,
      activeToday: active[active.length - 1]?.count ?? 0,
      activeMonth: monthly[monthly.length - 1]?.count ?? 0,
      inquiriesTotal,
      active,
      fresh,
      inquiries,
      monthly,
      byVersion,
      byOs,
    }
  } catch {
    return { storeConnected: false }
  }
}
