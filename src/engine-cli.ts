/**
 * 엔진 IPC 창구 — UI와 엔진을 잇는 유일한 통로
 *
 * 데스크톱 앱(Tauri)은 이걸 사이드카로 품고, "명령 + 인자"를 주면
 * JSON 한 줄을 돌려받는다. 검증된 엔진(scan/classify/sweep/quarantine/probe)을
 * 그대로 재사용한다 — 재작성 0. (docs/배포-아키텍처.md §2)
 *
 * 이 파일은 '배선'만 한다. 판단·격리·복구는 이미 테스트된 모듈이 한다.
 *
 * 규약: stdout에 JSON 한 줄만 낸다(그래야 Rust가 파싱하기 쉽다).
 *   성공 → {"ok":true,"data":...}
 *   실패 → {"ok":false,"error":"사람이 읽을 메시지"}  + exit 1
 *   진행 로그·경고는 전부 stderr로 (stdout을 오염시키지 않는다).
 *
 * 사용: cleanmate-engine <command> [json-args]
 *   scan-plan   <path>          스캔 → 3-존 + 정리 계획 + 질문
 *   apply-sweep <path>          존 A 자동 정리(격리로 이동)
 *   quar-list                   격리함 목록
 *   restore     <id|--all>      되돌리기
 *   probe                       숨은 공간(hiberfil 등)
 */

import { scan } from './scanner.ts'
import { classifyOne, isAutoEligible } from './classify.ts'
import { run as runEngine } from './engine.ts'
import { planSweep, applySweep } from './sweep.ts'
import {
  readManifest,
  restore,
  quarantineRoot,
  isExpired,
  GRACE_DAYS,
} from './quarantine.ts'
import { gatherFacts } from './probes/facts.ts'
import { probeHiberfil } from './probes/hiberfil.ts'
import type { Classified } from './types.ts'

function out(data: unknown): never {
  process.stdout.write(JSON.stringify({ ok: true, data }))
  process.exit(0)
}
function fail(message: string): never {
  process.stdout.write(JSON.stringify({ ok: false, error: message }))
  process.exit(1)
}

/** 시스템 드라이브의 격리함 경로 */
function sysQuarRoot(): string {
  const drive = process.env.SystemDrive ? process.env.SystemDrive + '\\' : '/'
  return quarantineRoot(drive)
}

/** 스캔 → 분류 → 정리 계획 + 질문. 데스크톱이라 실제 경로 규칙이 온전히 작동한다. */
async function scanPlan(path: string) {
  const scanned = await scan(path)

  let safeB = 0, safeC = 0, ambB = 0, ambC = 0, lockB = 0, lockC = 0
  let autoB = 0, autoC = 0, inferB = 0
  const ambig: Classified[] = []
  const keptMap = new Map<string, number>()

  for (const f of scanned.files) {
    const c = classifyOne(f)
    const z = c.verdict.zone
    if (z === 'LOCKED') {
      lockB += f.size; lockC++
      keptMap.set(c.verdict.meaning, (keptMap.get(c.verdict.meaning) ?? 0) + f.size)
    } else if (z === 'AMBIG') {
      ambB += f.size; ambC++; ambig.push(c)
    } else {
      safeB += f.size; safeC++
      if (isAutoEligible(c)) { autoB += f.size; autoC++ } else inferB += f.size
    }
  }

  const report = runEngine(ambig)
  const kept = [...keptMap.entries()]
    .map(([meaning, bytes]) => ({ meaning, bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 6)

  return {
    scannedFiles: scanned.files.length,
    elapsedMs: scanned.elapsedMs,
    zones: {
      safe: { bytes: safeB, count: safeC },
      ambig: { bytes: ambB, count: ambC },
      locked: { bytes: lockB, count: lockC },
    },
    plan: {
      autoBytes: autoB, autoCount: autoC,
      askBytes: ambB, askCount: ambC,
      lockBytes: lockB, lockCount: lockC,
      inferredBytes: inferB,
    },
    questions: report.questions,
    kept,
  }
}

/**
 * 명령·인자를 argv에서 뽑는다.
 * 일반 node 실행:  [node, engine-cli.ts, command, ...args] → slice(2)
 * SEA 단일 exe:    [exe, command, ...args] (스크립트 경로 없음) → slice(1)
 */
function readArgs(): string[] {
  let start = 2
  try {
    // SEA 런타임에서만 node:sea가 있고 isSea()가 참이다.
    const sea = require('node:sea')
    if (sea?.isSea?.()) start = 1
  } catch {
    /* 일반 node(ESM) 실행 — require 자체가 없다. slice(2)가 맞다. */
  }
  return process.argv.slice(start)
}

async function main() {
  const [command, ...args] = readArgs()

  try {
    switch (command) {
      case 'scan-plan': {
        if (!args[0]) fail('스캔할 경로가 필요합니다.')
        out(await scanPlan(args[0]))
        break
      }
      case 'apply-sweep': {
        if (!args[0]) fail('경로가 필요합니다.')
        const plan = await planSweep(args[0])
        const result = await applySweep(plan)
        out({
          quarantinedCount: result.quarantinedCount,
          bytesAfterGrace: result.bytesAfterGrace,
          failed: result.failed,
        })
        break
      }
      case 'quar-list': {
        const root = sysQuarRoot()
        const manifest = await readManifest(root)
        out({
          graceDays: GRACE_DAYS,
          items: manifest.map((e) => ({
            id: e.id,
            originalPath: e.originalPath,
            size: e.size,
            reason: e.reason,
            quarantinedAt: e.quarantinedAt,
            expired: isExpired(e),
          })),
          totalBytes: manifest.reduce((s, e) => s + e.size, 0),
        })
        break
      }
      case 'restore': {
        if (!args[0]) fail('되돌릴 id 또는 --all 이 필요합니다.')
        const root = sysQuarRoot()
        const manifest = await readManifest(root)
        const ids = args[0] === '--all'
          ? manifest.map((e) => e.id)
          : manifest.filter((e) => e.id.startsWith(args[0])).map((e) => e.id)
        const r = await restore(ids, root)
        out({
          restoredCount: r.restored.length,
          restoredBytes: r.restored.reduce((s, e) => s + e.size, 0),
          failed: r.failed.map((f) => ({ path: f.entry.originalPath, reason: f.reason })),
        })
        break
      }
      case 'probe': {
        const facts = await gatherFacts()
        const hiber = probeHiberfil(facts)
        out({
          facts: {
            ramBytes: facts.ramBytes,
            isLaptop: facts.isLaptop,
            laptopSignals: facts.laptopSignals,
            fastStartupEnabled: facts.fastStartupEnabled,
          },
          findings: [hiber].filter(Boolean),
        })
        break
      }
      default:
        fail(`알 수 없는 명령: ${command ?? '(없음)'}`)
    }
  } catch (err) {
    fail((err as Error).message ?? String(err))
  }
}

main()
