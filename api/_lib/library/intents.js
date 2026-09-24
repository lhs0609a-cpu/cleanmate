/**
 * 자료실 — 의도(intent) 모음
 *
 * @typedef {Object} Intent
 * @property {string} id
 * @property {string} kw        제목에 들어가는 말
 * @property {string[]} aka     같은 뜻으로 검색되는 말
 * @property {string[]} needs   대상에 이 필드가 있어야 문서를 만든다
 * @property {(t:any)=>string} title
 * @property {(t:any)=>string} desc
 * @property {(t:any)=>string} answer
 * @property {(t:any,e:any)=>any[]} sections
 * @property {(t:any)=>any[]} faq
 * @property {string[]} [onlyCat]  이 분류에서만 만든다
 * @property {string[]} [skipCat]  이 분류에서는 만들지 않는다
 */

import { ACT_INTENTS } from './intents-act.js'
import { KNOW_INTENTS } from './intents-know.js'
import { CASE_INTENTS } from './intents-case.js'

/** @type {Intent[]} */
export const INTENTS = [...KNOW_INTENTS, ...ACT_INTENTS, ...CASE_INTENTS]

export const INTENT_BY_ID = Object.fromEntries(INTENTS.map((i) => [i.id, i]))

/** 이 대상에 이 의도가 말이 되는가. 안 되면 그 조합은 아예 만들지 않는다. */
export function applies(intent, target) {
  for (const need of intent.needs) {
    const v = target[need]
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return false
  }
  if (intent.onlyCat && !intent.onlyCat.includes(target.cat)) return false
  if (intent.skipCat && intent.skipCat.includes(target.cat)) return false
  return true
}

if (new Set(INTENTS.map((i) => i.id)).size !== INTENTS.length) {
  throw new Error('intent id 가 겹칩니다')
}
