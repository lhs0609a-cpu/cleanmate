export {}
const $ = (id: string) => document.getElementById(id)!
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!)
const names: Record<string,string> = { question:'질문과 도움', tip:'정리 팁', story:'정리 후기' }
interface Item { id:string; title:string; body:string; author:string; category:string; createdAt:string }
let category = '', offset = 0, replyOffset = 0, current: Item | null = null, reportId = '', composingReply = false, generation = 0
async function api(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(path, { method, headers: { ...(body ? { 'Content-Type':'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.error || '연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
  return data
}
const date = (iso: string) => new Date(iso).toLocaleDateString('ko-KR')
const meta = (item: Item) => `<div class="meta"><span>${esc(item.author)}</span><time>${esc(date(item.createdAt))}</time></div>`
async function load(append = false) {
  const request = ++generation
  $('status').textContent = '이야기를 불러오는 중…'
  ;($('write') as HTMLButtonElement).disabled = true
  if (!append) { offset = 0; $('posts').replaceChildren(); $('more').hidden = true }
  try {
    const data = await api(`/api/community?offset=${offset}&category=${encodeURIComponent(category)}`)
    if (request !== generation) return
    if (!append) $('posts').replaceChildren()
    for (const item of data.items as Item[]) {
      const button = document.createElement('button'); button.className = 'post'
      button.innerHTML = `<span class="category">${esc(names[item.category])}</span><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p>${meta(item)}`
      button.onclick = () => { location.hash = item.id }
      $('posts').append(button)
    }
    offset += data.items.length; $('more').hidden = !data.more
    if (!offset) $('posts').innerHTML = '<div class="empty"><h3>첫 이야기를 기다리고 있어요.</h3>궁금했던 정리 방법이나 직접 해본 경험을 남겨 주세요. 글은 운영자 확인 후 공개됩니다.</div>'
    $('status').textContent = ''
    ;($('write') as HTMLButtonElement).disabled = false
  } catch (e) { if (request === generation) $('status').textContent = (e as Error).message }
}
async function detail(id: string, append = false) {
  const request = ++generation
  try {
    if (!append) replyOffset = 0
    const data = await api(`/api/community?id=${encodeURIComponent(id)}&offset=${replyOffset}`)
    if (request !== generation) return
    current = data.item; $('feed').hidden = true; $('detail').hidden = false
    $('post-content').innerHTML = `<span class="category">${esc(names[data.item.category])}</span><h2>${esc(data.item.title)}</h2>${meta(data.item)}<p class="body-text">${esc(data.item.body)}</p>`
    if (!append) $('replies').replaceChildren()
    for (const reply of data.replies as Item[]) {
      const el = document.createElement('div'); el.className = 'reply'
      el.innerHTML = `${meta(reply)}<p class="body-text">${esc(reply.body)}</p>`
      const report = document.createElement('button'); report.className = 'quiet'; report.textContent = '신고'; report.onclick = () => openReport(reply.id)
      const remove = document.createElement('button'); remove.className = 'quiet'; remove.textContent = '내 댓글 삭제'; remove.onclick = () => openDelete(reply.id)
      el.append(report, remove); $('replies').append(el)
    }
    replyOffset += data.replies.length; $('more-replies').hidden = !data.more
    if (!replyOffset) $('replies').textContent = '아직 공개된 댓글이 없습니다. 경험을 나눠 주세요.'
  } catch (e) { $('feed').hidden = false; $('detail').hidden = true; $('status').textContent = (e as Error).message }
}
function navigate() {
  const id = location.hash.slice(1)
  if (/^[a-f0-9-]{36}$/.test(id)) void detail(id)
  else { ++generation; current = null; $('detail').hidden = true; $('feed').hidden = false; void load() }
}
window.addEventListener('hashchange', navigate)
$('back').onclick = () => { location.hash = '' }
$('refresh').onclick = () => void load()
$('more').onclick = async () => { ($('more') as HTMLButtonElement).disabled = true; await load(true); ($('more') as HTMLButtonElement).disabled = false }
$('more-replies').onclick = async () => { if (!current) return; ($('more-replies') as HTMLButtonElement).disabled = true; await detail(current.id, true); ($('more-replies') as HTMLButtonElement).disabled = false }
document.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(button => button.onclick = () => {
  category = button.dataset.category || ''; document.querySelectorAll('[data-category]').forEach(b => b.classList.toggle('selected', b === button)); void load()
})
const dialog = (id: string) => $(id) as HTMLDialogElement
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button => button.onclick = () => dialog(button.dataset.close!).close())
function compose(reply: boolean) {
  composingReply = reply; $('compose-title').textContent = reply ? '댓글 쓰기' : '정리 이야기 쓰기'
  $('post-fields').hidden = reply
  const title = document.querySelector<HTMLInputElement>('[name="title"]')!; title.required = !reply
  title.disabled = reply
  document.querySelector<HTMLSelectElement>('[name="category"]')!.disabled = reply
  dialog('composer').showModal()
}
$('write').onclick = () => compose(false); $('reply').onclick = () => compose(true)
$('receipt-close').onclick = () => { $('receipt').hidden = true }
function openDelete(id = '') { const form = $('delete-form') as HTMLFormElement; form.reset(); (form.elements.namedItem('id') as HTMLInputElement).value = id; form.querySelector('.form-status')!.textContent = ''; dialog('delete-dialog').showModal() }
function openReport(id: string) { reportId = id; $('report-form').querySelector('.form-status')!.textContent = ''; dialog('report-dialog').showModal() }
$('remove').onclick = () => current && openDelete(current.id)
$('report').onclick = () => current && openReport(current.id)
$('delete-pending').onclick = () => openDelete()
function submit(id: string, action: (data: FormData, form: HTMLFormElement) => Promise<void>) {
  $(id).addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget as HTMLFormElement
    const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!; if (button.disabled) return
    button.disabled = true; form.querySelector('.form-status')!.textContent = '처리 중…'
    try { await action(new FormData(form), form); form.querySelector('.form-status')!.textContent = '' }
    catch(e) { form.querySelector('.form-status')!.textContent = (e as Error).message }
    finally { button.disabled = false }
  })
}
submit('compose-form', async (data, form) => {
  const result = await api('/api/community', 'POST', { action:'create', author:data.get('author'), title:data.get('title'), category:data.get('category'), body:data.get('body'), password:data.get('password'), consent:data.get('consent') === 'on', website:data.get('website'), ...(composingReply ? { parent:current?.id } : {}) })
  dialog('composer').close(); form.reset(); $('receipt').hidden = false; ($('receipt-id') as HTMLInputElement).value = result.id; $('receipt').scrollIntoView({ behavior:'smooth', block:'center' })
})
submit('delete-form', async data => {
  await api('/api/community', 'DELETE', { id:data.get('id'), password:data.get('password') }); dialog('delete-dialog').close()
  if (current?.id === data.get('id')) location.hash = ''; else if (current) await detail(current.id); else await load()
})
submit('report-form', async data => { await api('/api/community', 'POST', { action:'report', id:reportId, reason:data.get('reason') }); dialog('report-dialog').close(); $('receipt').hidden = true; alert('신고를 접수했습니다. 운영자가 확인하겠습니다.') })
async function sponsor() {
  try {
    const { sponsor: ad } = await api('/api/community-ad'); if (!ad?.active) return
    const url = new URL(ad.url); if (url.protocol !== 'https:') return
    $('sponsor').hidden = false; $('sponsor').innerHTML = `<span class="ad-label">광고 · ${esc(ad.advertiser)}</span><h3>${esc(ad.title)}</h3><p>${esc(ad.description)}</p>`
    const a = document.createElement('a'); a.href = url.href; a.target = '_blank'; a.rel = 'sponsored noopener noreferrer'; a.textContent = '광고주 사이트 보기 ↗'; $('sponsor').append(a)
    const event = (type: string) => void api('/api/community-ad', 'POST', { id:ad.id, event:type }).catch(() => {})
    a.onclick = () => event('click')
    const io = new IntersectionObserver(entries => { if (!entries.some(e => e.isIntersecting)) return; io.disconnect(); try { if (sessionStorage.getItem(`tc-ad-${ad.id}`)) return; sessionStorage.setItem(`tc-ad-${ad.id}`, '1') } catch {} event('view') }, { threshold:.5 }); io.observe($('sponsor'))
  } catch { /* No campaign means no empty ad slot. */ }
}
navigate(); void sponsor()
