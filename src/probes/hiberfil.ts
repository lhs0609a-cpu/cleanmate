/**
 * 최대절전 파일(hiberfil.sys) 프로브 — 설명 레이어의 첫 완성 사례
 *
 * 왜 이걸 첫 번째로 만드나: 사람이 삭제 전에 묻는 7가지를 전부 요구하는
 * 항목이라서다. 연관이 숨어 있고(빠른 시작 — 아무도 모른다), 위험이
 * 조건부고(노트북 vs 데스크톱), 복구가 명령 한 줄이고, 크기가 계산값이다.
 * 이거 하나를 제대로 하면 나머지 규칙들의 틀이 나온다.
 *
 * 설명은 정적 문자열이 아니라 실측 사실에서 만들어진다. RAM이 32GB면
 * 12.7GB, 16GB면 6.4GB다. 노트북이면 경고가 붙고 데스크톱이면 안 붙는다.
 * "당신 PC 얘기"여야 마음이 놓이지, 일반론은 위키백과다.
 */

import type { Finding } from '../types.ts'
import type { SystemFacts } from './facts.ts'

const GB = 1024 ** 3
const gb = (n: number) => (n / GB).toFixed(1)

export function probeHiberfil(f: SystemFacts): Finding | null {
  // 파일이 없다 = 최대절전이 이미 꺼져 있다. 할 말이 없다.
  if (f.hiberfilBytes === 0) return null

  const pct = Math.round((f.hiberfilBytes / f.ramBytes) * 100)

  /* ── ③ 연관: 뭐가 이걸 쓰나 ──────────────────────────────
     빠른 시작이 핵심이다. 기본으로 켜져 있어서 "난 최대절전 안 쓰는데?"
     하는 사람도 사실은 매일 쓰고 있다. 이걸 안 알려주고 끄게 하면
     "얘 때문에 부팅이 느려졌다"는 원망을 듣는다. */
  const usedBy = [
    '최대 절전 모드 — 전원을 완전히 껐다 켜도 열어둔 창이 그대로 돌아오는 기능이에요.',
  ]
  if (f.fastStartupEnabled) {
    usedBy.push(
      '빠른 시작 — 켤 때 몇 초 빨라지는 기능이에요. 지금 켜져 있습니다. ' +
        '기본값이라 쓰는 줄 모르는 분이 대부분이에요.'
    )
  }

  /* ── ④⑤ 지우면 뭐가 달라지나 — 양면 정직.
     좋은 점만 쓰면 광고다. 손해를 반드시 먼저 쓴다. */
  const ifRemoved = [
    '최대 절전 모드를 못 씁니다. 절전 모드(슬립)는 그대로 쓸 수 있어요.',
  ]
  if (f.fastStartupEnabled) {
    ifRemoved.push('빠른 시작도 같이 꺼집니다. 부팅이 2~5초쯤 느려질 수 있어요.')
  }
  ifRemoved.push(
    f.isLaptop
      ? `★ 이 PC는 노트북 같아요(${f.laptopSignals.join(', ')}). 덮개 닫아두는 편이면 한 번 더 생각해보세요. ` +
        '배터리가 나가도 하던 일을 지켜주는 게 이 기능이거든요.'
      : '이 PC는 데스크톱 같아요(배터리 없음). 데스크톱에서 최대절전 쓰는 분은 드물어서, 없어진 줄도 모르실 거예요.'
  )

  return {
    id: 'win.hiberfil',
    title: '최대절전 파일 (hiberfil.sys)',
    bytes: f.hiberfilBytes,
    // 지금은 존 C(잠금)다. 파일로서는 절대 못 지운다 — 아래 action이
    // 유일한 안전 경로다. 존 C지만 '회수 가능'인 첫 사례다.
    zone: 'LOCKED',
    explain: {
      what:
        '컴퓨터가 잘 때 덮는 이불이에요. 끄기 전에 열어둔 걸 통째로 적어놨다가, ' +
        '다시 켜면 그대로 펼쳐줍니다.',

      /* ── ② 왜 이렇게 큰가 — "내가 뭘 잘못했나?"에 답한다.
         마지막 문장이 중요하다. 다른 청소 도구를 아무리 돌려도 이게 안 줄어든
         이유를 여기서 처음 알게 된다. */
      why:
        `이불은 침대에 맞춰 미리 재단해둡니다 — 메모리(RAM)의 약 40%요. ` +
        `이 PC는 RAM이 ${gb(f.ramBytes)}GB라서 ${gb(f.hiberfilBytes)}GB예요(${pct}%). ` +
        `뭐가 쌓인 게 아니라 처음부터 이 크기라, 파일을 아무리 지워도 안 줄어요.` +
        (f.hiberFileSizePercent > 0
          ? ` (참고: 이 PC는 크기가 ${f.hiberFileSizePercent}%로 직접 지정돼 있네요.)`
          : ''),

      usedBy,
      ifRemoved,

      recovery: 'one-command',
      recoveryNote:
        '네. 이불을 버리는 게 아니라 개어 넣는 거예요. 다시 켜면 윈도우가 새로 펴줍니다. ' +
        '되돌리기 버튼도 같이 드려요.',

      /* ── ⑦ 안 지우면요 — '안 지운다'는 선택지를 절대 뺏지 않는다.
         이게 없으면 아무리 친절해도 압박이 된다. */
      ifKept: `아무 문제 없어요. ${gb(f.hiberfilBytes)}GB를 계속 쓸 뿐입니다. 급하지 않으면 그냥 두셔도 돼요.`,
    },

    action: {
      describe: '최대 절전 기능을 끕니다. 파일은 윈도우가 알아서 지웁니다.',
      command: 'powercfg /hibernate off',
      needsAdmin: true,
      undo: 'powercfg /hibernate on',
      undoDescribe: '최대 절전 기능을 다시 켭니다. 파일도 다시 생깁니다.',
    },
  }
}
