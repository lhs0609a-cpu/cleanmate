import { json, methodGuard } from './_lib/http.js'

export default async function handler(req, res) {
  if (methodGuard(req, res, ['GET'])) return
  try {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'teraclean' }
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    const response = await fetch('https://api.github.com/repos/lhs0609a-cpu/teraclean-releases/releases/latest', {
      headers, signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error('Release unavailable')
    const release = await response.json()
    const asset = release.assets?.find(a => a.name === 'TeraClean-Setup.exe')
      ?? release.assets?.find(a => /\.exe$/i.test(a.name))
    if (!release.tag_name || !asset?.browser_download_url || release.draft || release.prerelease) {
      throw new Error('Installer unavailable')
    }
    return json(res, 200, {
      tag_name: release.tag_name, published_at: release.published_at,
      assets: [{ name: asset.name, browser_download_url: asset.browser_download_url }],
    }, { 'Cache-Control': 'public, s-maxage=60' })
  } catch {
    return json(res, 503, { error: '최신 버전을 확인하지 못했습니다.' })
  }
}
