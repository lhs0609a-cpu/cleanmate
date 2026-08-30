/**
 * 관리자 화면 — 들어온 문의와 설치·사용 통계
 *
 * ★ 이 화면이 지키는 것 (서버 쪽 원칙과 짝이다 — api/admin/stats.js 참고)
 *   1) **모르는 건 모른다고 쓴다.** 내려받았지만 설치 안 한 사람은 절대 못 센다.
 *      그 칸을 추정치로 채우면 대시보드 전체가 추측이 된다.
 *   2) **숫자마다 출처를 붙인다.** 몇 주 지나면 자기가 만든 숫자에 자기가 속는다.
 *   3) 저장소가 안 붙어 있으면 0을 보여주는 대신 **왜 안 되는지**를 쓴다.
 *      "설치 0명"과 "아직 안 세고 있음"은 완전히 다른 사실이다.
 *
 * ★ 왜 프레임워크가 없나
 *   화면이 둘이고 상태가 셋이다. 이 규모에 런타임을 얹으면 번들이 열 배가 되고,
 *   이 저장소의 다른 코드(엔진·앱)와 다른 방식이 하나 더 생긴다.
 */

export {} // 모듈로 취급되게

const $ = (id: string) => document.getElementById(id)
const esc = (s: string) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/* ── 서버 부르기 ───────────────────────────────────────────────
   401이 오면 세션이 끝난 것이다. 그때 화면을 그대로 두면 사용자는 빈 목록을
   보고 "문의가 하나도 없구나"라고 잘못 읽는다. 그래서 로그인 화면으로 되돌린다. */
async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  if (res.status === 401) {
    showGate('세션이 끝났습니다. 다시 로그인해 주세요.')
    throw new Error('로그인이 필요합니다.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.error ?? `서버가 ${res.status}로 답했습니다.`)
  return data
}

/* ── 로그인 ────────────────────────────────────────────────── */

function showGate(message = '') {
  $('gate')!.hidden = false
  $('app')!.hidden = true
  $('login-err')!.textContent = message
}

function showApp() {
  $('gate')!.hidden = true
  $('app')!.hidden = false
  loadAll()
}

$('login-form')!.addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const btn = $('login-btn') as HTMLButtonElement
  const pw = ($('pw') as HTMLInputElement).value
  const err = $('login-err')!
  btn.disabled = true
  btn.textContent = '확인 중…'
  err.textContent = ''
  try {
    await api('/api/admin/session', { method: 'POST', body: JSON.stringify({ password: pw }) })
    ;($('pw') as HTMLInputElement).value = ''
    showApp()
  } catch (e) {
    err.textContent = (e as Error).message
  } finally {
    btn.disabled = false
    btn.textContent = '들어가기'
  }
})

$('logout')!.addEventListener('click', async () => {
  try { await fetch('/api/admin/session', { method: 'DELETE' }) } catch { /* 쿠키만 못 지운 것 */ }
  showGate()
})

/* ── 탭 ────────────────────────────────────────────────────── */
document.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-go]').forEach((b) => b.classList.remove('on'))
    btn.classList.add('on')
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'))
    $(`s-${btn.dataset.go}`)!.classList.add('on')
  })
})

$('refresh')!.addEventListener('click', () => loadAll())

/* ── 대시보드 ──────────────────────────────────────────────── */

const nf = new Intl.NumberFormat('ko-KR')
const num = (n: number) => nf.format(n)

/** 값을 모를 때의 칸. 0으로 채우지 않는다 — 0은 "아무도 없다"는 뜻이다. */
function kpi(cls: string, value: string, label: string, source: string, unknown = false) {
  return `<div class="kpi ${cls}">
    <div class="n${unknown ? ' unknown' : ''}">${esc(value)}</div>
    <div class="l">${esc(label)}</div>
    <div class="src">${source}</div>
  </div>`
}

/**
 * 막대 차트. 30개짜리 하나 그리자고 라이브러리를 넣지 않는다.
 * 최댓값이 0이면(기록이 없으면) 막대를 다 0으로 그리는 대신 안내를 보여준다 —
 * 바닥에 붙은 회색 막대 서른 개는 "고장난 화면"으로 읽힌다.
 */
function chart(series: { date: string; count: number }[]) {
  const max = Math.max(...series.map((d) => d.count), 0)
  if (!max) return `<div class="chart-empty">아직 기록이 없습니다.</div>`
  const bars = series
    .map((d) => {
      const h = Math.round((d.count / max) * 100)
      return `<span class="b${d.count ? '' : ' zero'}" title="${esc(d.date)} · ${num(d.count)}">
        <i style="--h:${d.count ? Math.max(h, 3) : 0}%"></i></span>`
    })
    .join('')
  return `<div class="chart">${bars}</div>
    <div class="chart-x"><span>${esc(series[0].date)}</span>
      <span>최대 ${num(max)}</span>
      <span>${esc(series[series.length - 1].date)}</span></div>`
}

function dist(rows: { name: string; count: number }[], emptyText: string) {
  if (!rows.length) return `<div class="chart-empty">${esc(emptyText)}</div>`
  const max = Math.max(...rows.map((r) => r.count), 1)
  return `<div class="dist">${rows
    .map(
      (r) => `<div class="drow">
        <span class="nm">${esc(r.name)}</span>
        <span class="tr"><i style="--w:${Math.round((r.count / max) * 100)}%"></i></span>
        <span class="v">${num(r.count)}</span>
      </div>`
    )
    .join('')}</div>`
}

async function loadDash() {
  const host = $('dash-body')!
  try {
    const d = await api('/api/admin/stats')
    const dl = d.downloads?.total ?? null
    const store = d.storeConnected === true

    /* 저장소가 안 붙어 있으면 통계 칸을 0으로 채우지 않는다.
       "설치 0명"과 "아직 안 세고 있음"은 완전히 다른 사실이고,
       전자를 보면 사람이 잘못된 결정을 한다. */
    const kpis = [
      kpi('k-dl', dl === null ? '못 읽음' : num(dl), '내려받은 횟수',
        dl === null
          ? 'GitHub 릴리스 API를 못 읽었습니다 — 한도 초과이거나 잠시 막힌 것'
          : 'GitHub 릴리스 자산의 download_count · 실측 (10분 캐시)',
        dl === null),
      kpi('k-inst', store ? num(d.installsTotal) : '안 세는 중', '설치된 기기',
        store
          ? '앱이 보낸 익명 신호의 고유 수 · 실측'
          : '저장소가 연결돼 있지 않습니다',
        !store),
      kpi('k-act', store ? num(d.activeToday) : '—', '오늘 켠 기기',
        store ? `이번 달은 ${num(d.activeMonth)}대` : '저장소 연결 필요', !store),
      kpi('k-inq', store ? num(d.inquiriesTotal) : '—', '들어온 문의',
        store ? '상담 폼으로 접수된 전체' : '저장소 연결 필요', !store),
      kpi('k-none', '못 잼', '받고 설치 안 한 사람',
        '설치를 안 하면 신호가 없습니다. 이 칸은 추정하지 않습니다.', true),
    ].join('')

    const gap = dl !== null && store && dl > 0
      ? `<div class="note"><b>내려받은 ${num(dl)}회 → 설치된 ${num(d.installsTotal)}대.</b>
           두 숫자는 세는 곳이 달라 그대로 나눠 비율로 읽으면 안 됩니다 —
           같은 사람이 두 번 받기도 하고, 익명 통계를 끈 기기는 설치 쪽에 안 잡힙니다.
           <b>추세</b>로 보세요: 내려받기가 느는데 설치가 안 늘면 설치 단계에서 막히는 것이고,
           그건 대개 "Windows의 PC 보호" 경고입니다.</div>`
      : ''

    const storeWarn = store
      ? ''
      : `<div class="err-box"><b>저장소가 연결돼 있지 않습니다.</b><br>
           Vercel 프로젝트 → Storage에서 Upstash Redis를 연결하면
           <code>UPSTASH_REDIS_REST_URL</code>·<code>UPSTASH_REDIS_REST_TOKEN</code>이
           자동으로 들어옵니다. 그전까지는 문의 접수와 설치 집계가 동작하지 않습니다.</div>`

    const versions = (d.byVersion ?? []).map((v: any) => ({ name: `v${v.version}`, count: v.count }))
    const oses = (d.byOs ?? []).map((o: any) => ({ name: o.os, count: o.count }))
    const releases = (d.downloads?.releases ?? []).slice(0, 8)
      .map((r: any) => ({ name: `v${r.version}`, count: r.total }))

    host.innerHTML = `
      ${storeWarn}
      <div class="kpis">${kpis}</div>
      ${gap}

      <div class="card">
        <div class="sechead"><h2>최근 30일 · 켠 기기 수</h2>
          <p class="why">하루에 한 번 오는 익명 신호를 고유 개수로 셉니다. 같은 기기를 두 번 세지 않아요.</p></div>
        ${store ? chart(d.active ?? []) : '<div class="chart-empty">저장소가 연결되면 여기에 그려집니다.</div>'}
      </div>

      <div class="card">
        <div class="sechead"><h2>최근 30일 · 처음 켠 기기</h2>
          <p class="why">그날 처음 신호를 보낸 기기 수 — 새 설치에 가장 가까운 숫자입니다.</p></div>
        ${store ? chart(d.fresh ?? []) : '<div class="chart-empty">저장소가 연결되면 여기에 그려집니다.</div>'}
      </div>

      <div class="split">
        <div class="card">
          <div class="sechead"><h2>버전 분포</h2></div>
          ${dist(versions, store ? '아직 신호가 없습니다.' : '저장소 연결 필요')}
          <div class="note" style="font-size:var(--t-xs)">낡은 버전이 많이 남아 있으면
            업데이트가 안 도달하고 있다는 뜻입니다.</div>
        </div>
        <div class="card">
          <div class="sechead"><h2>운영체제</h2></div>
          ${dist(oses, store ? '아직 신호가 없습니다.' : '저장소 연결 필요')}
        </div>
      </div>

      <div class="card">
        <div class="sechead"><h2>릴리스별 내려받기</h2>
          <p class="why">GitHub이 세어 준 값입니다 · 최신 8개</p></div>
        ${dist(releases, 'GitHub 릴리스를 못 읽었습니다.')}
      </div>

      <div class="card">
        <div class="sechead"><h2>최근 30일 · 들어온 문의</h2></div>
        ${store ? chart(d.inquiries ?? []) : '<div class="chart-empty">저장소가 연결되면 여기에 그려집니다.</div>'}
      </div>

      <p class="src" style="color:var(--faint);font-size:var(--t-2xs);text-align:right">
        ${esc(new Date(d.at).toLocaleString('ko-KR'))} 기준</p>`
  } catch (e) {
    host.innerHTML = `<div class="err-box">통계를 불러오지 못했습니다: ${esc((e as Error).message)}</div>`
  }
}

/* ── 문의 ──────────────────────────────────────────────────── */

const KIND_LABEL: Record<string, string> = {
  partner: '업체 제휴',
  service: '서비스 문의',
  bug: '버그 신고',
  etc: '그 외',
}
const STATUS_LABEL: Record<string, string> = { new: '새 문의', doing: '처리 중', done: '완료' }

let inqFilter = ''

/** 연락처가 이메일이면 mailto:, 전화처럼 보이면 tel: 로 건다. */
function contactLink(v: string): string {
  const s = v.trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `<a href="mailto:${esc(s)}">${esc(s)}</a>`
  if (/^[0-9+\-() .]{7,}$/.test(s)) return `<a href="tel:${esc(s.replace(/[^0-9+]/g, ''))}">${esc(s)}</a>`
  return esc(s)
}

function inqCard(it: any): string {
  const status = STATUS_LABEL[it.status] ? it.status : 'new'
  const at = new Date(it.at)
  return `<div class="inq ${esc(status)}" data-id="${esc(it.id)}">
    <div class="inq-h">
      <span class="who">${esc(it.name)}</span>
      ${it.company ? `<span class="co">${esc(it.company)}</span>` : ''}
      <span class="kind ${esc(it.kind)}">${esc(KIND_LABEL[it.kind] ?? '그 외')}</span>
      <span class="at">${esc(at.toLocaleString('ko-KR'))}</span>
    </div>
    <div class="contact">${contactLink(it.contact ?? '')}</div>
    <div class="body">${esc(it.message ?? '')}</div>
    ${it.from ? `<div class="from">들어온 자리: ${esc(it.from)}</div>` : ''}
    <div class="inq-foot">
      ${(['new', 'doing', 'done'] as const)
        .map((s) => `<button class="btn ${s === status ? 'btn-pri' : 'btn-ghost'} btn-sm"
              data-status-set="${s}"${s === status ? ' disabled' : ''}>${STATUS_LABEL[s]}</button>`)
        .join('')}
      <input class="memo" data-memo placeholder="메모 (나만 봅니다)" value="${esc(it.note ?? '')}" maxlength="2000" />
      <span class="saved" data-saved></span>
    </div>
  </div>`
}

async function loadInq() {
  const host = $('inq-body')!
  try {
    const q = inqFilter ? `?status=${encodeURIComponent(inqFilter)}&limit=100` : '?limit=100'
    const d = await api(`/api/admin/inquiries${q}`)
    const badge = $('inq-badge')
    // 배지는 '아직 안 본 것'만 센다. 전체 개수를 띄우면 영원히 빨간 점이 남는다.
    const newCount = (d.items ?? []).filter((i: any) => (i.status || 'new') === 'new').length
    if (badge) badge.textContent = inqFilter === '' && newCount ? `· ${newCount}` : ''
    $('inq-count')!.textContent = `전체 ${num(d.total ?? 0)}건`

    host.innerHTML = d.items?.length
      ? `<div class="card">${d.items.map(inqCard).join('')}</div>`
      : `<div class="card"><div class="empty">${
          inqFilter ? '이 상태인 문의가 없습니다.' : '아직 들어온 문의가 없습니다.'
        }</div></div>`

    wireInqActions()
  } catch (e) {
    host.innerHTML = `<div class="err-box">문의를 불러오지 못했습니다: ${esc((e as Error).message)}</div>`
  }
}

function wireInqActions() {
  document.querySelectorAll<HTMLButtonElement>('[data-status-set]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest<HTMLElement>('.inq')!
      const id = card.dataset.id!
      card.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true))
      try {
        await api('/api/admin/inquiries', {
          method: 'PATCH',
          body: JSON.stringify({ id, status: btn.dataset.statusSet }),
        })
        loadInq()
      } catch (e) {
        alert((e as Error).message)
        card.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = false))
      }
    })
  })

  /* 메모는 '저장' 버튼 없이 포커스를 뗄 때 저장한다. 버튼을 두면 안 누르고
     나가는 사람이 생기고, 그러면 적은 메모가 사라진다. */
  document.querySelectorAll<HTMLInputElement>('[data-memo]').forEach((input) => {
    let last = input.value
    input.addEventListener('blur', async () => {
      if (input.value === last) return
      const card = input.closest<HTMLElement>('.inq')!
      const saved = card.querySelector<HTMLElement>('[data-saved]')!
      try {
        await api('/api/admin/inquiries', {
          method: 'PATCH',
          body: JSON.stringify({ id: card.dataset.id, note: input.value }),
        })
        last = input.value
        saved.textContent = '저장됨'
        setTimeout(() => (saved.textContent = ''), 1800)
      } catch (e) {
        saved.style.color = 'var(--lock)'
        saved.textContent = (e as Error).message
      }
    })
  })
}

$('inq-filters')!.addEventListener('click', (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-status]')
  if (!btn) return
  inqFilter = btn.dataset.status ?? ''
  $('inq-filters')!.querySelectorAll('button').forEach((b) => b.classList.remove('on'))
  btn.classList.add('on')
  loadInq()
})

function loadAll() {
  loadDash()
  loadInq()
}

/* ── 시작 ──────────────────────────────────────────────────────
   이미 쿠키가 살아 있으면 로그인 화면을 건너뛴다. 매번 비밀번호를 묻는
   화면은 하루에 몇 번 여는 도구에서 그냥 마찰이다. */
async function boot() {
  try {
    const res = await fetch('/api/admin/session', { headers: { Accept: 'application/json' } })
    const d = await res.json().catch(() => null)
    if (d?.admin) return showApp()
  } catch {
    /* 서버 함수가 아직 없다(정적 미리보기). 로그인 화면을 그대로 보여준다. */
  }
  showGate()
}

boot()
