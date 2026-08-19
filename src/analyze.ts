/**
 * 분석 — 스캔 한 번 위에 관측 네 패스를 얹는다
 *
 * ── 왜 한 자리에 모으나 ──────────────────────────────────────
 * engine-cli.ts는 '배선'만 하는 파일이다(그 파일 머리말). 판단이 거기 들어가면
 * 시험할 수가 없다 — 실제 디스크를 훑어야만 돌아가는 코드가 되기 때문이다.
 * 그래서 네 패스를 여기 모으고, 밖에서는 함수 하나만 부른다.
 *
 * ── 순서가 곧 설계다 ─────────────────────────────────────────
 *   1) 크기 트리   어디가 큰가            (sizetree)
 *   2) 반복 구조   같은 모양이 N번 있나    (repeats)
 *   3) 해시 사본   내용이 같은 게 또 있나  (dupes)
 *   4) 판정        되살릴 수 있나          (verdict)
 *   5) 제안        사람이 볼 수 있게 접기  (proposal)
 *
 * 1~3은 **관측**이고 4가 **판정**이다. 섞으면 그때부터 숫자를 못 믿는다.
 *
 * ── 비용 ─────────────────────────────────────────────────────
 * 1·2·4·5는 디스크를 다시 안 읽는다(경로·크기·시각 연산뿐). 실측에서
 * 42만 개에 3.5초였다. 3만 크기가 겹치는 것만 골라 해시를 읽는데,
 * 실측에서 후보 44개 중 20개만 읽었다 — 거르는 규칙이 세서 거의 공짜다.
 */

import { buildSizeTree, findHotspots, type Hotspot } from './sizetree.ts'
import { findRepeats, type RepeatFamily } from './repeats.ts'
import { filterDupeCandidates, hashAndGroup } from './dupes.ts'
import { judge, summarize, type FileVerdict, type VerdictFile, type VerdictSummary } from './verdict.ts'
import { propose, type Proposal } from './proposal.ts'

export interface AnalyzeFile extends VerdictFile {
  mtimeMs: number
}

export interface AnalyzeResult {
  hotspots: Hotspot[]
  repeats: RepeatFamily[]
  verdicts: FileVerdict[]
  summary: VerdictSummary
  proposals: Proposal[]
  rest: { bytes: number; count: number; cards: number }
  /** 어느 패스가 얼마나 걸렸나 — 느려지면 어디가 느려졌는지 알아야 한다 */
  timing: Record<string, number>
}

/**
 * 내용이 같은 사본 → 남길 원본. **사본만** 담는다.
 *
 * ★ dupes.ts의 거르는 규칙을 그대로 쓴다. "바이트가 같으니 지워도 된다"가
 *   틀리는 자리가 있기 때문이다 — node_modules의 같은 dll은 프로그램마다
 *   자기 것이 필요하고, 하나를 지우면 내용은 다른 데 남아 있어도 그 프로그램은
 *   깨진다. '되살릴 수 있나'와 '지워도 안 깨지나'는 다른 질문이고,
 *   그 구분이 이미 NOT_DUPLICATES에 들어 있다.
 */
async function buildCopyMap(files: AnalyzeFile[]): Promise<Map<string, string>> {
  const { candidates } = filterDupeCandidates(
    files.map((f) => ({
      path: f.path,
      name: f.path.slice(Math.max(f.path.lastIndexOf('\\'), f.path.lastIndexOf('/')) + 1),
      size: f.size,
      mtimeMs: f.mtimeMs,
    }))
  )
  const map = new Map<string, string>()
  if (!candidates.length) return map
  const { groups } = await hashAndGroup(candidates)
  for (const g of groups) {
    // hashAndGroup이 이미 '이미 하드링크된 것'을 낭비에서 뺐다(v0.16.0).
    // 여기 남은 copies는 실제로 따로 자리를 차지하는 것들이다.
    for (const c of g.copies) map.set(c.path, g.keeper.path)
  }
  return map
}

export async function analyze(files: AnalyzeFile[], totalBytes: number): Promise<AnalyzeResult> {
  const timing: Record<string, number> = {}
  const clock = async <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
    const t = Date.now()
    const r = await fn()
    timing[name] = Date.now() - t
    return r
  }

  const hotspots = await clock('hotspots', () =>
    findHotspots(buildSizeTree(files), totalBytes, { minShare: 0.01, limit: 40 })
  )
  const repeats = await clock('repeats', () => findRepeats(files))
  const copyOf = await clock('dupes', () => buildCopyMap(files))
  const verdicts = await clock('verdict', () => judge({ files, repeats, copyOf }))
  const summary = summarize(verdicts)
  const { proposals, rest } = await clock('proposal', () => propose(verdicts, hotspots))

  return { hotspots, repeats, verdicts, summary, proposals, rest, timing }
}
