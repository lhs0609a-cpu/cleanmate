/**
 * 기본 스캔 대상 — "폴더 고르기" 없이 원클릭이 되게 하는 것
 *
 * 왜 필요한가: 지금까지 이 앱은 사용자가 고른 폴더 하나만 봤다. 그런데
 * "어느 폴더가 문제인지"를 아는 사람이면 애초에 이 앱이 필요 없다.
 * 용량이 부족한 사람은 어디를 봐야 할지 몰라서 부족한 거다.
 * → 첫 실행부터 아무것도 안 고르고 누를 수 있어야 한다.
 *
 * ── 왜 드라이브 전체가 아니라 '목록'인가 ──────────────────────
 * C 드라이브를 통째로 훑으면 지금 속도로 10분이 넘고, 그중 대부분은
 * 애초에 건드리지 않을 곳(존 C)이다. 실측에서 용량을 실제로 먹고 있던 건
 * 사용자 폴더와 AppData 두 군데였다. 넓게 훑는 것보다 '맞는 곳'을 보는 게
 * 빠르고, 무엇을 볼 건지 목록으로 보여줄 수 있어서 정직하다.
 *
 * ── 겹치면 두 번 센다 ────────────────────────────────────────
 * %TEMP%는 보통 AppData\Local\Temp다. 둘 다 목록에 넣으면 같은 파일을
 * 두 번 세서 "정리 가능 용량"이 부풀려진다. 삭제 도구가 용량을 부풀리는 건
 * 그냥 거짓말이라, dropNested()로 상위 경로에 포함된 항목을 걷어낸다.
 */

export interface PresetRoot {
  /** 화면에 보여줄 이름 — 무엇을 볼 건지 먼저 말한다 */
  label: string
  path: string
}

export interface PresetEnv {
  platform: NodeJS.Platform
  /** 사용자 홈 (windows: C:\Users\이름) */
  home: string
  /** %TEMP% — 홈 밖으로 옮겨둔 사람이 있어서 따로 받는다 */
  temp?: string
}

/** 경로 비교용 정규화. 대소문자·구분자·끝 슬래시를 없앤다. */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 다른 항목 안에 들어있는 경로를 걷어낸다.
 * (C:/Users/me/AppData/Local 이 있으면 C:/Users/me/AppData/Local/Temp 는 뺀다)
 *
 * 순수 함수로 뺀 이유: 여기가 틀리면 용량이 두 배로 보고된다. 눈으로는
 * 절대 못 잡는 종류의 버그라 테스트로 겨냥한다.
 */
export function dropNested(roots: PresetRoot[]): PresetRoot[] {
  return roots.filter((r, i) => {
    const me = norm(r.path)
    return !roots.some((other, j) => {
      if (i === j) return false
      const them = norm(other.path)
      if (them === me) return j < i // 완전 중복이면 앞의 것만 남긴다
      return me.startsWith(them + '/')
    })
  })
}

/**
 * 이 PC에서 기본으로 훑을 곳.
 *
 * 존재 여부는 여기서 따지지 않는다(순수 함수로 두려고). 실제로 있는 것만
 * 고르는 건 engine-cli가 한다.
 *
 * ★ C:\Windows 를 넣지 않는 이유: 스캐너가 어차피 안 들어간다(SKIP_DIRS).
 *   거기 있는 것들(업데이트 캐시·WinSxS)은 파일 삭제가 아니라 정식 명령으로
 *   다뤄야 해서 '숨은 공간' 프로브 쪽이 담당한다.
 */
export function defaultRoots(env: PresetEnv): PresetRoot[] {
  const { platform, home, temp } = env
  const j = (...parts: string[]) => parts.join(platform === 'win32' ? '\\' : '/')

  const roots: PresetRoot[] =
    platform === 'win32'
      ? [
          { label: '다운로드', path: j(home, 'Downloads') },
          { label: '바탕화면', path: j(home, 'Desktop') },
          { label: '문서', path: j(home, 'Documents') },
          { label: '사진', path: j(home, 'Pictures') },
          { label: '동영상', path: j(home, 'Videos') },
          { label: '음악', path: j(home, 'Music') },
          { label: '앱 데이터(로컬)', path: j(home, 'AppData', 'Local') },
          { label: '앱 데이터(로밍)', path: j(home, 'AppData', 'Roaming') },
        ]
      : [
          { label: '다운로드', path: j(home, 'Downloads') },
          { label: '바탕화면', path: j(home, 'Desktop') },
          { label: '문서', path: j(home, 'Documents') },
          { label: '앱 캐시', path: j(home, 'Library', 'Caches') },
        ]

  if (temp) roots.push({ label: '임시 폴더', path: temp })

  return dropNested(roots)
}
