/**
 * 자료실 — 사이트맵
 *
 * 사이트맵 한 장에 들어갈 수 있는 주소는 5만 개, 파일 크기는 50MB 까지입니다.
 * 문서가 34만 장이라 나눠 내보내고, 색인 파일로 묶습니다.
 *
 *   /sitemaps/library.xml        색인 (이걸 robots.txt 에 적습니다)
 *   /sitemaps/library-1.xml      1~45,000번째 주소
 *   /sitemaps/library-2.xml      그 다음 45,000개 …
 */

import { walk, counts } from './_lib/library/combos.js'
import { SITE } from './_lib/library/render.js'

const PER_FILE = 45000
const TODAY = new Date().toISOString().slice(0, 10)
const CACHE = 'public, max-age=0, s-maxage=86400, stale-while-revalidate=86400'

let TOTAL = null
function total() {
  if (TOTAL == null) TOTAL = counts().total
  return TOTAL
}

/** 페이지마다 중요도를 다르게 준다. 목차가 낱장보다 먼저 읽히도록. */
function weight(item) {
  if (item.kind === 'root') return { p: '0.9', f: 'weekly' }
  if (item.kind === 'cat') return { p: '0.8', f: 'weekly' }
  if (item.kind === 'target') return { p: '0.7', f: 'monthly' }
  if (item.env) return { p: '0.4', f: 'monthly' }
  return { p: '0.6', f: 'monthly' }
}

function xml(res, body) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.setHeader('Cache-Control', CACHE)
  res.end(body)
}

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET, HEAD')
    return res.end('Method Not Allowed')
  }

  const url = new URL(req.url, 'http://localhost')
  const nRaw = url.searchParams.get('n')
  const files = Math.ceil(total() / PER_FILE)

  // 색인
  if (!nRaw) {
    const rows = Array.from({ length: files }, (_, i) =>
      `  <sitemap><loc>${SITE}/sitemaps/library-${i + 1}.xml</loc><lastmod>${TODAY}</lastmod></sitemap>`)
    return xml(res, `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.join('\n')}
</sitemapindex>`)
  }

  const n = parseInt(nRaw, 10)
  if (!Number.isFinite(n) || n < 1 || n > files) {
    res.statusCode = 404
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600')
    return res.end('Not Found')
  }

  const from = (n - 1) * PER_FILE
  const to = from + PER_FILE
  const out = []
  let i = 0
  for (const item of walk()) {
    if (i >= to) break
    if (i >= from) {
      const { p, f } = weight(item)
      out.push(`  <url><loc>${SITE}${item.path}</loc><lastmod>${TODAY}</lastmod><changefreq>${f}</changefreq><priority>${p}</priority></url>`)
    }
    i++
  }

  return xml(res, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${out.join('\n')}
</urlset>`)
}
