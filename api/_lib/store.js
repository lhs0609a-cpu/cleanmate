/**
 * Upstash Redis — REST로만 쓴다 (의존성 0)
 *
 * ★ 왜 SDK를 안 쓰나
 *   이 저장소의 엔진은 외부 의존성이 0이다(docs/배포-아키텍처.md §0). 그 원칙을
 *   서버 쪽에서도 지킨다. Upstash는 HTTP 하나로 다 되는 REST API를 준다 —
 *   `POST <url>` 에 `["SET","key","value"]` 를 던지면 끝이다. SDK가 하는 일은
 *   그 fetch를 감싸는 것뿐인데, 그 대가로 node_modules와 잠금 파일과 공급망이
 *   따라온다. 넣지 않는다.
 *
 * ★ 없으면 조용히 죽는다 — 단, 거짓말은 안 한다
 *   환경변수가 없으면(로컬에서 그냥 켰을 때) 저장이 안 되는 게 정상이다.
 *   그때 "저장했습니다"라고 답하면 문의가 통째로 사라진다. 그래서
 *   configured()가 false면 호출부가 503으로 정직하게 답하게 한다.
 *
 * 필요한 환경변수 (Vercel → Storage → Upstash Redis 연결하면 자동으로 들어온다):
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

const URL_ = process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

export function configured() {
  return !!(URL_ && TOKEN)
}

/**
 * 명령 하나. 실패하면 던진다 — 부르는 쪽이 정하게.
 * @param {(string|number)[]} cmd 예: ['SET','k','v']
 */
export async function cmd(...args) {
  if (!configured()) throw new Error('저장소가 연결돼 있지 않습니다 (UPSTASH_REDIS_REST_* 없음)')
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args.map(String)),
  })
  if (!res.ok) throw new Error(`저장소가 ${res.status}로 답했습니다`)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.result
}

/**
 * 여러 명령을 한 번의 왕복으로. 통계 화면은 스무 개쯤 읽는데,
 * 하나씩 부르면 왕복이 스무 번이라 화면이 눈에 띄게 늦어진다.
 * @param {(string|number)[][]} cmds
 * @returns {Promise<any[]>} 각 명령의 result. 개별 실패는 null로 온다.
 */
export async function pipeline(cmds) {
  if (!configured()) throw new Error('저장소가 연결돼 있지 않습니다 (UPSTASH_REDIS_REST_* 없음)')
  if (!cmds.length) return []
  const res = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds.map((c) => c.map(String))),
  })
  if (!res.ok) throw new Error(`저장소가 ${res.status}로 답했습니다`)
  const json = await res.json()
  return json.map((r) => (r && r.error ? null : r?.result ?? null))
}

/**
 * 아주 단순한 초과 요청 차단.
 *
 * 정교한 걸 만들지 않는 이유: 이 API가 막아야 하는 건 분산 공격이 아니라
 * "폼 하나를 스크립트로 천 번 누르는 것"이다. 그건 IP당 카운터 하나로 막힌다.
 *
 * @param {string} bucket 무엇에 대한 제한인지 (예: 'inquiry')
 * @param {string} who 보통 IP
 * @param {number} limit 창 안에서 허용할 횟수
 * @param {number} windowSec 창 길이(초)
 * @returns {Promise<boolean>} true면 통과, false면 막힌 것
 */
export async function allow(bucket, who, limit, windowSec) {
  // 저장소가 없으면 막지 못한다 — 그렇다고 전부 차단하면 로컬에서 아무것도 못 한다.
  if (!configured()) return true
  const key = `rl:${bucket}:${who}:${Math.floor(Date.now() / (windowSec * 1000))}`
  try {
    const [n] = await pipeline([
      ['INCR', key],
      ['EXPIRE', key, windowSec],
    ])
    return Number(n) <= limit
  } catch {
    // 저장소가 잠깐 흔들렸다고 정상 사용자를 막지 않는다.
    return true
  }
}
