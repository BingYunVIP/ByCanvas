import test from 'node:test';
import assert from 'node:assert/strict';
import { generateImage, editImage, streamChat, setTransportOverride, ApiError } from '../js/api.js';

const profile = { baseUrl: 'https://upstream.example.test/v1', apiKey: 'sk-fake-key-for-tests' };
// 数量（n）、审核（moderation）已经整个下线，不再是请求参数——见 2026-09-20 的改动。
const params = { model: 'gpt-image-2.5-sunburst', prompt: 'a blue circle', size: 'auto', quality: 'auto', output_format: 'png' };
const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const defaults = { model: params.model, prompt: params.prompt, output_format: 'png' };
const oldFlags = { stream: true, streamImages: true, partial_images: 3, response_format: 'b64_json', codexCli: true, transparentMode: 'local', text_model: 'gpt-5.6-sol', reasoning_effort: 'max' };

function setup(t, transport, fetcher) {
  setTransportOverride(transport);
  t.after(() => setTransportOverride(''));
  t.mock.method(globalThis, 'fetch', fetcher);
}

function imageResponse(transport) {
  return Response.json(transport === 'direct'
    ? { data: [{ b64_json: b64 }] }
    : { images: [{ b64, mime: 'image/png' }] });
}

for (const transport of ['direct', 'proxy']) {
  test(`${transport}: 不适用/未声明参数不会被补回`, async (t) => {
    const file = new File(['reference-image'], 'ref.png', { type: 'image/png' });
    const minimal = { model: 'custom-image', prompt: '修改背景' };
    const field = transport === 'direct' ? 'image' : 'images';
    setup(t, transport, async (_url, init) => {
      if (typeof init.body === 'string') assert.deepEqual(JSON.parse(init.body), minimal);
      else {
        const body = Object.fromEntries(init.body);
        assert.equal(body[field].name, 'ref.png');
        delete body[field];
        assert.deepEqual(body, { model: minimal.model, prompt: minimal.prompt });
      }
      return imageResponse(transport);
    });
    const generated = await generateImage(profile, minimal);
    const edited = await editImage(profile, minimal, [file]);
    assert.equal(generated.images.length, 1);
    assert.equal(edited.images.length, 1);
    for (const image of [...generated.images, ...edited.images]) URL.revokeObjectURL(image.url);
  });

  test(`${transport}: 默认生图请求不携带旧开关或强制返回格式`, async (t) => {
    setup(t, transport, async (url, init) => {
      assert.equal(url, transport === 'direct' ? profile.baseUrl + '/images/generations' : '/api/images/generate');
      assert.deepEqual(JSON.parse(init.body), defaults);
      assert.equal(init.headers[transport === 'direct' ? 'Authorization' : 'X-Upstream-Key'],
        transport === 'direct' ? 'Bearer ' + profile.apiKey : profile.apiKey);
      return imageResponse(transport);
    });
    const result = await generateImage(profile, { ...params, ...oldFlags });
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].blob.type, 'image/png');
    assert.ok(result.images[0].blob.size > 0);
    URL.revokeObjectURL(result.images[0].url);
  });

  test(`${transport}: 参考图使用正确的 multipart 字段并省略 auto 参数`, async (t) => {
    const file = new File(['reference-image'], 'ref.png', { type: 'image/png' });
    setup(t, transport, async (url, init) => {
      assert.equal(url, transport === 'direct' ? profile.baseUrl + '/images/edits' : '/api/images/edit');
      const field = transport === 'direct' ? 'image' : 'images';
      const body = Object.fromEntries(init.body);
      assert.deepEqual(Object.keys(body).sort(), [...Object.keys(defaults), field].sort());
      for (const [key, value] of Object.entries(defaults)) assert.equal(body[key], value);
      assert.equal(await body[field].text(), 'reference-image');
      assert.ok(!('Content-Type' in init.headers));
      return imageResponse(transport);
    });
    const result = await editImage(profile, { ...params, ...oldFlags }, [file]);
    URL.revokeObjectURL(result.images[0].url);
  });
}

test('改图失败会抛出清晰的错误，不会被静默吞掉', async (t) => {
  setup(t, 'direct', async () => Response.json({ detail: '服务暂时繁忙' }, { status: 429 }));
  await assert.rejects(
    editImage(profile, params, [new File(['ref'], 'ref.png')]),
    /服务暂时繁忙/,
  );
});

test('取消改图请求会中止底层 fetch，不留下已完成的假结果', async (t) => {
  const controller = new AbortController();
  setup(t, 'direct', async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }));
  const promise = editImage(profile, params, [new File(['ref'], 'ref.png')], controller.signal);
  controller.abort();
  await assert.rejects(promise);
});

test('用户在输入栏选择的尺寸、质量、格式和原生透明背景仍会发送', async (t) => {
  setup(t, 'direct', async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), {
      ...defaults, size: '1024x1536', quality: 'high', output_format: 'webp', background: 'transparent',
    });
    return imageResponse('direct');
  });
  const result = await generateImage(profile, {
    ...params, size: '1024x1536', quality: 'high', output_format: 'webp', background: 'transparent',
  });
  URL.revokeObjectURL(result.images[0].url);
});

test('上游返回 URL 时自动下载，不要求用户开启 Base64', async (t) => {
  class Reader {
    async readAsDataURL(blob) {
      this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
      this.onload();
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
  globalThis.FileReader = Reader;
  t.after(() => original ? Object.defineProperty(globalThis, 'FileReader', original) : delete globalThis.FileReader);
  const urls = [];
  setup(t, 'direct', async (url, init) => {
    urls.push(url);
    if (urls.length === 1) return Response.json({ data: [{ url: 'https://cdn.example.test/image' }] });
    assert.equal(init, undefined, '图片下载不能携带 API Key');
    return new Response(Buffer.from(b64, 'base64'), { headers: { 'Content-Type': 'image/png' } });
  });
  const result = await generateImage(profile, params);
  assert.equal(urls.length, 2);
  assert.deepEqual(Buffer.from(await result.images[0].blob.arrayBuffer()), Buffer.from(b64, 'base64'));
  URL.revokeObjectURL(result.images[0].url);
});

test('直连被浏览器阻止时自动走中转，仍使用相同默认参数', async (t) => {
  const requests = [];
  setup(t, '', async (url, init) => {
    requests.push(url);
    assert.deepEqual(JSON.parse(init.body), defaults);
    if (url.startsWith('https:')) throw new TypeError('Failed to fetch');
    return imageResponse('proxy');
  });
  const result = await generateImage(profile, params);
  assert.deepEqual(requests, [profile.baseUrl + '/images/generations', '/api/images/generate']);
  URL.revokeObjectURL(result.images[0].url);
});

test('空的图片响应必须失败，不能触发任务成功通知', async (t) => {
  setup(t, 'direct', async () => Response.json({ data: [] }));
  await assert.rejects(generateImage(profile, params), /没有返回任何图片/);
});

const chat = { mode: 'auto', model: 'gpt-5.5', messages: [{ role: 'user', content: '你好' }] };

test('聊天自动切换不兼容的接口，无需用户设置协议', async (t) => {
  const paths = [];
  setup(t, 'direct', async (url, init) => {
    paths.push(url);
    assert.equal(JSON.parse(init.body).stream, true);
    if (url.endsWith('/responses')) return Response.json({ error: 'unsupported endpoint' }, { status: 404 });
    return new Response('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n');
  });
  const events = [];
  for await (const ev of streamChat(profile, chat)) events.push(ev);
  assert.deepEqual(paths, [profile.baseUrl + '/responses', profile.baseUrl + '/chat/completions']);
  assert.equal(events.filter((e) => e.event === 'content').map((e) => e.data.text).join(''), '你好');
});

for (const status of [401, 403, 429]) {
  test(`聊天 HTTP ${status} 不会换接口重复请求`, async (t) => {
    let count = 0;
    setup(t, 'direct', async () => { count++; return Response.json({ error: 'rejected' }, { status }); });
    await assert.rejects(async () => { for await (const _ of streamChat(profile, chat)) {} }, ApiError);
    assert.equal(count, 1);
  });
}

test('聊天已经输出或用户取消后，不会换协议重新发送', async (t) => {
  let count = 0;
  setup(t, 'direct', async () => {
    count++;
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"已收到"}\n\n'));
      },
      pull(controller) { controller.error(new TypeError('network disconnected')); },
    }));
  });
  const events = [];
  await assert.rejects(async () => { for await (const ev of streamChat(profile, chat)) events.push(ev); }, TypeError);
  assert.equal(events[0].data.text, '已收到');
  assert.equal(count, 1);
  t.mock.method(globalThis, 'fetch', async () => { count++; throw new DOMException('cancelled', 'AbortError'); });
  await assert.rejects(async () => { for await (const _ of streamChat(profile, chat)) {} }, { name: 'AbortError' });
  assert.equal(count, 2);
});
