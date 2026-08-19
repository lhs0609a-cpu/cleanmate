/**
 * 판정 사다리 — 모든 파일에 답을 붙인다
 *
 * ── 요구 ─────────────────────────────────────────────────────
 * "모든 걸 판단할 수 있어야 해. 이건 삭제해도 되고 저건 안 되고."
 *
 * 지금 엔진은 236GB를 "여쭤보고 정합니다" 한 덩어리에 밀어넣는다. 그건 판정이
 * 아니라 미루기다. 그렇다고 아무 근거 없이 "이건 지워도 된다"고 말하면
 * 되돌릴 수 없는 손해가 난다 — 실제로 repeats.ts를 만들다가 검수 대기 중인
 * 결과물 19.36GB를 '중간물'로 찍을 뻔했다.
 *
 * ── 답할 질문을 바꾼다 ───────────────────────────────────────
 * 엔진이 답할 수 **없는** 질문:  "이게 당신에게 중요한가?"
 * 엔진이 답할 수 **있는** 질문:  "이게 없어지면 되살릴 수 있나?"
 *
 * 두 번째는 관측으로 전부 답이 나온다. 그래서 빈칸이 없다.
 *   되살릴 수 있다  → 지워도 된다. 물어볼 필요조차 없다.
 *   되살릴 수 없다  → 유일본이다. 여기서만 "필요하세요?"를 묻는다.
 *   지우면 고장난다 → 아예 안 건드린다.
 *
 * 사용자가 답해야 할 질문이 236GB어치에서 **정말 사용자만 아는 것**으로 줄어든다.
 *
 * ── 사다리 순서가 곧 안전 설계다 ─────────────────────────────
 * 위에서부터 걸리는 대로 판정하고 멈춘다. 잠금이 맨 위인 이유는 명백하다 —
 * 아래쪽 근거가 아무리 강해도 시스템 파일을 지우면 안 된다.
 */

import type { Zone } from './types.ts'
import type { RepeatFamily } from './repeats.ts'

/** 되살릴 수 있는 근거. 없으면 'none'. */
export type Recovery =
  /** 규칙이 확증한 캐시·임시 — 프로그램이 필요할 때 다시 만든다 */
  | 'regenerates'
  /** 같은 내용이 다른 곳에 있다(해시로 확인) — 사본을 치워도 원본이 남는다 */
  | 'copy-elsewhere'
  /** 형제 폴더마다 복사돼 들어온 것 — 한 벌은 남는다 */
  | 'sibling-copy'
  /** 클라우드나 다른 드라이브에도 있다 */
  | 'backed-up'
  /**
   * 명령 한 번이면 다시 만들어진다 — 다만 시간이 걸린다.
   * (node_modules는 npm install, dist/build는 다시 빌드)
   *
   * ★ 이 칸이 없어서 133GB가 "물어볼 것"에 묻혀 있었다. 빌드 산출물 7.5GB와
   *   node_modules 4.1GB는 **되살릴 수 있는 게 확실한데** 물어보고 있었다.
   *   되살릴 수 있느냐(예)와 공짜냐(아니오)는 다른 질문이다. 섞으면 둘 다 못 쓴다.
   */
  | 'rebuildable'
  /** 되살릴 방법을 못 찾았다 */
  | 'none'

export type Action =
  /** 지워도 된다 — 되살릴 수 있으므로 */
  | 'delete'
  /** 되살릴 수 없다 — 필요한지 사용자에게 물어야 한다 */
  | 'ask'
  /** 지우면 고장난다 */
  | 'keep'

export interface VerdictFile {
  path: string
  size: number
  zone: Zone
  ruleBacked: boolean
  meaning: string
  /** 어느 규칙이 걸렸나. 'dev.build'처럼 다시 만들 수 있는 것을 여기서 가른다 */
  ruleId?: string
}

/**
 * 명령 한 번이면 되살아나는 규칙들.
 *
 * ★ 추측이 아니라 **규칙 DB가 이미 식별한 것**만 넣는다. 경로에 'build'가
 *   들어갔다고 여기 넣지 않는다 — 그건 추론이고, 사람이 만든 build 폴더를
 *   삼킨다. paths.ts가 확증한 id만 쓴다.
 */
const REBUILDABLE: Record<string, string> = {
  'dev.node_modules': '`npm install` 한 번이면 다시 받아집니다.',
  'dev.build': '다시 빌드하면 만들어집니다.',
}

/** 되살리는 데 드는 품. 지워도 되는 것 안에서도 순서를 가르는 기준이다. */
export type Effort =
  /** 프로그램이 알아서 다시 만든다. 사용자가 할 일이 없다 */
  | 'free'
  /** 다시 받거나 다시 빌드해야 한다. 되긴 되는데 시간이 든다 */
  | 'takes-time'

export interface FileVerdict {
  path: string
  size: number
  action: Action
  recovery: Recovery
  effort: Effort
  /** 사람이 읽을 근거 한 줄. 근거 없는 판정은 강요다 */
  because: string
  meaning: string
}

export interface VerdictInput {
  files: VerdictFile[]
  /** 반복 구조. 'shared' 판정과 '미완성 폴더' 보호에 쓴다 */
  repeats?: RepeatFamily[]
  /**
   * 해시로 확인된 사본 → 남길 원본. **사본만** 담는다.
   * 원본이 여기 들어오면 원본까지 지워진다.
   */
  copyOf?: Map<string, string>
  /** 클라우드·다른 드라이브에도 있는 것으로 확인된 경로 */
  backedUp?: Set<string>
}

const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
const dirOf = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/')))
const parentOf = (p: string): string | null => {
  const i = p.lastIndexOf('/')
  return i > 0 ? p.slice(0, i) : null
}

/**
 * 사다리를 태운다. 파일 하나가 여러 근거에 걸려도 **가장 위 것 하나**만 쓴다.
 */
export function judge(input: VerdictInput): FileVerdict[] {
  const { files, repeats = [], copyOf, backedUp } = input

  /* 미완성 폴더 = 결과물이 빠진 작업 폴더. 거기 있는 건 그 작업의 유일한
     흔적일 수 있다. **어떤 근거가 걸리든 자동 삭제 대상에서 뺀다.**
     실측에서 렌더링이 끊긴 폴더 6개가 여기 걸렸다. */
  const protectedSet = new Set<string>()
  for (const fam of repeats) for (const d of fam.incomplete) protectedSet.add(norm(d))

  /* 형제마다 복사돼 들어온 이름들. (가족 경로, 상대경로) 조합으로 기억한다. */
  const sharedRel = new Map<string, Set<string>>()
  for (const fam of repeats) {
    const rels = new Set(fam.entries.filter((e) => e.role === 'shared').map((e) => e.rel))
    if (rels.size) for (const d of fam.dirs) sharedRel.set(norm(d), rels)
  }

  /* 형제 복사본은 **한 벌을 남긴다.** 남길 폴더를 미리 정해둔다 —
     안 그러면 233벌이 전부 "사본"이 되어 원본까지 사라진다. */
  const keepSharedIn = new Map<string, string>() // 가족 → 남길 형제 폴더
  for (const fam of repeats) {
    if (fam.entries.some((e) => e.role === 'shared') && fam.dirs.length) {
      keepSharedIn.set(fam.parent, norm([...fam.dirs].sort()[0]))
    }
  }
  const famOf = new Map<string, string>() // 형제 폴더 → 가족 부모
  for (const fam of repeats) for (const d of fam.dirs) famOf.set(norm(d), fam.parent)

  const out: FileVerdict[] = []
  for (const f of files) {
    const np = norm(f.path)
    const base = (v: Omit<FileVerdict, 'path' | 'size' | 'meaning'>): FileVerdict => ({
      path: f.path, size: f.size, meaning: f.meaning, ...v,
    })

    // ── 1단 · 지우면 고장난다 ──────────────────────────────
    if (f.zone === 'LOCKED') {
      out.push(base({
        action: 'keep',
        recovery: 'none',
        effort: 'free',
        because: '지우면 뭔가 깨져요. 되살릴 수 있느냐를 따지기 전에 안 건드립니다.',
      }))
      continue
    }

    /* ── 미완성 폴더 보호 ────────────────────────────────
       사다리를 태우기 전에 막는다. 아래 근거가 걸려도 자동 삭제로 안 보낸다.

       ★ 보호 폴더 목록을 파일마다 전부 훑으면 안 된다. 형제가 408개인 무리에
         파일이 58만 개면 2.4억 번이다. 조상을 거슬러 올라가면 8번이면 끝난다. */
    let inProtected = false
    for (let d: string | null = dirOf(np); d; d = parentOf(d)) {
      if (protectedSet.has(d)) { inProtected = true; break }
    }

    // ── 2단 · 규칙이 확증한 캐시·임시 ────────────────────
    if (f.zone === 'SAFE' && f.ruleBacked) {
      out.push(base({
        action: 'delete',
        recovery: 'regenerates',
        effort: 'free',
        because: '프로그램이 필요할 때 다시 만드는 것이에요. 지워도 그대로 돌아옵니다.',
      }))
      continue
    }

    // ── 3단 · 같은 내용이 다른 곳에 있다 (해시로 확인) ───
    const original = copyOf?.get(f.path) ?? copyOf?.get(np)
    if (original && !inProtected) {
      out.push(base({
        action: 'delete',
        recovery: 'copy-elsewhere',
        effort: 'free',
        because: `내용이 완전히 같은 파일이 다른 곳에 있어요. 이걸 지워도 그쪽은 남습니다.`,
      }))
      continue
    }

    /* ── 4단 · 형제 폴더마다 복사된 것 ────────────────────
       여기도 조상을 거슬러 올라가며 '내가 속한 형제 폴더'를 찾는다. */
    let sibHit = false
    for (let d: string | null = dirOf(np); d; d = parentOf(d)) {
      const rels = sharedRel.get(d)
      if (!rels) continue
      if (!rels.has(np.slice(d.length + 1))) break
      // 남기기로 정한 폴더의 것은 원본이다 — 지우지 않는다.
      const fam = famOf.get(d)
      if (fam && keepSharedIn.get(fam) === d) break
      sibHit = true
      break
    }
    if (sibHit && !inProtected) {
      out.push(base({
        action: 'delete',
        recovery: 'sibling-copy',
        effort: 'free',
        because: '작업 폴더마다 같은 것이 복사돼 들어와 있어요. 한 벌은 남겨둡니다.',
      }))
      continue
    }

    // ── 5단 · 클라우드·다른 드라이브에도 있다 ────────────
    if (backedUp?.has(f.path) && !inProtected) {
      out.push(base({
        action: 'delete',
        recovery: 'backed-up',
        effort: 'free',
        because: '클라우드나 다른 드라이브에도 같은 게 있어요. 여기서 지워도 그쪽에 남습니다.',
      }))
      continue
    }

    /* ── 6단 · 다시 받거나 빌드하면 되는 것 ────────────────
       되살릴 수 있는 건 확실한데 **공짜가 아니다.** 그래서 지워도 된다고 하되
       품이 든다는 걸 같이 말한다. 이 칸이 없어서 11.6GB가 "몰라요"에 묻혀 있었다. */
    const how = f.ruleId ? REBUILDABLE[f.ruleId] : undefined
    if (how && !inProtected) {
      out.push(base({
        action: 'delete',
        recovery: 'rebuildable',
        effort: 'takes-time',
        because: `지워도 됩니다 — ${how} 다만 그만큼 시간이 걸려요.`,
      }))
      continue
    }

    // ── 7단 · 되살릴 방법을 못 찾았다 ────────────────────
    out.push(base({
      action: 'ask',
      recovery: 'none',
      effort: 'free',
      because: inProtected
        ? '아직 안 끝난 작업 폴더예요. 여기 있는 건 그 작업의 유일한 흔적일 수 있습니다.'
        : '되살릴 방법을 못 찾았어요. 지우면 다시 만들 수 없으니 필요하신지만 알려주세요.',
    }))
  }
  return out
}

/* ────────────────────────────────────────────────────────────
   합계 — "우리가 본 것 전부에 답이 붙었나"를 보여준다
   ──────────────────────────────────────────────────────────── */

export interface VerdictGroup {
  key: string
  bytes: number
  count: number
}

export interface VerdictSummary {
  /** 지워도 되는 것 — 되살릴 수 있는 근거별로 */
  deletable: { bytes: number; count: number; byRecovery: VerdictGroup[] }
  /** 물어봐야 하는 것 — 무엇인지별로 */
  ask: { bytes: number; count: number; byMeaning: VerdictGroup[] }
  /** 안 건드리는 것 */
  keep: { bytes: number; count: number }
  total: { bytes: number; count: number }
}

const RECOVERY_LABEL: Record<Recovery, string> = {
  regenerates: '다시 만들어지는 것',
  'copy-elsewhere': '다른 곳에 같은 게 있는 것',
  'sibling-copy': '폴더마다 복사돼 들어온 것',
  'backed-up': '클라우드에도 있는 것',
  rebuildable: '다시 받거나 빌드하면 되는 것',
  none: '되살릴 수 없는 것',
}

function roll(items: { key: string; size: number }[], top = 6): VerdictGroup[] {
  const m = new Map<string, VerdictGroup>()
  for (const it of items) {
    const g = m.get(it.key)
    if (g) { g.bytes += it.size; g.count++ }
    else m.set(it.key, { key: it.key, bytes: it.size, count: 1 })
  }
  return [...m.values()].sort((a, b) => b.bytes - a.bytes).slice(0, top)
}

export function summarize(verdicts: FileVerdict[]): VerdictSummary {
  const del = verdicts.filter((v) => v.action === 'delete')
  const ask = verdicts.filter((v) => v.action === 'ask')
  const keep = verdicts.filter((v) => v.action === 'keep')
  const sum = (a: FileVerdict[]) => a.reduce((n, v) => n + v.size, 0)

  return {
    deletable: {
      bytes: sum(del),
      count: del.length,
      byRecovery: roll(del.map((v) => ({ key: RECOVERY_LABEL[v.recovery], size: v.size }))),
    },
    ask: {
      bytes: sum(ask),
      count: ask.length,
      byMeaning: roll(ask.map((v) => ({ key: v.meaning, size: v.size }))),
    },
    keep: { bytes: sum(keep), count: keep.length },
    total: { bytes: sum(verdicts), count: verdicts.length },
  }
}
