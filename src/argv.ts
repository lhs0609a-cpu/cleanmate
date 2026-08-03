/**
 * 엔진 인자 파싱 — 별도 모듈인 이유가 있다
 *
 * engine-cli.ts는 불러오는 즉시 main()을 실행한다(CLI니까). 그래서 거기 있는
 * 함수를 테스트에서 import하면 테스트 러너의 argv로 엔진이 돌아버리고
 * process.exit까지 간다. 순수 판단만 여기로 뺀다.
 *
 * ★ 실물에서 터진 사고(2026-08-03): 설치된 앱의 모든 기능이 죽어 있었다.
 *   어떤 명령으로 엔진을 부르든 이 응답만 돌아왔다:
 *     {"ok":false,"error":"알 수 없는 명령: D:\\CleanMate\\teraclean-engine.exe"}
 *
 *   원인은 argv 자리 계산이었다. SEA(단일 exe)에서는 '스크립트 경로' 자리에
 *   실행 파일 경로가 한 번 더 들어온다:
 *     일반 node : [node, engine-cli.ts, command, ...args]
 *     SEA exe   : [exe,  exe,           command, ...args]
 *   앞의 것을 slice(1)로 잡아서 명령 자리에 exe 경로가 들어갔다.
 *
 *   그래서 '몇 개를 건너뛸까'가 아니라 '이게 명령인가'로 판단한다.
 */

/** argv에서 실제 명령·인자만 뽑는다. 실행 방식이 달라져도 명령을 잃지 않는다. */
export function parseArgv(argv: string[], execPath: string): string[] {
  const second = argv[1]
  // argv[1]이 자기 자신(exe)이거나 스크립트 파일이면 명령이 아니다.
  const isSelfOrScript =
    !!second && (second === execPath || /\.(ts|js|mjs|cjs)$/i.test(second))
  return argv.slice(isSelfOrScript ? 2 : 1)
}
