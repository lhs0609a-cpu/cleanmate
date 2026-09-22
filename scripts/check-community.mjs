import { preview, createServer } from 'vite'
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const server=process.argv.includes('--dev')
 ? await createServer({server:{host:'127.0.0.1',port:0}})
 : await preview({preview:{host:'127.0.0.1',port:0}})
if(process.argv.includes('--dev'))await server.listen()
const origin=server.resolvedUrls.local[0]
const browser=await chromium.launch({channel:'msedge',headless:true})
const id='12345678-1234-1234-1234-123456789abc'
const fixture={id,title:'화면 검증용 질문',body:'<script>window.injected=true</script> 정리 질문을 안전한 일반 텍스트로 표시합니다.',author:'화면검증',category:'question',createdAt:'2026-09-22T00:00:00Z'}
await mkdir('output/community-review',{recursive:true})
try {
 const page=await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message))
 let posts=[], campaign=null, submissions=[]
 await page.route('**/api/community-ad',route=>route.fulfill({json:{ok:true,sponsor:campaign}}))
 await page.route('**/api/community*',async route=>{
  const req=route.request(),url=new URL(req.url())
  if(url.pathname!='/api/community')return route.fallback()
  if(req.method()==='POST'){submissions.push(req.postDataJSON());return route.fulfill({status:201,json:{ok:true,id,status:'pending'}})}
  if(req.method()==='DELETE')return route.fulfill({json:{ok:true}})
  return route.fulfill({json:url.searchParams.has('id')?{ok:true,item:fixture,replies:[],more:false}:{ok:true,items:posts,more:false}})
 })
 for(const width of [1440,390]){
  posts=[];await page.setViewportSize({width,height:1000});await page.goto(`${origin}community.html`,{waitUntil:'networkidle'})
  assert.match(await page.locator('#posts').innerText(),/첫 이야기/)
  assert.equal(await page.locator('#sponsor').isVisible(),false)
  await page.screenshot({path:`output/community-review/community-${width}.png`,fullPage:true})
  await page.locator('#write').click()
  await page.locator('[name="title"]').fill('용량 정리 질문입니다')
  await page.locator('[name="body"]').fill('다운로드 폴더 정리 후에도 공간이 부족합니다.')
  await page.locator('[name="author"]').fill('화면검증')
  await page.locator('#compose-form [name="password"]').fill('test-password')
  await page.locator('[name="consent"]').check()
  await page.locator('#compose-form [type="submit"]').click()
  await page.locator('#receipt').waitFor({state:'visible'})
  assert.equal(await page.locator('#receipt-id').inputValue(),id)
  assert.equal(submissions.at(-1).consent,true)
  posts=[fixture];await page.locator('#refresh').click();await page.locator('.post').click()
  await page.locator('#detail').waitFor({state:'visible'})
  assert.equal(await page.evaluate(()=>window.injected),undefined)
  assert.match(await page.locator('.body-text').first().innerText(),/<script>/)
  await page.locator('#reply').click();await page.locator('[name="body"]').fill('댓글 흐름을 확인하는 내용입니다.')
  await page.locator('[name="author"]').fill('화면검증');await page.locator('#compose-form [name="password"]').fill('test-password');await page.locator('[name="consent"]').check()
  await page.locator('#compose-form [type="submit"]').click();await page.locator('#composer').waitFor({state:'hidden'})
  assert.equal(submissions.at(-1).parent,id)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  console.log(`PASS ${width}: empty state, moderated submission, receipt, escaped post, reply, no overflow`)
 }
 campaign={id,active:true,advertiser:'테스트 광고주',title:'검증용 후원 배너',description:'실제 운영 광고가 아닌 자동 검증용 데이터',url:'https://example.com'}
 await page.goto(`${origin}community.html`,{waitUntil:'networkidle'})
 await page.locator('#sponsor').waitFor({state:'visible'})
 assert.match(await page.locator('#sponsor').innerText(),/광고 · 테스트 광고주/)
 assert.match(await page.locator('#sponsor a').getAttribute('rel'),/sponsored/)
 await page.route(/\/api\/community(?:\?|$)/,route=>route.fulfill({status:503,json:{ok:false,error:'커뮤니티 연결을 준비 중입니다.'}}))
 await page.reload({waitUntil:'networkidle'});assert.match(await page.locator('#status').innerText(),/연결을 준비/)
 await page.route('https://api.github.com/**',route=>route.fulfill({status:404,json:{}}))
 await page.goto(`${origin}app.html`,{waitUntil:'networkidle'})
 await page.locator('[data-go="community"]').click()
 await page.frameLocator('#community-frame').locator('h1').waitFor()
 await page.screenshot({path:'output/community-review/app-community.png',fullPage:true})
 let pending=[{...fixture,status:'pending',reports:0}], saved=null, moderated=false
 await page.route('**/api/admin/session',route=>route.fulfill({json:{ok:true,admin:true}}))
 await page.route('**/api/admin/stats',route=>route.fulfill({json:{ok:true,storeConnected:false}}))
 await page.route('**/api/admin/inquiries*',route=>route.fulfill({json:{ok:true,items:[],total:0}}))
 await page.route('**/api/admin/community*',route=>{
  if(route.request().method()==='PATCH'){assert.equal(route.request().postDataJSON().status,'published');moderated=true;pending=[]}
  return route.fulfill({json:{ok:true,items:pending}})
 })
 await page.route('**/api/community-ad*',route=>{
  if(route.request().method()==='PUT')saved=route.request().postDataJSON()
  return route.fulfill({json:{ok:true,sponsor:saved,metrics:{views:0,clicks:0}}})
 })
 await page.setViewportSize({width:1440,height:1000})
 await page.goto(`${origin}admin.html`,{waitUntil:'networkidle'})
 await page.locator('[data-go="community"]').click()
 await page.locator('#community-admin button').first().click()
 await page.waitForFunction(()=>document.querySelector('#community-admin').textContent.includes('검수할 글이 없습니다'))
 assert.equal(moderated,true)
 await page.locator('#sponsor-form [name="active"]').check()
 await page.locator('#sponsor-form [name="advertiser"]').fill('검증용 광고주')
 await page.locator('#sponsor-form [name="title"]').fill('검증용 제목')
 await page.locator('#sponsor-form [name="description"]').fill('화면 검증용 광고 설명')
 await page.locator('#sponsor-form [name="url"]').fill('https://example.com')
 await page.locator('#sponsor-form [type="submit"]').click()
 await page.waitForFunction(()=>document.querySelector('#sponsor-status').textContent.includes('저장했습니다'))
 assert.equal(saved.active,true)
 await page.screenshot({path:'output/community-review/admin-community.png',fullPage:true})
 assert.deepEqual(errors,[])
 console.log('PASS: labeled campaign, unavailable storage message, embedded community, admin moderation, campaign saving and no JS errors')
}finally{await browser.close();if(process.argv.includes('--dev'))await server.close();else await new Promise(r=>server.httpServer.close(r))}
