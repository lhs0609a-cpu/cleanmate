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
const RELEASES_PAGE = `https://github.com/${REPO}/releases`
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

/** 스크롤하면 헤더에 경계선이 생긴다. */
function setupHeader() {
  const hdr = document.getElementById('hdr')
  if (!hdr) return
  const on = () => hdr.classList.toggle('scrolled', window.scrollY > 8)
  on()
  window.addEventListener('scroll', on, { passive: true })
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

async function main() {
  setupReveal()
  setupHeader()
  const els = {
    heroDl: document.getElementById('hero-dl'),
    navDl: document.getElementById('nav-dl'),
    finalDl: document.getElementById('final-dl'),
    heroVer: document.getElementById('hero-ver'),
    finalVer: document.getElementById('final-ver'),
  }

  const latest = await fetchLatest()
  const winUrl = latest ? latest.url : RELEASES_PAGE

  setDownload(els.heroDl, winUrl)
  setDownload(els.navDl, winUrl)
  setDownload(els.finalDl, winUrl)
  const label = latest
    ? `최신 버전 v${latest.version}${latest.date ? ` · ${latest.date}` : ''} · Windows 10/11`
    : '릴리스 페이지에서 최신 버전 받기'
  if (els.heroVer) els.heroVer.textContent = label
  if (els.finalVer) els.finalVer.textContent = label

  if (isMac()) applyMacFallback(els, winUrl)
}

main()
