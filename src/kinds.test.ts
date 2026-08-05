/**
 * 파일 종류 판별 테스트
 *
 * ★ 겨냥하는 것: 틀린 이름표를 붙이지 않는가.
 *   "게임 자료"라고 했는데 가족 사진이면, 사용자는 그걸 믿고 지운다.
 *   확신이 없으면 '기타'라고 말하는 게 맞다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kindOf, groupByKind, describeMix, impactOf } from './kinds.ts'

const BS = String.fromCharCode(92)
const p = (...seg: string[]) => seg.join(BS)

test('확장자로 큰 갈래를 안다', () => {
  assert.equal(kindOf('여행.mp4').label, '동영상')
  assert.equal(kindOf('가족사진.JPG').label, '사진·이미지')
  assert.equal(kindOf('계약서.hwp').label, '문서')
  assert.equal(kindOf('매출.xlsx').label, '표·엑셀')
  assert.equal(kindOf('설치.exe').label, '설치 파일')
  assert.equal(kindOf('자막.smi').label, '자막')
})

test('★ 출처가 확장자보다 먼저다 — 같은 mp4도 어디 있느냐로 뜻이 달라진다', () => {
  assert.equal(kindOf(p('C:', 'Games', 'steamapps', 'common', 'x.mp4')).label, '게임 자료 (Steam)')
  assert.equal(kindOf(p('C:', 'Users', 'me', 'KakaoTalk', 'received.mp4')).label,
    '카카오톡으로 받은 파일')
  assert.equal(kindOf(p('D:', 'OBS Studio', 'rec.mp4')).label, '회의·화면 녹화본')
  // 출처가 없으면 확장자로 떨어진다
  assert.equal(kindOf(p('D:', '내영상', 'rec.mp4')).label, '동영상')
})

test('개발 산출물과 캐시를 구분해서 알려준다', () => {
  assert.equal(kindOf(p('C:', 'proj', 'node_modules', 'a.js')).label, '개발 중간 산출물')
  assert.equal(kindOf(p('C:', 'Users', 'me', 'AppData', 'Local', 'Cache', 'f.bin')).label,
    '앱이 만든 임시·캐시')
})

test('★ 모르면 "기타"라고 한다 — 틀린 이름표는 없는 것보다 나쁘다', () => {
  const k = kindOf('무언가.xyz123')
  assert.equal(k.label, '기타')
  assert.match(k.why, /모릅니다/)
})

test('모든 판정에 근거가 붙는다', () => {
  for (const f of ['a.mp4', p('C:', 'steamapps', 'b.pak'), 'c.unknownext']) {
    assert.ok(kindOf(f).why.length > 5, `${f}: 근거가 없다`)
  }
})

test('종류별 묶음은 용량 큰 순', () => {
  const g = groupByKind([
    { path: 'a.mp4', size: 900 },
    { path: 'b.txt', size: 10 },
    { path: 'c.mp4', size: 100 },
  ])
  assert.equal(g[0].label, '동영상')
  assert.equal(g[0].count, 2)
  assert.equal(g[0].bytes, 1000)
})

test('한 문장 요약이 비율로 말한다 — "대부분 동영상입니다(91%)"', () => {
  const items = [
    { path: 'a.mp4', size: 910 },
    { path: 'b.hwp', size: 90 },
  ]
  const s = describeMix(groupByKind(items), 1000)
  assert.match(s, /대부분 동영상입니다\(91%\)/)
  assert.match(s, /문서 9%/)
})

test('종류가 하나뿐이면 군더더기를 붙이지 않는다', () => {
  const s = describeMix(groupByKind([{ path: 'a.mp4', size: 100 }]), 100)
  assert.equal(s, '대부분 동영상입니다(100%).')
})

/* ── 지우면 어떤 결과가 오나 ─────────────────────────────────
   사용자가 결정을 못 내리는 이유는 셋이다:
   "이게 뭐냐 / 지워도 되냐 / 뭐가 영향받냐". 셋째에 답하는 부분. */

test('★ 개인 자료는 "되돌릴 수 없음"으로 표시된다', () => {
  for (const k of ['video', 'image', 'camera', 'recording', 'doc', 'sheet']) {
    const im = impactOf(k)
    assert.equal(im.level, 'high', `${k}: 등급이 낮게 잡혔다`)
    assert.match(im.regen, /되살릴 수 없습니다/)
  }
})

test('캐시·로그는 영향 없음 — 앱이 다시 만든다', () => {
  for (const k of ['cache', 'log']) {
    assert.equal(impactOf(k).level, 'none')
    assert.match(impactOf(k).affects, /깨지지 않습니다|그대로입니다/)
  }
})

test('★ 클라우드 동기화 폴더는 "다른 기기에서도 사라진다"고 경고한다', () => {
  const im = impactOf('cloud')
  assert.equal(im.level, 'high')
  assert.match(im.affects, /클라우드에서도 지워져|다른 기기/)
})

test('★ 모르는 종류는 "모릅니다"라고 답한다 — 안전하다고 하지 않는다', () => {
  const im = impactOf('전혀-모르는-종류')
  assert.match(im.levelLabel, /모릅니다/)
  assert.match(im.affects, /확신이 없으면 그대로 두시는 편이 안전/)
})

test('모든 판정에 세 가지가 다 있다 — 등급·재생성·영향', () => {
  for (const k of ['cache', 'dev', 'installer', 'video', 'kakao', 'game-steam', 'other']) {
    const im = impactOf(k)
    assert.ok(im.levelLabel.length > 1, `${k}: 등급 이름이 없다`)
    assert.ok(im.regen.length > 3, `${k}: 다시 생기는지가 없다`)
    assert.ok(im.affects.length > 10, `${k}: 무엇이 영향받는지가 없다`)
  }
})

test('종류 묶음에 파급 판정이 함께 실린다', () => {
  const g = groupByKind([{ path: 'C:/a/여행.mp4', size: 100 }])
  assert.equal(g[0].impact.level, 'high')
})
