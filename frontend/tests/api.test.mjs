/**
 * 前端关键逻辑单测。跑法：在 frontend/ 下执行 `node --test tests/`
 *
 * 只测两处最容易出错、且出错后很难排查的地方：
 *   1. SSE 手动解析（不能用 EventSource，所以这段是自己写的）
 *   2. base64url 编解码（与后端 deps.py 的 decode_base64url 必须严格对齐）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  encodeBase64Url, parseSSEChunk, b64ToBlob,
  normalizeBaseUrl, normalizeModels, summarizeUsage, guessKind,
  convertUpstreamEvent, maskKey, toUpstreamContent,
} from '../js/api.js';
import { modelCapabilities } from '../js/model-capabilities.js';

// 和前端运行时读的是同一份目录（由 tools/sync_model_capabilities.py 从 OpenRouter 生成）
const catalog = JSON.parse(readFileSync(new URL('../data/model-capabilities.json', import.meta.url), 'utf8'));

test('base64url 结果不含 + / = 这三个会破坏 HTTP 头的字符', () => {
  for (const raw of [
    'https://api.bingyun.vip/v1',
    'https://example.com/openai/v1?key=a/b+c=',
    'http://localhost:8080/v1',
  ]) {
    assert.match(encodeBase64Url(raw), /^[A-Za-z0-9_-]*$/, `编码结果不合法：${raw}`);
  }
});

test('SSE 解析 content 事件', () => {
  const parsed = parseSSEChunk('event: content\ndata: {"text":"你好"}');
  assert.equal(parsed.event, 'content');
  assert.equal(parsed.data.text, '你好');
});

test('SSE 解析 usage 事件', () => {
  const parsed = parseSSEChunk('event: usage\ndata: {"duration_seconds":1.5,"input_tokens":10}');
  assert.equal(parsed.event, 'usage');
  assert.equal(parsed.data.input_tokens, 10);
  assert.equal(parsed.data.duration_seconds, 1.5);
});

test('SSE 解析 error 事件', () => {
  const parsed = parseSSEChunk('event: error\ndata: {"message":"上游返回 HTTP 401"}');
  assert.equal(parsed.event, 'error');
  assert.match(parsed.data.message, /401/);
});

test('没有 data 行的事件返回 null', () => {
  assert.equal(parseSSEChunk('event: done'), null);
});

test('data 是坏 JSON 时不抛异常，返回 null', () => {
  assert.equal(parseSSEChunk('event: content\ndata: {oops'), null);
});

test('b64ToBlob 转出正确 MIME 与内容', () => {
  // 1x1 透明 PNG
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const blob = b64ToBlob(b64, 'image/png');
  assert.equal(blob.type, 'image/png');
  assert.ok(blob.size > 0, 'Blob 不应为空');
});

/* ---------------------------------------------------------------------------
 * 直连通道：地址归一化、响应归一化、事件转换、Key 打码
 * ------------------------------------------------------------------------- */

test('normalizeBaseUrl 与后端 deps.py 保持一致', () => {
  // 后端 normalize_base_url 的规则：补 https、补 /v1、v1 之后截断、以 / 结尾则原样
  assert.equal(normalizeBaseUrl('api.bingyun.vip'), 'https://api.bingyun.vip/v1');
  assert.equal(normalizeBaseUrl('https://api.bingyun.vip'), 'https://api.bingyun.vip/v1');
  assert.equal(normalizeBaseUrl('https://api.bingyun.vip/v1'), 'https://api.bingyun.vip/v1');
  assert.equal(normalizeBaseUrl('https://api.bingyun.vip/v1/models'), 'https://api.bingyun.vip/v1');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/v1');
  assert.equal(normalizeBaseUrl(''), 'https://api.bingyun.vip/v1');
  // 以 / 结尾表示"原样用"，不再自动补 v1
  assert.equal(normalizeBaseUrl('https://api.bingyun.vip/'), 'https://api.bingyun.vip/');
  assert.equal(normalizeBaseUrl('https://api.bingyun.vip/openai/v1/'), 'https://api.bingyun.vip/openai/v1/');
});

test('normalizeModels 认得出生图模型，字段与后端一致', () => {
  const list = normalizeModels({ data: [
    { id: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol', supportsReasoningEffort: true },
    { id: 'gpt-image-2.5-sunburst' },
  ] });
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], {
    id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', kind: 'chat', reasoning: true,
    reasoningEfforts: [], defaultReasoningEffort: null, qualityOptions: [], defaultQuality: null,
    imageParameters: { size: false, output_format: false, background: false },
    // 没传目录时 vision 只能是「未知」，不能顺手判成 false
    vision: null,
  });
  assert.equal(list[1].kind, 'image', '名字里带 image 的应判为生图模型');
  assert.equal(list[1].name, 'gpt-image-2.5-sunburst', '没有 display_name 时回退到 id');
});

test('guessKind 覆盖各种生图模型命名', () => {
  assert.equal(guessKind('dall-e-3'), 'image');
  assert.equal(guessKind('FLUX.1-pro'), 'image');
  assert.equal(guessKind('gpt-5.4'), 'chat');
  assert.equal(guessKind(''), 'chat', '空值不能崩');
});

test('summarizeUsage 三套协议字段对齐后端', () => {
  assert.deepEqual(
    summarizeUsage('chat_completions', { prompt_tokens: 10, completion_tokens: 2,
      prompt_tokens_details: { cached_tokens: 7 } }),
    { input_tokens: 10, output_tokens: 2, cache_write_tokens: null, cache_read_tokens: 7 },
  );
  assert.deepEqual(
    summarizeUsage('responses', { input_tokens: 3, output_tokens: 4,
      input_tokens_details: { cache_write_tokens: 1 } }),
    { input_tokens: 3, output_tokens: 4, cache_write_tokens: 1, cache_read_tokens: null },
  );
  assert.deepEqual(
    summarizeUsage('messages', { input_tokens: 1, output_tokens: 2,
      cache_read_input_tokens: 9 }),
    { input_tokens: 1, output_tokens: 2, cache_write_tokens: null, cache_read_tokens: 9 },
  );
  // 图片返回明确 token 数时显示；不会把金额或计费单位换算成 token。
  assert.deepEqual(summarizeUsage('images_generate', { input_tokens: 15, output_tokens: 300,
    input_tokens_details: { cached_tokens: 5 } }),
  { input_tokens: 15, output_tokens: 300, cache_read_tokens: 5, cache_write_tokens: null });
  assert.equal(summarizeUsage('images_generate', { cost: 1 }).input_tokens, null);
  assert.equal(summarizeUsage('chat_completions', null).input_tokens, null);
});

test('convertUpstreamEvent 把三套协议的原生事件翻成统一事件', () => {
  const state = { usage: null };

  assert.deepEqual(
    convertUpstreamEvent('chat_completions',
      { event: 'message', data: { choices: [{ delta: { content: '你好' } }] } }, state),
    [{ event: 'content', data: { text: '你好' } }],
  );
  assert.deepEqual(
    convertUpstreamEvent('chat_completions',
      { event: 'message', data: { choices: [{ delta: { reasoning_content: '想想' } }] } }, state),
    [{ event: 'reasoning', data: { text: '想想' } }],
  );

  assert.deepEqual(
    convertUpstreamEvent('responses',
      { event: 'message', data: { type: 'response.output_text.delta', delta: '答案' } }, state),
    [{ event: 'content', data: { text: '答案' } }],
  );
  // response.completed 不直接产出事件，只把用量记进 state
  assert.deepEqual(
    convertUpstreamEvent('responses',
      { event: 'message', data: { type: 'response.completed',
        response: { usage: { input_tokens: 5, output_tokens: 6 } } } }, state),
    [],
  );
  assert.equal(state.usage.input_tokens, 5);

  assert.deepEqual(
    convertUpstreamEvent('messages',
      { event: 'content_block_delta', data: { delta: { type: 'thinking_delta', thinking: '推' } } }, state),
    [{ event: 'reasoning', data: { text: '推' } }],
  );
});

test('convertUpstreamEvent 遇到 response.failed 要报错而不是静默', () => {
  const out = convertUpstreamEvent('responses', {
    event: 'message',
    data: { type: 'response.failed', response: { error: { message: '余额不足' } } },
  }, { usage: null });
  assert.equal(out[0].event, 'error');
  assert.match(out[0].data.message, /余额不足/);
});

test('maskKey 绝不能吐出完整密钥', () => {
  const key = 'sk-abcdefghijklmnopqrstuvwxyz1234';
  const masked = maskKey(key);
  assert.notEqual(masked, key);
  assert.ok(masked.includes('*'), '掩码必须含 * 号');
  assert.equal(masked, 'sk-abcd *** 1234', '保留 sk- 前缀与正文前后各 4 位');
  assert.ok(!masked.includes('abcdefghijklmnopqrstuvwxyz'), '中段不能泄露');
  assert.equal(maskKey(''), '');
  assert.equal(maskKey('short'), '*****', '过短的密钥整个打码');
  assert.equal(maskKey('sk-12345678'), '***********', '短密钥不能因首尾重叠而完整泄露');
  assert.equal(maskKey('abcdefghijklmnop'), 'abcd *** mnop', '非 sk- 密钥也保留前后各 4 位');
});

/* ---------------------------------------------------------------------------
 * 模型能力：只认 OpenRouter 目录。这一组专门盯住「上游不声明就误判成不支持」
 * 那类 bug —— 真实上游 /v1/models 只有 created/display_name/id/object/owned_by/type，
 * 根本没有 supportsReasoningEffort，能力必须靠目录补。
 * ------------------------------------------------------------------------- */
test('真实上游形状（没有任何能力字段）也能从目录拿到推理档位和视觉能力', () => {
  const list = normalizeModels({ data: [
    // 上游实际返回的字段就这些，一个能力字段都没有
    { id: 'gpt-5.6-terra', display_name: 'GPT-5.6 Terra', object: 'model', owned_by: 'openai', type: 'chat', created: 1 },
  ] }, catalog);
  const terra = list[0];
  assert.equal(terra.id, 'gpt-5.6-terra');
  assert.deepEqual(terra.reasoningEfforts, ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(terra.reasoning, true, 'gpt-5.6-terra 支持推理，不能被误标成不支持');
  assert.equal(terra.vision, true, 'gpt-5.6-terra 支持图像输入');
});

test('OpenRouter 明确不支持图像输入的模型，vision 判 false', () => {
  const only = modelCapabilities({ id: 'text-only-model', vision: false });
  assert.equal(only.vision, false);
  assert.deepEqual(only.reasoningEfforts, []);
});

test('目录里查不到的模型不硬猜：推理档位和视觉都留空', () => {
  const unknown = modelCapabilities({ id: 'totally-unknown-model' }, catalog);
  assert.deepEqual(unknown.reasoningEfforts, []);
  assert.equal(unknown.vision, null, '查不到时是未知，不该顺手判成不支持');
});

/* ---------------------------------------------------------------------------
 * 文本模型带参考图：中间格式 → 三套协议各自的图片写法
 * ------------------------------------------------------------------------- */
const MULTIMODAL = [
  { type: 'text', text: '这是什么' },
  { type: 'image', image: 'data:image/png;base64,aGk=' },
];

test('responses 把参考图翻成 input_image', () => {
  const content = toUpstreamContent('responses', MULTIMODAL);
  assert.deepEqual(content, [
    { type: 'input_text', text: '这是什么' },
    { type: 'input_image', image_url: 'data:image/png;base64,aGk=', detail: 'auto' },
  ]);
});

test('chat_completions 把参考图翻成 image_url', () => {
  const content = toUpstreamContent('chat_completions', MULTIMODAL);
  assert.deepEqual(content, [
    { type: 'text', text: '这是什么' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,aGk=' } },
  ]);
});

test('messages（Claude）把参考图翻成 base64 source，且不带 data: 前缀', () => {
  const content = toUpstreamContent('messages', MULTIMODAL);
  assert.deepEqual(content, [
    { type: 'text', text: '这是什么' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGk=' } },
  ]);
});

test('不带图时还原成纯字符串，和以前发出的请求体一模一样', () => {
  assert.equal(toUpstreamContent('responses', '纯文本'), '纯文本');
  assert.equal(toUpstreamContent('chat_completions', [{ type: 'text', text: '只有文字' }]), '只有文字');
});

test('外链图片一律不发，避免把服务器当探针', () => {
  assert.throws(
    () => toUpstreamContent('responses', [{ type: 'image', image: 'http://169.254.169.254/latest/meta-data' }]),
    /内联图片/,
  );
});
