/**
 * 자료실 — 조합(combination)
 *
 * 주소는 세 조각으로 만든다.
 *   /library/<대상>/<의도>.html            핵심 문서
 *   /library/<대상>/<의도>/<환경>.html     환경별 문서
 *   /library/<대상>/                       대상 한 개의 목차
 *   /library/c/<분류>/                     분류 목차
 *
 * ★ 조각을 슬래시로 나눈 이유
 *   하이픈 하나로 이어 붙이면 chrome-cache-delete 를 되읽을 때
 *   (chrome / cache-delete) 인지 (chrome-cache / delete) 인지 알 수 없다.
 *   슬래시로 나누면 되읽기가 애매해질 일이 없고, 주소만 봐도 구조가 보인다.
 */

import { TARGETS, TARGET_BY_ID } from './targets.js'
import { INTENTS, INTENT_BY_ID, applies } from './intents.js'
import { ENVS, ENV_BY_ID } from './envs.js'
import { CATS } from './schema.js'

/** 환경과 분류가 서로 안 맞는 조합은 만들지 않는다. */
const ENV_SKIP_CATS = {
  'windows-server': ['game', 'creative', 'messenger', 'media', 'korean'],
  'gaming-laptop': ['office', 'backup'],
  'tablet-pc': ['dev', 'vm', 'ai', 'creative'],
  'emmc': ['dev', 'vm', 'ai', 'creative'],
  'sd-card': ['dev', 'vm', 'ai'],
}

export function envApplies(env, target) {
  const skip = ENV_SKIP_CATS[env.id]
  return !skip || !skip.includes(target.cat)
}

/** 대상 하나에 말이 되는 의도 목록. 계산이 잦아 캐시해 둔다. */
const intentCache = new Map()
export function intentsFor(target) {
  let v = intentCache.get(target.id)
  if (!v) {
    v = INTENTS.filter((i) => applies(i, target))
    intentCache.set(target.id, v)
  }
  return v
}

const envCache = new Map()
export function envsFor(target) {
  let v = envCache.get(target.id)
  if (!v) {
    v = ENVS.filter((e) => envApplies(e, target))
    envCache.set(target.id, v)
  }
  return v
}

/** 전체 문서 수. 핵심 + 환경별 + 목차. */
export function counts() {
  let core = 0
  let env = 0
  for (const t of TARGETS) {
    const ni = intentsFor(t).length
    core += ni
    env += ni * envsFor(t).length
  }
  const hubs = TARGETS.length + Object.keys(CATS).length + 1 + Math.ceil(TARGETS.length / 40)
  return { core, env, hubs, total: core + env + hubs, targets: TARGETS.length, intents: INTENTS.length, envs: ENVS.length }
}

/** 모든 문서 주소를 순서대로 흘려보낸다. 사이트맵이 이걸 잘라 쓴다. */
export function* walk() {
  yield { kind: 'root', path: '/library/' }
  for (const cat of Object.keys(CATS)) yield { kind: 'cat', cat, path: `/library/c/${cat}/` }
  for (let p = 1; p <= Math.ceil(TARGETS.length / 40); p++) yield { kind: 'all', path: `/library/all/${p}` }
  for (const t of TARGETS) {
    yield { kind: 'target', target: t, path: `/library/${t.id}/` }
    const is = intentsFor(t)
    const es = envsFor(t)
    for (const i of is) {
      yield { kind: 'page', target: t, intent: i, env: null, path: `/library/${t.id}/${i.id}.html` }
      for (const e of es) {
        yield { kind: 'page', target: t, intent: i, env: e, path: `/library/${t.id}/${i.id}/${e.id}.html` }
      }
    }
  }
}

/** 주소 → 무엇을 그릴지. 모르는 주소면 null. */
export function resolve(pathname) {
  const clean = String(pathname || '').replace(/^\/+|\/+$/g, '')
  if (clean === '' || clean === 'library') return { kind: 'root' }

  const parts = clean.replace(/^library\/?/, '').split('/').filter(Boolean)
  if (parts.length === 0) return { kind: 'root' }

  if (parts[0] === 'c') {
    const cat = parts[1]
    return cat && CATS[cat] ? { kind: 'cat', cat } : null
  }
  if (parts[0] === 'search') return { kind: 'search' }
  if (parts[0] === 'all') return { kind: 'all', page: Math.max(1, parseInt(parts[1] ?? '1', 10) || 1) }

  const target = TARGET_BY_ID[parts[0]]
  if (!target) return null
  if (parts.length === 1) return { kind: 'target', target }

  const intentId = parts[1].replace(/\.html$/, '')
  const intent = INTENT_BY_ID[intentId]
  if (!intent || !applies(intent, target)) return null

  if (parts.length === 2 && parts[1].endsWith('.html')) return { kind: 'page', target, intent, env: null }
  if (parts.length === 2) return { kind: 'page', target, intent, env: null, redirect: `/library/${target.id}/${intent.id}.html` }

  if (parts.length === 3) {
    const envId = parts[2].replace(/\.html$/, '')
    const env = ENV_BY_ID[envId]
    if (!env || !envApplies(env, target)) return null
    return { kind: 'page', target, intent, env }
  }
  return null
}

export function pageUrl(target, intent, env) {
  return env
    ? `/library/${target.id}/${intent.id}/${env.id}.html`
    : `/library/${target.id}/${intent.id}.html`
}
