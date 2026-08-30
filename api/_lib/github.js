/**
 * GitHub 릴리스에서 다운로드 수를 읽는다 — 오늘 공짜로 되는 유일한 실측
 *
 * ★ 왜 서버에서 읽고 캐시하나
 *   scripts/download-counts.mjs는 사람이 가끔 부르는 용도라 그냥 불러도 됐다.
 *   이건 다르다. 방문자마다 부르면 **api.github.com의 시간당 60회 한도**를
 *   금방 태운다 — 서버리스 함수들이 IP를 나눠 쓰기 때문에 방문자 60명이면
 *   끝이다. 그다음 방문자는 전부 빈 숫자를 본다.
 *
 *   그래서 Redis에 10분 캐시를 둔다. 10분이면 다운로드 수처럼 천천히 자라는
 *   숫자엔 충분히 최신이고, 한도는 시간당 6회만 쓴다.
 */

import { configured, cmd } from './store.js'

const REPO = 'lhs0609a-cpu/teraclean-releases'
const API = `https://api.github.com/repos/${REPO}/releases?per_page=100`
const CACHE_KEY = 'gh:releases'
const CACHE_SEC = 600

/**
 * @returns {Promise<{total:number, latest:string|null, releases:{version:string,published:string,total:number}[], cached:boolean}|null>}
 *   못 읽으면 null. 부르는 쪽이 "모른다"를 그대로 보여주게 — 0으로 채우지 않는다.
 *   (0은 "아무도 안 받았다"는 뜻이고, 그건 사실이 아니다.)
 */
export async function downloadStats() {
  if (configured()) {
    try {
      const hit = await cmd('GET', CACHE_KEY)
      if (hit) return { ...JSON.parse(hit), cached: true }
    } catch { /* 캐시가 없거나 흔들렸을 뿐 — 그냥 원본을 읽는다 */ }
  }

  let releases
  try {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'teraclean-admin' }
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    const res = await fetch(API, { headers })
    if (!res.ok) return null
    releases = await res.json()
    if (!Array.isArray(releases)) return null
  } catch {
    return null
  }

  const rows = releases.map((r) => ({
    version: String(r.tag_name ?? '').replace(/^v/, ''),
    published: r.published_at ? r.published_at.slice(0, 10) : '',
    total: (r.assets ?? []).reduce((n, a) => n + (a.download_count ?? 0), 0),
  }))
  const data = {
    total: rows.reduce((n, r) => n + r.total, 0),
    latest: rows[0]?.version ?? null,
    releases: rows,
  }

  if (configured()) {
    try { await cmd('SET', CACHE_KEY, JSON.stringify(data), 'EX', CACHE_SEC) } catch { /* 캐시는 있으면 좋은 것 */ }
  }
  return { ...data, cached: false }
}
