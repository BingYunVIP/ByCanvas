import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import vm from 'node:vm'
import { tr } from '../js/i18n-text.js'

const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8')

function pageState(savedConversations = [], savedSettings = []) {
  const settings = new Map(savedSettings)
  const records = new Map(savedConversations.map((c) => [c.id, structuredClone(c)]))
  const warnings = []
  const db = {
    getSetting: async (key, fallback) => structuredClone(settings.has(key) ? settings.get(key) : fallback),
    setSetting: async (key, value) => settings.set(key, structuredClone(value)),
    listConversations: async () => structuredClone([...records.values()]),
    putConversation: async (c) => records.set(c.id, structuredClone(c)),
  }
  const ctx = vm.createContext({
    tr,
    window: { ByChatDB: db }, ByChatDB: db, console: { warn: (...args) => warnings.push(args) },
    S: { profiles: [{ id: 'p1', key: 'test' }], activeId: 'p1' }, G: { persistInputOnRestart: true },
    currentModel: '', currentSize: '', promptInput: { value: '' }, inputImages: [], MAX_INPUT_IMAGES: 8,
    renderList() {}, syncTitle() {}, stickBottom() {}, renderChatView() {}, syncComposerModels() {}, refreshSizePill() {},
    renderInputImages() {}, activeProfile: () => ({ key: 'test' }), openSettings() {},
  })
  // 读取应用里的原始示例，避免测试夹具与真正展示的内容脱节。
  vm.runInContext(source.slice(0, source.indexOf('function computeUiScale')), ctx)
  vm.runInContext(source.slice(source.indexOf('const DEFAULT_CONVERSATIONS = ['), source.indexOf('const TOAST_ICONS')), ctx)
  for (const name of ['restoreState', 'persistConversations', 'persistActiveConversation']) {
    vm.runInContext(source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm'))[0], ctx)
  }
  return { ctx, settings, records, warnings, value: (code) => vm.runInContext(code, ctx) }
}

test('自定义示例标题、置顶、分组及内置分组名在刷新后保留', async () => {
  const initial = pageState()
  const rows = structuredClone(initial.value('conversations'))
  rows[0].title = '自定义标题'; rows[0].pinned = false; rows[0].groupId = 'g3'
  const { ctx, value } = pageState(rows, [['groups', [
    { key: 'pinned', name: '精选', renamed: true }, { key: 'other', name: '归档', renamed: true }, { key: 'g3', name: '我的分组' },
  ]]])
  await ctx.restoreState()
  assert.equal(value('conversations[0].title'), '自定义标题')
  assert.equal(value('groupKeyOf(conversations[0])'), 'g3')
  assert.deepEqual(Array.from(value('groupDefs.map(g => g.name)')), ['精选', '归档', '我的分组'])
})

test('空本地记录保留原有两个分组、五条示例对话和图片，重复刷新不会丢失或重复', async () => {
  const { ctx, value, warnings } = pageState()
  for (let reload = 0; reload < 2; reload++) {
    await ctx.restoreState()
    assert.deepEqual(Array.from(value('groupDefs.map((g) => g.name)')), ['置顶', '其他'])
    assert.equal(value('conversations.length'), 5)
    assert.equal(value('conversations.filter((c) => groupKeyOf(c) === "pinned").length'), 2)
    assert.equal(value('conversations.filter((c) => groupKeyOf(c) === "other").length'), 3)
    assert.equal(value('activeId'), 1)
    for (const c of value('conversations')) {
      assert.equal(c.messages.length, 1)
      assert.ok(c.messages[0].prompt.length > 0)
      assert.ok(existsSync(new URL('../' + c.messages[0].images[0], import.meta.url)))
    }
  }
  assert.deepEqual(warnings, [])
})

test('补回默认示例时保留已有对话、自建分组和当前选择', async () => {
  const saved = { id: 42, title: '我的对话', pinned: false, groupId: 'g3', messages: [{ prompt: '保留原文', images: ['img_user'] }] }
  const groups = [{ key: 'g3', name: '我的分组', keepEmpty: true }]
  const { ctx, value, records, warnings } = pageState([saved], [['groups', groups], ['activeConversationId', 42]])
  await ctx.restoreState()
  assert.equal(value('conversations.length'), 6)
  assert.equal(value('conversations[0].messages[0].prompt'), '保留原文')
  assert.deepEqual(Array.from(value('groupDefs.map((group) => group.name)')), ['置顶', '其他', '我的分组'])
  assert.equal(value('activeId'), 42)
  assert.equal(value('nextId'), 43)
  assert.deepEqual(records.get(42), { ...saved, active: true })
  assert.deepEqual(warnings, [])
})

test('默认示例可正常保存，再次打开仍显示两个分组和五条对话', async () => {
  const first = pageState()
  await first.ctx.restoreState()
  await first.ctx.persistConversations(true)
  const second = pageState([...first.records.values()], [...first.settings])
  await second.ctx.restoreState()
  assert.equal(second.value('conversations.length'), 5)
  assert.deepEqual(Array.from(second.value('groupDefs.map((g) => g.name)')), ['置顶', '其他'])
  assert.deepEqual(second.warnings, [])
})

test('旧版数据管理留下的清空标记不再阻止默认示例恢复', async () => {
  const { ctx, value, records, warnings } = pageState([], [
    ['conversationHistoryInitialized', true], ['groups', []], ['activeConversationId', null],
  ])
  await ctx.restoreState()
  assert.equal(value('conversations.length'), 5)
  assert.equal(value('activeId'), 1)
  assert.equal(records.size, 5)
  assert.deepEqual(Array.from(value('groupDefs.map((g) => g.name)')), ['置顶', '其他'])
  assert.deepEqual(warnings, [])
})

test('已有对话占用示例编号时另行分配，重载不会覆盖或重复创建', async () => {
  const user = { id: 1, title: '我的聊天', messages: [{ prompt: '真实提问', text: '真实回复', images: ['img_user'] }] }
  const first = pageState([user], [['activeConversationId', 1]])
  await first.ctx.restoreState()
  const example = first.value('conversations.find((c) => c.exampleId === 1)')
  assert.notEqual(example.id, 1)
  assert.equal(first.value('activeId'), 1)
  assert.deepEqual(first.records.get(1).messages, user.messages)
  const second = pageState([...first.records.values()], [...first.settings])
  await second.ctx.restoreState()
  assert.equal(second.value('conversations.length'), 6)
  assert.equal(second.value('conversations.find((c) => c.exampleId === 1).id'), example.id)
  assert.deepEqual(second.records.get(1).messages, user.messages)
  assert.deepEqual(second.warnings, [])
})

test('旧示例缺少图片时恢复原图，并保留后续提问和生成结果', async () => {
  const initial = pageState()
  const saved = structuredClone(initial.value('conversations'))
  for (const c of saved) delete c.exampleId // 兼容尚未保存示例标记的旧版本。
  saved[0].messages[0].images = []
  saved[0].messages.push({ prompt: '后续提问', images: ['img_new'], text: '新的内容' })
  saved[1].messages[0].images = ['img_regenerated']
  const first = pageState(saved)
  await first.ctx.restoreState()
  assert.equal(first.records.get(1).messages.length, 2)
  assert.equal(first.records.get(1).messages[0].images[0], 'assets/realistic-female-iphone-selfie-portrait.jpg')
  assert.deepEqual(first.records.get(1).messages[1], saved[0].messages[1])
  assert.equal(first.records.get(2).messages[0].images[0], 'assets/japanese-classroom-video-screenshot.jpg')
  assert.deepEqual(first.records.get(2).messages[1].images, ['img_regenerated'])
  const second = pageState([...first.records.values()], [...first.settings])
  await second.ctx.restoreState()
  assert.equal(second.records.get(1).messages.length, 2)
  assert.equal(second.records.get(2).messages.length, 2)
  assert.deepEqual(second.warnings, [])
})

test('复用了示例提示词的新对话不会被误当成默认示例', async () => {
  const initial = pageState()
  const prompt = initial.value('DEFAULT_CONVERSATIONS[0].prompt')
  const user = { id: 42, title: '我的另一张自拍', pinned: false, messages: [{ prompt, images: ['img_user'] }] }
  const { ctx, records, value } = pageState([user], [['activeConversationId', 42]])
  await ctx.restoreState()
  assert.deepEqual(records.get(42), { ...user, active: true })
  assert.equal(value('conversations.length'), 6)
  assert.equal(records.get(1).exampleId, 1)
})
