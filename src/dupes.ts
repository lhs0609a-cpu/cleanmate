/**
 * 같은 파일이 여러 벌 — 사진 밖으로
 *
 * ── 왜 필요했나 ──────────────────────────────────────────────
 * 중복 판정은 이미 photos.ts에 있었는데 **사진에만** 묶여 있었다. 그런데 실제로
 * 자리를 많이 먹는 중복은 사진이 아니다. 이 PC를 훑다가 바로 나온 것:
 *
 *   MegaroadGlobal-Agent-Setup.exe      168MB
 *   MegaroadGlobal-Agent-Setup (1).exe  168MB   ← 완전히 같은 파일
 *
 * 설치 파일·영상·압축파일은 한 벌이 수백 MB라 두 벌만 있어도 사진 수백 장이다.
 *
 * ── 판정 지식은 새로 쓰지 않는다 ─────────────────────────────
 * 크기로 좁히고 → 앞뒤 256KB+크기 해시로 확정하고 → 사본 표시·나이로 원본을
 * 고르는 규칙은 photos.ts가 이미 갖고 있다. 여기서 다시 쓰면 반드시 갈라진다.
 * 그대로 가져다 쓰고, 이 파일은 **어디를 볼 것인가**만 담당한다.
 *
 * ── 중복이라고 다 지워도 되는 게 아니다 ──────────────────────
 * ★ 이게 이 모듈에서 제일 중요한 부분이다. `node_modules`에는 같은 파일이 수십 벌
 *   있는 게 **정상**이다. 각 패키지가 자기 것을 갖고 있어야 돌아간다. 가상환경도,
 *   게임 데이터도, 윈도우 시스템도 마찬가지다. 여기서 "사본"이라며 하나를 지우면
 *   그건 중복 정리가 아니라 그냥 고장이다.
 *   그래서 대상은 **사람이 만들거나 받아둔 자리**로만 좁힌다. 확신이 없으면 뺀다.
 */

import { extname } from 'node:path'
import { stat } from 'node:fs/promises'
import { groupBySize, contentHash, buildDupGroups, pickKeeper, type PhotoFile, type DupGroup } from './photos.ts'

export type DupFile = PhotoFile
export type { DupGroup }

/** 이보다 작은 파일은 중복이어도 체감이 없다 — 목록만 길어진다. */
export const DUP_MIN_BYTES = 10 * 1024 * 1024 // 10MB

/**
 * 여기 있는 같은 파일은 '중복'이 아니라 '필요해서 여러 벌'이다.
 *
 * 지우면 깨지는 자리와, 우리가 관리하는 자리(격리함·이동 폴더)를 다 뺀다.
 * 이동 금지 목록(relocate.ts)과 겹치지만 같지 않다 — 저기는 '옮기면 깨지는 곳'이고
 * 여기는 '같은 파일이 여러 벌 있는 게 정상인 곳'이다. 예를 들어 다운로드 폴더는
 * 옮겨도 되지만 중복도 지워도 된다. 반대로 게임 폴더는 둘 다 안 된다.
 */
const NOT_DUPLICATES = [
  { test: /[\\/]windows[\\/]/i, why: '윈도우 시스템' },
  { test: /[\\/]program files( \(x86\))?[\\/]/i, why: '설치된 프로그램' },
  { test: /[\\/]programdata[\\/]/i, why: '프로그램 공용 데이터' },
  /**
   * ★ 모델 파일은 이 규칙을 건너뛴다(modelOk).
   *
   *   AppData를 통째로 빼는 건 "프로그램마다 같은 부품을 갖고 있는 게 정상"이라서다.
   *   그런데 실측에서 이런 게 나왔다 — 같은 AI 모델 6.46GB가 **6벌**, 그중 3벌이
   *   AppData 안이었다. 이건 부품이 아니라 **인터넷에서 받아온 큰 자료**고,
   *   여러 벌 있는 게 정상이 아니다(32.3GB 낭비).
   *   받아온 자료는 프로그램이 어디 있든 한 벌이면 충분하다.
   */
  { test: /[\\/]appdata[\\/]/i, why: '프로그램이 저장한 자료', modelOk: true },
  { test: /[\\/]node_modules[\\/]/i, why: '프로그램마다 같은 부품을 갖고 있는 게 정상입니다' },
  { test: /[\\/](\.venv|venv|site-packages|__pycache__)[\\/]/i, why: '프로그램 부품 상자' },
  { test: /[\\/]\.git[\\/]/i, why: '변경 기록을 담아두는 폴더 안' },
  { test: /[\\/](steamapps?|epic ?games|riot games|battle\.net|nexon)[\\/]/i, why: '게임 데이터' },
  { test: /[\\/]\.(teraclean|cleanmate)[\\/]/i, why: '보관함' },
  { test: /[\\/]TeraClean-Moved[\\/]/i, why: '이미 옮겨둔 폴더' },
  { test: /[\\/]\$recycle\.bin[\\/]/i, why: '휴지통' },
  { test: /[\\/]system volume information[\\/]/i, why: '시스템 복원' },
]

/** 확장자가 이거면 '여러 벌 있는 게 정상'인 축이다(라이브러리·부분 파일 등). */
const NOT_DUP_EXT = new Set(['.dll', '.pyd', '.lib', '.so', '.dylib', '.sys', '.node', '.pdb', '.part', '.crdownload', '.tmp'])

/**
 * 인터넷에서 받아온 큰 자료인가 — AI 모델 같은 것.
 *
 * 이런 파일은 프로그램이 몇 벌 깔려 있든 **한 벌이면 충분하다.** 게다가 하나에
 * 수 GB라, 중복 하나가 사진 수천 장 값이다. 확장자로 알아보고, 확장자가 없는
 * 것(ollama가 받아둔 것들)은 자리로 알아본다.
 */
const MODEL_EXTS = new Set(['.safetensors', '.ckpt', '.gguf', '.pt', '.pth', '.onnx', '.tflite', '.h5', '.msgpack'])
const MODEL_DIRS = /[\\/](models?|checkpoints?|blobs|unet|vae|loras?|clip|diffusion_models|\.ollama|huggingface)[\\/]/i

export function isModelFile(path: string): boolean {
  const name = path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1)
  const dot = name.lastIndexOf('.')
  if (dot > 0 && MODEL_EXTS.has(name.slice(dot).toLowerCase())) return true
  // 확장자가 없고 자리가 모델 폴더면 모델로 본다 (ollama의 blobs 같은 것)
  return dot <= 0 && MODEL_DIRS.test(path)
}

export interface DupCheck {
  ok: boolean
  reason?: string
}

/** 이 파일을 중복 후보로 볼 수 있나. 모르면 뺀다. */
export function isDupeCandidate(path: string): DupCheck {
  const model = isModelFile(path)
  for (const rule of NOT_DUPLICATES) {
    if (!rule.test.test(path)) continue
    if (model && (rule as { modelOk?: boolean }).modelOk) continue
    return { ok: false, reason: rule.why }
  }
  if (NOT_DUP_EXT.has(extname(path).toLowerCase())) {
    return { ok: false, reason: '프로그램이 불러 쓰는 파일이라 여러 벌 있는 게 정상입니다' }
  }
  return { ok: true }
}

/* ────────────────────────────────────────────────────────────
   무엇을 남길지 — 클라우드에 있는 쪽을 우선한다

   photos.ts의 규칙(사본 표시 없는 것 · 더 오래된 것)이 기본이고, 여기에 하나를
   더 얹는다: **동기화 폴더에 있는 쪽을 남긴다.** 그쪽은 지워도 클라우드에 남고,
   다른 기기에서도 보이니까 사용자에게 더 안전한 사본이다.
   ──────────────────────────────────────────────────────────── */

const CLOUD = /[\\/](onedrive|dropbox|google drive|드라이브|drivefs|icloud)[\\/]/i

export function isCloudPath(path: string): boolean {
  return CLOUD.test(path)
}

/**
 * 중복 묶음을 만든다. photos.ts의 묶기를 쓰고, 남길 것만 클라우드 쪽으로 옮긴다.
 * 바꿀 때는 근거 문장도 같이 바꾼다 — 근거가 결과와 다르면 그게 더 나쁘다.
 */
export function buildFileDupGroups(hashed: { file: DupFile; hash: string }[]): DupGroup[] {
  return buildDupGroups(hashed).map((g) => {
    if (isCloudPath(g.keeper.path)) return g
    const all = [g.keeper, ...g.copies]
    const cloud = all.filter((f) => isCloudPath(f.path))
    if (!cloud.length) return g
    const keeper = pickKeeper(cloud).keeper
    const copies = all.filter((f) => f.path !== keeper.path)
    return {
      ...g,
      keeper,
      copies,
      wastedBytes: copies.reduce((s, f) => s + f.size, 0),
      keeperReason: '클라우드 동기화 폴더에 있어서 남겼어요 — 다른 기기에서도 보이는 사본입니다.',
    }
  })
}

/* ────────────────────────────────────────────────────────────
   이미 합쳐진 것을 "낭비"라고 하지 않는다

   ★ 실측에서 나온 오보 (2026-08-18)
     이 PC의 AI 모델 폴더를 훑었더니 "낭비 58.86GB"라고 나왔다. 그중
     sd_xl_base_1.0.safetensors는 6.46GB짜리가 **6벌**로 잡혀 32.31GB가
     낭비라고 했다. 그런데 fsutil로 확인하니 링크수가 6이었다 —
     여섯 경로가 **이미 같은 실물 하나**를 나눠 쓰고 있었고, 실제로 차지하는
     건 6.46GB, 회수할 수 있는 건 **0바이트**였다.

     내용이 같다는 것과 자리를 따로 차지한다는 것은 다른 문제다. 해시만 보면
     구분이 안 된다. 파일시스템에 물어봐야 안다.

     "58.86GB를 아낄 수 있어요"라고 해놓고 눌렀더니 아무것도 안 비면, 그건
     경쟁 도구가 하는 짓이고 이 제품이 하지 않기로 한 짓이다.
     (실제 회수 가능액은 19.7GB였다 — Ollama 모델 쪽만 진짜 중복이었다)
   ──────────────────────────────────────────────────────────── */

/**
 * 파일의 '실물 신원'. 같은 값이면 이미 같은 실물을 나눠 쓰는 중이다(하드링크).
 * 윈도우에서는 볼륨 일련번호 + 파일 인덱스, 그 외에는 dev + ino가 그 역할을 한다.
 */
export type FileIdentity = string

/**
 * 이미 링크된 사본을 낭비에서 뺀다 — 순수 함수라 디스크 없이 시험할 수 있다.
 *
 * @param identityOf 경로 → 실물 신원. 모르면 null(그때는 **낭비로 센다** —
 *                   모른다고 0으로 깎으면 진짜 중복을 놓친다. 보수적인 쪽은
 *                   "회수 가능하다"가 아니라 "회수량을 부풀리지 않는다"이므로,
 *                   신원을 모를 때는 따로 차지한다고 보는 게 맞다)
 */
export function markAlreadyLinked(
  groups: DupGroup[],
  identityOf: (path: string) => FileIdentity | null
): DupGroup[] {
  return groups.map((g) => {
    /* 이미 센 신원들. 키퍼의 신원으로 시작한다 — 키퍼와 같은 실물인 사본은
       치워봐야 1바이트도 안 빈다. 사본끼리 서로 링크된 경우도 한 번만 센다. */
    const seen = new Set<FileIdentity>()
    const kid = identityOf(g.keeper.path)
    if (kid) seen.add(kid)

    let wasted = 0
    const copies = g.copies.map((c) => {
      const id = identityOf(c.path)
      const linked = id !== null && seen.has(id)
      if (id) seen.add(id)
      if (!linked) wasted += c.size
      return linked ? { ...c, alreadyLinked: true } : c
    })

    return { ...g, copies, wastedBytes: wasted }
  })
}

/** 이 묶음에서 실제로 회수할 게 남았나. 0이면 화면에 올릴 이유가 없다. */
export function hasRealWaste(g: DupGroup): boolean {
  return g.wastedBytes > 0
}

export interface DupScanResult {
  groups: DupGroup[]
  /** 사본을 치우면 비는 용량 */
  wastedBytes: number
  /** 본 파일 수(후보로 추린 것) */
  candidates: number
  /** 해시까지 읽어본 파일 수 — 이게 곧 든 시간이다 */
  hashed: number
  /** 중복이지만 손대면 안 되는 자리라 뺀 개수 */
  excluded: number
}

/**
 * 볼 것만 남긴다 — 순수 함수. 파일을 읽지 않으므로 규칙만 따로 시험할 수 있다.
 *
 * ★ 걸러내기와 해시 읽기를 갈라둔 이유: 규칙은 경로 문자열의 문제고, 해시는
 *   디스크의 문제다. 한 함수에 묶어두면 규칙을 시험하려 해도 실제 파일을 만들어야
 *   하고, 하필 임시 폴더가 AppData 아래라 규칙에 먼저 걸려서 해시 쪽을 아예
 *   시험할 수 없었다. 섞여 있으면 둘 다 제대로 못 본다.
 */
export function filterDupeCandidates(files: DupFile[]): { candidates: DupFile[]; excluded: number } {
  let excluded = 0
  const candidates = files.filter((f) => {
    if (f.size < DUP_MIN_BYTES) return false
    if (isDupeCandidate(f.path).ok) return true
    excluded++
    return false
  })
  return { candidates, excluded }
}

/**
 * 후보 → 중복 묶음. 여기서만 디스크를 읽는다.
 *
 * 해시는 **크기가 겹치는 것만** 읽는다. 파일 수가 아니라 '크기가 같은 파일 수'에
 * 비례하므로, 수만 개를 넣어도 실제로 읽는 건 보통 수십~수백 개다.
 */
export async function hashAndGroup(
  candidates: DupFile[],
  opts: DupScanOptions = {}
): Promise<Omit<DupScanResult, 'excluded'>> {
  const sizeGroups = groupBySize(candidates)
  const hashed: { file: DupFile; hash: string }[] = []
  /* ★ 여기가 이 기능에서 제일 오래 걸리는 자리다 — 파일마다 앞뒤를 실제로 읽는다.
     그동안 화면이 "찾는 중…" 한 줄이면 사용자는 멈춘 건지 도는 건지 알 수 없다.
     몇 개 중 몇 개를 봤는지는 여기서만 알 수 있으니, 여기서 알린다. */
  const total = sizeGroups.reduce((n, g) => n + g.length, 0)
  let done = 0
  for (const group of sizeGroups) {
    for (const f of group) {
      try {
        hashed.push({ file: f, hash: await contentHash(f.path, f.size) })
      } catch {
        /* 읽을 수 없는 파일은 후보에서 뺀다 — 못 읽은 걸 같다고 할 수는 없다 */
      }
      opts.onHashProgress?.(++done, total, f.size)
    }
  }

  const raw = buildFileDupGroups(hashed)

  /* ★ 여기서 파일시스템에 한 번 더 물어본다.
     내용이 같아도 **이미 같은 실물**이면 치워봐야 용량이 안 빈다. stat은 중복으로
     확정된 것에만 부르므로(수십 개 수준) 비용이 안 보인다. */
  const ids = new Map<string, FileIdentity | null>()
  for (const g of raw) {
    for (const f of [g.keeper, ...g.copies]) {
      if (ids.has(f.path)) continue
      try {
        const st = await stat(f.path)
        /* nlink가 1이면 자기 혼자다 — 신원을 만들 필요도 없다. 2 이상일 때만
           누구와 같은 실물인지 따진다. ino는 윈도우에서도 파일 인덱스로 채워진다. */
        ids.set(f.path, st.nlink > 1 ? `${st.dev}:${st.ino}` : null)
      } catch {
        ids.set(f.path, null) // 못 읽으면 모르는 것 — 낭비로 센다(부풀리지 않는 쪽)
      }
    }
  }

  const groups = markAlreadyLinked(raw, (p) => ids.get(p) ?? null).filter(hasRealWaste)
  return {
    groups,
    wastedBytes: groups.reduce((s, g) => s + g.wastedBytes, 0),
    candidates: candidates.length,
    hashed: hashed.length,
  }
}

/* ────────────────────────────────────────────────────────────
   왜 이렇게 됐나 — 원인까지 말해준다

   ★ 중복을 지워주는 것만으로는 반쪽이다. 실측에서 나온 상황은 "같은 모델이
     6벌"이었는데, 그 원인은 **같은 프로그램이 6곳에 설치돼 있어서**였다.
     원인을 모르면 정리해도 다음 달에 똑같이 쌓인다. 그리고 사용자가 정말
     내려야 할 결정은 "사본을 지울까"가 아니라 "설치본을 정리할까"다.
   ──────────────────────────────────────────────────────────── */

export interface InstallCause {
  /** 여러 곳에 있는 프로그램 이름 (경로에서 그대로 읽은 것) */
  name: string
  /** 그게 설치된 자리들 */
  roots: string[]
  /** 이 원인 때문에 낭비된 용량 */
  wastedBytes: number
}

/** 경로들의 뒤에서부터 같은 조각을 센다. 같은 구조가 여러 곳에 복사된 흔적이다. */
export function commonSuffix(paths: string[]): string[] {
  const parts = paths.map((p) => p.split(/[\\/]/).filter(Boolean))
  const out: string[] = []
  // 스프레드로 최솟값을 구하지 않는다 — 배열 길이만큼 인자를 만드는 자리를
  // 만들지 않는다는 규칙(breakdown.ts 머리말). 여기선 짧지만 예외를 안 만든다.
  let shortest = Infinity
  for (const p of parts) if (p.length < shortest) shortest = p.length
  for (let i = 1; i <= shortest; i++) {
    const seg = parts[0][parts[0].length - i]
    if (!parts.every((p) => p[p.length - i].toLowerCase() === seg.toLowerCase())) break
    out.unshift(seg)
  }
  return out
}

/**
 * 폴더 이름에 드러나는 프로그램 — 이름을 지어내지 않고 경로에서 읽는다.
 *
 * ★ 왜 이름 표가 필요한가: 같은 프로그램인데 폴더 이름이 제각각이다.
 *   실측에서 ComfyUI가 이렇게 흩어져 있었다 —
 *     GVF-ComfyUI · ComfyUI_windows_portable · @stockfactory\...\ComfyUI_windows_portable
 *   경로 조각만 비교하면 이 셋이 남남으로 보인다. 그러면 "같은 프로그램이
 *   여러 벌"이라는, 사용자가 진짜 알아야 할 사실을 못 말한다.
 */
const PROGRAM_FAMILY: [RegExp, string][] = [
  [/comfyui/i, 'ComfyUI'],
  [/stable[-_ ]?diffusion|automatic1111|a1111|sd[-_ ]?webui/i, 'Stable Diffusion 웹UI'],
  [/fooocus/i, 'Fooocus'],
  [/invokeai/i, 'InvokeAI'],
  [/ollama/i, 'Ollama'],
  [/lm[-_ ]?studio/i, 'LM Studio'],
  [/text[-_ ]?generation[-_ ]?webui|oobabooga/i, '텍스트 생성 웹UI'],
]

/** 경로에서 프로그램과 그 설치 자리를 읽는다. 못 알아보면 null. */
export function familyRootOf(path: string): { name: string; root: string } | null {
  const segs = path.split(/[\\/]/).filter(Boolean)
  for (let i = segs.length - 1; i >= 0; i--) {
    for (const [re, name] of PROGRAM_FAMILY) {
      if (re.test(segs[i])) return { name, root: segs.slice(0, i + 1).join('\\') }
    }
  }
  return null
}

/**
 * 중복 묶음들에서 "같은 프로그램이 여러 곳에 있다"를 찾아낸다.
 *
 * 두 가지로 읽는다:
 *   ① 폴더 이름이 아는 프로그램이면 그걸로 묶는다 (ComfyUI가 4곳)
 *   ② 모르는 프로그램이면 경로 뒤쪽의 같은 구조로 묶는다
 *      (`…\X\models\checkpoints\파일`이 여러 곳 → X가 곧 그 프로그램)
 */
export function findInstallCauses(groups: DupGroup[], top = 3): InstallCause[] {
  const map = new Map<string, InstallCause>()
  const put = (key: string, name: string, roots: string[], bytes: number) => {
    const c = map.get(key) ?? { name, roots: [], wastedBytes: 0 }
    for (const r of roots) if (r && !c.roots.includes(r)) c.roots.push(r)
    c.wastedBytes += bytes
    map.set(key, c)
  }

  for (const g of groups) {
    const paths = [g.keeper.path, ...g.copies.map((c) => c.path)]

    // ① 아는 프로그램 이름이 경로에 있나
    const fams = paths.map(familyRootOf).filter(Boolean) as { name: string; root: string }[]
    const byName = new Map<string, string[]>()
    for (const f of fams) byName.set(f.name, [...(byName.get(f.name) ?? []), f.root])
    let matched = false
    for (const [name, roots] of byName) {
      const uniq = [...new Set(roots)]
      if (uniq.length < 2) continue
      put(name.toLowerCase(), name, uniq, g.wastedBytes)
      matched = true
    }
    if (matched) continue

    // ② 모르는 프로그램 — 뒤에서부터 같은 구조를 본다
    const suffix = commonSuffix(paths)
    if (suffix.length < 2) continue // 파일 이름만 같은 것 — 구조가 겹친 게 아니다
    const cut = (p: string) => {
      const segs = p.split(/[\\/]/).filter(Boolean)
      return segs.slice(0, segs.length - suffix.length).join('\\')
    }
    put(suffix[0].toLowerCase(), suffix[0], paths.map(cut), g.wastedBytes)
  }

  return [...map.values()]
    .filter((c) => c.roots.length >= 2)
    .sort((a, b) => b.wastedBytes - a.wastedBytes)
    .slice(0, top)
}

/** 걸러내고 → 해시로 확정한다. 엔진이 쓰는 통로는 이것 하나다. */
/** 오래 걸리는 동안 밖에 알릴 통로. 없으면 예전 그대로 조용히 돈다. */
export interface DupScanOptions {
  /** @param done 여태 확인한 파일 수 @param total 확인할 전체 @param bytes 방금 본 파일 크기 */
  onHashProgress?: (done: number, total: number, bytes: number) => void
}

export async function findDuplicates(
  files: DupFile[],
  opts: DupScanOptions = {}
): Promise<DupScanResult> {
  const { candidates, excluded } = filterDupeCandidates(files)
  return { ...(await hashAndGroup(candidates, opts)), excluded }
}
