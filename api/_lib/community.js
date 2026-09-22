import { createHash, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { cmd } from './store.js'
import { clientIp } from './http.js'

export const CATEGORIES = ['question', 'tip', 'story']
export const validId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
export const key = id => `community:item:${id}`
export const publicIndex = item => item.type === 'post' ? 'community:posts' : `community:replies:${item.parent}`
export function publicItem(item) {
  const { id, type, parent, category, title, body, author, createdAt } = item
  return { id, type, parent, category, title, body, author, createdAt }
}
export async function getItem(id) {
  if (!validId(id)) return null
  const raw = await cmd('GET', key(id))
  return raw ? JSON.parse(raw) : null
}
export async function readItems(index, offset = 0, limit = 20) {
  const ids = await cmd('ZREVRANGE', index, offset, offset + limit - 1) ?? []
  if (!ids.length) return []
  const raw = await cmd('MGET', ...ids.map(key))
  return raw.filter(Boolean).map(value => JSON.parse(value))
}
// Fail closed for posting/reporting if rate-limit storage is unavailable.
export async function withinLimit(req, bucket, maximum = 5, seconds = 600) {
  const who = createHash('sha256').update(`${process.env.ADMIN_SESSION_SECRET || 'community'}:${clientIp(req)}`).digest('hex')
  const count = await cmd('EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", 1,
    `community:limit:${bucket}:${who}:${Math.floor(Date.now() / (seconds * 1000))}`, seconds)
  return Number(count) <= maximum
}
export function makeItem(input) {
  const salt = randomUUID()
  return { id: randomUUID(), type: input.parent ? 'reply' : 'post', parent: input.parent || null,
    category: input.category, title: input.title || '', body: input.body, author: input.author,
    createdAt: new Date().toISOString(), status: 'pending', reports: 0, salt,
    passwordHash: scryptSync(input.password, salt, 32).toString('hex') }
}
export function owns(item, password) {
  return typeof password === 'string' && password.length <= 128 &&
    timingSafeEqual(scryptSync(password, item.salt, 32), Buffer.from(item.passwordHash, 'hex'))
}
export async function insert(item) {
  await cmd('EVAL', "redis.call('SET',KEYS[1],ARGV[1]); redis.call('ZADD',KEYS[2],ARGV[2],ARGV[3]); return 1", 2,
    key(item.id), 'community:pending', JSON.stringify(item), Date.now(), item.id)
}
// Modify the current record atomically; never replace concurrent reports or resurrect deleted text.
export async function transition(item, status) {
  return Number(await cmd('EVAL', `
    local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
    local item=cjson.decode(raw); if item.status=='deleted' then return 0 end
    if ARGV[1]=='published' and item.type=='reply' then
      local parent=redis.call('GET',KEYS[5]); if not parent or cjson.decode(parent).status~='published' then return -1 end
    end
    item.status=ARGV[1]; item.updatedAt=ARGV[2]
    if ARGV[1]=='deleted' then item.body=''; item.title=''; item.author='삭제한 사용자' end
    redis.call('SET',KEYS[1],cjson.encode(item)); redis.call('ZREM',KEYS[2],item.id); redis.call('ZREM',KEYS[3],item.id)
    if ARGV[1]=='published' then redis.call('ZADD',KEYS[4],ARGV[3],item.id) else redis.call('ZREM',KEYS[4],item.id) end
    if item.type=='post' then
      if ARGV[1]=='published' then redis.call('ZADD',KEYS[6],ARGV[3],item.id) else redis.call('ZREM',KEYS[6],item.id) end
    end
    return 1`, 6, key(item.id), 'community:pending', 'community:reported', publicIndex(item), key(item.parent || item.id), `community:posts:${item.category}`,
    status, new Date().toISOString(), Date.parse(item.createdAt)))
}
