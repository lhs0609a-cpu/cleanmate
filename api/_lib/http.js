/**
 * 서버 함수들이 공통으로 쓰는 것 — 응답·본문 읽기·방문자 식별
 *
 * 원칙 하나: **오류 메시지는 사람이 읽을 한국어로 준다.**
 * 이 API를 부르는 건 우리 화면이고, 화면은 받은 문장을 거의 그대로 보여준다.
 * "Internal Server Error"가 상담 폼 밑에 뜨면 그 사람은 그냥 창을 닫는다.
 */

/** JSON 응답. 캐시는 기본으로 끈다 — 통계·문의는 캐시되면 틀린 걸 보여준다. */
export function json(res, status, body, headers = {}) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(JSON.stringify(body))
}

export function fail(res, status, message) {
  json(res, status, { ok: false, error: message })
}

/** 허용한 메서드가 아니면 405. 지원 목록을 Allow 헤더로 밝힌다. */
export function methodGuard(req, res, allowed) {
  if (allowed.includes(req.method)) return false
  res.setHeader('Allow', allowed.join(', '))
  fail(res, 405, `${req.method}는 여기서 받지 않습니다.`)
  return true
}

/**
 * 본문을 JSON으로 읽는다.
 *
 * Vercel의 Node 런타임은 대개 req.body를 미리 채워 주지만, 그건 요청 헤더에
 * 달려 있다. 안 채워졌을 때 undefined를 그대로 쓰면 "왜 가끔 빈 문의가
 * 들어오지"가 된다 — 그래서 직접 읽는 길을 항상 남겨둔다.
 *
 * ★ 던지는 건 "너무 길다" 하나뿐이다.
 *   부르는 쪽(api/inquiry.js)은 여기서 나온 예외를 413으로 바꿔 **그 문구를
 *   폼 밑에 그대로 보여준다.** 그래서 읽다 끊긴 요청까지 같이 던지면
 *   "req is not async iterable" 같은 영어 내부 문구가 사람 눈앞에 뜬다.
 *   길이 말고는 전부 null로 돌려 400("내용을 읽지 못했습니다")이 되게 한다.
 */
export async function readJson(req, limitBytes = 32 * 1024) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body) } catch { return null }
  }
  const chunks = []
  let size = 0
  try {
    for await (const c of req) {
      size += c.length
      if (size > limitBytes) {
        const err = new Error('보내신 내용이 너무 깁니다.')
        err.tooLong = true
        throw err
      }
      chunks.push(c)
    }
  } catch (err) {
    if (err?.tooLong) throw err
    return null
  }
  if (!chunks.length) return null
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return null }
}

/**
 * 요청자 식별 — 초과 요청 차단에만 쓴다.
 *
 * ★ 원본 IP를 저장하지 않는다. 여기서 나온 값은 rate limit 키와
 *   해시된 형태로만 쓰이고, 문의 레코드에는 들어가지 않는다.
 */
export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim()
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown'
}

/** 오늘(UTC) — 통계 키를 만들 때 쓴다. 서버 시간대에 따라 흔들리면 안 된다. */
export function todayUTC(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10)
}

/** 문자열을 안전한 길이로 자른다. 없거나 빈 값이면 '' */
export function trimStr(v, max) {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, max)
}

/**
 * 데스크톱 앱만 열어주는 교차 출처 허용
 *
 * ★ 이게 없으면 익명 신호는 **한 건도 안 들어온다.**
 *   랜딩·관리자 화면은 같은 도메인에서 자기 API를 부르니 아무 문제가 없다.
 *   그런데 데스크톱 앱은 다르다 — 앱 화면의 출처는 `http://tauri.localhost`이고
 *   신호는 우리 배포 도메인으로 간다. 브라우저(WebView2)는 이걸 교차 출처로
 *   보고, `Content-Type: application/json`이 붙어 있으니 먼저 OPTIONS를 던진다.
 *   그 OPTIONS에 허용 헤더가 없으면 본 요청은 아예 나가지 않는다.
 *   app.ts의 sendPing은 실패를 조용히 삼키므로(그게 맞다) **아무도 모른 채**
 *   대시보드의 '설치된 기기'가 영원히 0에 머문다.
 *
 * ★ 왜 `*`를 안 쓰나
 *   `*`로 열면 아무 웹페이지나 우리 숫자를 부풀릴 수 있다. 이 저장소가 파는
 *   대시보드는 '실측'이라고 적혀 있는 숫자다 — 아무나 쓸 수 있는 문을 달아두면
 *   그 글자가 거짓이 된다. 그래서 앱이 실제로 쓰는 출처만 적는다.
 *   (curl로는 출처를 지어낼 수 있다. 이건 브라우저에서 오는 장난을 막는 문이지
 *    인증이 아니다 — 그래서 이 문 안쪽은 여전히 횟수 제한으로 막는다.)
 *
 * 허용한 출처가 아니면 아무 헤더도 안 붙인다. 그러면 브라우저가 알아서 막는다.
 * @returns {boolean} true면 여기서 응답을 끝냈다(프리플라이트) — 호출부는 그냥 return
 */
const APP_ORIGINS = new Set([
  'http://tauri.localhost', // Windows (WebView2)
  'https://tauri.localhost', // Windows, dangerousUseHttpScheme=false 인 경우
  'tauri://localhost', // macOS · Linux (WKWebView / WebKitGTK)
  'http://localhost:5173', // tauri dev — devUrl
  'http://127.0.0.1:5173',
])

export function appCors(req, res, methods = 'POST, OPTIONS') {
  const origin = req.headers.origin
  if (origin && APP_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    // 출처마다 답이 다르므로 캐시가 섞이면 안 된다.
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', methods)
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Max-Age', '86400') // 하루에 한 번 보내는데 매번 물을 이유가 없다
  }
  if (req.method === 'OPTIONS') {
    // 허용 목록에 없는 출처에도 204를 준다. 뭘 허용하는지는 위 헤더의 유무로만
    // 답한다 — 여기서 403을 주면 우리가 어떤 출처를 아는지를 알려주는 셈이다.
    res.statusCode = 204
    res.end()
    return true
  }
  return false
}
