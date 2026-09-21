import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'

let sequence = 0
async function tabs() {
  globalThis.indexedDB = new IDBFactory()
  const storage = new Map()
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  const id = ++sequence
  const a = await import(`../js/db.js?test=${id}a`)
  const b = await import(`../js/db.js?test=${id}b`)
  await a.putConversation({ id: 1, title: 'original', messages: [{ id: 'r1', prompt: 'first', images: [] }] })
  return { a, b, av: await a.listConversations(), bv: await b.listConversations(), storage }
}

test('stale tabs cannot erase new conversations, images or newer API keys', async () => {
  const { a, b, av, bv } = await tabs()
  await a.setSetting('S', { profiles: [{ id: 'p1', key: 'old' }], darkMode: false })
  const sa = await a.getSetting('S'), sb = await b.getSetting('S')
  const image = await a.saveImageBlob(new Blob(['image']))
  av.push({ id: 2, title: 'new in A', messages: [{ prompt: 'new', images: [image] }] })
  await a.syncConversations(av)
  sa.profiles[0].key = 'new-key'
  await a.setSetting('S', sa)
  await b.syncConversations(bv)
  await b.setSetting('S', sb)
  assert.equal((await a.getConversation(2)).title, 'new in A')
  assert.equal(await (await a.getImage(image)).blob.text(), 'image')
  assert.equal((await a.getSetting('S')).profiles[0].key, 'new-key')
})

test('different fields and concurrent new rounds merge under the database lock', async () => {
  const { a, b, av, bv } = await tabs()
  av[0].title = 'renamed'
  av[0].messages.push({ prompt: 'from A', text: 'answer A' })
  bv[0].pinned = true
  bv[0].messages.push({ prompt: 'from B', text: 'answer B' })
  await Promise.all([a.syncConversations(av), b.syncConversations(bv)])
  const result = await a.getConversation(1)
  assert.equal(result.title, 'renamed')
  assert.equal(result.pinned, true)
  assert.deepEqual(result.messages.map((m) => m.prompt), ['first', 'from A', 'from B'])
  assert.equal(result._revision, 2)
})

test('same-field conflicts abort rather than overwrite a newer saved edit', async () => {
  const { a, b, av, bv } = await tabs()
  av[0].title = 'from A'
  bv[0].title = 'from B'
  await a.syncConversations(av)
  await assert.rejects(b.syncConversations(bv), { name: 'StorageConflictError' })
  assert.equal((await a.getConversation(1)).title, 'from A')
  assert.equal(bv[0].title, 'from B')
})

test('deleted conversations stay deleted; pending and shared images survive cleanup', async () => {
  const { a, b, av, bv } = await tabs()
  const shared = await a.saveImageBlob(new Blob(['shared']))
  const pending = await a.saveImageBlob(new Blob(['not committed yet']))
  av[0].messages[0].images = [shared]
  av.push({ id: 2, title: 'also uses image', messages: [{ prompt: 'second', images: [shared] }] })
  await a.syncConversations(av)
  av.splice(0, 1)
  await a.syncConversations(av)
  bv[0].title = 'late stale edit'
  await b.syncConversations(bv)
  assert.equal(await a.getConversation(1), undefined)
  assert.ok(await a.getImage(shared))
  assert.ok(await a.getImage(pending))
  av.length = 0
  await a.syncConversations(av)
  assert.equal(await a.getImage(shared), undefined)
  assert.ok(await a.getImage(pending))
})

test('rapid settings saves keep the latest input and merge other tabs preferences', async () => {
  const { a, b } = await tabs()
  await a.setSetting('S', { profiles: [{ id: 'p1', key: '' }], darkMode: false })
  const av = await a.getSetting('S'), bv = await b.getSetting('S')
  av.profiles[0].key = 's'
  const first = a.setSetting('S', av)
  av.profiles[0].key = 'sk-full-value'
  const second = a.setSetting('S', av)
  bv.darkMode = true
  const other = b.setSetting('S', bv)
  await Promise.all([first, second, other])
  const saved = await a.getSetting('S')
  assert.equal(saved.profiles[0].key, 'sk-full-value')
  assert.equal(saved.darkMode, true)
})

test('database results take precedence over an older mirror with the same timestamp', async () => {
  const { a, storage } = await tabs()
  await a.setSetting('S', { profiles: [{ id: 'p1', key: 'new' }], darkMode: true })
  const key = 'bychat-img:setting:v3:S'
  const backup = JSON.parse(storage.get(key))
  backup.value.darkMode = false
  storage.set(key, JSON.stringify(backup))
  assert.equal((await a.getSetting('S')).darkMode, true)
})

test('v2 upgrades retain conversations, image blobs and the newest legacy key backup', async () => {
  globalThis.indexedDB = new IDBFactory()
  const storage = new Map([['bychat-img:setting:S', JSON.stringify({ updatedAt: 20, value: { profiles: [{id:'p1',key:'newest'}] } })]])
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('bychat-img', 2)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore('conversations', {keyPath:'id'}).put({id:1,title:'kept',messages:[{prompt:'old',images:['img_old']}]})
      db.createObjectStore('images', {keyPath:'id'}).put({id:'img_old',blob:new Blob(['kept image'])})
      db.createObjectStore('settings', {keyPath:'key'}).put({key:'S',updatedAt:10,value:{profiles:[{id:'p1',key:'old'}]}})
    }
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  })
  const db = await import(`../js/db.js?migration=${++sequence}`)
  assert.equal((await db.listConversations())[0].title, 'kept')
  assert.equal(await (await db.getImage('img_old')).blob.text(), 'kept image')
  assert.equal((await db.getSetting('S')).profiles[0].key, 'newest')
})
