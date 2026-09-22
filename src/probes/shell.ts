/**
 * 프로브가 바깥 세상을 보는 통로 — 파워셸 한 번
 *
 * ── 왜 한 곳에 모으나 ────────────────────────────────────────
 * 프로브마다 `execFile('powershell.exe', ['-NoProfile', …])`를 따로 적고 있었다.
 * 똑같은 네 줄이 다섯 군데에 흩어져 있었다는 건, **'얼마까지 기다릴 것인가'를
 * 정할 자리가 없었다**는 뜻이다. 실측에서 '숨은 공간' 화면이 55초를 기다렸는데,
 * 그 시간을 끊을 손잡이가 어디에도 없었다.
 * (로딩 표시를 startPanel 한 곳에 모은 것과 같은 이유다 — loading-progress.test.ts)
 *
 * ── 왜 시간을 끊나 ──────────────────────────────────────────
 * 여기서 하는 일은 전부 **읽기**다. 휴지통 크기를 재고, 가상 메모리 설정을 보고,
 * vhdx 파일 크기를 묻는다. 이런 게 20초를 넘겼다면 답이 큰 게 아니라 무언가
 * 막힌 것이다(디스크가 잠깐 바쁘거나, 백신이 프로세스를 붙잡고 있거나).
 *
 * 막힌 것을 끝까지 기다려주면 화면이 영영 안 뜬다. 그래서 끊고 **나머지로 낸다** —
 * 프로브는 원래 한 군데가 없어도 나머지를 보여주게 돼 있다(engine-cli의 probe).
 * 못 잰 항목은 '0'이 아니라 '확인 필요'로 나간다. "없다"와 "못 봤다"는 다른 말이다.
 *
 * ── 왜 콘솔 창이 안 뜨나 ────────────────────────────────────
 * windowsHide. 앱(GUI 프로세스)이 콘솔 프로그램을 띄우면 윈도우가 검은 창을
 * 하나 붙여준다 — 탭을 누를 때마다 창이 깜빡였다(main.rs CREATE_NO_WINDOW와 같은 사연).
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * 읽기 한 번을 기다려주는 한도.
 *
 * ★ 넉넉하게 잡은 값이다. 실측(정상 PC)에서 가장 느린 조사가 0.3초였다.
 *   여기 걸린다는 건 느린 게 아니라 막힌 것이다.
 */
export const PS_TIMEOUT_MS = 20_000

interface PsOptions {
  /** 기본 20초. 각주처럼 오래 걸려도 되는 조회만 늘린다. */
  timeoutMs?: number
  /** 기본 1MB. 목록을 통째로 받는 조회만 늘린다. */
  maxBuffer?: number
}

/**
 * 파워셸에 스크립트 하나를 시키고 stdout을 받는다.
 *
 * ★ script는 **고정 문자열**이어야 한다. 사용자·레지스트리에서 온 값을
 *   이어붙이지 않는다 — 이어붙이는 순간 주입 통로가 된다(startup.ts·main.rs와 같은 원칙).
 *   넘길 값이 있으면 stdin으로 넘긴다.
 */
export async function ps(script: string, opts: PsOptions = {}): Promise<string> {
  const { stdout } = await exec(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      windowsHide: true,
      timeout: opts.timeoutMs ?? PS_TIMEOUT_MS,
      maxBuffer: opts.maxBuffer ?? 1 << 20,
    }
  )
  return stdout
}
