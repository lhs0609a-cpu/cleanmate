/**
 * 홈페이지 ↔ 최신 릴리스 실시간 연동
 *
 * GitHub 릴리스 API에서 '항상 최신'을 읽어 다운로드 버튼·버전 표시를 채운다.
 * 새 버전을 배포하면(태그 푸시 → CI) 홈페이지가 자동으로 그걸 가리킨다 —
 * 코드 수정·재배포 없이. 이게 "실시간 연동"이다.
 *
 * ★ CSP 주의: 이 fetch는 vercel.json이 랜딩 문서에만 `connect-src
 *   https://api.github.com`을 허용해 주기 때문에 통한다. 사용자 파일을 읽는
 *   /app.html은 여전히 `connect-src 'none'`이다 — 그쪽은 네트워크가 아예 막혀 있다.
 *   두 정책을 한 덩어리로 묶으면 둘 중 하나가 반드시 깨진다(실제로 깨져 있었다).
 *
 * 실패해도 안전하게: API가 막히면 릴리스 페이지로 폴백한다.
 */

export {} // 모듈로 취급되게 (import 없어도)

/**
 * ★ 배포 저장소 — 소스 저장소(비공개)가 아니다.
 *
 * 소스는 비공개인데 방문자와 설치된 앱은 "최신 버전이 뭐고 어디서 받나"를 읽어야 한다.
 * 비공개 저장소의 릴리스 API는 인증 없이 부르면 404다(있는데 없다고 답한다) —
 * 그러면 이 fetch가 실패하고 폴백이 릴리스 페이지로 보내는데 그 페이지도 404여서
 * 다운로드가 통째로 막힌다. 실제로 그 상태였다.
 * 그래서 설치파일만 두는 공개 저장소를 따로 뒀다.
 */
const REPO = 'lhs0609a-cpu/teraclean-releases'
/**
 * ★ API가 안 될 때의 폴백 — 릴리스 '페이지'가 아니라 **설치파일 자체**로 보낸다.
 *
 * 왜 바꿨나: 폴백이 릴리스 목록 페이지였다. 개발자에겐 그게 릴리스 페이지지만
 * 일반 사용자에겐 영어 변경 이력과 파일 여러 개가 늘어선 화면이다 —
 * "어느 걸 받아야 되죠?"가 여기서 나온다. 그리고 폴백은 드물지 않다:
 * JS를 끈 사람, 사내망에서 api.github.com이 막힌 사람, 회사 공용 IP라
 * 시간당 호출 한도(60회)를 이미 쓴 사람이 전부 이 길로 온다.
 *
 * `releases/latest/download/<이름>`은 GitHub이 공식 지원하는 고정 주소다 —
 * 항상 최신 릴리스의 그 이름 자산으로 302한다. 그래서 릴리스마다 **같은 이름**의
 * 사본을 반드시 함께 올린다(scripts/publish-release.mjs가 만들어 준다).
 */
const SETUP_NAME = 'TeraClean-Setup.exe'
const LATEST_FILE = `https://github.com/${REPO}/releases/latest/download/${SETUP_NAME}`
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`

interface LatestInfo {
  version: string
  url: string // 설치파일 직접 다운로드 URL
  date: string
}

async function fetchLatest(): Promise<LatestInfo | null> {
  try {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    const r = await res.json()
    const exe = (r.assets ?? []).find((a: any) => /\.exe$/i.test(a.name))
    if (!exe) return null
    return {
      version: (r.tag_name ?? '').replace(/^v/, ''),
      url: exe.browser_download_url,
      date: r.published_at ? new Date(r.published_at).toLocaleDateString('ko-KR') : '',
    }
  } catch {
    return null
  }
}

function setDownload(el: HTMLElement | null, url: string) {
  if (!el) return
  el.setAttribute('href', url)
}

/**
 * macOS 방문자인가.
 *
 * 왜 필요한가: 지금 설치파일은 Windows용 exe 하나뿐이다. macOS 사용자에게
 * "다운로드"를 그대로 내밀면 받아도 실행이 안 되는 파일을 주는 셈이다.
 * 그래서 없는 걸 있는 척하지 않고, 준비 중임을 밝히고 체험으로 안내한다.
 * (userAgentData가 있으면 그걸 쓴다 — UA 문자열은 점점 못 믿게 되고 있다.)
 */
function isMac(): boolean {
  const uaPlatform = (navigator as any).userAgentData?.platform
  if (typeof uaPlatform === 'string' && uaPlatform) return /mac/i.test(uaPlatform)
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}

/** 스크롤에 따라 요소가 부드럽게 나타난다 (점진적 향상 — JS 없어도 내용은 보임). */
function setupReveal() {
  const els = document.querySelectorAll('.reveal')
  // 애니메이션을 줄여달라고 설정한 사용자에겐 기다리지 않고 바로 보여준다
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (still || !('IntersectionObserver' in window)) {
    els.forEach((e) => e.classList.add('in'))
    return
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          ;(e.target as HTMLElement).classList.add('in')
          io.unobserve(e.target)
        }
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
  )
  els.forEach((e, i) => {
    ;(e as HTMLElement).style.transitionDelay = `${Math.min(i % 4, 3) * 70}ms`
    io.observe(e)
  })
}

/**
 * 스크롤하면 헤더에 경계선이 생기고, 읽은 만큼 막대가 찬다.
 *
 * 둘을 한 리스너에서 처리하는 이유: scroll 이벤트에 리스너를 여러 개 달면
 * 한 프레임 안에 레이아웃을 여러 번 읽게 된다. 여기선 한 번만 읽는다.
 */
function setupHeader() {
  const hdr = document.getElementById('hdr')
  const bar = document.getElementById('progress')
  const on = () => {
    const y = window.scrollY
    hdr?.classList.toggle('scrolled', y > 8)
    if (bar) {
      const max = document.documentElement.scrollHeight - window.innerHeight
      bar.style.width = max > 0 ? `${Math.min(100, (y / max) * 100)}%` : '0'
    }
  }
  on()
  window.addEventListener('scroll', on, { passive: true })
  window.addEventListener('resize', on, { passive: true })
}

/**
 * 좁은 화면 메뉴. 링크를 누르면 닫힌다 — 열어둔 채로 두면 목적지를 가린다.
 * Esc로도 닫는다(키보드만 쓰는 사람이 갇히지 않게).
 */
function setupMenu() {
  const btn = document.getElementById('menu-btn')
  const sheet = document.getElementById('sheet')
  if (!btn || !sheet) return
  const set = (open: boolean) => {
    sheet.classList.toggle('on', open)
    btn.setAttribute('aria-expanded', String(open))
    btn.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기')
  }
  btn.addEventListener('click', () => set(!sheet.classList.contains('on')))
  sheet.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a')) set(false) })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false) })
}

/**
 * 지금 보고 있는 섹션을 메뉴에서 밝힌다.
 *
 * ★ scroll 위치를 매 프레임 계산하지 않는다. 섹션이 여덟 개고 페이지가 길어서,
 *   그 계산을 스크롤마다 하면 저사양 기기에서 눈에 띄게 끊긴다.
 *   IntersectionObserver는 브라우저가 알아서 합쳐서 알려준다.
 */
function setupActiveNav() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('#mainnav a[href^="#"]')]
  if (!links.length || !('IntersectionObserver' in window)) return
  const byId = new Map(links.map((a) => [a.getAttribute('href')!.slice(1), a]))
  const targets = [...byId.keys()].map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[]
  if (!targets.length) return

  /* 화면 위쪽 1/3에 걸린 섹션을 '지금 보는 것'으로 친다. 정중앙을 쓰면
     섹션이 화면보다 긴 경우(목업이 큰 섹션들) 한참 지나야 바뀐다. */
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        for (const a of links) a.classList.remove('here')
        byId.get(e.target.id)?.classList.add('here')
      }
    },
    { rootMargin: '-15% 0px -70% 0px', threshold: 0 }
  )
  targets.forEach((t) => io.observe(t))
}

/** macOS 방문자용 처리 — 없는 빌드를 있는 척하지 않는다. */
function applyMacFallback(
  els: { heroDl: HTMLElement | null; navDl: HTMLElement | null; finalDl: HTMLElement | null; heroVer: HTMLElement | null; finalVer: HTMLElement | null },
  winUrl: string
) {
  const note = document.getElementById('os-note')
  if (note) {
    note.textContent =
      'macOS를 쓰고 계시네요. 데스크톱 앱은 아직 Windows 10/11만 지원합니다 — macOS 버전은 준비 중입니다. 지금은 브라우저 체험으로 같은 엔진을 돌려볼 수 있습니다.'
    note.classList.add('on')
  }
  for (const el of [els.heroDl, els.finalDl]) {
    if (!el) continue
    el.textContent = '브라우저에서 체험하기'
    el.setAttribute('href', '/app.html')
  }
  if (els.navDl) {
    els.navDl.textContent = '체험'
    els.navDl.setAttribute('href', '/app.html')
  }
  // Windows용 링크는 없애지 않는다 — 맥에서 보고 PC로 받아가는 사람이 있다.
  for (const ver of [els.heroVer, els.finalVer]) {
    if (!ver) continue
    ver.textContent = ''
    const a = document.createElement('a')
    a.href = winUrl
    a.textContent = 'Windows용 설치파일 받기 →'
    a.style.color = 'var(--acc)'
    ver.append(a)
  }
}

/**
 * 다운로드 수를 밴드에 채운다 — 서버가 GitHub에서 실측해 준 값.
 *
 * ★ 못 읽으면 그 칸을 통째로 숨긴다. 0을 보여주지 않는다.
 *   0은 "아무도 안 받았다"는 뜻인데 그건 사실이 아니고, 이 랜딩의 숫자는
 *   전부 실측이라는 게 이 제품의 신뢰 기반이다(40.7GB·14.6GB가 그렇다).
 *   한 칸이라도 지어내면 나머지도 같이 의심받는다.
 *
 * 반올림도 안 한다("1,000+" 같은 것). 세어진 그대로 쓴다.
 */
async function fillPublicStats() {
  const slot = document.getElementById('stat-dl')
  const n = document.getElementById('dl-count')
  if (!slot || !n) return
  try {
    const res = await fetch('/api/public-stats', { headers: { Accept: 'application/json' } })
    if (!res.ok) return
    const data = await res.json()
    if (typeof data.downloads !== 'number' || data.downloads <= 0) return
    n.textContent = data.downloads.toLocaleString('ko-KR')
    slot.hidden = false
  } catch {
    /* 서버 함수가 아직 없거나(정적 미리보기), 네트워크가 막혔다.
       숫자 하나 때문에 화면에 오류를 띄우지 않는다. */
  }
}

/**
 * 상담·제휴 문의 폼.
 *
 * ★ 화면에서 지키는 것
 *   1) 보내는 동안 버튼을 잠근다. 두 번 눌러 두 건이 들어오는 게 제일 흔한 사고다.
 *   2) 실패하면 **적은 내용을 지우지 않는다.** 다시 쓰라고 하는 순간 그 사람은 떠난다.
 *   3) 실패 문구에 대체 연락처를 함께 준다 — 막다른 길을 만들지 않는다.
 *   4) 성공하면 폼을 감사 문장으로 바꾼다. 빈 폼이 남아 있으면 "보내진 건가?"가 된다.
 */
function setupContactForm() {
  const form = document.getElementById('inq-form') as HTMLFormElement | null
  const btn = document.getElementById('inq-send') as HTMLButtonElement | null
  const msg = document.getElementById('inq-msg')
  if (!form || !btn || !msg) return

  // 폼이 뜬 시각 — 서버가 '3초 안에 제출'을 봇으로 거른다(api/inquiry.js).
  const shownAt = Date.now()

  const say = (text: string, kind: 'ok' | 'bad') => {
    msg.textContent = text
    msg.className = `on ${kind}`
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    const data = new FormData(form)
    const get = (k: string) => String(data.get(k) ?? '').trim()

    // 서버도 확인하지만, 여기서 먼저 말해주는 편이 왕복 한 번을 아낀다.
    if (!get('name')) return say('이름(또는 상호)을 적어주세요.', 'bad')
    if (!get('contact')) return say('답 받으실 이메일이나 전화번호를 적어주세요.', 'bad')
    if (get('message').length < 5) return say('어떤 내용인지 한 줄만 더 적어주세요.', 'bad')

    btn.disabled = true
    const label = btn.textContent
    btn.textContent = '보내는 중…'
    msg.className = ''

    try {
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: get('kind') || 'etc',
          name: get('name'),
          company: get('company'),
          contact: get('contact'),
          message: get('message'),
          website: get('website'), // 허니팟 — 채워져 있으면 봇이다
          elapsedMs: Date.now() - shownAt,
          from: location.pathname + location.hash,
        }),
      })
      const out = await res.json().catch(() => null)
      if (!res.ok || !out?.ok) {
        return say(
          `${out?.error ?? '보내지 못했습니다.'} ` +
            '계속 안 되면 GitHub 이슈로도 남기실 수 있어요 — github.com/lhs0609a-cpu/teraclean-releases/issues',
          'bad'
        )
      }
      // 성공 — 폼을 치우고 무슨 일이 일어날지 말한다.
      form.innerHTML =
        '<div style="padding:8px 0"><h3 style="font-size:var(--t-xl)">받았습니다.</h3>' +
        '<p style="margin-top:12px;color:var(--ink-2);line-height:1.75">' +
        '영업일 기준 2~3일 안에 적어주신 곳으로 직접 답을 드릴게요.<br>' +
        '급하시면 GitHub 이슈로도 남기실 수 있습니다.</p></div>'
    } catch {
      say(
        '네트워크가 막혀 보내지 못했습니다. 잠시 뒤 다시 시도하시거나, ' +
          'GitHub 이슈로 남겨주세요 — github.com/lhs0609a-cpu/teraclean-releases/issues',
        'bad'
      )
    } finally {
      btn.disabled = false
      if (label) btn.textContent = label
    }
  })
}

async function main() {
  setupReveal()
  setupHeader()
  setupActiveNav()
  setupMenu()
  setupContactForm()
  fillPublicStats()
  const els = {
    heroDl: document.getElementById('hero-dl'),
    navDl: document.getElementById('nav-dl'),
    finalDl: document.getElementById('final-dl'),
    heroVer: document.getElementById('hero-ver'),
    finalVer: document.getElementById('final-ver'),
  }

  const latest = await fetchLatest()
  const winUrl = latest ? latest.url : LATEST_FILE

  setDownload(els.heroDl, winUrl)
  setDownload(els.navDl, winUrl)
  setDownload(els.finalDl, winUrl)
  const label = latest
    ? `최신 버전 v${latest.version}${latest.date ? ` · ${latest.date}` : ''} · Windows 10/11`
    // 버전을 못 읽었을 뿐이지 받을 수는 있다. "페이지로 가세요"라고 떠넘기지 않는다.
    : 'Windows 10/11 · 최신 버전 내려받기'
  if (els.heroVer) els.heroVer.textContent = label
  if (els.finalVer) els.finalVer.textContent = label

  if (isMac()) applyMacFallback(els, winUrl)
}

main()
