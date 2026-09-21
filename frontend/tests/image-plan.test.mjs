import test from 'node:test'
import assert from 'node:assert/strict'
import { imagePlanBody, readImagePlan, combineImageUsage } from '../js/image-plan.js'
import { planImage, setTransportOverride } from '../js/api.js'

const payload = { prompt: '将猫改成白色', images: ['data:image/png;base64,aGk='],
  history: [{ role: 'user', content: '画一只猫' }, { role: 'assistant', content: '已生成猫咪图片' }], reference_source: 'previous' }
const plan = { prompt: '完整的白猫构图', reference_images: [1] }
const profile = { baseUrl: 'https://plan.example.test/v1', apiKey: 'sk-fake' }
function response(mode, args = plan) {
  const argumentsText = JSON.stringify(args)
  if (mode === 'responses') return { output: [{ type: 'function_call', name: 'create_image', arguments: argumentsText }], usage: { input_tokens: 40, output_tokens: 10 } }
  return { choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'create_image', arguments: argumentsText } }] } }] }
}

for (const mode of ['responses', 'chat_completions']) {
  test(`${mode}: 图片工具接收历史和参考图，不接收界面的模型和推理设置`, () => {
    const body = imagePlanBody({ ...payload, model: 'old-choice', reasoning_effort: 'max', reasoning: { effort: 'high' } }, mode)
    assert.equal(body.model, undefined)
    assert.equal(body.stream, false)
    assert.equal(body.tools.length, 1)
    assert.equal(body.reasoning, undefined)
    assert.equal(body.reasoning_effort, undefined)
    assert.equal(body.output_config, undefined)
    assert.match(JSON.stringify(body), /画一只猫/)
    assert.match(JSON.stringify(body), /aGk=/)
    assert.deepEqual(readImagePlan(response(mode), mode, 1), plan)
  })
}

test('只接受单次受限的图片工具调用，拒绝无效描述和编造的参考图编号', () => {
  for (const args of [null, { prompt: '', reference_images: [] }, { prompt: 'x', reference_images: [0] },
    { prompt: 'x', reference_images: [2] }, { prompt: 'x', reference_images: ['1'] }, { prompt: 'x' }]) {
    assert.throws(() => readImagePlan(response('responses', args), 'responses', 1), /无效/)
  }
  assert.throws(() => readImagePlan({ output: [] }, 'responses', 1), /图片需求解析失败/)
  const multiple = response('responses'); multiple.output.push(multiple.output[0])
  assert.throws(() => readImagePlan(multiple, 'responses', 1), /图片需求解析失败/)
  const unknown = response('responses'); unknown.output[0].name = 'other_tool'
  assert.throws(() => readImagePlan(unknown, 'responses', 1), /图片需求解析失败/)
  assert.deepEqual(readImagePlan(response('responses', { prompt: '新图', reference_images: [] }), 'responses', 0), { prompt: '新图', reference_images: [] })
})

for (const transport of ['direct', 'proxy']) {
  test(`${transport}: 图片辅助模型始终交由后端选择，保留凭证、取消信号及用量`, async (t) => {
    setTransportOverride(transport); t.after(() => setTransportOverride(''))
    const signal = new AbortController().signal
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url, '/api/image-plan')
      assert.equal(init.signal, signal)
      assert.equal(init.headers['X-Upstream-Key'], 'sk-fake')
      const json = JSON.parse(init.body), body = json.body
      assert.equal(body.store, false)
      assert.equal(body.tool_choice.name, 'create_image')
      assert.equal(body.model, undefined)
      assert.equal(body.reasoning, undefined)
      return Response.json(response('responses'))
    })
    const result = await planImage(profile, payload, signal)
    assert.equal(result.prompt, plan.prompt)
    assert.equal(result.usage.input_tokens, 40)
  })
}

test('文本工具接口不兼容时自动回退，但鉴权、限流、服务故障和取消不重复请求', async (t) => {
  setTransportOverride('direct'); t.after(() => setTransportOverride(''))
  const modes = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/image-plan')
    const mode = JSON.parse(init.body).mode
    modes.push(mode)
    return mode === 'responses' ? Response.json({ error: 'not supported' }, { status: 404 }) : Response.json(response('chat_completions'))
  })
  assert.equal((await planImage(profile, payload)).prompt, plan.prompt)
  assert.deepEqual(modes, ['responses', 'chat_completions'])
  for (const status of [401, 403, 429, 500]) {
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: 'rejected' }, { status }) })
    await assert.rejects(planImage(profile, payload), { status })
    assert.equal(calls, 1)
  }
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new DOMException('cancelled', 'AbortError') })
  await assert.rejects(planImage(profile, payload), { name: 'AbortError' })
  assert.equal(calls, 1)
})

test('旧聊天模型和协议偏好不会覆盖生图后台的默认值', async (t) => {
  setTransportOverride(''); t.after(() => setTransportOverride(''))
  const paths = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    paths.push(url)
    const { mode, body } = JSON.parse(init.body)
    assert.equal(mode, 'responses')
    assert.equal(body.model, undefined)
    assert.equal(body.reasoning, undefined)
    assert.equal(body.reasoning_effort, undefined)
    return Response.json(response('responses'))
  })
  await planImage(profile, { ...payload, model: 'claude-old-choice', mode: 'messages', reasoning_effort: 'max' })
  assert.deepEqual(paths, ['/api/image-plan'])
})

test('用量合计只相加实际返回的 token 数，缺失值不会显示为零', () => {
  assert.equal(combineImageUsage(null, { input_tokens: null }), null)
  assert.deepEqual(combineImageUsage({ input_tokens: 40, output_tokens: 10, cache_read_tokens: 20 }, { input_tokens: 100, output_tokens: 1000 }),
    { input_tokens: 140, output_tokens: 1010, cache_read_tokens: 20 })
})
