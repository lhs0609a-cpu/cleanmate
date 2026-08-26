/**
 * 릴리스 자산 준비 — "어느 파일 받아야 되죠?"를 없앤다
 *
 * ★ 왜 필요한가
 *   랜딩의 다운로드 버튼은 JS가 GitHub API로 최신 자산 주소를 읽어 채운다.
 *   그런데 그 길이 막히는 사람이 적지 않다 — JS를 끈 사람, 사내망에서
 *   api.github.com이 막힌 사람, 공용 IP라 시간당 한도(60회)를 이미 쓴 사람.
 *   그 사람들은 폴백으로 간다. 폴백이 릴리스 '목록 페이지'면, 일반 사용자는
 *   영어 변경 이력과 파일 여러 개 앞에서 멈춘다.
 *
 *   그래서 폴백을 고정 주소의 **파일**로 바꿨다:
 *     https://github.com/<repo>/releases/latest/download/TeraClean-Setup.exe
 *   이 주소가 살아 있으려면 릴리스마다 **같은 이름**의 사본이 올라가 있어야 한다.
 *   이 스크립트가 그 사본을 만들고, 올리는 명령까지 찍어 준다.
 *
 * ★ 버전 있는 이름도 그대로 둔다
 *   업데이터(latest.json)와 사용자의 다운로드 폴더에는 버전이 보이는 편이 낫다.
 *   그래서 지우는 게 아니라 **사본을 하나 더** 만든다. 둘은 바이트가 같다 —
 *   해시도 같으니 SmartScreen 평판도 나뉘지 않는다.
 *
 * 사용:
 *   node scripts/publish-release.mjs                 # dist-installer에서 최신 것을 집는다
 *   node scripts/publish-release.mjs <설치파일 경로>  # 직접 지정
 */

import { readdir, copyFile, stat, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist-installer')
/** 랜딩(web/src/landing.ts의 SETUP_NAME)과 반드시 같아야 한다. 테스트로 잠가뒀다. */
const FIXED_NAME = 'TeraClean-Setup.exe'

/** 버전이 붙은 설치파일 중 가장 최근 것. 여러 버전이 쌓여 있어도 헷갈리지 않게. */
async function findInstaller(): Promise<string> {
  let names: string[]
  try {
    names = await readdir(DIST)
  } catch {
    throw new Error(`빌드 산출물 폴더가 없어요: ${DIST}\n먼저 이노셋업으로 설치파일을 만들어 주세요.`)
  }
  const cands = names.filter((n) => /^TeraClean-Setup-.+\.exe$/i.test(n))
  if (!cands.length) throw new Error(`${DIST} 안에 TeraClean-Setup-<버전>.exe가 없어요.`)

  const withTime = await Promise.all(
    cands.map(async (n) => ({ n, t: (await stat(join(DIST, n))).mtimeMs }))
  )
  withTime.sort((a, b) => b.t - a.t)
  return join(DIST, withTime[0].n)
}

async function sha256(path: string): Promise<string> {
  // 설치파일은 수십 MB다. 통째로 올리지 않고 조금씩 읽는다.
  const h = createHash('sha256')
  const fh = await readFile(path)
  h.update(fh)
  return h.digest('hex')
}

async function main() {
  const src = process.argv[2] ? join(process.cwd(), process.argv[2]) : await findInstaller()
  const version = basename(src).replace(/^TeraClean-Setup-/i, '').replace(/\.exe$/i, '')
  const fixed = join(dirname(src), FIXED_NAME)

  await copyFile(src, fixed)
  const hash = await sha256(src)
  const size = (await stat(src)).size

  const mb = (size / 1024 / 1024).toFixed(1)
  console.log(`
버전      v${version}
크기      ${mb} MB
SHA-256   ${hash}

올릴 파일 두 개 (같은 내용, 이름만 다름):
  ${basename(src)}      ← 사람이 보는 이름(버전이 보인다)
  ${FIXED_NAME}         ← 랜딩 폴백이 가리키는 고정 이름 · 빠뜨리면 그 링크가 404다

  gh release create v${version} "${src}" "${fixed}" \\
    --repo lhs0609a-cpu/teraclean-releases \\
    --title "v${version}" \\
    --notes "SHA-256: ${hash}"

★ 릴리스 노트에 SHA-256을 그대로 적는다. 서명이 붙기 전까지, 받은 파일이
  우리가 만든 그 파일인지 사용자가 스스로 확인할 수 있는 유일한 방법이다.
`)
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
