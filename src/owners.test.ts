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

test('★ "깨지는 것"과 "그대로인 것"이 갈려 있다 — 안심의 근거를 따로 준다', () => {
  const o = ownerOf(TORCH)
  assert.ok(o.breaks.length >= 1, '무엇이 깨지는지가 있어야 한다')
  assert.ok(o.intact.some((a) => /코드/.test(a)), '원본 코드가 남는다는 말이 있어야 한다')
  assert.ok(o.intact.some((a) => /윈도우|다른 프로그램/.test(a)))
})

/**
 * ★ 낱개 선택이 사용자에게 손해가 되는 경우를 말해준다.
 *
 * 목록에서 `torch_cuda.dll 1.2GB` 하나만 체크하면 1.2GB를 아낀 것 같지만,
 * 그 프로젝트는 6GB짜리 .venv를 통째로 지운 것과 **똑같이** 못 쓴다.
 * 회수는 1/5인데 피해는 같다 — 그러면 그건 나쁜 선택이고, 그 사실을 아는 건
 * 우리뿐이다. 말 안 하면 사용자는 "큰 것부터 골랐다"고 생각한다.
 */
test('★ 하나만 지워도 손해인 묶음은 그렇다고 말한다', () => {
  const o = ownerOf(TORCH)
  assert.ok(o.unit, '낱개로 지워봐야 뜻이 없다는 사실을 말하지 않는다')
  assert.match(o.unit, /ACE-Step-1\.5/, '어느 프로젝트가 안 돌아가는지 이름을 댄다')
  assert.doesNotMatch(o.unit, /\{프로그램/, '조사 치환이 새어나갔다')
})

test('사진·동영상 같은 낱개 파일에는 "묶음" 경고를 붙이지 않는다', () => {
  // 아무 데나 붙이면 경고가 배경음이 된다. 한 덩어리로 깨지는 것에만 붙인다.
  assert.equal(ownerOf('C:\\Users\\me\\Videos\\holiday.mp4').unit, '')
})

test('허깅페이스 모델 캐시는 "다시 받는다"까지 말한다', () => {
  const o = ownerOf(ONNX)
  assert.equal(o.program, 'cthumb-sample')
  assert.match(o.role, /허깅페이스/)
  assert.equal(o.verdict, 'safe')
  assert.match(o.onDelete, /자동으로 받습니다/)
  assert.ok(o.breaks.some((a) => /인터넷/.test(a)), '오프라인이면 못 쓴다는 사실을 숨기지 않는다')
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
  assert.ok(o.intact.some((a) => /세이브/.test(a)), '진행 상황이 안전하다는 걸 말해야 결정이 된다')
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
  assert.ok(o.intact.some((a) => /로그인|설정/.test(a)))
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

test('★ "지우면"과 "영향"이 같은 문장이면 안 된다 — 화면에 같은 줄이 두 번 떴다', () => {
  // 실물 버그: 역할을 못 알아본 파일에서 onDelete와 영향 범위가 같은 문자열이었다.
  for (const p of ['D:\\사진\\가족.jpg', 'C:\\Users\\me\\AppData\\Local\\X\\일반.dat',
                   'D:\\받은것\\영화.mkv', 'C:\\문서\\계약서.pdf']) {
    const o = ownerOf(p)
    for (const a of [...o.breaks, ...o.intact]) {
      assert.notEqual(a, o.onDelete, `${p}: '지우면'과 같은 문장이 영향 칸에 또 있다`)
    }
  }
})

test('★ AppData 안의 동영상은 "동영상"이라고 한다 — 위치가 확장자를 이기면 안 된다', () => {
  // 실물: AppData\MusicFactory\releases\검수대기\video.mp4(99MB)가
  //       '프로그램이 저장한 데이터'로 떴다. 누구 것인지는 이미 따로 답하므로
  //       역할 자리에는 "무슨 파일인지"가 와야 한다.
  const o = ownerOf('C:\\Users\\lhs06\\AppData\\Local\\MusicFactory\\releases\\검수대기\\video.mp4')
  assert.match(o.role, /동영상/)
  assert.equal(o.program, 'MusicFactory')
  assert.match(ownerHeadline(o), /MusicFactory/)
})

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
    // 근거는 '임시 폴더'처럼 짧은 조각이다(문장으로 쓰면 카드가 글 덩어리가 된다).
    // 그래도 비어 있으면 안 된다 — 근거를 못 대는 판정은 판정이 아니다.
    assert.ok(o.because.trim().length >= 3, `${p}: 근거가 비었다`)
    assert.ok(o.onDelete.length > 10, `${p}: 지우면 어떻게 되는지가 비었다`)
    assert.ok(o.verdictLabel.length > 1, `${p}: 판정 문구가 비었다`)
    // {프로그램} 자리가 그대로 새어나가면 화면에 중괄호가 보인다.
    assert.doesNotMatch(
      [o.onDelete, ...o.breaks, ...o.intact].join(''), /\{프로그램/, `${p}: 치환이 안 됐다`)
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

test('★ "…로/…으로 보입니다"를 받침에 맞게 쓴다', () => {
  // 실물: "MusicFactory(프로그램)의 동영상로 보입니다"
  const video = ownerOf('C:\\Users\\me\\AppData\\Local\\MusicFactory\\releases\\video.mp4')
  assert.match(ownerHeadline(video), /동영상으로 보입니다$/)
  // ㄹ 받침은 '으로'가 아니라 '로'다 — '파일로'가 맞고 '파일으로'는 틀리다
  const conf = ownerOf('C:\\Users\\me\\AppData\\Roaming\\SomeApp\\config\\x.ini')
  assert.match(conf.role, /설정 파일/)
  assert.match(ownerHeadline(conf), /설정 파일로 보입니다$/)
})

test('추정한 이름을 확정처럼 말하지 않는다', () => {
  // identified가 false인데 단정형으로 끝나면 신뢰가 한 번에 무너진다.
  const guessed = ownerOf('C:\\Users\\me\\AppData\\Local\\SomeVendor\\cache\\x.bin')
  assert.equal(guessed.identified, false)
  assert.match(ownerHeadline(guessed), /보입니다/)
})
