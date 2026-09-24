/**
 * 자료실 — 대상(target) 전체 목록
 *
 * 분류별 파일을 하나로 합치고, 규칙을 어긴 항목이 있으면 즉시 멈춘다.
 * 조용히 이상한 페이지를 30만 장 찍어내는 것보다, 여기서 터지는 게 낫다.
 */

import { CATS, validateTarget } from './schema.js'
import { SYSTEM_TARGETS } from './targets/system.js'
import { DEV_TARGETS } from './targets/dev.js'
import { BROWSER_TARGETS } from './targets/browser.js'
import { GAME_TARGETS } from './targets/game.js'
import { CREATIVE_TARGETS } from './targets/creative.js'
import { MESSENGER_TARGETS } from './targets/messenger.js'
import { AI_TARGETS } from './targets/ai.js'
import { CLOUD_TARGETS } from './targets/cloud.js'
import { OFFICE_TARGETS } from './targets/office.js'
import { MEDIA_TARGETS } from './targets/media.js'
import { KOREAN_TARGETS } from './targets/korean.js'
import { BACKUP_TARGETS } from './targets/backup.js'

const RAW = [
  ...SYSTEM_TARGETS, ...DEV_TARGETS, ...BROWSER_TARGETS, ...GAME_TARGETS,
  ...CREATIVE_TARGETS, ...MESSENGER_TARGETS, ...AI_TARGETS, ...CLOUD_TARGETS,
  ...OFFICE_TARGETS, ...MEDIA_TARGETS, ...KOREAN_TARGETS, ...BACKUP_TARGETS,
]

const errors = []
const seen = new Set()
for (const t of RAW) {
  errors.push(...validateTarget(t))
  if (seen.has(t.id)) errors.push(`${t.id}: id 가 겹칩니다`)
  seen.add(t.id)
}
if (errors.length) throw new Error('자료실 대상 데이터 오류:\n  ' + errors.join('\n  '))

/** 분류 이름을 미리 붙여 둔다. 표를 그릴 때마다 찾지 않도록. */
export const TARGETS = RAW.map((t) => ({ ...t, catLabel: CATS[t.cat].label }))

export const TARGET_BY_ID = Object.fromEntries(TARGETS.map((t) => [t.id, t]))

export function targetsByCat(cat) {
  return TARGETS.filter((t) => t.cat === cat)
}

/** 아주 단순한 검색. 이름·별칭·경로에서 찾는다. */
export function searchTargets(q, limit = 60) {
  const needle = String(q || '').trim().toLowerCase()
  if (!needle) return []
  const scored = []
  for (const t of TARGETS) {
    const hay = [t.name, t.full, t.id, ...(t.aliases ?? []), ...(t.paths ?? [])].join(' ').toLowerCase()
    const i = hay.indexOf(needle)
    if (i >= 0) scored.push({ t, score: (t.name.toLowerCase().includes(needle) ? 0 : 100) + i })
  }
  scored.sort((a, b) => a.score - b.score)
  return scored.slice(0, limit).map((s) => s.t)
}
