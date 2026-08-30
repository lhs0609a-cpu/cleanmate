/**
 * 익명 신호가 약속한 것만 세는가 — 그리고 기기 목록을 안 남기는가
 *
 * ★ 왜 여기까지 테스트하나
 *   랜딩과 앱은 "파일은 기기를 한 바이트도 떠나지 않습니다"를 약속하고,
 *   docs/관리자-설정.md는 한 걸음 더 나가 **"설치 ID 목록이 우리 손에 남지
 *   않는다"**고 적어 뒀다. 그 약속을 지키는 건 문장이 아니라 여기서 나가는
 *   Redis 명령이다. 누군가 세는 게 아쉬워 `SADD inst:ids <id>` 한 줄을
 *   보태는 순간, 우리는 기기 목록을 가진 회사가 된다 — 그리고 아무도 모른다.
 *
 *   web-contract.test.ts는 앱이 **보내는 것**이 셋뿐임을 잠갔다.
 *   이 파일은 서버가 **남기는 것**을 잠근다.
 *
 * ★ 저장소는 fetch를 바꿔 끼워 흉내 낸다(store.js는 fetch 하나로만 부른다).
 *   INCR만 진짜 세는 이유: 횟수 제한이 그 값으로 판단하기 때문이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

type Handler = (req: any, res: any) => Promise<void> | void

process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.invalid'
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'

/** 나간 명령 전부 */
let sent: string[][] = []
/** INCR만 실제로 센다 — 횟수 제한이 이 값으로 판단한다 */
const counters = new Map<string, number>()

globalThis.fetch = (async (url: any, init: any) => {
  const parsed = JSON.parse(String(init?.body ?? '[]'))
  const pipelined = String(url).endsWith('/pipeline')
  const list: string[][] = pipelined ? parsed : [parsed]
  sent.push(...list)
  const results = list.map((c) => {
    if (c[0] === 'INCR') {
      const n = (counters.get(c[1]) ?? 0) + 1
      counters.set(c[1], n)
      return { result: n }
    }
    if (c[0] === 'SET') return { result: 'OK' } // NX가 통했다 = 오늘 처음 본 설치
    return { result: 1 }
  })
  return { ok: true, status: 200, json: async () => (pipelined ? results : results[0]) }
}) as unknown as typeof fetch

const ping = (await import('../api/ping.js')).default as Handler

function fakeRes() {
  const headers: Record<string, string> = {}
  return {
    statusCode: 0,
    body: '',
    headers,
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = String(v) },
    end(b?: string) { this.body = b ?? '' },
    json(): any { try { return JSON.parse(this.body) } catch { return null } },
  }
}

const ID = '3f1e2d4c-5b6a-4c8d-9e0f-1a2b3c4d5e6f'

async function send(body: unknown, ip = '203.0.113.20') {
  const res = fakeRes()
  await ping({
    method: 'POST',
    url: '/api/ping',
    headers: { 'x-forwarded-for': ip },
    body,
    socket: { remoteAddress: ip },
  }, res)
  return res
}

/** 저장 명령(횟수 제한용 rl: 키는 뺀다 — 그건 세는 게 아니라 막는 것이다) */
const stored = () => sent.filter((c) => !String(c[1] ?? '').startsWith('rl:'))

function fresh() {
  sent = []
  counters.clear()
}

/* ── 세는 것 ──────────────────────────────────────────────── */

test('★ 정상 신호는 개수로만 남는다', async () => {
  fresh()
  const res = await send({ installId: ID, version: '0.23.0', os: 'windows' })
  assert.equal(res.statusCode, 200, '신호가 거절됐다: ' + res.body)
  assert.equal(res.json()?.stored, true, '저장했다고 안 한다 — 대시보드가 영원히 0이 된다')

  const cmds = stored()
  const has = (op: string, key: string) => cmds.some((c) => c[0] === op && c[1] === key)
  assert.ok(has('PFADD', 'inst:all'), '전체 설치 수를 안 센다')
  assert.ok(has('PFADD', 'inst:v:0.23.0'), '버전별로 안 센다 — 업데이트가 도달하는지 못 본다')
  assert.ok(has('PFADD', 'inst:os:windows'), 'OS별로 안 센다')
  assert.ok(cmds.some((c) => c[0] === 'PFADD' && /^inst:d:\d{4}-\d{2}-\d{2}$/.test(c[1])), '날짜별로 안 센다')
})

test('★ 설치 ID가 목록으로 남지 않는다 — 문서가 "우리 손에 안 남는다"고 적어 뒀다', async () => {
  fresh()
  await send({ installId: ID, version: '0.23.0', os: 'windows' })

  for (const c of stored()) {
    /* HyperLogLog(PFADD)는 개수만 남기고 원본을 못 되살린다. 집합·목록·정렬집합에
       ID가 들어가는 순간 그건 '기기 목록'이다. */
    if (['SADD', 'LPUSH', 'RPUSH', 'ZADD', 'HSET'].includes(c[0])) {
      assert.ok(!c.slice(2).includes(ID), c[0] + ' ' + c[1] + ' 에 설치 ID가 값으로 들어갔다 — 목록이 남는다')
    }
  }

  /* 예외는 'seen:<id>' 하나뿐이고(새 설치를 하루 단위로 세려고 둔다),
     그건 반드시 스스로 사라져야 한다. TTL이 빠지면 영구 보관이 된다. */
  const seen = stored().find((c) => c[0] === 'SET' && String(c[1]).startsWith('seen:'))
  assert.ok(seen, '새 설치를 가려내는 자리가 사라졌다')
  assert.ok(seen!.includes('NX'), 'NX가 없으면 매번 새 설치로 센다')
  const ex = seen!.indexOf('EX')
  assert.ok(ex > 0 && Number(seen![ex + 1]) > 0, 'seen: 키에 만료가 없다 — 설치 ID가 영원히 남는다')
})

test('★ 파일에 대한 건 한 조각도 저장되지 않는다', async () => {
  fresh()
  // 앱은 이런 걸 안 보낸다. 그래도 서버가 받아 적으면 안 된다.
  await send({
    installId: ID,
    version: '0.23.0',
    os: 'windows',
    path: 'C:\\Users\\나\\Documents\\세금.xlsx',
    scanned: 383_430,
    bytes: 120_300_000_000,
    user: '이희수',
  })
  const dump = JSON.stringify(stored())
  for (const leak of ['세금.xlsx', 'Users', '383430', '이희수']) {
    assert.doesNotMatch(dump, new RegExp(leak), leak + ' 이(가) 저장 명령에 실렸다')
  }
})

/* ── 안 세는 것 ───────────────────────────────────────────── */

test('★ 형식이 안 맞는 신호는 아무것도 안 센다 — 숫자가 부풀면 실측이 아니다', async () => {
  for (const body of [
    { version: '0.23.0', os: 'windows' },                       // ID 없음
    { installId: 'not-a-uuid', version: '0.23.0', os: 'linux' }, // 아무 문자열
    { installId: ID.replace(/-/g, ''), version: '0.23.0' },      // 하이픈 없는 것
    null,
  ]) {
    fresh()
    const res = await send(body)
    assert.equal(res.statusCode, 400, JSON.stringify(body) + ' 가 통과했다')
    assert.equal(sent.length, 0, '거절해놓고 세기는 했다')
  }
})

test('★ 모르는 버전·OS는 키를 오염시키지 않고 unknown으로 모인다', async () => {
  fresh()
  await send({ installId: ID, version: '0.23.0-beta; DEL *', os: 'AndroidTV' })
  const keys = stored().map((c) => String(c[1]))
  assert.ok(keys.includes('inst:v:unknown'), '이상한 버전 문자열이 그대로 키가 됐다: ' + keys.join(', '))
  assert.ok(keys.includes('inst:os:unknown'), '모르는 OS가 그대로 키가 됐다')
  assert.doesNotMatch(keys.join(' '), /DEL/, '보낸 문자열이 키에 그대로 들어갔다')
})

test('★ 같은 설치가 연달아 보내도 한 번만 센다 — 창을 여러 개 켜면 두 대가 된다', async () => {
  fresh()
  const counted = []
  for (let i = 0; i < 5; i++) {
    sent = []
    const res = await send({ installId: ID, version: '0.23.0', os: 'windows' })
    assert.equal(res.statusCode, 200, '재시도를 오류로 답했다 — 앱이 이걸 반복한다')
    counted.push(stored().some((c) => c[0] === 'PFADD'))
  }
  assert.ok(counted.slice(-1)[0] === false, '1분에 다섯 번을 다 셌다 — 활성 기기 수가 부풀려진다')
  assert.ok(counted[0] === true, '첫 신호를 안 셌다')
})

test('★ 저장소가 흔들려도 앱에는 오류를 내지 않는다 — 통계 때문에 사용자 화면이 깨지면 안 된다', async () => {
  fresh()
  const real = globalThis.fetch
  globalThis.fetch = (async () => { throw new Error('저장소가 죽었다') }) as unknown as typeof fetch
  try {
    const res = await send({ installId: ID, version: '0.23.0', os: 'windows' }, '203.0.113.21')
    assert.equal(res.statusCode, 200, '통계 저장이 실패했다고 앱에 오류를 돌려줬다')
    // 다만 "저장했다"고 하지는 않는다 — 우리가 우리를 속이면 대시보드가 거짓이 된다.
    assert.equal(res.json()?.stored, false, '저장에 실패했는데 저장했다고 답했다')
  } finally {
    globalThis.fetch = real
  }
})
