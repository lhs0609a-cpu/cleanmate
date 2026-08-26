/**
 * 스캔 중단 테스트 — 멈출 수 있어야 기다릴 수 있다
 *
 * ★ 이 파일이 생긴 이유:
 *   실측에서 AppData 38만 개에 133초가 걸린다. 그런데 스캐너에는 취소 신호를
 *   받을 자리 자체가 없었다. 사용자가 할 수 있는 일은 작업관리자로 죽이는
 *   것뿐이었고, 그렇게 죽인 사람은 다시 안 연다.
 *
 *   중단은 실패가 아니다. 그래서 여기서 잠그는 계약은 셋이다 —
 *   ① 정말 멈춘다  ② 여태 모은 건 그대로 돌려준다  ③ 왜 멈췄는지 말한다.
 *   ②가 없으면 취소가 벌이 된다(눌렀더니 빈 화면). ③이 없으면 화면이
 *   "시간이 모자랐어요"와 "멈추셨네요"를 구분 못 한다 — 전자는 사과할 일이고
 *   후자는 사용자가 시킨 일이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scan } from './scanner.ts'

async function sandbox(dirs: number, filesPerDir: number) {
  const base = await mkdtemp(join(tmpdir(), 'teraclean-scan-'))
  for (let d = 0; d < dirs; d++) {
    const dir = join(base, `d${d}`)
    await mkdir(dir, { recursive: true })
    for (let f = 0; f < filesPerDir; f++) {
      await writeFile(join(dir, `f${f}.tmp`), 'x')
    }
  }
  return { base, cleanup: () => rm(base, { recursive: true, force: true }) }
}

test('중단 신호를 미리 켜두면 아무것도 안 훑는다', async () => {
  const s = await sandbox(3, 5)
  try {
    const ac = new AbortController()
    ac.abort()

    const r = await scan(s.base, { signal: ac.signal })

    assert.equal(r.files.length, 0, '이미 세운 스캔이 파일을 훑었다')
    assert.equal(r.truncated, true, '덜 훑었다는 사실을 안 알린다')
    assert.equal(r.stoppedBy, 'cancel', '사용자가 세운 것으로 안 적혔다')
  } finally {
    await s.cleanup()
  }
})

test('훑는 도중에 세우면 여태 모은 건 그대로 돌아온다', async () => {
  // 폴더를 여러 개 두고, 첫 폴더를 본 순간 세운다.
  const s = await sandbox(6, 40)
  try {
    const ac = new AbortController()

    const r = await scan(s.base, {
      signal: ac.signal,
      // 첫 폴더(40개)를 다 세고 나오는 순간 세운다. 남은 다섯 폴더는 안 훑는다.
      onProgress: (count) => { if (count >= 40) ac.abort() },
    })

    assert.equal(r.truncated, true, '중단인데 전부 훑은 척한다')
    assert.equal(r.stoppedBy, 'cancel')
    assert.ok(r.files.length > 0, '★ 중단이 빈 화면이 되면 취소가 벌이 된다')
    assert.ok(r.files.length < 6 * 40, '세웠는데 끝까지 훑었다')
    // 모은 것과 합계가 어긋나면 화면 숫자가 거짓말이 된다.
    assert.equal(
      r.totalBytes,
      r.files.reduce((n, f) => n + f.size, 0),
      '중단 시점의 합계가 목록과 안 맞는다'
    )
  } finally {
    await s.cleanup()
  }
})

test('한 폴더에 파일이 몰려 있어도 그 안에서 멈춘다', async () => {
  // ★ 실물의 모양이다. AppData는 폴더 하나에 수만 개가 든 자리가 있어서,
  //   폴더 진입 지점에서만 신호를 보면 누른 지 한참 뒤에야 멈춘다.
  //
  //   그래서 **폴더에 들어간 직후**에 세운다. 진입 검사는 이미 통과한 뒤라,
  //   여기서 멈추는 길은 항목 순회 안의 검사밖에 없다.
  const s = await sandbox(1, 300)
  try {
    const ac = new AbortController()
    let seen = 0

    const r = await scan(s.base, {
      signal: ac.signal,
      onProgress: () => {
        seen++
        if (seen === 2) ac.abort() // 1=바깥 폴더 진입, 2=d0 진입
      },
    })

    assert.equal(r.stoppedBy, 'cancel')
    assert.equal(r.files.length, 0, `폴더 안에서 안 멈추고 계속 세고 있다 (${r.files.length}개)`)
  } finally {
    await s.cleanup()
  }
})

test('안 세우면 평소대로 다 훑고, 멈춘 이유는 비어 있다', async () => {
  const s = await sandbox(3, 10)
  try {
    const ac = new AbortController()
    const r = await scan(s.base, { signal: ac.signal })

    assert.equal(r.files.length, 30)
    assert.equal(r.truncated, false)
    assert.equal(r.stoppedBy, undefined, '멀쩡히 끝났는데 멈춘 이유가 붙었다')
  } finally {
    await s.cleanup()
  }
})

test('마감시간으로 멈춘 것과 사용자가 세운 것을 구분한다', async () => {
  const s = await sandbox(2, 5)
  try {
    const r = await scan(s.base, { deadlineMs: Date.now() - 1 })

    assert.equal(r.truncated, true)
    assert.equal(r.stoppedBy, 'deadline', '시간이 모자란 것을 취소로 적으면 사용자를 탓하는 셈이다')
  } finally {
    await s.cleanup()
  }
})
