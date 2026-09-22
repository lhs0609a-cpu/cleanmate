import test from 'node:test'
import assert from 'node:assert/strict'
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
const { default: community } = await import('../api/community.js')
const { default: admin } = await import('../api/admin/community.js')
const { default: ad, validateSponsor } = await import('../api/community-ad.js')
const { makeItem, owns, publicItem } = await import('../api/_lib/community.js')
const call = async (handler, method, body, url = '/api/community') => {
  const headers = {}; const res = { statusCode:200, setHeader:(k,v)=>{headers[k]=v}, end:value=>{res.body=JSON.parse(value)} }
  await handler({ method, url, body, headers:{ 'content-type':'application/json' }, socket:{remoteAddress:'127.0.0.1'} }, res)
  return res
}
const input = { action:'create', category:'question', title:'용량 질문입니다', body:'캐시 정리 후에도 공간이 부족합니다.', author:'테스터', password:'deletion-password', consent:true }
test('delete password is hashed; public records never expose credentials or moderation internals', () => {
  const item=makeItem(input)
  assert.ok(owns(item,input.password)); assert.ok(!owns(item,'incorrect'))
  assert.notEqual(item.passwordHash,input.password)
  assert.deepEqual(Object.keys(publicItem(item)).sort(), ['id','type','parent','category','title','body','author','createdAt'].sort())
})
test('sponsor only accepts complete HTTPS campaigns; disabling requires no dummy URL', () => {
  const valid={ active:true, advertiser:'광고주', title:'광고 제목', description:'광고 설명', url:'https://example.com' }
  assert.ok(validateSponsor(valid)); assert.deepEqual(validateSponsor({active:false}),{active:false})
  for (const url of ['javascript:alert(1)','http://example.com','https://user:secret@example.com']) assert.equal(validateSponsor({...valid,url}),null)
})
test('unauthenticated visitors cannot moderate or configure advertising', async () => {
  assert.equal((await call(admin,'PATCH',{id:'x',status:'published'})).statusCode,401)
  assert.equal((await call(ad,'PUT',{active:true})).statusCode,401)
})
test('posting requires valid consent/content and goes to pending, not public feed', async t => {
  const commands=[]
  t.mock.method(globalThis,'fetch',async (_url,opts) => {
    const cmd=JSON.parse(opts.body); commands.push(cmd)
    return { ok:true, json:async()=>({result:1}) }
  })
  assert.equal((await call(community,'POST',{...input,consent:false})).statusCode,400)
  assert.equal((await call(community,'POST',{...input,password:'short'})).statusCode,400)
  const response=await call(community,'POST',input)
  assert.equal(response.statusCode,201); assert.equal(response.body.status,'pending')
  const write=commands.find(c=>c.includes('community:pending'))
  assert.ok(write)
  const stored=JSON.parse(write[5]); assert.equal(stored.status,'pending'); assert.equal(stored.body,input.body)
  assert.ok(!JSON.stringify(response.body).includes('password'))
})
test('storage failure never reports a successful post', async t => {
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('offline')})
  assert.equal((await call(community,'POST',input)).statusCode,503)
})
test('pending records cannot be read through public detail API', async t => {
  const item=makeItem(input)
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({result:JSON.stringify(item)})}))
  assert.equal((await call(community,'GET',undefined,`/api/community?id=${item.id}`)).statusCode,404)
})
test('public feed does not leak secret fields', async t => {
  const item={...makeItem(input),status:'published'}
  t.mock.method(globalThis,'fetch',async(_url,opts)=>{
    const command=JSON.parse(opts.body)
    return {ok:true,json:async()=>({result:command[0]==='ZREVRANGE'?[item.id]:[JSON.stringify(item)]})}
  })
  const result=await call(community,'GET')
  assert.equal(result.statusCode,200); assert.equal(result.body.items[0].title,input.title)
  assert.ok(!JSON.stringify(result.body).includes(item.passwordHash))
})
