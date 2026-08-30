/**
 * 상담 폼이 받은 것을 실제로 받는가 — 그리고 안 받았을 때 받았다고 하지 않는가
 *
 * ★ 왜 동작으로 확인해야 하나
 *   web-contract.test.ts는 `fail(res, 503`이라는 글자가 소스에 있는지를 본다.
 *   그 글자가 있어도 그 가지에 못 닿으면 소용이 없다. 이 함수가 틀리는 방식은
 *   딱 하나로 모인다 — **"접수됐습니다"를 띄우고 아무 데도 안 남기는 것.**
 *   그러면 보낸 사람은 답을 기다리고, 우리는 문의가 없는 줄 안다. 양쪽 다
 *   아무도 이상한 걸 못 느낀다. 화면에 오류가 안 뜨기 때문이다.
 *
 * ★ Redis 없이 저장 경로까지 확인한다.
 *   store.js는 `fetch` 하나로만 Upstash를 부른다(SDK 없음). 그래서 fetch를
 *   가짜로 바꿔 끼우면 **실제로 어떤 명령이 나가는지**를 그대로 볼 수 있다.
 *   여기서 확인하는 것 중 제일 중요한 건 "저장되는 레코드에 IP가 안 섞인다"다 —
 *   문서(docs/관리자-설정.md)가 그렇게 약속하고 있고, 약속은 코드가 지킨다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

type Handler = (req: any, res: any) => Promise<void> | void

/* store.js는 이 두 값을 **불러올 때** 읽는다 — import보다 먼저 넣어야 한다. */
const FAKE_URL = 'https://fake-upstash.invalid'
process.env.UPSTASH_REDIS_REST_URL = FAKE_URL
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'

/** 나간 Upstash 명령들. 테스트마다 비운다. */
let sent: string[][] = []
/** 다음 fetch를 실패시킬지 — 저장이 깨졌을 때의 답을 보려고 */
let failNext = false

globalThis.fetch = (async (url: any, init: any) => {
  if (failNext) throw new Error('저장소가 죽었다')
  const cmds = JSON.parse(String(init?.body ?? '[]'))
  const pipelined = String(url).endsWith('/pipeline')
  const list: string[][] = pipelined ? cmds : [cmds]
  sent.push(...list)
  /* 카운터(INCR)는 1을 준다 — 횟수 제한에 안 걸리고, 문의 번호는 1이 된다. */
  const results = list.map(() => ({ result: 1 }))
  return {
    ok: true,
    status: 200,
    json: async () => (pipelined ? results : results[0]),
  }
}) as unknown as typeof fetch

const inquiry = (await import('../api/inquiry.js')).default as Handler

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

/** 사람이 제대로 채운 폼 — 각 테스트에서 한 군데씩 망가뜨려 쓴다 */
const GOOD = {
  kind: 'partner',
  name: '깨끗한이사',
  company: '깨끗한이사 주식회사',
  contact: 'clean@example.com',
  message: '제휴 문의드립니다. 서울 강서구에서 정리수납 일을 하고 있습니다.',
  website: '',
  elapsedMs: 42_000,
  from: '/#contact',
}

function post(body: unknown, ip = '203.0.113.10') {
  return {
    method: 'POST',
    url: '/api/inquiry',
    headers: { 'x-forwarded-for': ip },
    body,
    socket: { remoteAddress: ip },
  }
}

/** 방금 나간 명령 중 문의 레코드를 저장한 SET을 찾아 파싱한다 */
function savedRecord(): any {
  const set = sent.find((c) => c[0] === 'SET' && String(c[1]).startsWith('inq:'))
  return set ? JSON.parse(set[2]) : null
}

async function run(body: unknown, ip?: string) {
  sent = []
  failNext = false
  const res = fakeRes()
  await inquiry(post(body, ip), res)
  return res
}

/* ── 받은 것은 실제로 남는다 ──────────────────────────────── */

test('★ 제대로 된 문의는 저장까지 간다 — 응답만 200이면 소용이 없다', async () => {
  const res = await run(GOOD)
  assert.equal(res.statusCode, 200, '정상 문의가 거절됐다: ' + res.body)
  assert.equal(res.json()?.ok, true)
  assert.ok(res.json()?.id, '접수 번호가 없다 — 어디에 남았는지 알 수 없다')

  const rec = savedRecord()
  assert.ok(rec, '"접수됐습니다"라고 답해놓고 저장 명령이 한 줄도 안 나갔다')
  assert.equal(rec.name, GOOD.name)
  assert.equal(rec.contact, GOOD.contact, '연락처가 안 남으면 답을 못 한다')
  assert.equal(rec.message, GOOD.message)
  assert.equal(rec.kind, 'partner')
  assert.equal(rec.status, 'new', '들어오자마자 처리된 것으로 보이면 답을 빠뜨린다')

  // 목록에도 넣어야 관리자 화면에 뜬다. SET만 하고 색인을 빠뜨리면 영원히 안 보인다.
  assert.ok(sent.some((c) => c[0] === 'ZADD' && c[1] === 'inq:ids'), '목록 색인에 안 넣었다 — 관리자 화면에 안 뜬다')
})

test('★ 저장하는 것에 IP·헤더가 섞이지 않는다 — 문서가 그렇게 약속했다', async () => {
  await run(GOOD, '198.51.100.77')
  const rec = savedRecord()
  const keys = Object.keys(rec).sort()
  assert.deepEqual(
    keys,
    ['at', 'company', 'contact', 'from', 'id', 'kind', 'message', 'name', 'note', 'status'],
    '저장 레코드의 칸이 달라졌다: ' + keys.join(', ')
  )
  assert.doesNotMatch(JSON.stringify(rec), /198\.51\.100\.77/, 'IP가 문의 레코드에 저장됐다')
})

test('★ 본문이 스트림으로만 와도 받는다 — 여기서 놓치면 "가끔 빈 문의"가 된다', async () => {
  /* Vercel의 Node 런타임이 req.body를 항상 채워주는 건 아니다(요청 헤더에 달렸다).
     안 채워졌을 때 조용히 빈 문의가 들어오는 게 이 코드가 막으려던 것이다. */
  sent = []
  const res = fakeRes()
  const payload = Buffer.from(JSON.stringify(GOOD), 'utf8')
  await inquiry({
    method: 'POST',
    url: '/api/inquiry',
    headers: {},
    socket: { remoteAddress: '203.0.113.11' },
    async *[Symbol.asyncIterator]() { yield payload },
  }, res)
  assert.equal(res.statusCode, 200, '스트림으로 온 문의가 거절됐다: ' + res.body)
  assert.equal(savedRecord()?.name, GOOD.name, '스트림으로 온 문의가 빈 채로 저장됐다')
})

/* ── 못 받았으면 못 받았다고 한다 ─────────────────────────── */

test('★ 저장이 깨지면 성공이라고 답하지 않는다 — 이게 이 함수의 유일한 금기다', async () => {
  sent = []
  failNext = true
  const res = fakeRes()
  await inquiry(post(GOOD), res)
  failNext = false

  assert.equal(res.statusCode, 503, '저장이 깨졌는데 ' + res.statusCode + '로 답했다')
  assert.equal(res.json()?.ok, false)
  // 화면이 그대로 보여줄 문장이다. 영어 오류 문구가 폼 밑에 뜨면 그 사람은 창을 닫는다.
  assert.match(res.json()?.error ?? '', /접수/, '왜 안 됐는지 사람 말로 안 알려준다')
})

test('★ 빈 칸으로 보내면 400이고, 아무것도 저장하지 않는다', async () => {
  const cases: [string, unknown][] = [
    ['이름 없음', { ...GOOD, name: '   ' }],
    ['연락처 없음', { ...GOOD, contact: '' }],
    ['내용이 너무 짧음', { ...GOOD, message: '안녕' }],
    ['본문이 아예 없음', null],
  ]
  for (const [label, body] of cases) {
    const res = await run(body)
    assert.equal(res.statusCode, 400, label + '에 ' + res.statusCode + '로 답했다')
    assert.equal(savedRecord(), null, label + '인데 저장됐다')
    assert.ok((res.json()?.error ?? '').length > 0, label + '에 이유를 안 알려준다')
  }
})

test('★ 너무 긴 본문은 끊되, 사람이 읽을 문장으로 답한다', async () => {
  /* 32KB 제한에 걸리는 유일한 정상 경로다. 여기서 내부 오류 메시지가
     그대로 나가면 폼 밑에 영어 한 줄이 뜨고, 그 사람은 창을 닫는다. */
  sent = []
  const huge = Buffer.from(JSON.stringify({ ...GOOD, message: '가'.repeat(200_000) }), 'utf8')
  const res = fakeRes()
  await inquiry({
    method: 'POST',
    url: '/api/inquiry',
    headers: {},
    socket: { remoteAddress: '203.0.113.12' },
    async *[Symbol.asyncIterator]() { yield huge },
  }, res)
  assert.equal(res.statusCode, 413, '긴 본문을 안 끊는다: ' + res.statusCode)
  assert.match(res.json()?.error ?? '', /너무 깁니다/, '왜 안 됐는지 사람 말로 안 알려준다')
  assert.doesNotMatch(res.json()?.error ?? '', /[a-z]{4,}/, '내부 오류 문구가 그대로 나갔다: ' + res.body)
  assert.equal(sent.length, 0)
})

test('★ POST 말고는 받지 않는다', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    sent = []
    const res = fakeRes()
    await inquiry({ method, url: '/api/inquiry', headers: {}, socket: {} }, res)
    assert.equal(res.statusCode, 405, method + '이 통과했다')
    assert.match(res.headers['allow'] ?? '', /POST/, '무엇을 받는지 안 알려준다')
    assert.equal(sent.length, 0)
  }
})

/* ── 스팸 ─────────────────────────────────────────────────── */

test('★ 봇은 조용히 통과시키고 저장은 안 한다 — 막혔다고 알려주면 우회한다', async () => {
  const bots: [string, unknown][] = [
    ['허니팟을 채운 봇', { ...GOOD, website: 'https://spam.example' }],
    ['폼이 뜨자마자 보낸 봇', { ...GOOD, elapsedMs: 900 }],
  ]
  for (const [label, body] of bots) {
    const res = await run(body)
    // 200이어야 한다. 400을 주면 봇이 뭘 고쳐야 하는지 배운다.
    assert.equal(res.statusCode, 200, label + '에게 막혔다고 알려줬다')
    assert.equal(res.json()?.ok, true)
    assert.equal(res.json()?.id, null, '봇에게 접수 번호를 줬다')
    assert.equal(sent.length, 0, label + '의 글이 저장됐다 — 관리자 화면이 스팸으로 찬다')
  }
})

test('★ 사람이 오래 걸려 쓴 글은 봇으로 안 친다', async () => {
  // elapsedMs가 없는 경우(구형 화면·자동완성)도 사람으로 본다 — 사람을 막는 게 더 큰 손해다.
  for (const body of [{ ...GOOD, elapsedMs: 3001 }, { ...GOOD, elapsedMs: undefined }]) {
    const res = await run(body)
    assert.equal(res.statusCode, 200)
    assert.ok(savedRecord(), '사람이 쓴 글이 조용히 버려졌다')
  }
})

/* ── 값 다듬기 ────────────────────────────────────────────── */

test('★ 길거나 이상한 값에 저장이 통째로 깨지지 않는다', async () => {
  const res = await run({
    ...GOOD,
    kind: '<script>',                       // 화면 선택지 밖의 값
    name: '가'.repeat(500),
    message: '나'.repeat(9000),
    from: 'https://example.com/' + 'x'.repeat(500),
  })
  assert.equal(res.statusCode, 200, '긴 값에 거절됐다: ' + res.body)
  const rec = savedRecord()
  assert.equal(rec.kind, 'etc', '모르는 종류가 그대로 저장됐다 — 관리자 화면의 분류가 깨진다')
  assert.equal(rec.name.length, 60)
  assert.equal(rec.message.length, 4000)
  assert.equal(rec.from.length, 80)
})
