/**
 * 정리 가이드 테스트 — 검색에 내보내는 글이 조용히 나빠지지 않게 잠근다.
 *
 * ★ 여기서 막는 사고는 셋이다.
 *
 *   1) **검색어 변형마다 페이지를 찍어내는 것.**
 *      2026년 3월 구글 코어 업데이트가 정확히 그걸 겨냥했다(scaled content abuse).
 *      검수 없이 대량으로 찍은 사이트들이 트래픽 40~90%를 잃었다.
 *      그래서 슬러그·질문이 겹치는지, 글이 너무 얇은지를 여기서 본다.
 *
 *   2) **틀이 글보다 많아지는 것.**
 *      한 페이지의 고유한 글이 공통 틀보다 적으면 그게 얇은 페이지다.
 *      본문 분량에 바닥을 둔다.
 *
 *   3) **직답이 답이 아닌 것.**
 *      맨 위 문단은 AI 답변이 그대로 집어가는 자리다. 여기서 결론을 미루면
 *      인용될 때 아무 말도 안 하는 문단이 인용된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ARTICLES, TOPICS, bySlug, byTopic } from './guide.ts'
import type { Topic } from './guide.ts'

/** 한글은 띄어쓰기 단위가 영어와 달라서, AI 인용 길이는 글자 수로 본다. */
const len = (s: string) => s.replace(/\s+/g, '').length

test('★ 슬러그와 질문이 안 겹친다 — 같은 질문에 두 페이지를 만들지 않는다', () => {
  /* "hiberfil.sys란", "hiberfil.sys 삭제"를 따로 만드는 게 검색어 변형 찍어내기다.
     한 질문에 한 페이지, 대신 그 페이지가 끝까지 답한다. */
  const slugs = ARTICLES.map((a) => a.slug)
  assert.equal(new Set(slugs).size, slugs.length, '슬러그가 겹친다 — 같은 URL이 두 번 나온다')
  const qs = ARTICLES.map((a) => a.question)
  assert.equal(new Set(qs).size, qs.length, '같은 질문에 페이지가 둘이다')
})

test('★ 슬러그가 URL로 쓸 수 있는 모양이다', () => {
  for (const a of ARTICLES) {
    assert.match(a.slug, /^[a-z0-9-]+$/, `${a.slug}: 소문자·숫자·붙임표만 쓴다`)
    assert.ok(a.slug.length <= 40, `${a.slug}: 너무 길다`)
  }
})

test('★ 직답이 맨 위에서 결론을 낸다 — AI가 인용하는 자리다', () => {
  for (const a of ARTICLES) {
    const n = len(a.answer)
    assert.ok(n >= 80, `${a.slug}: 직답이 ${n}자로 너무 짧다 — 인용돼도 답이 안 된다`)
    assert.ok(n <= 320, `${a.slug}: 직답이 ${n}자로 너무 길다 — 잘려서 인용된다`)
    assert.doesNotMatch(
      a.answer,
      /아래에서|아래를 참고|밑에서 설명|이어서 설명/,
      `${a.slug}: 직답이 답을 미룬다 — 그 문단만 인용되면 아무 말도 안 한 게 된다`
    )
  }
})

test('★ 글이 얇지 않다 — 틀이 글보다 많으면 그게 얇은 페이지다', () => {
  for (const a of ARTICLES) {
    const body = a.sections.flatMap((s) => [s.h, ...s.p]).join('')
    const n = len(body)
    assert.ok(n >= 600, `${a.slug}: 본문이 ${n}자뿐이다 — 공통 틀에 묻힌다`)
    assert.ok(a.sections.length >= 2, `${a.slug}: 문단 묶음이 ${a.sections.length}개뿐이다`)
  }
})

test('★ 검색 결과에 뜨는 제목·설명이 잘리지 않는다', () => {
  for (const a of ARTICLES) {
    assert.ok(a.title.length <= 60, `${a.slug}: 제목 ${a.title.length}자 — 검색 결과에서 잘린다`)
    assert.ok(a.summary.length >= 50, `${a.slug}: 설명이 너무 짧다`)
    assert.ok(a.summary.length <= 155, `${a.slug}: 설명 ${a.summary.length}자 — 잘린다`)
  }
})

test('★ 제목이 질문 모양이다 — 사람이 검색창에 치는 말 그대로', () => {
  /* 이 앱을 쓸 사람은 "테라클린"을 검색하지 않는다. 그 이름을 모르니까.
     "hiberfil.sys 지워도 되나요"를 검색한다. 제목이 그 말이어야 클릭된다. */
  for (const a of ARTICLES) {
    assert.match(a.question, /[?]$/, `${a.slug}: H1이 질문이 아니다 — "${a.question}"`)
  }
})

test('★ 자주 묻는 것이 붙어 있다 — AI 답변이 질문·답 쌍을 그대로 집어간다', () => {
  for (const a of ARTICLES) {
    assert.ok(a.faq.length >= 1, `${a.slug}: FAQ가 없다`)
    for (const f of a.faq) {
      assert.match(f.q, /[?.]$/, `${a.slug}: FAQ 질문이 문장으로 안 끝난다`)
      assert.ok(len(f.a) >= 20, `${a.slug}: FAQ 답이 너무 짧다 — "${f.q}"`)
    }
  }
})

test('★ 서로 잇는 링크가 실제로 있는 글을 가리킨다', () => {
  for (const a of ARTICLES) {
    assert.ok(a.related.length >= 2, `${a.slug}: 이어지는 글이 ${a.related.length}개뿐이다`)
    for (const r of a.related) {
      assert.ok(bySlug(r), `${a.slug}: "${r}"로 잇는데 그런 글이 없다 — 404가 된다`)
      assert.notEqual(r, a.slug, `${a.slug}: 자기 자신을 가리킨다`)
    }
  }
})

test('★ 주제가 넷을 안 넘고, 빈 주제가 없다', () => {
  /* 네이버 C-Rank는 "이 사이트가 한 분야에서 얼마나 전문적인가"를 본다.
     주제를 흩으면 어느 분야에서도 전문가가 안 된다. */
  const topics = Object.keys(TOPICS) as Topic[]
  assert.equal(topics.length, 4, '주제가 넷을 넘었다 — 주제 집중도가 흩어진다')
  for (const t of topics) {
    assert.ok(byTopic(t).length >= 3, `${t}: ${byTopic(t).length}편뿐이다 — 주제로 서려면 더 필요하다`)
  }
})

test('★ 모든 글이 엔진의 어느 지식에서 나왔는지 밝힌다', () => {
  /* 이 제품의 약속이 "지어내지 않는다"이다. 그 약속은 앱 안에서만이 아니라
     이 글에도 적용된다. 근거를 못 적는 글은 쓰지 않는다. */
  for (const a of ARTICLES) {
    assert.ok(a.source && a.source.length > 3, `${a.slug}: 근거가 되는 엔진 지식을 안 밝혔다`)
    assert.match(a.source, /\.ts|\.ts#/, `${a.slug}: 근거가 파일을 안 가리킨다 — "${a.source}"`)
  }
})

test('★ 날짜가 미래가 아니고 모양이 맞다', () => {
  /* 하루치 여유를 준다 — 이 저장소는 한국에서 쓰는데 빌드는 UTC에서 돌 수 있다.
     시차 때문에 "내일 확인한 글"로 잡히면, 진짜 잘못된 날짜와 구분이 안 된다. */
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10)
  const today = tomorrow
  for (const a of ARTICLES) {
    assert.match(a.updated, /^\d{4}-\d{2}-\d{2}$/, `${a.slug}: 날짜 모양이 틀렸다`)
    assert.ok(a.updated <= today, `${a.slug}: 확인 날짜가 미래다 — ${a.updated}`)
  }
})

test('★ 우리가 못 재는 숫자를 글에서 약속하지 않는다', () => {
  /* 앱은 "○초 빨라집니다"를 안 쓴다. 윈도우가 그 값을 안 알려주기 때문이다.
     글에서만 그 약속을 깨면, 앱을 켠 사람이 속았다고 느낀다. */
  const all = ARTICLES.flatMap((a) => [a.answer, a.summary, ...a.sections.flatMap((s) => s.p)])
  for (const p of all) {
    assert.doesNotMatch(p, /\d+\s*초\s*(빨라|단축)/, `못 재는 숫자를 약속한다: "${p.slice(0, 60)}…"`)
    assert.doesNotMatch(p, /\d+\s*%\s*(빨라|향상)/, `못 재는 숫자를 약속한다: "${p.slice(0, 60)}…"`)
  }
})
