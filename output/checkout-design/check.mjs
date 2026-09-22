import { chromium } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const browser=await chromium.launch({channel:'msedge',headless:true})
try {
 const page=await browser.newPage()
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000})
  await page.goto(pathToFileURL(resolve('output/checkout-design/index.html')).href)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.screenshot({path:`output/checkout-design/checkout-${width}.png`,fullPage:true})
  await page.locator('.card [data-pay]').click()
  await page.locator('#cancel').click()
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('취소'))
  assert.match(await page.locator('#notice').innerText(),/취소/)
  await page.locator('.card [data-pay]').click()
  await page.locator('#success').click()
  await page.locator('#reading').waitFor({state:'visible'})
  assert.equal(await page.locator('#sticky').isVisible(),false)
  await page.screenshot({path:`output/checkout-design/reading-${width}.png`})
  console.log(`PASS ${width}: layout, payment dialog, cancel, success and reading`)
 }
}finally{await browser.close()}
