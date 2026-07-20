/**
 * 자동 업데이트 로직 — V3/알약 방식
 *
 * 흐름:
 *   1. 앱이 켜질 때(또는 주기적으로) latest.json을 조용히 확인한다.
 *   2. 서버 version > 내 version 이면 "업데이트 있음"을 알린다.
 *   3. 이노셋업 설치파일을 받아, 무결성을 검증하고,
 *      /VERYSILENT 로 실행 → 조용히 재설치 → 앱 재시작.
 *
 * 이 파일은 '판단'만 한다(순수). 실제 다운로드·실행은 데스크톱 셸(Tauri)의
 * 권한 있는 명령이 한다 — engine.ts가 질문 '선정'만 하고 실행은 안 하는 것과
 * 같은 분리다. 브라우저에서도 이 비교 로직은 그대로 테스트된다.
 */

export interface UpdateManifest {
  version: string
  notes: string
  pub_date: string
  url: string
  signature: string
}

export interface UpdateCheck {
  hasUpdate: boolean
  current: string
  latest: string
  manifest?: UpdateManifest
}

/** SemVer 비교. a>b → 1, a<b → -1, 같으면 0. 프리릴리스는 안 다룬다(MVP). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10))
  const pb = b.split('.').map((n) => parseInt(n, 10))
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

/**
 * 장부와 현재 버전을 비교해 업데이트 필요 여부를 판단한다.
 * fetchJson은 주입한다 — 브라우저는 fetch, Tauri는 권한 있는 http로.
 */
export async function checkForUpdate(
  currentVersion: string,
  manifestUrl: string,
  fetchJson: (url: string) => Promise<unknown>
): Promise<UpdateCheck> {
  const manifest = (await fetchJson(manifestUrl)) as UpdateManifest
  const hasUpdate = compareVersions(manifest.version, currentVersion) > 0
  return {
    hasUpdate,
    current: currentVersion,
    latest: manifest.version,
    manifest: hasUpdate ? manifest : undefined,
  }
}

/**
 * 무인 재설치 명령을 만든다. 실제 실행은 Tauri 셸이 한다.
 *   /VERYSILENT       — UI 없이 설치
 *   /SUPPRESSMSGBOXES — 확인창 없이
 *   /NORESTART        — 윈도우 재부팅 안 함
 * 이노셋업이 이 인자들을 표준으로 지원한다(cleanmate.iss).
 */
export function silentInstallArgs(): string[] {
  return ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']
}
