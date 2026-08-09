/**
 * 소유자 판별 테스트
 *
 * ★ 이 파일의 기준선은 실제 스크린샷이다. 사용자 화면에 이렇게 떴다:
 *
 *     torch_cuda.dll   [개발 중간 산출물]   1.2GB
 *     model.onnx       [개발 중간 산출물]   578MB
 *
 *   1.2GB짜리를 앞에 두고 "개발 중간 산출물"이라는 말로는 아무도 결정을
 *   못 내린다. 뭐가 깨지는지를 말하지 않았기 때문이다. 그래서 그 경로들을
 *   그대로 테스트에 박아둔다 — 다시 그 화면으로 돌아가지 않게.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ownerOf, ownerHeadline } from './owners.ts'

/* 스크린샷에 찍힌 실제 경로 두 개 */
const TORCH =
  'C:\\Users\\lhs06\\AppData\\Local\\MusicFactory\\ACE-Step-1.5\\.venv\\Lib\\site-packages\\torch\\lib\\torch_cuda.dll'
const ONNX =
  'C:\\Users\\lhs06\\AppData\\Local\\cthumb-sample\\node_modules\\@huggingface\\transformers\\.cache\\Xenova\\clip-vit-base-patch32\\onnx\\model.onnx'

test('★ 1.2GB짜리 dll이 어느 프로젝트 것인지 이름을 댄다', () => {
  const o = ownerOf(TORCH)
  assert.equal(o.program, 'ACE-Step-1.5', '가상환경을 담은 폴더가 곧 주인이다')
  assert.equal(o.programKind, '개발 프로젝트')
  assert.ok(o.identified, '경로에서 그대로 읽은 이름이므로 추정이 아니다')
  assert.match(o.role, /AI 계산 라이브러리/)
  // 결정에 필요한 건 "다시 만들 수 있다"가 아니라 "얼마나 걸리나"다.
  assert.match(o.onDelete, /ACE-Step-1\.5/)
  assert.match(o.onDelete, /pip install/)
  assert.match(o.onDelete, /분/)
  assert.equal(o.verdict, 'ask')
})

test('★ 영향 범위에 "영향받지 않는 것"이 함께 적힌다 — 안심의 근거다', () => {
  const o = ownerOf(TORCH)
  assert.ok(o.affects.length >= 2)
  assert.ok(o.affects.some((a) => /코드/.test(a)), '원본 코드가 남는다는 말이 있어야 한다')
  assert.ok(o.affects.some((a) => /윈도우|다른 프로그램/.test(a)))
})

test('허깅페이스 모델 캐시는 "다시 받는다"까지 말한다', () => {
  const o = ownerOf(ONNX)
  assert.equal(o.program, 'cthumb-sample')
  assert.match(o.role, /허깅페이스/)
  assert.equal(o.verdict, 'safe')
  assert.match(o.onDelete, /다시 (내려)?받/)
  assert.ok(o.affects.some((a) => /인터넷/.test(a)), '오프라인이면 못 쓴다는 사실을 숨기지 않는다')
})

test('한 줄 정체가 "프로그램의 역할" 꼴로 나온다', () => {
  assert.match(ownerHeadline(ownerOf(TORCH)), /^ACE-Step-1\.5\(개발 프로젝트\)의 /)
})

/* ────────────────────────────────────────────────────────────
   게임 — 사용자가 예로 든 경우. 캐시와 세이브가 갈려야 한다.
   ──────────────────────────────────────────────────────────── */

test('★ 배틀그라운드 셰이더 캐시: 이름을 대고, 세이브는 안전하다고 말한다', () => {
  const o = ownerOf('D:\\Steam\\steamapps\\common\\PUBG\\TslGame\\Saved\\ShaderCache\\a.bin')
  assert.equal(o.program, '배틀그라운드')
  assert.equal(o.programKind, '게임')
  assert.equal(o.verdict, 'safe')
  assert.match(o.role, /셰이더/)
  assert.match(o.onDelete, /배틀그라운드/)
  assert.ok(o.affects.some((a) => /세이브/.test(a)), '진행 상황이 안전하다는 걸 말해야 결정이 된다')
})

test('★ 같은 게임의 세이브 폴더는 정반대 판정이 나온다', () => {
  const o = ownerOf('D:\\Steam\\steamapps\\common\\Elden Ring\\SaveGames\\ER0000.sl2')
  assert.equal(o.verdict, 'keep')
  assert.match(o.onDelete, /★/, '되돌릴 수 없는 것에는 표시가 붙는다')
  assert.match(o.onDelete, /진행 상황/)
})

test('게임 본체 데이터는 "다시 받아야 한다"고 말한다', () => {
  const o = ownerOf('D:\\Steam\\steamapps\\common\\Fortnite\\pakchunk0.pak')
  assert.equal(o.program, '포트나이트')
  assert.equal(o.verdict, 'ask')
  assert.match(o.onDelete, /다시 받/)
})

/* ────────────────────────────────────────────────────────────
   흔한 프로그램들 — 같은 '캐시'라도 주인 이름이 붙어야 한다
   ──────────────────────────────────────────────────────────── */

test('브라우저 캐시는 크롬 이름을 달고 나온다', () => {
  const o = ownerOf('C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache\\f_00123')
  assert.equal(o.program, '크롬')
  assert.equal(o.verdict, 'safe')
  assert.match(o.onDelete, /크롬/)
  assert.ok(o.affects.some((a) => /로그인|설정/.test(a)))
})

test('설치된 앱 안의 node_modules는 앱 것으로 잡는다 — 프로젝트로 착각하지 않는다', () => {
  // 실측에서 잡힌 오탐: AppData\Local의 node_modules 635곳을 사용자 프로젝트로 오인했다.
  const o = ownerOf('C:\\Users\\me\\AppData\\Local\\Discord\\app-1.0\\node_modules\\x\\index.js')
  assert.equal(o.program, '디스코드')
  assert.equal(o.programKind, '메신저')
})

test('라이브러리 안의 config 폴더를 사용자 설정으로 오인하지 않는다', () => {
  const o = ownerOf('C:\\proj\\node_modules\\webpack\\config\\defaults.js')
  assert.notEqual(o.verdict, 'keep')
  assert.match(o.role, /node_modules/)
})

/* ────────────────────────────────────────────────────────────
   모를 때 — 지어내지 않는다
   ──────────────────────────────────────────────────────────── */

test('★ 프로그램을 모르면 모른다고 쓴다', () => {
  const o = ownerOf('D:\\백업\\여행.mp4')
  assert.equal(o.program, '')
  assert.match(ownerHeadline(o), /확실하지 않습니다/)
})

test('AppData 폴더 이름으로 추정한 것은 "…로 보입니다"가 된다', () => {
  const o = ownerOf('C:\\Users\\me\\AppData\\Roaming\\HancomOffice\\cache\\x.tmp')
  assert.equal(o.program, 'HancomOffice', '대소문자를 살려서 보여준다')
  assert.equal(o.identified, false)
  assert.match(ownerHeadline(o), /로 보입니다$/)
})

test('역할을 모르는 파일은 종류 지식(kinds.ts)으로 답한다 — 빈칸을 두지 않는다', () => {
  const o = ownerOf('D:\\사진\\가족.jpg')
  assert.match(o.role, /사진/)
  assert.equal(o.verdict, 'keep')
  assert.ok(o.onDelete.length > 10)
})

/* ────────────────────────────────────────────────────────────
   구조적 보증 — 화면이 빈칸을 그리지 않게
   ──────────────────────────────────────────────────────────── */

test('★ 어떤 경로를 넣어도 다섯 칸이 다 채워진다', () => {
  const paths = [
    'C:\\x.dat',
    'C:\\Users\\me\\AppData\\Local\\Temp\\a.tmp',
    'C:\\Users\\me\\Downloads\\setup.exe',
    'C:\\Windows\\Temp\\x.log',
    '/Users/me/Library/Caches/app/x.bin',
    TORCH,
    ONNX,
  ]
  for (const p of paths) {
    const o = ownerOf(p)
    assert.ok(o.role.length > 1, `${p}: 역할이 비었다`)
    assert.ok(o.because.length > 5, `${p}: 근거가 비었다`)
    assert.ok(o.onDelete.length > 10, `${p}: 지우면 어떻게 되는지가 비었다`)
    assert.ok(o.affects.length > 0, `${p}: 영향 범위가 비었다`)
    assert.ok(o.verdictLabel.length > 1, `${p}: 판정 문구가 비었다`)
    // {프로그램} 자리가 그대로 새어나가면 화면에 중괄호가 보인다.
    assert.doesNotMatch(o.onDelete + o.affects.join(''), /\{프로그램/, `${p}: 치환이 안 됐다`)
  }
})

/* ────────────────────────────────────────────────────────────
   조사 — 문장 하나가 어색하면 설명 전체가 기계처럼 읽힌다
   ──────────────────────────────────────────────────────────── */

test('★ 받침 없는 이름에 "을/이"를 붙이지 않는다', () => {
  // 실제로 이렇게 나왔다: "배틀그라운드을 다음에 켤 때", "ACE-Step-1.5이 실행되지"
  const pubg = ownerOf('D:\\Steam\\steamapps\\common\\PUBG\\TslGame\\Saved\\ShaderCache\\a.bin')
  assert.match(pubg.onDelete, /배틀그라운드를 다음에/)
  assert.doesNotMatch(pubg.onDelete, /배틀그라운드을/)

  const proj = ownerOf(TORCH)
  assert.match(proj.onDelete, /ACE-Step-1\.5가 실행되지/)
  assert.doesNotMatch(proj.onDelete, /ACE-Step-1\.5이 /)
})

test('받침 있는 이름은 그대로 "을/이"를 쓴다', () => {
  const chrome = ownerOf('C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache\\f')
  assert.match(chrome.onDelete, /크롬이 필요할 때/) // 롬 = 받침 있음
})

test('끝의 묵음 e를 세지 않는다 — sample은 "샘플"이다', () => {
  // 실제로 "cthumb-sample가 그 기능을…"이 화면에 떴다.
  assert.match(ownerOf(ONNX).onDelete, /cthumb-sample이 그 기능을/)
  // 반대쪽도 맞아야 한다: Code는 '코드'라서 받침이 없다.
  const code = ownerOf('C:\\work\\VS-Code\\node_modules\\a\\b.js')
  assert.match(code.onDelete, /VS-Code를 다시 열 때/)
})

test('숫자로 끝나는 프로젝트 이름도 읽는 소리대로 맞춘다', () => {
  // 1·3·6은 받침(일·삼·육), 2·4·5는 없음(이·사·오)
  const six = ownerOf('C:\\work\\proj-6\\node_modules\\a\\b.js')
  assert.match(six.onDelete, /proj-6을 다시 열 때/)
  const five = ownerOf('C:\\work\\proj-5\\node_modules\\a\\b.js')
  assert.match(five.onDelete, /proj-5를 다시 열 때/)
})

test('추정한 이름을 확정처럼 말하지 않는다', () => {
  // identified가 false인데 단정형으로 끝나면 신뢰가 한 번에 무너진다.
  const guessed = ownerOf('C:\\Users\\me\\AppData\\Local\\SomeVendor\\cache\\x.bin')
  assert.equal(guessed.identified, false)
  assert.match(ownerHeadline(guessed), /보입니다/)
})
