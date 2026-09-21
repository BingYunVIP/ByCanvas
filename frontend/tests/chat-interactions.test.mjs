import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { tr } from '../js/i18n-text.js'
import { renderMarkdown, escapeMarkup } from '../js/chat-format.js'
import { combineImageUsage } from '../js/image-plan.js'
import { modelCapabilities } from '../js/model-capabilities.js'
const catalog = JSON.parse(readFileSync(new URL('../data/model-capabilities.json', import.meta.url), 'utf8'))

// app.js 是普通浏览器脚本。执行原函数，用内存替身隔离网络、存储和 DOM。
const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8')
function load(names, globals) {
  const context = vm.createContext({ tr, ...globals })
  const functions = names.map((name) => {
    const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm'))
    assert.ok(match, name)
    return match[0]
  }).join('\n')
  vm.runInContext(functions, context)
  return context
}

function generationContext(stream) {
  const node = { style: {}, classList: { add() {}, remove() {} }, innerHTML: '' }
  const api = { streamChat: stream, transportName: () => 'direct' }
  const c = { id: 1 }
  const state = { persisted: 0, paints: 0 }
  const ctx = load(['doGenerate', 'cancelGeneration', 'clearRunningRound', 'stopRunning', 'taskKindFor', 'imageContext', 'dataUrlToFile', 'refsToDataUrls'], {
    AbortController, Event, activeId: 1, currentModel: 'text-model', inputImages: [],
    currentAbort: null, isRunning: false, runningRoundKey: '1:0', runningRoundKind: 'chat',
    streamRenderFrame: null, streamingText: '', streamingReasoning: '', pendingInputs: [],
    promptInput: { value: '', dispatchEvent() {} }, MODELS: [{ id: 'text-model', kind: 'chat' }, { id: 'image-model', kind: 'image' }],
    File, atob, MAX_INPUT_IMAGES: 8, IMAGE_URLS: new Map(), conversationRounds: (c) => c?.messages || [],
    S: {}, ByChatAPI: api, window: { ByChatAPI: api }, notifyTaskCompleted() {},
    document: { getElementById: () => node },
    activeProfile: () => ({ url: 'https://test.invalid', key: 'test' }),
    setRunningRound(_c, _round, kind) { ctx.runningRoundKind = kind }, showToast() {}, stickBottom() {},
    renderChatView() { state.paints++ }, updateStreamingBubble() {}, renderList() {},
    chatModeFor: () => 'auto', chatHistory: () => [], persistConversations() { state.persisted++ },
  })
  return { ctx, c, state }
}

test('停止回复时保留已收到的文字、恢复排队草稿并清除生成状态', async () => {
  const { ctx, c, state } = generationContext(async function* () {
    yield { event: 'content', data: { text: '已生成的部分' } }
    yield { event: 'reasoning', data: { text: '已有推理' } }
    ctx.cancelGeneration()
    const error = new Error('aborted')
    error.name = 'AbortError'
    throw error
  })
  ctx.pendingInputs = ['稍后继续']
  ctx.promptInput.value = '当前草稿'
  const round = { prompt: '提问', images: [] }
  await ctx.doGenerate('提问', { model: 'text-model' }, c, round)
  assert.equal(round.cancelled, true)
  assert.equal(round.text, '已生成的部分')
  assert.equal(round.reasoning, '已有推理')
  assert.equal(ctx.promptInput.value, '当前草稿\n稍后继续')
  assert.equal(ctx.pendingInputs.length, 0)
  assert.equal(ctx.runningRoundKey, null)
  assert.equal(ctx.isRunning, false)
  assert.equal(state.persisted, 1)
})

test('流式错误显示未完成并保留正文，不会误显示为成功', async () => {
  const { ctx, c } = generationContext(async function* () {
    yield { event: 'content', data: { text: '保留这些字' } }
    yield { event: 'error', data: { message: '服务暂时繁忙' } }
  })
  const round = { prompt: '提问', images: [] }
  await ctx.doGenerate('提问', { model: 'text-model' }, c, round)
  assert.equal(round.text, '保留这些字')
  assert.equal(round.error, '服务暂时繁忙')
  assert.equal(ctx.runningRoundKey, null)
  assert.equal(ctx.isRunning, false)
})

function imageGenerationContext() {
  const { ctx, c, state } = generationContext(async function* () { throw new Error('不应调用普通聊天') })
  const requests = []
  const round = { prompt: '画一只猫', images: [], referenceImages: [] }
  c.messages = [round]
  ctx.ByChatDB = { async saveImageBlob(blob) { assert.equal(await blob.text(), 'generated'); return 'img_result' } }
  const result = { images: [{ blob: new Blob(['generated']), url: 'blob:result' }], usage: { input_tokens: 25, output_tokens: 300 } }
  Object.assign(ctx.ByChatAPI, {
    combineImageUsage,
    async planImage(_cred, payload) {
      requests.push({ kind: 'plan', payload })
      return { prompt: '完整的猫咪构图', reference_images: payload.images.map((_, i) => i + 1), usage: { input_tokens: 30, output_tokens: 10, cache_read_tokens: 20 } }
    },
    async generateImage(_cred, payload) { requests.push({ kind: 'generate', payload }); return result },
    async editImage(_cred, payload, files) { requests.push({ kind: 'edit', payload, files }); return result },
  })
  return { ctx, c, round, requests, state }
}

test('后台辅助模型不读取旧文本模型和推理设置，所选图片模型与原始提示词保留', async () => {
  const { ctx, c, round, requests } = imageGenerationContext()
  ctx.currentModel = 'text-model'
  ctx.chatModeFor = () => { throw new Error('生图不应读取聊天接口偏好') }
  await ctx.doGenerate(round.prompt, { model: 'image-model', text_model: 'old-text-choice', reasoning_effort: 'max', quality: 'max', output_format: 'webp' }, c, round)
  assert.deepEqual(requests.map((r) => r.kind), ['plan', 'generate'])
  assert.equal(requests[0].payload.model, undefined)
  assert.equal(requests[0].payload.mode, undefined)
  assert.equal(requests[0].payload.reasoning_effort, undefined)
  assert.equal(requests[1].payload.model, 'image-model')
  assert.equal(requests[1].payload.prompt, '完整的猫咪构图')
  assert.equal(requests[1].payload.quality, 'max')
  assert.equal(requests[1].payload.output_format, 'webp')
  assert.equal(requests[1].payload.text_model, undefined)
  assert.equal(requests[1].payload.reasoning_effort, undefined)
  assert.equal(ctx.currentModel, 'text-model')
  assert.equal(round.prompt, '画一只猫')
  assert.deepEqual(Array.from(round.images), ['img_result'])
  assert.deepEqual(round.usage, { input_tokens: 55, output_tokens: 310, cache_read_tokens: 20 })
  assert.equal(round.phase, undefined)
  assert.equal(ctx.isRunning, false)
})

test('连续改图提供之前的对话和最近结果，上传参考图时优先使用上传图', async () => {
  for (const uploaded of [false, true]) {
    const { ctx, c, round, requests } = imageGenerationContext()
    const previous = 'data:image/png;base64,b2xk'
    const explicit = 'data:image/png;base64,dXBsb2Fk'
    c.messages.unshift({ prompt: '画一只猫', imagePrompt: '上一轮完整构图', images: [previous] },
      { prompt: '失败的请求', error: 'failed', images: ['bad'] })
    // 重试历史任务时，不能把后面的对话或图片当成本轮参考。
    c.messages.push({ prompt: '未来的请求', images: ['future'] })
    if (uploaded) round.referenceImages = [explicit]
    await ctx.doGenerate('改成白色', { model: 'image-model', reasoning_effort: 'high' }, c, round)
    assert.deepEqual(requests.map((r) => r.kind), ['plan', 'edit'])
    assert.equal(requests[0].payload.reasoning_effort, undefined)
    assert.equal(requests[0].payload.reference_source, uploaded ? 'uploaded' : 'previous')
    assert.deepEqual(Array.from(requests[0].payload.images), [uploaded ? explicit : previous])
    assert.deepEqual(Array.from(requests[0].payload.history, (m) => m.content), ['画一只猫', '已生成图片。图片描述：上一轮完整构图'])
    assert.equal(await requests[1].files[0].text(), uploaded ? 'upload' : 'old')
  }
})

test('文本模型选择全新主题时不把上一轮图片误送到编辑接口', async () => {
  const { ctx, c, round, requests } = imageGenerationContext()
  c.messages.unshift({ prompt: '旧主题', images: ['data:image/png;base64,b2xk'] })
  ctx.ByChatAPI.planImage = async () => ({ prompt: '新主题', reference_images: [] })
  await ctx.doGenerate('画一座山', { model: 'image-model' }, c, round)
  assert.deepEqual(requests.map((r) => r.kind), ['generate'])
})

test('接口返回错误信息时保留已完成图片并明确报错，不触发完成通知', async () => {
  const { ctx, c, round } = imageGenerationContext()
  let notifications = 0
  ctx.notifyTaskCompleted = () => { notifications++ }
  ctx.ByChatAPI.generateImage = async () => ({
    images: [{ blob: new Blob(['generated']), url: 'blob:result' }],
    errors: ['接口返回的数量与请求不一致'],
  })
  await ctx.doGenerate(round.prompt, { model: 'image-model' }, c, round)
  assert.match(round.error, /接口返回的数量与请求不一致/)
  assert.deepEqual(Array.from(round.images), ['img_result'])
  assert.equal(notifications, 0)
  assert.equal(ctx.isRunning, false)
})

test('取消时多图请求已返回的部分图片仍会保存', async () => {
  const { ctx, c, round } = imageGenerationContext()
  ctx.ByChatAPI.generateImage = async () => {
    ctx.cancelGeneration()
    return { images: [{ blob: new Blob(['generated']), url: 'blob:result' }] }
  }
  await ctx.doGenerate(round.prompt, { model: 'image-model', n: 2 }, c, round)
  assert.equal(round.cancelled, true)
  assert.deepEqual(Array.from(round.images), ['img_result'])
  assert.equal(round.error, undefined)
})

test('保存多张图片时第二张写入失败，第一张仍留在对话中', async () => {
  const { ctx, c, round } = imageGenerationContext()
  let saved = 0
  ctx.ByChatDB.saveImageBlob = async () => {
    if (++saved === 2) throw new Error('本机存储空间不足')
    return 'img_first'
  }
  ctx.ByChatAPI.generateImage = async () => ({ images: [
    { blob: new Blob(['first']), url: 'blob:first' }, { blob: new Blob(['second']), url: 'blob:second' },
  ] })
  await ctx.doGenerate(round.prompt, { model: 'image-model', n: 2 }, c, round)
  assert.deepEqual(Array.from(round.images), ['img_first'])
  assert.match(round.error, /本机存储空间不足/)
})

test('再次生成沿用本轮保存的参数，不读取当前界面的选择', async () => {
  const round = { prompt: '画一只猫', params: { model: 'image-model', quality: 'high' }, images: ['old'] }
  let sent
  const ctx = load(['retryRound'], {
    activeId: 1, currentModel: 'image-model', isRunning: false, conversations: [{ id: 1, messages: [round] }],
    conversationRounds: (c) => c.messages, taskKindFor: () => 'image', parameterApplicable: () => true,
    buildParams: () => ({ model: 'image-model', quality: 'low' }), nowStamp: () => 'now',
    setRunningRound() {}, stickBottom() {}, renderChatView() {}, scrollChatToBottom() {},
    async doGenerate(_prompt, params) { sent = params },
  })
  await ctx.retryRound(0)
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), { model: 'image-model', quality: 'high' })
})

for (const outcome of ['cancel', 'failure']) {
  test(`文本模型阶段 ${outcome} 后不请求图片接口，并恢复发送状态`, async () => {
    const { ctx, c, round, requests } = imageGenerationContext()
    ctx.ByChatAPI.planImage = async () => {
      if (outcome === 'failure') throw new Error('文本模型不可用')
      ctx.cancelGeneration()
      return { prompt: '不应执行', reference_images: [] }
    }
    await ctx.doGenerate(round.prompt, { model: 'image-model' }, c, round)
    assert.equal(requests.length, 0)
    assert.equal(outcome === 'cancel' ? round.cancelled : round.error, outcome === 'cancel' ? true : '文本模型不可用')
    assert.equal(ctx.isRunning, false)
    assert.equal(round.phase, undefined)
  })
}

test('逐张下载选择正确图片，并将上游图片转换为当前选择的格式', async () => {
  const resolved = [], downloads = []
  const ctx = load(['downloadCurrentImage'], {
    conversations: [{ id: 1, title: '作品', messages: [{ images: ['img_a', 'img_b'], params: { output_format: 'png' } }] }],
    activeId: 1, conversationRounds: (c) => c.messages, PILL_STATE: { format: 'JPEG' },
    ByChatImageExport: { async convertImage(blob, format) {
      assert.equal(blob.type, 'image/webp')
      assert.equal(format, 'JPEG')
      return { blob: new Blob(['converted'], { type: 'image/jpeg' }), extension: 'jpg' }
    } },
    resolveImageSrc: async (id) => { resolved.push(id); return 'blob:test' },
    fetch: async () => ({ ok: true, blob: async () => new Blob(['image'], { type: 'image/webp' }) }),
    URL: { createObjectURL: () => 'blob:download', revokeObjectURL() {} },
    document: { body: { appendChild() {} }, createElement: () => ({ click() { downloads.push(this.download) }, remove() {} }) },
    showToast() {}, setTimeout() {},
  })
  await ctx.downloadCurrentImage(0, 1)
  assert.deepEqual(resolved, ['img_b'])
  assert.deepEqual(downloads, ['作品-2.jpg'])
})

test('复用提示词读取用户刚修改的参数值', () => {
  const ctx = load(['promptForRound'], {
    activeId: 1, conversations: [{ id: 1, messages: [{ prompt: '生成 {argument name="颜色" default="蓝色"} 的花' }] }],
    conversationRounds: (c) => c.messages,
    document: { querySelectorAll: () => [{ dataset: { argumentIndex: '0', value: '红色' } }] },
  })
  assert.equal(ctx.promptForRound(0), '生成 红色 的花')
})

test('图片异步读取期间切换对话，不把参考图加入新的对话', async () => {
  let finish
  const ctx = load(['addInputImageFromFile'], {
    activeId: 1, inputImages: [], MAX_INPUT_IMAGES: 8,
    parameterApplicable: () => true,
    fileToDataUrl: () => new Promise((resolve) => { finish = resolve }),
    showToast() {}, promptInput: { value: '' }, renderInputImages() {},
  })
  const pending = ctx.addInputImageFromFile({ type: 'image/png' }, 1)
  ctx.activeId = 2
  finish('data:image/png;base64,aA==')
  assert.equal(await pending, false)
  assert.equal(ctx.inputImages.length, 0)
})

test('提示词参数与 Markdown 共存，参数内容经过转义', () => {
  const ctx = load(['renderPromptHtml'], { window: { ByChatFormat: { renderMarkdown } }, escapeHtml: escapeMarkup })
  const raw = '**颜色**：{argument name="<名称>" default="<img src=x onerror=alert(1)>"}'
  const sent = ctx.renderPromptHtml(raw)
  assert.match(sent, /<strong>颜色<\/strong>/)
  assert.match(sent, /data-argument-index="0"/)
  assert.match(sent, /onclick="editArgument\(event, this\)"/)
  assert.ok(!sent.includes('<img'))
  assert.ok(!sent.includes('<名称>'))
})

test('代码中的参数示例不会导致后面的编辑参数错位', () => {
  const ctx = load(['promptForRound'], {
    activeId: 1,
    conversations: [{ id: 1, messages: [{ prompt: '`{argument name="示例" default="保留"}`\n\n**{argument name="颜色" default="蓝色"}**' }] }],
    conversationRounds: (c) => c.messages,
    document: { querySelectorAll: () => [{ dataset: { argumentIndex: '1', value: '红色' } }] },
  })
  assert.equal(ctx.promptForRound(0), '`保留`\n\n**红色**')
})

function composerContext() {
  const input = { value: '', notifications: 0, dispatchEvent() { this.notifications++ }, focus() {} }
  const ctx = load(['clearComposer', 'handleSend', 'addInputImageFromFile'], {
    document: { getElementById: () => input }, promptInput: input,
    Event, activeId: 1, inputImages: [], MAX_INPUT_IMAGES: 8,
    fileToDataUrl: async () => 'data:image/png;base64,aA==', renderInputImages() {}, showToast() {},
    G: { clearInputAfterSubmit: true }, requestTaskNotificationPermission() {},
    parameterApplicable: () => true,
  })
  return { ctx, input }
}

test('清空已发送草稿会通知实时编辑器更新', () => {
  const { ctx, input } = composerContext()
  input.value = '**旧草稿**'
  ctx.clearComposer()
  assert.equal(input.value, '')
  assert.equal(input.notifications, 1)
})

test('上传参考图将引用编号写入 Markdown 草稿并通知实时编辑器', async () => {
  const { ctx, input } = composerContext()
  input.value = '**修改背景**'
  assert.equal(await ctx.addInputImageFromFile({ type: 'image/png' }, 1), true)
  assert.equal(input.value, '**修改背景** @1 ')
  assert.equal(input.notifications, 1)
})

test('发送仍使用 Markdown 原文，记录与模型请求一致', async () => {
  const { ctx, input } = composerContext()
  const requests = []
  const conversation = { id: 1, title: '构图', messages: [] }
  Object.assign(ctx, {
    isRunning: false, currentModel: 'gpt-image-2.5-sunburst', conversations: [conversation],
    activeProfile: () => ({ key: 'test' }), nowStamp: () => '2026-09-19 15:00',
    setRunningRound() {}, taskKindFor: () => 'image', stickBottom() {}, renderChatView() {}, scrollChatToBottom() {},
    buildParams: () => ({ model: 'gpt-image-2.5-sunburst' }),
    async doGenerate(prompt) { requests.push(prompt) }, async drainPendingInputs() {},
  })
  const raw = '## 构图\n\n- **暖光**\n- 竖图'
  input.value = raw
  await ctx.handleSend()
  assert.deepEqual(requests, [raw])
  assert.equal(conversation.messages[0].prompt, raw)
  assert.equal(input.value, '')
})

for (const clear of [true, false]) {
  test(`提交后清空=${clear}，本轮改图仍有独立的参考图快照`, async () => {
    const { ctx, input } = composerContext()
    const conversation = { id: 1, title: '改图', messages: [] }
    let sent
    Object.assign(ctx, {
      isRunning: false, currentModel: 'image-model', conversations: [conversation],
      G: { clearInputAfterSubmit: clear }, inputImages: ['data:image/png;base64,aGk='],
      activeProfile: () => ({ key: 'test' }), nowStamp: () => '2026-09-19',
      setRunningRound() {}, taskKindFor: () => 'image', stickBottom() {}, renderChatView() {}, scrollChatToBottom() {},
      buildParams: () => ({ model: 'image-model' }),
      async doGenerate(_prompt, _params, _conversation, round) { sent = round.referenceImages.slice() }, async drainPendingInputs() {},
    })
    input.value = '修改图片'
    await ctx.handleSend()
    assert.deepEqual(Array.from(sent), ['data:image/png;base64,aGk='])
    assert.equal(input.value, clear ? '' : '修改图片')
    assert.equal(ctx.inputImages.length, clear ? 0 : 1)
  })
}

test('排队后更改输入、参考图和模型，不会影响已经排队的任务', async () => {
  const { ctx, input } = composerContext()
  Object.assign(ctx, { isRunning: true, pendingInputs: [], inputImages: ['data:image/png;base64,aGk='], buildParams: () => ({ model: 'first-model' }) })
  input.value = '第一个任务'
  await ctx.handleSend()
  input.value = '后续草稿'
  ctx.inputImages = ['data:image/png;base64,bmV3']
  assert.equal(ctx.pendingInputs[0].prompt, '第一个任务')
  assert.equal(ctx.pendingInputs[0].params.model, 'first-model')
  assert.equal(ctx.pendingInputs[0].conversationId, 1)
  assert.deepEqual(Array.from(ctx.pendingInputs[0].referenceImages), ['data:image/png;base64,aGk='])
})

test('通知只在开启且获准时显示，并能定位完成任务的对话', () => {
  const messages = [], opened = []
  class Notification {
    static permission = 'denied'
    constructor(title) { this.title = title; messages.push(this) }
    close() {}
  }
  const ctx = load(['notifyTaskCompleted'], {
    G: { taskCompletionNotification: true }, Notification,
    window: { Notification, focus() {} }, conversations: [{ id: 5 }], selectConversation: (id) => opened.push(id),
  })
  ctx.notifyTaskCompleted({ id: 5 }, 1)
  assert.equal(messages.length, 0)
  Notification.permission = 'granted'
  ctx.notifyTaskCompleted({ id: 5 }, 1)
  assert.equal(messages[0].title, '图片已完成')
  messages[0].onclick()
  assert.deepEqual(opened, [5])
  ctx.G.taskCompletionNotification = false
  ctx.notifyTaskCompleted({ id: 5 }, 0)
  assert.equal(messages.length, 1)
})

function modelSelectionContext() {
  const nodes = new Map()
  for (const key of ['model', 'reasoning', 'quality', 'format', 'transparent', 'size']) {
    const button = { disabled: false, title: '', classList: { toggle() {} } }
    nodes.set('val-' + key, { textContent: '', closest: () => button })
    nodes.set('menu-' + key, { innerHTML: '', querySelectorAll: () => [], classList: { remove() {} } })
  }
  nodes.set('attachBtn', { disabled: false })
  nodes.set('val-attach', { hidden: true })
  const profile = { id: 'first-api', models: [
    // vision 来自 OpenRouter 的 input_modalities：true 能看图，false 明确不支持
    { id: 'text-a', kind: 'chat', vision: true, reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium' },
    { id: 'text-b', kind: 'chat', vision: false, reasoningEfforts: ['none', 'low', 'high', 'max'], defaultReasoningEffort: 'low' },
    { id: 'unknown-default', kind: 'chat', reasoningEfforts: ['low', 'high'] },
    { id: 'image-a', kind: 'image', qualityOptions: ['auto', 'high', 'max'] },
    { id: 'gpt-image-2.5-sunburst', kind: 'image', ...modelCapabilities({ id: 'gpt-image-2.5-sunburst' }, catalog) },
    { id: 'dall-e-3', kind: 'image', ...modelCapabilities({ id: 'dall-e-3' }, catalog) },
    { id: 'limited-image', kind: 'image', ...modelCapabilities({ id: 'limited-image', qualityOptions: ['draft', 'best'],
      supported_parameters: { size: { enum: ['1024x1024', '1024x1536'] } } }, catalog) },
    { id: 'gpt-5.6-sol', kind: 'chat', reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultReasoningEffort: 'medium' },
  ] }
  const ctx = load(['modelName', 'imageParameter', 'parameterApplicable', 'pillOptions', 'syncModelCapabilities', 'refreshPill', 'renderPillMenu',
    'refreshSizePill', 'togglePillMenu',
    'closeAllPillMenus', 'selectPill', 'syncComposerModels', 'pickDefaultModel', 'buildParams', 'taskKindFor'], {
    MODELS: [], currentModel: '', currentSize: 'auto', modelCapabilityContext: null, SZ: { open: false },
    PILL_STATE: { reasoning: 'auto', quality: 'auto', format: 'PNG', transparent: 'false' },
    PILL_LABELS: { model: '模型', reasoning: '推理', quality: '质量', format: '格式', transparent: '透明' },
    PILL_OPTIONS: { format: ['PNG', 'JPEG', 'WebP'], transparent: ['false', 'true'] },
    S: { modelPinned: true }, activeProfile: () => profile, isVisibleModel: () => true,
    document: { getElementById: (id) => nodes.get(id), querySelectorAll: () => [] },
    escapeHtml: escapeMarkup, persistSettings() {}, showToast() {},
  })
  vm.runInContext(source.match(/^function pillValue[^\n]+/m)[0], ctx)
  ctx.syncComposerModels()
  const menuValues = () => [...nodes.get('menu-reasoning').innerHTML.matchAll(/data-v="([^"]+)"/g)].map((match) => match[1])
  return { ctx, profile, nodes, menuValues }
}

test('切换模型立即更新推理菜单、默认值及请求参数，不沿用上一模型的选择', () => {
  const { ctx, nodes, menuValues } = modelSelectionContext()
  ctx.selectPill('model', 'text-a')
  assert.equal(nodes.get('val-reasoning').textContent, 'medium')
  ctx.selectPill('reasoning', 'high')
  ctx.selectPill('model', 'text-b')
  assert.deepEqual(menuValues(), ['auto', 'low', 'high', 'max'])
  assert.equal(nodes.get('val-reasoning').textContent, 'low')
  assert.equal(ctx.buildParams('提问').reasoning_effort, 'low')
  ctx.selectPill('reasoning', 'max')
  ctx.selectPill('model', 'text-a')
  assert.deepEqual(menuValues(), ['auto', 'low', 'medium', 'high'])
  assert.equal(ctx.buildParams('提问').reasoning_effort, 'medium')
})

test('原推理选择只作用于聊天，图片质量继续随所选图片模型更新', () => {
  const { ctx, nodes, menuValues } = modelSelectionContext()
  ctx.selectPill('model', 'text-b')
  ctx.selectPill('reasoning', 'high')
  ctx.selectPill('model', 'unknown-default')
  assert.equal(nodes.get('val-reasoning').textContent, '自动')
  assert.equal(nodes.get('val-reasoning').closest().disabled, false)
  assert.equal(ctx.buildParams('提问').reasoning_effort, undefined)
  ctx.selectPill('reasoning', 'high')
  ctx.selectPill('model', 'image-a')
  assert.deepEqual(menuValues(), ['auto'])
  assert.equal(nodes.get('val-reasoning').textContent, '不适用')
  assert.match(nodes.get('val-reasoning').closest().title, /可调整图片质量/)
  assert.equal(nodes.get('val-reasoning').closest().disabled, true)
  assert.equal(ctx.buildParams('生图').text_model, undefined)
  assert.equal(ctx.buildParams('生图').reasoning_effort, undefined)
  assert.equal(nodes.get('val-quality').closest().disabled, false)
  ctx.selectPill('model', 'text-b')
  assert.equal(ctx.buildParams('聊天').text_model, undefined)
  assert.equal(nodes.get('val-reasoning').closest().disabled, false)
  assert.equal(nodes.get('val-reasoning').textContent, 'low')
})

test('聊天模型与推理选择不会成为生图辅助模型参数', () => {
  const { ctx, menuValues } = modelSelectionContext()
  ctx.selectPill('model', 'text-b')
  assert.deepEqual(menuValues(), ['auto', 'low', 'high', 'max'])
  ctx.selectPill('reasoning', 'max')
  const params = ctx.buildParams('聊天')
  ctx.selectPill('model', 'image-a')
  assert.equal(params.model, 'text-b')
  assert.equal(params.text_model, undefined)
  assert.equal(params.reasoning_effort, 'max')
  assert.equal(ctx.buildParams('生图').model, 'image-a')
  assert.equal(ctx.buildParams('生图').text_model, undefined)
  assert.equal(ctx.buildParams('生图').reasoning_effort, undefined)
  // 即使旧草稿残留了文字推理值，也不能传给图片任务。
  ctx.PILL_STATE.reasoning = 'max'
  assert.equal(ctx.buildParams('生图').reasoning_effort, undefined)
})

test('重新获取同一模型保留有效手选档位，已移除的档位退回新的默认值', () => {
  const { ctx, profile, menuValues } = modelSelectionContext()
  ctx.selectPill('model', 'text-b')
  ctx.selectPill('reasoning', 'max')
  ctx.syncComposerModels()
  assert.equal(ctx.buildParams('提问').reasoning_effort, 'max')
  profile.models[1].reasoningEfforts = ['none', 'medium', 'high']
  profile.models[1].defaultReasoningEffort = 'medium'
  ctx.syncComposerModels()
  assert.deepEqual(menuValues(), ['auto', 'medium', 'high'])
  assert.equal(ctx.buildParams('提问').reasoning_effort, 'medium')
})

test('切换 API 配置后，同名模型也使用新配置的推理档位和默认值', () => {
  const { ctx, profile, menuValues } = modelSelectionContext()
  ctx.selectPill('model', 'text-a')
  ctx.selectPill('reasoning', 'high')
  profile.id = 'second-api'
  profile.models[0] = { id: 'text-a', kind: 'chat', reasoningEfforts: ['low', 'high', 'max'], defaultReasoningEffort: 'max' }
  ctx.syncComposerModels()
  assert.deepEqual(menuValues(), ['auto', 'low', 'high', 'max'])
  assert.equal(ctx.buildParams('提问').reasoning_effort, 'max')
})

test('文本模型禁用全部图片参数，返回图片模型时保留可用的选择', () => {
  const { ctx, nodes } = modelSelectionContext()
  ctx.selectPill('model', 'gpt-image-2.5-sunburst')
  ctx.selectPill('quality', 'max')
  ctx.selectPill('format', 'WebP')
  ctx.selectPill('transparent', 'true')
  ctx.currentSize = '1024x1536'
  const imageParams = JSON.stringify(ctx.buildParams('图片'))
  ctx.selectPill('model', 'text-b')
  for (const key of ['quality', 'format', 'transparent', 'size']) {
    assert.equal(nodes.get('val-' + key).textContent, '不适用', key)
    assert.equal(nodes.get('val-' + key).closest().disabled, true, key)
  }
  assert.equal(nodes.get('attachBtn').disabled, true)
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.buildParams('聊天'))), { model: 'text-b', prompt: '聊天', reasoning_effort: 'low' })
  // 被禁用的参数即使调用原事件处理函数，也不能改变图片配置或打开菜单。
  ctx.selectPill('quality', 'high')
  ctx.selectPill('format', 'JPEG')
  ctx.selectPill('size', '512x512')
  ctx.togglePillMenu({ stopPropagation() {} }, 'format')
  ctx.selectPill('model', 'gpt-image-2.5-sunburst')
  assert.equal(JSON.stringify(ctx.buildParams('图片')), imageParams)
  assert.equal(nodes.get('attachBtn').disabled, false)
})

test('JPEG 不携带透明背景，切回 PNG 恢复透明选择', () => {
  const { ctx, nodes } = modelSelectionContext()
  ctx.selectPill('model', 'gpt-image-2.5-sunburst')
  ctx.selectPill('transparent', 'true')
  assert.equal(ctx.buildParams('图片').background, 'transparent')
  ctx.selectPill('format', 'JPEG')
  assert.equal(nodes.get('val-transparent').textContent, '不适用')
  assert.equal(nodes.get('val-transparent').closest().disabled, true)
  assert.equal(ctx.buildParams('图片').background, undefined)
  ctx.selectPill('format', 'PNG')
  assert.equal(nodes.get('val-transparent').textContent, 'true')
  assert.equal(ctx.buildParams('图片').background, 'transparent')
})

test('图片模型遵循尺寸枚举和不支持的参数，不把旧模型设置送到新模型', () => {
  const { ctx, nodes } = modelSelectionContext()
  ctx.selectPill('model', 'gpt-image-2.5-sunburst')
  ctx.selectPill('quality', 'max')
  ctx.selectPill('format', 'WebP')
  ctx.selectPill('transparent', 'true')
  ctx.currentSize = '3840x2160'
  ctx.selectPill('model', 'limited-image')
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.buildParams('图片'))), {
    model: 'limited-image', prompt: '图片', size: '1024x1024', quality: 'auto',
  })
  ctx.selectPill('size', '1024x1536')
  assert.equal(ctx.buildParams('图片').size, '1024x1536')
  ctx.selectPill('size', '3840x2160')
  assert.equal(ctx.buildParams('图片').size, '1024x1536')
  ctx.selectPill('model', 'dall-e-3')
  for (const key of ['format', 'transparent']) assert.equal(nodes.get('val-' + key).textContent, '不适用')
})

test('文本模型带参考图：图作为多模态内容挂在当前这句上，不是走生图', () => {
  const ctx = load(['chatHistory'], { conversationRounds: (c) => c?.messages || [] })
  const c = { messages: [{ prompt: '上一句', text: '上一句的回答' }] }
  const round = { prompt: '本轮提问' }
  // vm 沙箱里造的对象跨 realm，deepEqual 会比原型；先 JSON 往返一次
  const out = (...args) => JSON.parse(JSON.stringify(ctx.chatHistory(...args)))
  const withImage = out(c, round, '这是什么', ['data:image/png;base64,aGk='])
  assert.deepEqual(withImage[0], { role: 'user', content: '上一句' }, '历史照旧是纯文本')
  assert.deepEqual(withImage[withImage.length - 1], {
    role: 'user',
    content: [
      { type: 'text', text: '这是什么' },
      { type: 'image', image: 'data:image/png;base64,aGk=' },
    ],
  })
  // 不带图时和以前一模一样，不能为了统一都改成数组
  const plain = out(c, round, '这是什么', [])
  assert.deepEqual(plain[plain.length - 1], { role: 'user', content: '这是什么' })
  // 非 data: 的引用（已失效的 blob 等）不能混进请求体
  const dirty = out(c, round, '这是什么', ['blob:dead'])
  assert.deepEqual(dirty[dirty.length - 1], { role: 'user', content: '这是什么' })
})

test('选了文本模型又上传参考图：走聊天通道发出去，不再报「请先选择图片模型」', async () => {
  let sent = null
  const { ctx, c } = generationContext(async function* (_cred, payload) {
    sent = payload
    yield { event: 'content', data: { text: '这是一只猫' } }
  })
  ctx.chatHistory = load(['chatHistory'], { conversationRounds: (x) => x?.messages || [] }).chatHistory
  const round = { prompt: '这是什么', images: [], referenceImages: ['data:image/png;base64,aGk='] }
  await ctx.doGenerate('这是什么', { model: 'text-model' }, c, round)
  assert.equal(round.error, undefined, '文本模型带参考图不该报错')
  assert.equal(round.text, '这是一只猫')
  assert.equal(sent.model, 'text-model')
  const messages = JSON.parse(JSON.stringify(sent.messages))
  const last = messages[messages.length - 1]
  assert.deepEqual(last.content[1], { type: 'image', image: 'data:image/png;base64,aGk=' },
    '参考图必须真的进了请求体')
})

test('OpenRouter 标注不支持图像输入的模型，参考图按钮保持禁用', () => {
  const { ctx, nodes } = modelSelectionContext()
  ctx.MODELS = []
  ctx.currentModel = ''
  assert.equal(ctx.parameterApplicable('attach'), false, '首次加载还没有模型时不能抛异常')
  ctx.syncComposerModels()
  ctx.selectPill('model', 'text-b')   // vision: false
  assert.equal(nodes.get('attachBtn').disabled, true)
  ctx.selectPill('model', 'text-a')   // vision: true
  assert.equal(nodes.get('attachBtn').disabled, false, '能看图的文本模型要允许上传参考图')
})
