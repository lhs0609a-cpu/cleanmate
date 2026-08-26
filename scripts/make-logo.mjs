/**
 * 임시 로고 생성기 — 의존성 0 (Node 내장 zlib만)
 *
 * 왜 손으로 PNG를 굽나: 이 환경엔 이미지 도구가 없고 드라이브 폴더는
 * npm install이 안 된다. 그래서 zlib + Buffer만으로 PNG를 직접 인코딩한다.
 *
 * 디자인: 브랜드 청록 라운드 사각 타일 + 흰 **브래킷 T** 노크아웃.
 * 도형은 scripts/lib/brand-mark.mjs 한 곳에만 적혀 있다 — 파비콘·OG·트레이도
 * 같은 파일에서 가져간다. 다섯 군데에 따로 그려두면 로고를 바꿀 때
 * 반드시 어딘가에 옛 로고가 남는다(실제로 그랬다).
 *
 * 왜 타일을 쓰나(솔리드 안): 앱 아이콘·설치파일·트레이는 배경이 제각각이다.
 * 획만 있는 안은 밝은 배경에서 사라진다. 타일이 배경을 정해준다.
 *
 * 출력: assets/logo.png (1024×1024 RGBA) — CI가 `tauri icon`으로 전 크기 생성
 *       src-tauri/icons/tray.png (32×32) — 트레이는 손으로 만들어 커밋돼 있었다.
 *                                          그래서 로고를 바꿔도 안 바뀌었다.
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const N = 1024
const SS = 2 // 슈퍼샘플링(안티에일리어싱)

import { markAt, TILE_RADIUS, TEAL_TOP, TEAL_BOT, SIMPLE_BELOW } from './lib/brand-mark.mjs'

const WHITE = [255, 255, 255]

// ── SDF 헬퍼 (중심 원점 좌표) ──
function roundedBox(px, py, hw, hh, r) {
  const qx = Math.abs(px) - hw + r
  const qy = Math.abs(py) - hh + r
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  const inside = Math.min(Math.max(qx, qy), 0)
  return outside + inside - r
}
function segment(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay
  const bax = bx - ax, bay = by - ay
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)))
  return Math.hypot(pax - bax * h, pay - bay * h)
}
const clamp01 = (x) => Math.max(0, Math.min(1, x))
// SDF → 커버리지 (경계에서 부드럽게)
const cov = (d) => clamp01(0.5 - d)

// 타일 한 변. 1024 캔버스 안에서 여백을 조금 남긴다.
const TILE = 800

/* ★ 마크는 **출력 크기**를 보고 고른다.
   1024로 그린 뒤 32px로 줄이면 대괄호가 뭉갠다 — 줄이는 건 그림을 흐리게 할 뿐,
   그 크기에서 읽히게 만들어 주지는 않는다. 그래서 최종 픽셀 기준으로 타일이
   얼마나 되는지 계산해서, 작으면 대괄호를 뗀 원도를 쓴다(brand-mark.mjs).
   글꼴이 크기별로 다른 원도를 쓰는 것과 같은 이야기다. */
let MARK = markAt(TILE)

function sample(x, y) {
  // 배경 투명
  let r = 0, g = 0, b = 0, a = 0

  // 타일 (라운드 사각)
  const dTile = roundedBox(x, y, TILE / 2, TILE / 2, TILE * TILE_RADIUS)
  const tileCov = cov(dTile)
  if (tileCov > 0) {
    const t = clamp01((y + 512) / 1024) // 위→아래 그라디언트
    const tr = TEAL_TOP[0] * (1 - t) + TEAL_BOT[0] * t
    const tg = TEAL_TOP[1] * (1 - t) + TEAL_BOT[1] * t
    const tb = TEAL_TOP[2] * (1 - t) + TEAL_BOT[2] * t
    ;[r, g, b, a] = over(tr, tg, tb, tileCov, r, g, b, a)
  }

  /* 브래킷 T를 흰색으로 파낸다.
     ★ 대괄호와 T를 따로 잰다 — 굵기가 다르기 때문이다. 한 번에 최솟값을 구해
       같은 두께를 주면 24px에서 둘이 뭉쳐 T가 안 읽힌다. */
  let dB = Infinity
  for (const [ax, ay, bx, by] of MARK.bracket) dB = Math.min(dB, segment(x, y, ax, ay, bx, by))
  const bCov = cov(dB - MARK.bracketHalf)
  if (bCov > 0) [r, g, b, a] = over(WHITE[0], WHITE[1], WHITE[2], bCov, r, g, b, a)

  let dT = Infinity
  for (const [ax, ay, bx, by] of MARK.tee) dT = Math.min(dT, segment(x, y, ax, ay, bx, by))
  const tCov = cov(dT - MARK.teeHalf)
  if (tCov > 0) [r, g, b, a] = over(WHITE[0], WHITE[1], WHITE[2], tCov, r, g, b, a)

  return [r, g, b, a]
}

// 알파 합성 (src over dst), 알파 0~1
function over(sr, sg, sb, sa, dr, dg, db, da) {
  const oa = sa + da * (1 - sa)
  if (oa === 0) return [0, 0, 0, 0]
  const or = (sr * sa + dr * da * (1 - sa)) / oa
  const og = (sg * sa + dg * da * (1 - sa)) / oa
  const ob = (sb * sa + db * da * (1 - sa)) / oa
  return [or, og, ob, oa]
}

/* ── 렌더 (슈퍼샘플) ──
   ★ 출력 크기(M)와 도형 좌표계(N)를 갈라놨다. 트레이 아이콘은 32px인데,
     1024로 그려서 줄이면 얇은 획이 뭉개진다 — 32px 격자 위에서 직접 그려야
     경계가 산다. 도형은 같은 정의를 쓰므로 두 그림이 어긋날 일은 없다.

     작은 크기일수록 슈퍼샘플을 올린다. 큰 그림은 픽셀이 많아 2배로 충분하지만,
     32px에서는 획 하나가 2~3픽셀이라 계단이 그대로 보인다. */
/** 생 RGBA (필터 바이트 없음). PNG도 ICO도 여기서 출발한다. */
function pixels(M) {
  // 최종 픽셀에서 타일이 몇 px이 되는지 — 그 크기로 원도를 고른다.
  const tileOnScreen = (TILE * M) / N
  MARK = markAt(TILE, { simple: tileOnScreen < SIMPLE_BELOW })
  const ss = M <= 64 ? 4 : SS
  const scale = N / M
  const out = Buffer.alloc(M * M * 4)
  for (let py = 0; py < M; py++) {
    for (let px = 0; px < M; px++) {
      let R = 0, G = 0, B = 0, A = 0
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) * scale - N / 2
          const y = (py + (sy + 0.5) / ss) * scale - N / 2
          const [r, g, b, a] = sample(x, y)
          R += r * a; G += g * a; B += b * a; A += a
        }
      const a = A / (ss * ss)
      const o = (py * M + px) * 4
      out[o] = A > 0 ? Math.round(R / A) : 0
      out[o + 1] = A > 0 ? Math.round(G / A) : 0
      out[o + 2] = A > 0 ? Math.round(B / A) : 0
      out[o + 3] = Math.round(a * 255)
    }
  }
  return out
}

/** PNG용 — 줄마다 필터 바이트(0)를 앞에 붙인다. */
function bake(M) {
  const px = pixels(M)
  const raw = Buffer.alloc(M * (1 + M * 4))
  for (let y = 0; y < M; y++) {
    raw[y * (1 + M * 4)] = 0
    px.copy(raw, y * (1 + M * 4) + 1, y * M * 4, (y + 1) * M * 4)
  }
  return raw
}

// ── PNG 인코딩 ──
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function encode(M) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(M, 0)
  ihdr.writeUInt32BE(M, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(bake(M), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function write(file, M) {
  const png = encode(M)
  writeFileSync(file, png)
  // 어느 원도가 나갔는지 찍는다 — 작은 아이콘이 왜 T만 있는지 나중에 헷갈리지 않게.
  console.log(`${file} · ${M}×${M} · ${MARK.simple ? 'T' : '[T]'} · ${(png.length / 1024).toFixed(1)}KB`)
}

/* ── ICO ────────────────────────────────────────────────────
   ★ 왜 직접 굽나: 전에는 CI가 `tauri icon assets/logo.png`으로 만들었다.
     그건 1024 그림을 **축소**하는 것이라, 16·32px에서 대괄호가 그대로 뭉갠다 —
     하필 작업표시줄·alt-tab·탐색기에서 제일 자주 보이는 크기다.
     여기서 크기마다 직접 그리면 그 크기에 맞는 원도(작으면 T만)가 들어간다.

   ICO는 그림 여러 장을 담는 상자다. 헤더 6바이트 + 장마다 16바이트 목록 +
   그림 데이터. 큰 장은 PNG로, 작은 장은 BMP(DIB)로 넣는다 —
   윈도우는 둘 다 읽지만 작은 크기는 BMP 쪽이 호환이 넓다. */

/** ICO 안의 BMP 한 장. 위아래가 뒤집힌 BGRA + 1비트 마스크(우리는 알파를 쓰므로 전부 0). */
function dib(M) {
  const px = pixels(M)
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(M, 4)
  header.writeInt32LE(M * 2, 8) // XOR + AND 를 합친 높이
  header.writeUInt16LE(1, 12) // 평면
  header.writeUInt16LE(32, 14) // 비트수
  const xor = Buffer.alloc(M * M * 4)
  for (let y = 0; y < M; y++) {
    for (let x = 0; x < M; x++) {
      const s = (y * M + x) * 4
      const d = ((M - 1 - y) * M + x) * 4 // 아래에서 위로
      xor[d] = px[s + 2] // B
      xor[d + 1] = px[s + 1] // G
      xor[d + 2] = px[s] // R
      xor[d + 3] = px[s + 3] // A
    }
  }
  // AND 마스크: 줄마다 4바이트 경계로 맞춘다. 알파가 있으니 전부 0(불투명)이면 된다.
  const maskRow = Math.ceil(M / 32) * 4
  const mask = Buffer.alloc(maskRow * M)
  header.writeUInt32LE(xor.length + mask.length, 20)
  return Buffer.concat([header, xor, mask])
}

function ico(sizes) {
  const images = sizes.map((M) => ({
    M,
    // 128 이상은 PNG로 — 생 BMP로 넣으면 파일이 급격히 커진다(256px 한 장에 256KB).
    data: M >= 128 ? encode(M) : dib(M),
  }))
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0) // 예약
  head.writeUInt16LE(1, 2) // 1 = 아이콘
  head.writeUInt16LE(images.length, 4)

  let offset = 6 + images.length * 16
  const dir = Buffer.concat(
    images.map(({ M, data }) => {
      const e = Buffer.alloc(16)
      e[0] = M >= 256 ? 0 : M // 256은 0으로 적는다(1바이트라 안 들어간다)
      e[1] = M >= 256 ? 0 : M
      e.writeUInt16LE(1, 4) // 평면
      e.writeUInt16LE(32, 6) // 비트수
      e.writeUInt32LE(data.length, 8)
      e.writeUInt32LE(offset, 12)
      offset += data.length
      return e
    })
  )
  return Buffer.concat([head, dir, ...images.map((i) => i.data)])
}

mkdirSync('assets', { recursive: true })
mkdirSync('src-tauri/icons', { recursive: true })

// 앱 아이콘 원본 — 스토어·설치 화면처럼 크게 보는 자리.
write('assets/logo.png', N)

// tauri.conf.json의 bundle.icon 이 가리키는 파일들. 크기마다 직접 그린다.
write('src-tauri/icons/32x32.png', 32)
write('src-tauri/icons/128x128.png', 128)
write('src-tauri/icons/128x128@2x.png', 256)

/* ★ 트레이는 여기서 같이 굽는다.
   전에는 손으로 만들어 커밋해뒀다. 그래서 로고를 바꿔도 **트레이만 옛 로고로
   남았다.** 자동으로 만들어지지 않는 자산은 반드시 언젠가 뒤처진다. */
write('src-tauri/icons/tray.png', 32)

// exe에 박히는 아이콘. 윈도우가 자리마다 알아서 골라 쓴다.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const icoBuf = ico(ICO_SIZES)
writeFileSync('src-tauri/icons/icon.ico', icoBuf)
console.log(
  `src-tauri/icons/icon.ico · ${ICO_SIZES.join('·')} · ${(icoBuf.length / 1024).toFixed(1)}KB`
)
