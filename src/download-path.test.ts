/**
 * 배선 — 받으러 온 사람이 파일까지 닿는가
 *
 * ★ 왜 필요한가
 *   다운로드 버튼은 JS가 GitHub API로 최신 자산 주소를 읽어 채운다. 그 길이
 *   막히는 사람이 적지 않다 — JS를 끈 사람, 사내망에서 api.github.com이 막힌
 *   사람, 공용 IP라 시간당 한도(60회)를 이미 쓴 사람. 그 사람들은 폴백으로 간다.
 *
 *   폴백이 릴리스 '목록 페이지'였다. 개발자에겐 릴리스 페이지지만 일반
 *   사용자에겐 영어 변경 이력과 파일 여러 개가 늘어선 화면이다.
 *
 *   그래서 폴백을 고정 주소의 파일로 바꿨는데, 이 주소는 **릴리스마다 같은 이름의
 *   사본이 올라가야만** 산다. 이름이 한 글자만 어긋나도 404다 — 그리고 그 404는
 *   JS가 도는 개발자 브라우저에서는 절대 안 보인다. 그래서 여기서 잠근다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** 랜딩이 쓰는 고정 파일명 */
function landingSetupName(): string {
  const m = read('web/src/landing.ts').match(/const SETUP_NAME = '([^']+)'/)
  assert.ok(m, 'landing.ts에 SETUP_NAME이 없다')
  return m![1]
}

test('릴리스 스크립트가 만드는 이름과 랜딩이 가리키는 이름이 같다', () => {
  const pub = read('scripts/publish-release.mjs')
  const m = pub.match(/const FIXED_NAME = '([^']+)'/)
  assert.ok(m, 'publish-release.mjs에 FIXED_NAME이 없다')

  assert.equal(
    m![1],
    landingSetupName(),
    '★ 올리는 이름과 링크가 가리키는 이름이 다르면 그 링크는 404다'
  )
})

test('정적 href도 파일로 간다 — JS가 못 돌아도 받아진다', () => {
  const html = read('web/index.html')
  const name = landingSetupName()

  // JS 없이도 살아 있어야 하는 링크. 릴리스 목록으로 보내면 거기서 멈춘다.
  assert.ok(
    html.includes(`/releases/latest/download/${name}`),
    '최종 CTA가 아직 릴리스 목록 페이지를 가리킨다'
  )
})

test('API 폴백이 목록 페이지가 아니라 파일이다', () => {
  const ts = read('web/src/landing.ts')
  assert.match(ts, /const winUrl = latest \? latest\.url : LATEST_FILE/, '폴백이 아직 페이지다')
  assert.match(ts, /releases\/latest\/download/, '고정 주소를 안 만든다')
})

test('설치 경고를 각주가 아니라 먼저 말한다', () => {
  const html = read('web/index.html')

  // 받은 사람의 상당수가 다음 화면에서 멈춘다. 그 경고를 각주로 숨기면
  // 사용자는 검색창으로 가고, 거기서 우리 얘기를 듣게 된다.
  assert.match(html, /class="warn-ahead"/, '경고 예고 블록이 없다')
  assert.match(html, /Windows의 PC 보호/, '실제로 뜨는 화면 이름을 안 알려준다')
  assert.match(html, /추가 정보/, '넘어가는 법을 안 알려준다')
  // "바이러스가 아니다"를 분명히 해야 한다 — 그게 진짜 걱정거리다.
  assert.match(html, /바이러스가 발견됐다는 뜻이 아니라/, '왜 뜨는지를 안 밝힌다')
})

test('앱이 자주 묻는 셋에 미리 답해둔다', () => {
  const html = read('web/app.html')

  assert.match(html, /Windows의 PC 보호" 경고가 떴어요/, '설치 경고 답이 없다')
  assert.match(html, /남은 용량이 그대로예요/, '용량 답이 없다')
  assert.match(html, /지운 걸 되돌리고 싶어요/, '되돌리기 답이 없다')
  assert.match(html, /id="support-link"/, '문의 창구가 없다')

  // ★ 화면이 동작과 다른 말을 하면 나머지 설명도 못 믿는다.
  //   이 앱은 이제 보관하지 않고 지운다 — 답변도 그 사실 위에 서야 한다.
  assert.match(html, /지운 만큼은 <b>그 자리에서 바로<\/b> 빕니다/, '옛 보관함 시절 설명이 남아 있다')
  assert.doesNotMatch(
    html.slice(html.indexOf('<section class="help">')),
    /30일/,
    '자주 묻는 답에 없는 기능(30일 유예)이 적혀 있다'
  )
})

test('문의에 버전이 실려 간다', () => {
  const app = read('web/src/app.ts')
  // 첫 왕복이 "버전이 뭐예요?"로 새면 그 문의는 대개 거기서 끝난다.
  assert.match(app, /const v = APP_VERSION/, '문의에 버전을 안 싣는다')
  assert.match(app, /function setupSupportLink/, '문의 링크를 안 채운다')
})
