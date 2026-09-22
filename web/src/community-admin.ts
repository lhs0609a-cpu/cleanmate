type API = (path: string, init?: RequestInit) => Promise<any>
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!)
export function setupCommunityAdmin(api: API) {
  const host = document.getElementById('community-admin')!
  let filter = 'pending'
  async function loadQueue() {
    host.textContent = '검수할 글을 불러오는 중…'
    try {
      const data = await api(`/api/admin/community?status=${filter}`)
      host.replaceChildren()
      for (const item of data.items) {
        const card = document.createElement('div'); card.className = 'card'
        card.innerHTML = `<p>${item.type === 'reply' ? '댓글' : '게시글'} · ${esc(item.author)} · 신고 ${esc(item.reports || 0)}건 ${item.lastReport ? `(${esc(item.lastReport)})` : ''}</p><h3>${esc(item.title || '댓글 검수')}</h3><p style="white-space:pre-wrap;overflow-wrap:anywhere;margin:16px 0">${esc(item.body)}</p>${item.parent ? `<p>원글: ${esc(item.parent)}</p>` : ''}`
        for (const [status, label] of [['published', '공개 / 신고 검토 완료'], ['hidden', '숨김 처리']]) {
          const button = document.createElement('button'); button.className = 'btn btn-ghost'; button.style.marginRight = '8px'; button.textContent = label
          button.onclick = async () => { button.disabled = true; try { await api('/api/admin/community', { method:'PATCH', body:JSON.stringify({ id:item.id, status }) }); await loadQueue() } catch(e) { button.disabled = false; alert((e as Error).message) } }
          card.append(button)
        }
        host.append(card)
      }
      if (!data.items.length) host.textContent = '검수할 글이 없습니다.'
    } catch(e) { host.textContent = (e as Error).message }
  }
  document.querySelectorAll<HTMLButtonElement>('[data-community-status]').forEach(button => button.onclick = () => {
    filter = button.dataset.communityStatus!; document.querySelectorAll('[data-community-status]').forEach(b => b.classList.toggle('on', b === button)); void loadQueue()
  })
  const form = document.getElementById('sponsor-form') as HTMLFormElement
  const message = document.getElementById('sponsor-status')!
  async function loadAd() {
    try {
      const data = await api('/api/community-ad?admin=1')
      for (const name of ['advertiser', 'title', 'description', 'url']) (form.elements.namedItem(name) as HTMLInputElement).value = data.sponsor?.[name] || ''
      ;(form.elements.namedItem('active') as HTMLInputElement).checked = !!data.sponsor?.active
      message.textContent = `현재 광고의 집계 요청: 노출 ${data.metrics.views}회 · 클릭 ${data.metrics.clicks}회. 참고용 집계이며 고유 방문자·청구 근거·매출이 아닙니다.`
    } catch(e) { message.textContent = (e as Error).message }
  }
  form.onsubmit = async event => {
    event.preventDefault(); const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!; button.disabled = true
    const data = new FormData(form)
    try {
      await api('/api/community-ad', { method:'PUT', body:JSON.stringify({ active:data.get('active') === 'on', advertiser:data.get('advertiser'), title:data.get('title'), description:data.get('description'), url:data.get('url') }) })
      await loadAd(); message.textContent = '저장했습니다. 변경한 광고는 새 집계로 시작합니다. ' + message.textContent
    } catch(e) { message.textContent = (e as Error).message }
    finally { button.disabled = false }
  }
  return () => { void loadQueue(); void loadAd() }
}
