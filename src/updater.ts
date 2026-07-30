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

/* ── 무결성 검증 ─────────────────────────────────────────────
   업데이트 경로는 우리가 사용자 컴퓨터에서 임의 코드를 실행하는 통로다.
   받은 파일이 우리가 만든 그 파일인지 확인하지 않으면, 중간에서 바꿔치기한
   설치파일을 우리 손으로 실행해 주는 셈이 된다. 신뢰가 제품의 핵심 가치인데
   여기가 열려 있으면 다른 모든 안전장치가 의미 없다.

   판단은 여기(순수 함수)서 하고, 해시 계산과 실행은 Tauri 셸이 한다.
   Rust 쪽도 실행 직전에 한 번 더 대조한다 — 이 층을 우회당해도 막히게. */

/** 검증 결과. ok가 아니면 절대 실행하지 않는다. */
export interface IntegrityResult {
  ok: boolean
  reason?: string
}

const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * 장부의 signature 값에서 SHA-256 16진수만 뽑아 정규화한다.
 * "sha256:ABC…" / "ABC…" 둘 다 받고, 소문자로 통일한다.
 * 형식이 아니면 null — 부르는 쪽이 '검증 불가'로 처리해야 한다.
 */
export function normalizeSha256(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null
  const hex = value.trim().replace(/^sha256[:=]/i, '').toLowerCase()
  return SHA256_HEX.test(hex) ? hex : null
}

/**
 * 받은 파일이 장부에 적힌 그 파일인지 대조한다.
 *
 * ★ 실패 시 닫힌다(fail closed): 장부에 서명이 없거나 형식이 깨졌으면
 *   "검증할 수 없으니 통과"가 아니라 "검증할 수 없으니 거절"이다.
 *   서명 없는 릴리스는 업데이트되지 않는다 — 그게 안전한 방향이다.
 */
export function verifyIntegrity(expected: string | undefined | null, actual: string | undefined | null): IntegrityResult {
  const want = normalizeSha256(expected)
  if (want === null) {
    return { ok: false, reason: '릴리스에 SHA-256 서명이 없어 업데이트를 검증할 수 없어요' }
  }
  const got = normalizeSha256(actual)
  if (got === null) {
    return { ok: false, reason: '받은 파일의 해시를 계산하지 못했어요' }
  }
  if (want !== got) {
    return { ok: false, reason: '받은 파일이 릴리스에 게시된 것과 달라요 — 설치를 멈췄어요' }
  }
  return { ok: true }
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
