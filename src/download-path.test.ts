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

/* ★ 여기까지는 전부 '이름이 서로 맞는가'만 봤다. 그런데 이름이 다 맞아도
   릴리스에 그 파일이 **안 올라가면** 폴백은 404다.

   실제로 v0.22.0이 그랬다. 사본을 만드는 스크립트는 있었지만(publish-release.mjs)
   CI가 부르질 않아서, 여태 사람이 손으로 올려 왔다. 한 번 잊자 바로 깨졌고
   — JS가 도는 개발자 브라우저에서는 그 404가 끝내 안 보였다.

   그래서 '올리는 쪽'도 여기서 잠근다. */

/** 게시 단계(action-gh-release)의 files 목록만 잘라낸다.
 *
 *  ★ 파일 전체를 includes로 훑으면 안 된다. 사본을 만드는 단계에도 같은 경로
 *    문자열이 있어서(DST=...), 정작 files 목록에서 줄이 빠져도 통과한다.
 *    처음 이 테스트를 그렇게 썼다가 실제로 그 구멍을 놓쳤다 — 일부러 줄을
 *    지워 보고서야 알았다. 그래서 블록을 잘라서 본다. */
function releaseFiles(): string[] {
  const wf = read('.github/workflows/release.yml')
  const at = wf.indexOf('action-gh-release')
  assert.ok(at > 0, 'release.yml에 게시 단계가 없다')

  const head = wf.indexOf('files: |', at)
  assert.ok(head > 0, '게시 단계에 files 목록이 없다')

  const lines = wf.slice(head + 'files: |'.length).split('\n').slice(1)
  const out: string[] = []
  for (const l of lines) {
    const t = l.trim()
    // 목록은 들여쓴 줄이 이어진다. 들여쓰기가 끝나면 다음 키(body: 등)다.
    if (!t || !/^\s{12,}\S/.test(l)) break
    out.push(t)
  }
  return out
}

test('★ 릴리스 워크플로가 고정 이름 사본을 실제로 올린다', () => {
  const name = landingSetupName()
  const files = releaseFiles()

  assert.ok(files.length > 0, 'files 목록을 못 읽었다')
  assert.ok(
    files.includes(`dist-installer/${name}`),
    `★ release.yml의 files에 ${name}이 없다 — 폴백 링크가 404가 된다. 실제: ${files.join(', ')}`
  )
})

test('고정 이름 사본을 만드는 단계가 있다 — 올릴 파일 자체가 생겨야 한다', () => {
  const wf = read('.github/workflows/release.yml')
  assert.match(wf, /cp "\$SRC" "\$DST"/, '사본을 만드는 단계가 없다')
})

test('고정 이름 사본은 해시 계산 뒤에 만든다 — 앞에서 만들면 바이트가 갈린다', () => {
  const wf = read('.github/workflows/release.yml')
  const copyAt = wf.indexOf('고정 이름 사본 만들기')
  const manifestAt = wf.indexOf('업데이트 장부(latest.json) 생성')

  assert.ok(copyAt > 0 && manifestAt > 0, '두 단계가 다 있어야 한다')
  assert.ok(
    copyAt > manifestAt,
    '★ 사본이 서명·해시 계산보다 앞에 있다 — 고정 이름으로 받은 사람만 업데이트가 거절된다'
  )
})
