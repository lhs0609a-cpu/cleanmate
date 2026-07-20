/**
 * 임시 로고 생성기 — 의존성 0 (Node 내장 zlib만)
 *
 * 왜 손으로 PNG를 굽나: 이 환경엔 이미지 도구가 없고 드라이브 폴더는
 * npm install이 안 된다. 그래서 zlib + Buffer만으로 PNG를 직접 인코딩한다.
 *
 * 디자인(임시): 브랜드 청록(#0B6F76) 라운드 사각 타일 + 흰 체크마크.
 * "안전하게 정리했다"는 확인의 의미. 나중에 진짜 로고로 교체한다.
 *
 * 출력: assets/logo.png (1024×1024 RGBA). CI가 `tauri icon`으로 전 크기 생성.
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const N = 1024
const SS = 2 // 슈퍼샘플링(안티에일리어싱)

// ── 색 ──
const TEAL_TOP = [14, 138, 147]
const TEAL_BOT = [8, 96, 103]
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

// 체크마크 두 획 (중심 원점)
const CHK = [
  [-165, 20, -45, 150], // 짧은 획 (내려긋기)
  [-45, 150, 200, -150], // 긴 획 (올려긋기)
]
const STROKE = 46 // 획 반두께

function sample(x, y) {
  // 배경 투명
  let r = 0, g = 0, b = 0, a = 0

  // 타일 (라운드 사각)
  const dTile = roundedBox(x, y, 400, 400, 190)
  const tileCov = cov(dTile)
  if (tileCov > 0) {
    const t = clamp01((y + 512) / 1024) // 위→아래 그라디언트
    const tr = TEAL_TOP[0] * (1 - t) + TEAL_BOT[0] * t
    const tg = TEAL_TOP[1] * (1 - t) + TEAL_BOT[1] * t
    const tb = TEAL_TOP[2] * (1 - t) + TEAL_BOT[2] * t
    ;[r, g, b, a] = over(tr, tg, tb, tileCov, r, g, b, a)
  }

  // 체크마크
  let dChk = Infinity
  for (const [ax, ay, bx, by] of CHK) dChk = Math.min(dChk, segment(x, y, ax, ay, bx, by))
  const chkCov = cov(dChk - STROKE)
  if (chkCov > 0) [r, g, b, a] = over(WHITE[0], WHITE[1], WHITE[2], chkCov, r, g, b, a)

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

// ── 렌더 (슈퍼샘플) ──
const raw = Buffer.alloc(N * (1 + N * 4))
for (let py = 0; py < N; py++) {
  raw[py * (1 + N * 4)] = 0 // 필터 바이트
  for (let px = 0; px < N; px++) {
    let R = 0, G = 0, B = 0, A = 0
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const x = px + (sx + 0.5) / SS - N / 2
        const y = py + (sy + 0.5) / SS - N / 2
        const [r, g, b, a] = sample(x, y)
        R += r * a; G += g * a; B += b * a; A += a
      }
    const n = SS * SS
    const a = A / n
    const o = py * (1 + N * 4) + 1 + px * 4
    raw[o] = a > 0 ? Math.round(R / A) : 0
    raw[o + 1] = a > 0 ? Math.round(G / A) : 0
    raw[o + 2] = a > 0 ? Math.round(B / A) : 0
    raw[o + 3] = Math.round(a * 255)
  }
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
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0)
ihdr.writeUInt32BE(N, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
const idat = deflateSync(raw, { level: 9 })
const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync('assets', { recursive: true })
writeFileSync('assets/logo.png', png)
console.log(`assets/logo.png 생성됨 · ${N}×${N} · ${(png.length / 1024).toFixed(1)}KB`)
