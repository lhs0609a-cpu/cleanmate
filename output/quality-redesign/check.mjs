import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const browser = await chromium.launch({ headless: true, timeout: 20000 });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.argv[2] ?? new URL('./index.html', import.meta.url).href);
  await page.screenshot({ path: fileURLToPath(new URL('./01-homepage.png', import.meta.url)), fullPage: true });
  await page.getByRole('button', { name: '프로그램 시안', exact: true }).click();
  await page.screenshot({ path: fileURLToPath(new URL('./02-program.png', import.meta.url)), fullPage: true });
  await page.getByRole('button', { name: '분석 결과 예시 보기' }).click();
  await page.getByRole('button', { name: '캐시 2.1 GB 실행 전 확인' }).click();
  await page.getByRole('button', { name: '예시 실행', exact: true }).click();
  await page.getByRole('heading', { name: '캐시 정리 결과' }).waitFor();
  for (const width of [390, 768, 820, 1180]) {
    await page.setViewportSize({ width, height: 800 });
    for (const name of ['내 PC', '정리하기', '기록과 복구']) {
      await page.locator('[data-page]').filter({ hasText: name }).click();
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(`App overflow: ${width}, ${name}`);
    }
  }
  await page.getByRole('button', { name: '홈페이지 시안', exact: true }).click();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(`Landing overflow: ${width}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: fileURLToPath(new URL('./03-mobile.png', import.meta.url)), fullPage: true });
  if (errors.length) throw Error(errors.join('\n'));
  console.log('PASS: navigation, confirmation, result, responsive widths, no page errors');
} finally { await browser.close(); }
