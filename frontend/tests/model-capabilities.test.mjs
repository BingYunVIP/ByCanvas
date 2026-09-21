import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modelCapabilities } from '../js/model-capabilities.js';
import { normalizeModels, streamChat, setTransportOverride, fetchModels } from '../js/api.js';

const catalog = JSON.parse(readFileSync(new URL('../data/model-capabilities.json', import.meta.url), 'utf8'));

test('保留服务商返回的完整枚举，优先于官方兜底', () => {
  const m = modelCapabilities({ id: 'gpt-6-astra', supportsReasoningEffort: true,
    reasoningEfforts: [{ value: 'minimal' }, { value: 'ultra', default: true }],
    qualityOptions: ['standard', 'premium'] }, catalog);
  assert.deepEqual(m.reasoningEfforts, ['minimal', 'ultra']);
  // 不采信上游标的 default（哪怕标的是 'ultra' 这种最高档）——那经常就是
  // 最贵最慢的一挡，前端会退回「自动」。见 2026-09-20 的改动。
  assert.equal(m.defaultReasoningEffort, null);
  assert.deepEqual(m.qualityOptions, ['standard', 'premium']);
});

test('OpenRouter 图像参数枚举、JSON Schema 和 Codex 风格均可读取', () => {
  assert.deepEqual(modelCapabilities({ id: 'image-custom', supported_parameters: { quality: { type: 'enum', values: ['draft', 'best'] } } }).qualityOptions, ['draft', 'best']);
  assert.deepEqual(modelCapabilities({ id: 'text-custom', parameters: { properties: { reasoning_effort: { enum: ['none', 'xhigh'], default: 'none' } } } }).reasoningEfforts, ['none', 'xhigh']);
  assert.deepEqual(modelCapabilities({ id: 'text-custom', supported_reasoning_efforts: [{ effort: 'low' }, { effort: 'max' }] }).reasoningEfforts, ['low', 'max']);
});

test('未知模型只保留已知能力，不能把支持 reasoning 当成固定三档', () => {
  const m = modelCapabilities({ id: 'new-model', supported_parameters: ['reasoning'] }, catalog);
  assert.equal(m.reasoning, true);
  assert.deepEqual(m.reasoningEfforts, []);
  assert.deepEqual(m.qualityOptions, []);
  assert.deepEqual(modelCapabilities({ id: 'gpt-6-astra', supportsReasoningEffort: false }, catalog).reasoningEfforts, []);
  assert.deepEqual(modelCapabilities({ id: 'gpt-image-2.5-sunburst', qualityOptions: [] }, catalog).qualityOptions, []);
});

test('缺失字段按准确模型 ID 使用已核实的档位', () => {
  assert.deepEqual(modelCapabilities({ id: 'gpt-5.5' }, catalog).reasoningEfforts, ['none', 'low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(modelCapabilities({ id: 'openai/gpt-6-astra' }, catalog).reasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(modelCapabilities({ id: 'gpt-image-2.5-sunburst' }, catalog).qualityOptions, ['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(modelCapabilities({ id: 'gpt-image-2.5-flare-custom' }, catalog).qualityOptions, []);
});

test('模型标准化不会丢失档位或展示内部审核模型', () => {
  const models = normalizeModels({ data: [{ id: 'codex-auto-review\r\n' }, { id: 'image-custom', qualityOptions: ['xhigh'] }] });
  assert.equal(models.length, 1);
  assert.deepEqual(models[0].qualityOptions, ['xhigh']);
});

test('图片参数采用明确的服务商能力，限制条件经过再次标准化仍不丢失', () => {
  // 数量（n）、审核（moderation）已经整个下线，imageParameters 里不会再有
  // 这两个键——见 2026-09-20 的改动。
  const [model] = normalizeModels([{ id: 'gpt-image-2.5-sunburst', supported_parameters: {
    background: false, output_format: { enum: ['webp'] },
  } }], catalog);
  assert.equal(model.imageParameters.background, false);
  assert.equal('n' in model.imageParameters, false);
  assert.equal('moderation' in model.imageParameters, false);
  assert.deepEqual(model.imageParameters.output_format.options, ['webp']);
  assert.deepEqual(model.imageParameters.size, {});
  assert.deepEqual(normalizeModels([model], catalog)[0].imageParameters, model.imageParameters);
  assert.deepEqual(modelCapabilities({ id: 'custom-image', supported_parameters: ['size'] }).imageParameters,
    { size: {}, output_format: false, background: false });
  assert.equal(modelCapabilities({ id: 'gpt-image-2', supported_parameters: [] }, catalog).imageParameters.size, false);
});

test('已核实的图片模型和快照提供参数能力，不给未知图片模型套用全部参数', () => {
  const known = modelCapabilities({ id: 'gpt-image-2.5-sunburst' }, catalog);
  assert.deepEqual(known.imageParameters.output_format.options, ['png', 'jpeg', 'webp']);
  assert.deepEqual(modelCapabilities({ id: 'openai/gpt-image-2.5-sunburst-2026-09-08' }, catalog), known);
  const dalle = modelCapabilities({ id: 'dall-e-3' }, catalog);
  assert.equal(dalle.imageParameters.background, false);
  assert.deepEqual(modelCapabilities({ id: 'unknown-image' }, catalog).imageParameters,
    { size: false, output_format: false, background: false });
});

for (const supported of [true, false]) {
  test(`读取独立图像模型目录：支持=${supported}，失败时仍能获取模型`, async (t) => {
    setTransportOverride('direct');
    t.after(() => setTransportOverride(''));
    t.mock.method(globalThis, 'fetch', async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('model-capabilities.json')) return Response.json(catalog);
      if (path.endsWith('/images/models')) return supported
        ? Response.json({ data: [{ id: 'custom-image', supported_parameters: { quality: { type: 'enum', values: ['draft', 'photo', 'ultra'] } } }] })
        : Response.json({ error: 'not found' }, { status: 404 });
      return Response.json({ data: [{ id: 'custom-image' }] });
    });
    const list = await fetchModels({ baseUrl: 'https://example.test/v1', apiKey: 'fake' });
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].qualityOptions, supported ? ['draft', 'photo', 'ultra'] : []);
  });
}

for (const mode of ['responses', 'chat_completions', 'messages']) {
  test(`${mode} 将选择的推理强度传到实际请求`, async (t) => {
    setTransportOverride('direct');
    t.after(() => setTransportOverride(''));
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(mode === 'messages' ? body.output_config.effort : mode === 'responses' ? body.reasoning.effort : body.reasoning_effort, 'max');
      const content = mode === 'responses' ? '{"type":"response.output_text.delta","delta":"ok"}'
        : mode === 'messages' ? '{"delta":{"type":"text_delta","text":"ok"}}' : '{"choices":[{"delta":{"content":"ok"}}]}';
      return new Response((mode === 'messages' ? 'event: content_block_delta\n' : '') + 'data: ' + content + '\n\ndata: [DONE]\n\n');
    });
    for await (const _ of streamChat({ baseUrl: 'https://example.test/v1', apiKey: 'test' }, {
      mode, model: 'test-model', reasoning_effort: 'max', messages: [{ role: 'user', content: 'hello' }],
    })) {}
  });
}
