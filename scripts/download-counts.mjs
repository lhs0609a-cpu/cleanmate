/**
 * 다운로드 수 세기 — 오늘 공짜로 되는 유일한 실측
 *
 * ★ 왜 필요한가
 *   앱에도 랜딩에도 계측이 한 줄도 없다. "1만 명 중 몇 명이 설치까지 오나"를
 *   아무도 모른다. 그런데 GitHub은 릴리스 자산이 몇 번 내려갔는지를 이미
 *   세어서 API로 준다 — 코드를 배포하지도, 사용자에게 아무것도 보내게 하지도
 *   않고 퍼널의 첫 칸을 실측으로 바꿀 수 있다.
 *
 *   여기서 알 수 있는 것: 버전별·파일별 다운로드 수, 그 합계.
 *   여기서 알 수 없는 것: 설치까지 갔는지, 앱을 열었는지. 그건 앱 안의
 *   계측이 필요하고, 그건 옵트인으로 따로 설계한다. 모르는 걸 아는 척하지 않는다.
 *
 * 사용:
 *   node scripts/download-counts.mjs            # 표로 본다
 *   node scripts/download-counts.mjs --json     # 파일에 쌓아 추이를 본다
 *
 * 인증 없이 시간당 60회다. 사람이 가끔 부르는 용도라 충분하다.
 * (GITHUB_TOKEN을 환경변수에 두면 그걸 쓴다 — 한도가 넉넉해진다.)
 */

const REPO = 'lhs0609a-cpu/teraclean-releases'
const API = `https://api.github.com/repos/${REPO}/releases?per_page=100`

async function main() {
  const headers = { Accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

  const res = await fetch(API, { headers })
  if (!res.ok) {
    throw new Error(
      res.status === 403
        ? '시간당 호출 한도(60회)를 다 썼어요. 한 시간 뒤에 다시 부르거나 GITHUB_TOKEN을 넣어주세요.'
        : `GitHub이 ${res.status}로 답했어요.`
    )
  }
  const releases = await res.json()
  if (!Array.isArray(releases) || !releases.length) {
    console.log('아직 릴리스가 없어요.')
    return
  }

  const rows = releases.map((r) => {
    const assets = (r.assets ?? []).map((a) => ({ name: a.name, count: a.download_count ?? 0 }))
    return {
      version: r.tag_name,
      published: r.published_at ? r.published_at.slice(0, 10) : '',
      total: assets.reduce((n, a) => n + a.count, 0),
      assets,
    }
  })
  const total = rows.reduce((n, r) => n + r.total, 0)

  if (process.argv.includes('--json')) {
    // 날짜는 부르는 쪽이 찍는다 — 추이를 보려면 이 줄을 파일에 이어 붙이면 된다.
    console.log(JSON.stringify({ at: new Date().toISOString(), total, releases: rows }))
    return
  }

  console.log(`\n${REPO} — 설치파일 다운로드\n`)
  for (const r of rows) {
    console.log(`  ${r.version.padEnd(12)} ${String(r.total).padStart(6)}회   ${r.published}`)
    for (const a of r.assets) {
      // 고정 이름 사본과 버전 이름은 같은 파일이다. 합쳐서 한 번의 다운로드로 세지 않는다 —
      // 어느 쪽으로 받았는지가 랜딩 링크가 먹히는지를 말해준다.
      console.log(`      ${a.name.padEnd(34)} ${String(a.count).padStart(6)}회`)
    }
  }
  console.log(`\n  합계 ${total.toLocaleString()}회\n`)
  console.log('  ※ 이건 "받은 사람" 수다. 설치·실행까지 갔는지는 아직 모른다 —')
  console.log('     그건 앱 안의 옵트인 계측이 생겨야 알 수 있다.\n')
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
