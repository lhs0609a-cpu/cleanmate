/**
 * 버전 일치 테스트 — 무한 재설치를 막는 안전장치
 *
 * ★ 왜 이게 필요한가:
 *   앱은 자기 버전(app.ts의 APP_VERSION)과 릴리스의 최신 버전을 비교해서
 *   업데이트를 띄운다. 릴리스는 v0.5.0인데 APP_VERSION만 0.4.0으로 남아 있으면,
 *   0.5.0을 설치한 사용자가 켤 때마다 "0.5.0으로 업데이트하시겠어요?"를 보고
 *   설치하고 재시작하고 다시 묻는 무한 재설치에 빠진다.
 *   updater.ts의 "같은 버전이면 재설치하지 않는다" 방어선은 이 값이 맞을 때만 작동한다.
 *
 * 설치파일 버전은 CI가 git 태그에서 뽑으므로(release.yml의 steps.ver),
 * 태그와 이 값들도 같아야 한다. 그건 릴리스 체크리스트에 있다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const SEMVER = /^\d+\.\d+\.\d+$/

function appVersion(): string {
  const m = read('web/src/app.ts').match(/const APP_VERSION = '([^']+)'/)
  assert.ok(m, "app.ts에서 APP_VERSION을 찾지 못했다 — 이름이 바뀌었으면 이 테스트도 고쳐야 한다")
  return m![1]
}

function tauriVersion(): string {
  return JSON.parse(read('src-tauri/tauri.conf.json')).version
}

function cargoVersion(): string {
  // [package] 블록의 첫 version 만 본다. 의존성 버전이 아니다.
  const m = read('src-tauri/Cargo.toml').match(/\[package\][\s\S]*?\nversion = "([^"]+)"/)
  assert.ok(m, 'Cargo.toml에서 package version을 찾지 못했다')
  return m![1]
}

test('★ 앱·Tauri·Cargo 버전이 모두 같다 — 어긋나면 무한 재설치가 난다', () => {
  const app = appVersion()
  const tauri = tauriVersion()
  const cargo = cargoVersion()

  assert.equal(app, tauri, `app.ts(${app})와 tauri.conf.json(${tauri})이 다르다`)
  assert.equal(app, cargo, `app.ts(${app})와 Cargo.toml(${cargo})이 다르다`)
})

test('버전 형식이 semver다 — CI가 태그에서 뽑은 값과 비교된다', () => {
  for (const [name, v] of [
    ['app.ts', appVersion()],
    ['tauri.conf.json', tauriVersion()],
    ['Cargo.toml', cargoVersion()],
  ] as const) {
    assert.match(v, SEMVER, `${name}의 버전 형식이 이상하다: ${v}`)
  }
})
