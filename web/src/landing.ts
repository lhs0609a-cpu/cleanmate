/**
 * 홈페이지 ↔ 최신 릴리스 실시간 연동
 *
 * GitHub 릴리스 API에서 '항상 최신'을 읽어 다운로드 버튼·버전 표시를 채운다.
 * 새 버전을 배포하면(태그 푸시 → CI) 홈페이지가 자동으로 그걸 가리킨다 —
 * 코드 수정·재배포 없이. 이게 "실시간 연동"이다.
 *
 * 실패해도 안전하게: API가 막히면 릴리스 페이지로 폴백한다.
 */

export {} // 모듈로 취급되게 (import 없어도)

const REPO = 'lhs0609a-cpu/cleanmate'
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

async function main() {
  const heroDl = document.getElementById('hero-dl')
  const navDl = document.getElementById('nav-dl')
  const finalDl = document.getElementById('final-dl')
  const heroVer = document.getElementById('hero-ver')
  const finalVer = document.getElementById('final-ver')

  const latest = await fetchLatest()

  if (latest) {
    setDownload(heroDl, latest.url)
    setDownload(navDl, latest.url)
    setDownload(finalDl, latest.url)
    const label = `최신 버전 v${latest.version}${latest.date ? ` · ${latest.date}` : ''} · Windows 10/11`
    if (heroVer) heroVer.textContent = label
    if (finalVer) finalVer.textContent = label
  } else {
    // 폴백: 릴리스 페이지로
    setDownload(heroDl, RELEASES_PAGE)
    setDownload(navDl, RELEASES_PAGE)
    setDownload(finalDl, RELEASES_PAGE)
    const label = '릴리스 페이지에서 최신 버전 받기'
    if (heroVer) heroVer.textContent = label
    if (finalVer) finalVer.textContent = label
  }
}

main()
