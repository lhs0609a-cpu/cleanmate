/**
 * 그림 테스트 — 그림이 글을 지울 때 정보까지 지우지 않는지 잠근다.
 *
 * ★ 여기서 막는 사고는 셋이다.
 *
 *   1) **화면에서만 보이는 정보가 생기는 것.**
 *      그림은 화면에만 있다. 터미널(cli-probe)에도, 화면 낭독기에도 SVG는 없다.
 *      "이 문장은 그림이 대신하니까 빼자"를 데이터에서 해버리면 그 두 곳에서는
 *      문장이 그냥 사라진다 — 정보를 옮긴 게 아니라 잃은 것이다.
 *      그래서 엔진은 문장을 그대로 갖고 있고, 화면만 그 줄을 안 그린다.
 *
 *   2) **문장과 그림이 소리 없이 어긋나는 것.**
 *      replaces에 적힌 문장이 explain에 실제로 없으면 화면은 아무것도 못 지우고,
 *      그림과 문장이 같은 말을 두 번 한다. 그 순간 글은 오히려 늘어난다.
 *
 *   3) **화면이 숫자를 갖는 것.**
 *      화면이 바이트를 더하고 빼기 시작하면 화면과 엔진이 다른 말을 하게 된다.
 *      이 제품에서 그건 기능 하나가 틀리는 게 아니라 전부를 못 믿게 되는 일이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { probePageFile, probeRestore } from './probes/system-space.ts'
import type { PageFileFacts, RestoreFacts } from './probes/system-space.ts'
import { probeBulk } from './probes/bulk.ts'
import { figureSvg, withoutCovered } from '../web/src/figures.ts'
import type { Figure, Finding } from './types.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const GB = 1024 ** 3

const pf = (over: Partial<PageFileFacts> = {}): PageFileFacts => ({
  path: 'C:\\pagefile.sys',
  bytes: 71 * GB,
  usedBytes: 16 * GB,
  peakBytes: 24 * GB,
  automatic: true,
  ramBytes: 32 * GB,
  initialMB: 0,
  maximumMB: 0,
  ...over,
})

const restore = (over: Partial<RestoreFacts> = {}): RestoreFacts => ({
  measured: false,
  usedBytes: 0,
  allocatedBytes: 0,
  maxBytes: 0,
  ...over,
})

/** 엔진이 그림을 붙이는 항목 전부. 새 그림이 생기면 여기 한 줄만 는다. */
function findingsWithFigures(): Finding[] {
  const all: (Finding | null)[] = [
    probePageFile(pf()),
    probeRestore(restore()),
    ...probeBulk([
      { kind: 'wsl', path: 'C:\\Users\\me\\AppData\\Local\\Packages\\Ubuntu\\ext4.vhdx', bytes: 62 * GB, label: 'Ubuntu' },
      { kind: 'docker', path: 'C:\\Users\\me\\AppData\\Local\\Docker\\wsl\\data\\ext4.vhdx', bytes: 40 * GB, label: '' },
    ] as any),
  ]
  return all.filter((f): f is Finding => !!f && !!f.figure)
}

/* ══════════════════════════════════════════════════════════════
   그림이 담는 값 — 엔진 쪽
   ══════════════════════════════════════════════════════════════ */

test('★ 그림을 붙인 항목이 실제로 있다 — 이 테스트가 빈 배열을 도는 걸 막는다', () => {
  const fs = findingsWithFigures()
  assert.ok(fs.length >= 4, `그림이 붙은 항목이 ${fs.length}개뿐이다 — 배선이 끊겼을 수 있다`)
})

test('★ 모든 그림에 alt가 있다 — 못 보는 사람에게서 뺏지 않는다', () => {
  for (const f of findingsWithFigures()) {
    assert.ok(f.figure!.alt.trim().length > 10, `${f.id}: 그림에 읽어줄 문장이 없다`)
  }
})

test('★ 그림이 대신하는 문장은 엔진에 그대로 남아 있다 — 터미널엔 그림이 없다', () => {
  for (const f of findingsWithFigures()) {
    for (const line of f.figure!.replaces ?? []) {
      const inExplain =
        f.explain.ifRemoved.includes(line) ||
        f.explain.why.includes(line) ||
        f.explain.what.includes(line)
      assert.ok(
        inExplain,
        `${f.id}: 그림이 "${line}"을 대신한다는데 그 문장이 explain에 없다 — ` +
          '화면은 아무것도 못 지우고, 터미널은 없는 말을 하게 된다'
      )
    }
  }
})

test('★ 막대 두 줄은 남는 몫 + 비는 몫이 지금 크기와 맞는다', () => {
  /* 합이 안 맞으면 막대가 자기 자를 벗어나고, 사용자는 안 맞는 그림을
     근거로 시스템을 바꾸게 된다. */
  for (const f of findingsWithFigures()) {
    const g = f.figure!
    if (g.kind !== 'before-after') continue
    assert.equal(g.keepBytes + g.freesBytes, g.totalBytes, `${f.id}: 몫의 합이 지금 크기와 안 맞는다`)
    assert.ok(g.totalBytes > 0, `${f.id}: 크기가 0인데 막대를 그린다`)
  }
})

test('★ 가상 메모리 — 재시작 얘기가 그림과 문장 양쪽에 다 있다', () => {
  const f = probePageFile(pf())!
  const g = f.figure!
  assert.equal(g.kind, 'before-after')
  assert.match(g.alt, /재시작/, 'alt가 재시작 얘기를 안 한다')
  assert.match(g.alt, /안 빕니다|안 빈다/, 'alt가 "재시작 전까지는 안 빈다"를 안 말한다')
  assert.ok(g.alt.includes('71.0GB'), 'alt에 지금 크기가 없다')
  assert.equal(g.replaces!.length, 1, '대신하는 줄이 하나여야 한다')
})

test('★ 권장할 게 없으면 그림도 없다 — 그릴 "바꾼 뒤"가 없다', () => {
  // 최고 기록을 못 읽으면 근거가 없어 권장을 안 만든다. 그림도 같이 없어야 한다.
  assert.equal(probePageFile(pf({ peakBytes: 0 }))!.figure, undefined, '근거가 없는데 바꾼 뒤를 그린다')
})

test('★ 리눅스 디스크 — 안에 든 것을 그리지 않는다. 우리는 그 값을 모른다', () => {
  const f = findingsWithFigures().find((x) => x.id.startsWith('bulk.wsl'))!
  const g = f.figure!
  assert.equal(g.kind, 'unchanged')
  if (g.kind !== 'unchanged') return
  /* 밖에서 볼 수 있는 건 파일 크기 하나뿐이다. 안쪽 값을 담는 자리가 생기면
     언젠가 누가 채우고, 그 순간 이 그림이 거짓말이 된다. */
  assert.ok(!('insideBytes' in g), '안에 든 것을 담는 자리가 생겼다 — 우리는 그 값을 못 잰다')
  assert.equal(g.bytes, 62 * GB)
})

test('★ 시스템 복원 — 못 쟀을 때만 그린다. 잰 값이 있으면 숫자가 이미 답이다', () => {
  const unknown = probeRestore(restore({ measured: false }))!
  assert.equal(unknown.figure?.kind, 'unmeasured')
  assert.equal(unknown.bytes, 0, '못 쟀는데 크기를 지어냈다')

  const known = probeRestore(restore({ measured: true, allocatedBytes: 40 * GB, usedBytes: 12 * GB }))!
  assert.equal(known.figure, undefined, '잰 값이 있는데도 "못 쟀다" 그림을 그린다')
})

/* ══════════════════════════════════════════════════════════════
   그리는 쪽 — 화면
   ══════════════════════════════════════════════════════════════ */

/** 여섯 종류를 한 번씩. 하나라도 안 그려지면 그 화면이 조용히 글만 남는다. */
const SAMPLES: Figure[] = [
  { kind: 'before-after', totalBytes: 71 * GB, keepBytes: 36 * GB, freesBytes: 35 * GB,
    beforeLabel: '지금', afterLabel: '줄인 뒤', freesNote: '재시작 뒤에 빔', alt: '막대 두 줄' },
  { kind: 'unchanged', bytes: 62 * GB, beforeLabel: '지우기 전', afterLabel: '지운 뒤',
    betweenLabel: '안에서 지워도', insideNote: '안은 못 봅니다', alt: '같은 크기 상자 둘' },
  { kind: 'copies', total: 6, keep: 1, gone: 5, freesBytes: 12 * GB, keepLabel: '남습니다', alt: '여섯 벌 중 하나' },
  { kind: 'unmeasured', wrongTag: '안 씀', wrongLabel: '0GB', rightTag: '못 쟀음',
    rightLabel: '권한이 있어야 읽습니다', alt: '못 잰 것' },
  { kind: 'split', parts: [
      { label: '제안', count: 4, tone: 'act' },
      { label: '판단 못 함', count: 17, tone: 'hold' },
      { label: '꺼둠', count: 3, tone: 'off' }],
    alt: '나뉜 비율' },
  { kind: 'timeline', spanDays: 720, thresholdDays: 180, thresholdLabel: '6개월',
    marks: [{ label: 'A · 8개월째', daysAgo: 250 }, { label: 'B · 20개월째', daysAgo: 600 }],
    nowLabel: '오늘', farLabel: '24개월 전', unknownCount: 9, unknownLabel: '기록 없음', alt: '지난 시간' },
]

test('★ 여섯 종류가 전부 그려진다 — 하나만 빠져도 그 화면은 글만 남는다', () => {
  const kinds = new Set(SAMPLES.map((f) => f.kind))
  assert.equal(kinds.size, 6, '표본이 여섯 종류를 다 안 덮는다')
  for (const f of SAMPLES) {
    const svg = figureSvg(f)
    assert.ok(svg.includes('<svg'), `${f.kind}: 안 그려진다`)
    assert.ok(svg.includes('role="img"'), `${f.kind}: 이미지로 안 읽힌다`)
    assert.match(svg, /aria-label="[^"]{4,}"/, `${f.kind}: 읽어줄 문장이 안 붙는다`)
    assert.ok(svg.includes('viewBox="0 0 520 '), `${f.kind}: 다른 자를 쓴다 — 화면 사이에서 그림이 흔들린다`)
  }
})

test('★ 그림 안의 글자가 전부 빠져나간다 — 남의 파일 이름이 태그가 되면 안 된다', () => {
  /* 프로그램 이름·경로는 우리가 안 만든 문자열이다. 그대로 넣으면 화면이 깨지거나
     더 나쁜 일이 생긴다. 그림도 카드 본문과 같은 규칙을 지켜야 한다. */
  const svg = figureSvg({
    kind: 'copies', total: 2, keep: 1, gone: 1, freesBytes: GB,
    keepLabel: '<script>x</script>', alt: '"따옴표" & <꺾쇠>',
  })
  assert.ok(!svg.includes('<script>'), '라벨의 태그가 그대로 들어간다')
  assert.ok(!/aria-label="[^"]*"[^>]*"/.test(svg.split('>')[1] ?? ''), 'alt의 따옴표가 속성을 깬다')
  assert.ok(svg.includes('&lt;script&gt;'), '라벨이 안 빠져나갔다')
})

test('★ 그릴 게 없으면 아무것도 안 그린다 — 빈 그림 상자를 만들지 않는다', () => {
  assert.equal(figureSvg(undefined), '')
  assert.equal(figureSvg(null), '')
  assert.equal(figureSvg({ kind: 'nope' } as any), '', '모르는 종류를 대충 그린다')
  assert.equal(
    figureSvg({ ...SAMPLES[0], totalBytes: 0 } as Figure), '',
    '크기가 0인데 막대를 그린다'
  )
  assert.equal(
    figureSvg({ ...SAMPLES[2], total: 1 } as Figure), '',
    '한 벌뿐인데 "여러 벌" 그림을 그린다'
  )
})

test('★ 몫이 0이면 색표를 안 그린다 — "0B 남김"은 알려주는 게 아니라 잡음이다', () => {
  const svg = figureSvg({ ...SAMPLES[0], keepBytes: 0, freesBytes: 71 * GB } as Figure)
  assert.ok(!svg.includes('남김'), '0인 몫에 색표를 붙인다')
  assert.ok(svg.includes('재시작 뒤에 빔'), '비는 몫의 색표까지 사라졌다')
})

test('★ 같은 종류를 여러 개 그려도 서로 안 먹는다 — id가 겹치면 안 된다', () => {
  /* 같은 화면에 같은 종류가 둘 이상 오는 건 흔하다(같은 파일 그룹 여러 개).
     조각 id가 같으면 뒤엣것이 앞엣것의 조각을 쓴다. */
  const a = figureSvg(SAMPLES[4])
  const b = figureSvg(SAMPLES[4])
  const idOf = (s: string) => s.match(/id="([^"]+)"/)?.[1]
  assert.ok(idOf(a) && idOf(b), '조각 id를 안 쓴다면 이 테스트는 지워도 된다')
  assert.notEqual(idOf(a), idOf(b), '두 그림이 같은 조각 id를 쓴다')
})

test('★ 화면은 그림이 대신하는 줄만 뺀다 — 나머지는 그대로 보인다', () => {
  const lines = ['★ 가', '나', '★ 다']
  const kept = withoutCovered(lines, { ...SAMPLES[0], replaces: ['나'] } as Figure)
  assert.deepEqual(kept, ['★ 가', '★ 다'])
  assert.deepEqual(withoutCovered(lines, undefined), lines, '그림이 없는데 줄을 뺀다')
  assert.deepEqual(withoutCovered(undefined, undefined), [], '줄이 없을 때 터진다')
})

/* ══════════════════════════════════════════════════════════════
   배선과 규칙 — 소스에서 확인한다
   ══════════════════════════════════════════════════════════════ */

test('★ 화면이 숫자를 지어내지 않는다 — 엔진이 준 값만 쓴다', () => {
  /* figures.ts가 만들어도 되는 건 '길이'뿐이다. 바이트를 더하거나 빼서
     화면이 제 나름의 값을 만들기 시작하면 화면과 엔진이 다른 말을 하게 된다. */
  const src = read('web/src/figures.ts')
  assert.doesNotMatch(src, /f\.\w*[Bb]ytes\s*[-+]\s*f\./, '그림이 바이트를 직접 계산한다')
})

test('★ 그림은 한 곳에서만 그린다 — app.ts에 두 번째 그리는 자리가 생기면 안 된다', () => {
  const ui = read('web/src/app.ts')
  assert.match(ui, /import \{ figureSvg, withoutCovered \} from '\.\/figures\.ts'/, '그림 모듈을 안 쓴다')
  assert.doesNotMatch(ui, /function figureSvg/, 'app.ts가 그림을 또 그린다 — 두 문법이 생긴다')
})

test('★ 그림이 여섯 화면에 실제로 붙어 있다', () => {
  const ui = read('web/src/app.ts')
  const wired = (ui.match(/figureSvg\(/g) ?? []).length
  assert.ok(wired >= 6, `화면에 붙은 그림이 ${wired}곳뿐이다`)
  // 화면 머리말에 오는 그림은 카드 안이 아니라 제목 아래에 선다.
  assert.match(ui, /class="head-fig"/, '머리말 그림 자리가 없다')
})

test('★ 판단 기준을 화면이 하드코딩하지 않는다 — 엔진이 준 기준선을 쓴다', () => {
  /* 기준을 바꾸는 순간 그림의 기준선이 실제 기준과 달라지고, 아무도 못 알아챈다.
     그때 화면은 "6개월 넘은 것만 골랐어요"라고 쓰면서 3개월짜리를 보여주게 된다. */
  const ui = read('web/src/app.ts')
  const i = ui.indexOf("kind: 'timeline'")
  assert.ok(i > 0, '시간 축 그림이 안 붙어 있다')
  const block = ui.slice(i - 600, i + 600)
  assert.match(block, /thresholdDays: d\.minUnusedDays/, '기준선을 엔진이 아니라 화면이 정한다')
  assert.doesNotMatch(block, /thresholdDays: \d/, '기준선을 숫자로 박아뒀다')
})

test('★ 그림은 새 색을 안 만든다 — 다크 모드가 저절로 따라와야 한다', () => {
  /* 원칙 1번: 장식으로 쓰는 색이 하나 늘 때마다 경고색의 힘이 그만큼 빠진다.
     그림 클래스가 토큰 밖의 색을 쓰면 다크 모드에서 혼자 밝은 채로 남기도 한다. */
  const css = read('web/app.html')
  const classes = ['.d-now{', '.d-off{', '.d-soon{', '.d-empty{', '.d-box{', '.d-keep{',
                   '.d-gone{', '.d-guide{', '.d-tick{', '.d-axis{', '.d-dot{', '.d-arrow{',
                   '.d-mark{', '.d-lock{', '.arw{', '.dl{', '.dv{']
  for (const cls of classes) {
    const i = css.indexOf(cls)
    assert.ok(i > 0, `${cls} 규칙이 없다 — 그림이 색 없이 그려진다`)
    const rule = css.slice(i, css.indexOf('}', i))
    assert.doesNotMatch(rule, /#[0-9a-fA-F]{3,8}\b/, `${cls}가 토큰이 아니라 색을 직접 적었다`)
  }
})

test('★ 그림이 화면을 가로로 밀지 않는다', () => {
  const css = read('web/app.html')
  const i = css.indexOf('.fact-fig{')
  assert.ok(i > 0, '.fact-fig 규칙이 없다')
  assert.match(css.slice(i, css.indexOf('}', i)), /overflow-x:\s*auto/,
    '넘칠 때 그림 상자 안에서 안 밀고 화면을 민다')
})
