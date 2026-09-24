/**
 * 자료실 — 페이지 한 장을 그 자리에서 만들어 내보낸다.
 *
 * ══ 왜 미리 만들어 두지 않나 ═════════════════════════════════════
 *   문서가 34만 장입니다. 정적 파일로 찍으면 배포 파일 수와 빌드 시간이
 *   감당이 안 됩니다. 대신 요청이 오면 그 자리에서 만들고, CDN이 1년 동안
 *   들고 있게 합니다. 같은 주소로 두 번째 오는 요청은 서버까지 오지 않습니다.
 *
 * ══ 크롤러에게 보이는 것 ═════════════════════════════════════════
 *   완성된 HTML입니다. 자바스크립트를 안 돌리는 크롤러(특히 네이버)도
 *   본문을 그대로 읽습니다.
 */

import { resolve } from './_lib/library/combos.js'
import { counts } from './_lib/library/combos.js'
import { searchTargets } from './_lib/library/targets.js'
import {
  renderPage, renderTargetHub, renderCatHub, renderRoot, renderAll,
  renderSearch, renderNotFound,
} from './_lib/library/render.js'

/** CDN이 1년 들고 있게 한다. 내용이 바뀌면 배포가 캐시를 갈아 끼운다. */
const CACHE = 'public, max-age=0, s-maxage=31536000, stale-while-revalidate=86400'
const CACHE_SHORT = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=600'

function html(res, status, body, cache = CACHE) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', cache)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(body)
}

/** 다시 쓸 때마다 세지 않도록 한 번만 세어 둔다. */
let TOTAL = null

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET, HEAD')
    return res.end('Method Not Allowed')
  }

  const url = new URL(req.url, 'http://localhost')
  // 재작성 규칙이 넘겨준 조각. 구분자가 / 일 수도 , 일 수도 있다.
  const raw = url.searchParams.get('path') ?? ''
  const path = raw.split(/[,/]+/).filter(Boolean).join('/')

  const hit = resolve(path)
  if (!hit) return html(res, 404, renderNotFound(), CACHE_SHORT)

  if (hit.redirect) {
    res.statusCode = 301
    res.setHeader('Location', hit.redirect)
    res.setHeader('Cache-Control', CACHE)
    return res.end()
  }

  try {
    switch (hit.kind) {
      case 'root':
        if (TOTAL == null) TOTAL = counts().total
        return html(res, 200, renderRoot(TOTAL))
      case 'cat':
        return html(res, 200, renderCatHub(hit.cat))
      case 'target':
        return html(res, 200, renderTargetHub(hit.target))
      case 'page':
        return html(res, 200, renderPage(hit))
      case 'all':
        return html(res, 200, renderAll(hit.page))
      case 'search': {
        const q = (url.searchParams.get('q') ?? '').slice(0, 80)
        return html(res, 200, renderSearch(q, searchTargets(q)), CACHE_SHORT)
      }
      default:
        return html(res, 404, renderNotFound(), CACHE_SHORT)
    }
  } catch (err) {
    // 페이지 하나가 깨져도 사이트 전체가 500을 내지 않게 한다.
    console.error('library render failed:', path, err)
    return html(res, 500, renderNotFound(), 'no-store')
  }
}
