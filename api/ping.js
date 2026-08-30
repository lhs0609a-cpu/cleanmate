/**
 * 익명 설치 신호 — "몇 명이 쓰고 있나"를 세는 유일한 통로
 *
 * ★ 이 함수가 받는 것과 안 받는 것을 여기 못박아 둔다.
 *   받는 것: 설치할 때 만든 임의의 UUID 하나, 앱 버전, OS 이름.
 *   안 받는 것: 파일 이름·경로·용량, 스캔 결과, 사용자 이름, IP(저장 안 함).
 *
 *   랜딩과 앱은 "파일은 기기를 한 바이트도 떠나지 않습니다"라고 약속한다.
 *   그 약속은 **파일**에 대한 것이고, 이 신호에는 파일이 한 조각도 없다.
 *   그래도 앱 설정에서 끌 수 있게 하고, 개인정보 문구에 그대로 적는다 —
 *   숨기고 보내는 순간 저 약속 전체가 못 믿을 말이 된다.
 *
 * ★ 왜 HyperLogLog(PFADD)인가
 *   설치 ID를 집합에 그대로 쌓으면 우리 손에 '기기 목록'이 남는다. HLL은
 *   개수만 남기고 원본을 못 되살린다 — 세는 목적에는 충분하고, 안 남기는
 *   편이 낫다. 키 하나가 12KB를 안 넘는다는 건 덤이다.
 *   (예외가 하나 있다: 'seen:<id>'는 새 설치를 하루 단위로 세려고 잠깐 둔다.
 *    값이 아니라 존재 여부만 쓰고, 400일 뒤 스스로 사라진다.)
 */

import { json, methodGuard, readJson, clientIp, trimStr, todayUTC, appCors } from './_lib/http.js'
import { configured, pipeline, allow } from './_lib/store.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VERSION_RE = /^\d+\.\d+\.\d+$/
const OSES = new Set(['windows', 'macos', 'linux', 'unknown'])
const SEEN_TTL = 400 * 24 * 60 * 60 // 400일 — 1년 넘게 안 켠 설치는 잊는다

export default async function handler(req, res) {
  /* 이 함수만 교차 출처를 연다 — 부르는 쪽이 우리 도메인이 아니라 데스크톱 앱이다.
     프리플라이트(OPTIONS)를 여기서 끝내지 않으면 본 요청은 아예 나가지 않는다. */
  if (appCors(req, res)) return
  if (methodGuard(req, res, ['POST', 'OPTIONS'])) return

  /* 신호는 조용히 실패해야 한다. 앱이 이 응답을 보고 뭘 하지 않기 때문에,
     오류를 자세히 돌려줄 이유가 없다 — 다만 200으로 덮지도 않는다. */
  let body = null
  try { body = await readJson(req, 2048) } catch { body = null }
  if (!body) return json(res, 400, { ok: false })

  const id = trimStr(body.installId, 40)
  if (!UUID_RE.test(id)) return json(res, 400, { ok: false })

  const version = VERSION_RE.test(trimStr(body.version, 20)) ? body.version.trim() : 'unknown'
  const os = OSES.has(body.os) ? body.os : 'unknown'

  // 같은 설치가 1분에 여러 번 보내도 한 번만 센다(재시도·창 여러 개).
  if (!(await allow('ping', id, 3, 60))) return json(res, 200, { ok: true })
  if (!(await allow('ping-ip', clientIp(req), 120, 600))) return json(res, 429, { ok: false })

  if (!configured()) return json(res, 200, { ok: true, stored: false })

  const day = todayUTC()
  const month = day.slice(0, 7)
  try {
    /* SET ... NX 는 '없을 때만' 넣고, 넣었으면 'OK'를 준다. 그 응답으로
       "이 설치를 오늘 처음 봤다"를 알 수 있다 — 새 설치 수가 여기서 나온다. */
    const [firstTime] = await pipeline([['SET', `seen:${id}`, day, 'NX', 'EX', SEEN_TTL]])
    const cmds = [
      ['PFADD', 'inst:all', id],
      ['PFADD', `inst:d:${day}`, id],
      ['PFADD', `inst:m:${month}`, id],
      ['PFADD', `inst:v:${version}`, id],
      ['PFADD', `inst:os:${os}`, id],
      ['SADD', 'inst:versions', version],
      ['SADD', 'inst:oses', os],
      // 일별 활성 키는 오래 둘 이유가 없다 — 대시보드가 최근 60일만 그린다.
      ['EXPIRE', `inst:d:${day}`, 100 * 24 * 60 * 60],
    ]
    if (firstTime === 'OK') cmds.push(['INCR', `inst:new:${day}`], ['EXPIRE', `inst:new:${day}`, 400 * 24 * 60 * 60])
    await pipeline(cmds)
  } catch {
    return json(res, 200, { ok: true, stored: false })
  }

  return json(res, 200, { ok: true, stored: true })
}
