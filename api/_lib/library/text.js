/**
 * 자료실 — 글자를 다루는 잔손질
 *
 * 조합으로 문장을 만들 때 제일 먼저 티가 나는 건 조사다.
 * "크롬 캐시을 지우면"이 한 번 나오면 그 페이지는 사람이 안 쓴 글이 된다.
 * 여기 있는 함수들이 그걸 막는다.
 */

const HANGUL_START = 0xac00
const HANGUL_END = 0xd7a3

/** 끝 글자에 받침이 있나. 숫자·영문으로 끝나면 읽는 소리 기준으로 판정한다. */
export function hasJong(word) {
  const s = String(word).replace(/[)\]}>"'』」》\s]+$/, '')
  const ch = s.at(-1)
  if (!ch) return false
  const code = ch.codePointAt(0)
  if (code >= HANGUL_START && code <= HANGUL_END) return (code - HANGUL_START) % 28 !== 0
  // 숫자는 읽는 소리로: 0(영) 1(일) 3(삼) 6(육) 7(칠) 8(팔) 은 받침 있음
  if (/[0-9]/.test(ch)) return '013678'.includes(ch)
  // 영문은 마지막 알파벳 발음 기준. l·m·n·ng·r 로 끝나면 받침처럼 읽힌다.
  if (/[a-z]/i.test(ch)) return 'lmnr'.includes(ch.toLowerCase()) || /ng$/i.test(s)
  return false
}

/** 조사 붙이기. `jo('캐시','을')` → `캐시를` */
export function jo(word, particle) {
  const pair = {
    '은': ['은', '는'], '는': ['은', '는'],
    '이': ['이', '가'], '가': ['이', '가'],
    '을': ['을', '를'], '를': ['을', '를'],
    '과': ['과', '와'], '와': ['과', '와'],
    '으로': ['으로', '로'], '로': ['으로', '로'],
    '이나': ['이나', '나'], '나': ['이나', '나'],
    '이라': ['이라', '라'], '라': ['이라', '라'],
    '아': ['아', '야'], '야': ['아', '야'],
  }[particle]
  if (!pair) return word + particle
  return word + (hasJong(word) ? pair[0] : pair[1])
}

/** 이름 + 조사 한 번에. `w('크롬 캐시','을')` */
export const w = jo

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

/** 같은 입력이면 같은 결과가 나오는 해시. 페이지마다 변형을 고르는 데 쓴다. */
export function hash32(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 후보 중 하나를 결정적으로 고른다. 새로고침해도 같은 문장이 나온다. */
export function pick(list, seed) {
  return list[hash32(seed) % list.length]
}

/** 목록을 문장으로. ['A','B','C'] → 'A·B·C' */
export const dot = (list) => list.join('·')

/** 목록을 문장으로. ['A','B','C'] → 'A, B, C' */
export const comma = (list) => list.join(', ')
