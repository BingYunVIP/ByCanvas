import test from 'node:test'
import assert from 'node:assert/strict'

import { deleteSetting, getSetting, setSetting, setSettings } from '../js/db.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test('IndexedDB 不可用时 API 配置仍由 localStorage 镜像恢复', async (t) => {
  const previousStorage = globalThis.localStorage
  const previousIndexedDB = globalThis.indexedDB
  globalThis.localStorage = memoryStorage()
  delete globalThis.indexedDB
  t.after(() => {
    if (previousStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previousStorage
    if (previousIndexedDB === undefined) delete globalThis.indexedDB
    else globalThis.indexedDB = previousIndexedDB
  })

  const settings = {
    S: { profiles: [{ id: 'p1', key: 'sk-persisted-locally' }], activeId: 'p1' },
    G: { version: 2, persistInputOnRestart: true },
    model: 'gpt-image-test',
    size: '1024x1024',
  }
  await setSettings(settings)

  assert.deepEqual(await getSetting('S', null), settings.S)
  assert.deepEqual(await getSetting('G', null), settings.G)
  assert.equal(await getSetting('model', ''), settings.model)
  assert.equal(await getSetting('size', ''), settings.size)
})

test('单项设置的写入和删除在 IndexedDB 故障时仍保持一致', async (t) => {
  const previousStorage = globalThis.localStorage
  const previousIndexedDB = globalThis.indexedDB
  globalThis.localStorage = memoryStorage()
  delete globalThis.indexedDB
  t.after(() => {
    if (previousStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previousStorage
    if (previousIndexedDB === undefined) delete globalThis.indexedDB
    else globalThis.indexedDB = previousIndexedDB
  })

  await setSetting('activeConversationId', 42)
  assert.equal(await getSetting('activeConversationId', null), 42)
  await deleteSetting('activeConversationId')
  assert.equal(await getSetting('activeConversationId', null), null)
})
