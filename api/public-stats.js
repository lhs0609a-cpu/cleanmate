/**
 * 랜딩이 쓰는 공개 숫자 — 실측한 것만
 *
 * ★ 왜 이 함수가 따로 있나
 *   랜딩은 지금 브라우저에서 직접 api.github.com을 부른다(web/src/landing.ts).
 *   버전 하나 읽는 데는 그걸로 충분했다. 그런데 다운로드 수까지 읽으려면
 *   릴리스를 전부 받아야 하고, 그러면 방문자마다 GitHub 한도(시간당 60회)를
 *   태운다. 서버에서 한 번 읽어 10분 캐시하면 방문자가 몇이든 한도가 안 는다.
 *
 * ★ 숫자를 부풀리지 않는다.
 *   "1,000+" 같은 반올림도 안 한다. 이 제품은 실측한 숫자를 그대로 쓰는 것으로
 *   신뢰를 얻고 있고(랜딩의 40.7GB·14.6GB가 전부 실측이다), 여기서 한 번
 *   봐주면 나머지 숫자도 같이 의심받는다. 못 읽으면 null을 주고,
 *   화면은 그 자리를 아예 비운다.
 */

import { json, fail } from './_lib/http.js'
import { downloadStats } from './_lib/github.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return fail(res, 405, `${req.method}는 여기서 받지 않습니다.`)
  }

  const d = await downloadStats().catch(() => null)

  /* 이 응답만은 캐시를 허용한다 — 10분이면 랜딩엔 충분히 최신이고,
     CDN이 받아주면 함수 호출 자체가 줄어든다. */
  json(
    res,
    200,
    {
      ok: true,
      downloads: d ? d.total : null,
      latest: d ? d.latest : null,
    },
    { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800' }
  )
}
