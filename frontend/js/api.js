import { tr } from './i18n-text.js';
import { readSSE } from './sse.js';

/**
 * 后端调用层 —— 全站**唯一**发请求的地方。
 * 换后端地址、改鉴权方式、调整参数字段，只动这一个文件。
 *
 * 两条通道：
 *   ① 直连（浏览器 → 上游）：上游开了 CORS 时走这条。请求不经过我们的服务器，
 *      Key 一步都不离开浏览器；长时间的生图请求也不会卡在本地回环上。
 *   ② 中转（浏览器 → 后端 → 上游）：上游没开 CORS 时的兜底。
 *  走哪条是**自动探测**的：默认先试直连，被浏览器的同源策略拦下来
 *  （fetch 抛 TypeError）就记住这个地址不支持跨域，之后改走中转。
 *  想强制指定：在地址后加 ?transport=direct 或 ?transport=proxy 访问一次。
 *
 * 其它关键约定：
 *   1. 中转时 API 地址与 Key 通过请求头带给后端，后端只做透传、用完即弃。
 *   2. 流式聊天用 fetch + ReadableStream 手动解析 SSE —— 不能用 EventSource，
 *      因为它无法自定义请求头，而我们的 Key 必须放在请求头里。
 *   3. 图片以 base64 返回，在这里转成 Blob，绝不依赖服务器上的文件路径。
 */

import { modelCapabilities, loadCapabilityCatalog, optionValues } from './model-capabilities.js';
import { imagePlanBody, readImagePlan, combineImageUsage } from './image-plan.js';

export const DEFAULT_UPSTREAM = 'https://api.bingyun.vip/v1';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** URL 放进 HTTP 头前做 base64url 编码，避免特殊字符破坏头格式。 */
export function encodeBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 把用户填的地址补齐成 .../v1，与后端 deps.py 的 normalize_base_url 保持一致。 */
export function normalizeBaseUrl(raw) {
  const input = String(raw || '').trim();
  if (!input) return DEFAULT_UPSTREAM;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input) ? input : `https://${input}`;
  let u;
  try { u = new URL(withScheme); } catch { return DEFAULT_UPSTREAM; }
  if (input.endsWith('/')) {
    const path = u.pathname ? u.pathname.replace(/\/+$/, '/') : '/';
    return u.origin + path;
  }
  const segments = u.pathname.split('/').filter(Boolean);
  const vi = segments.indexOf('v1');
  if (vi >= 0) segments.length = vi + 1;
  else segments.push('v1');
  return `${u.origin}/${segments.join('/')}`;
}

/* ---------------------------------------------------------------------------
 * 直连探测与缓存
 * ------------------------------------------------------------------------- */

const CORS_CACHE_KEY = 'bycanvas.cors';
let transportOverride = '';   // 'direct' | 'proxy' | ''

export function setTransportOverride(value) {
  transportOverride = (value === 'direct' || value === 'proxy') ? value : '';
}

/** 当前生效的通道名，给界面显示用 */
export function transportName(profile) {
  return shouldTryDirect(profile) ? 'direct' : 'proxy';
}

function readCorsCache() {
  try { return JSON.parse(localStorage.getItem(CORS_CACHE_KEY) || '{}') || {}; } catch { return {}; }
}

function markCors(profile, ok) {
  try {
    const cache = readCorsCache();
    cache[normalizeBaseUrl(profile && profile.baseUrl)] = { ok: !!ok, at: Date.now() };
    localStorage.setItem(CORS_CACHE_KEY, JSON.stringify(cache));
  } catch { /* 隐私模式下写不了就算了，退化成每次都试 */ }
}

/** 没探测过就先试直连；试过就按结果来。 */
function shouldTryDirect(profile) {
  if (transportOverride === 'proxy') return false;
  if (transportOverride === 'direct') return true;
  const hit = readCorsCache()[normalizeBaseUrl(profile && profile.baseUrl)];
  return hit ? !!hit.ok : true;
}

/** fetch 被同源策略拦下时抛的是 TypeError（不是 ApiError），这是唯一的判据。 */
function isCorsFailure(err) {
  return !!err && (err instanceof TypeError || err.name === 'TypeError');
}

/* ---------------------------------------------------------------------------
 * 归一化：把上游的原生响应整成和中转通道一样的形状
 * ------------------------------------------------------------------------- */

// nano-banana 是 Gemini 图像模型的产品代号，id 里不含 image/video，必须显式列出。
const IMAGE_HINTS = ['image', 'dall', 'flux', 'midjourney', 'imagen', 'seedream', 'nano-banana'];
const VIDEO_HINTS = ['video', 'sora', 'veo', 'kling', 'runway'];

/**
 * 不向用户展示的模型 id（小写）。内部审核模型 + 产品侧明确要求隐藏的三个。
 * 直连与中转两条通道共用同一份名单，避免两边展示不一致。
 */
export const HIDDEN_MODEL_IDS = [
  'codex-auto-review',
  'gpt-image-medium',
  'gpt-reserve',
  'grok-4.7-build-fast',
];

export function isHiddenModel(modelId) {
  return HIDDEN_MODEL_IDS.includes(String(modelId || '').trim().toLowerCase());
}

/** 与后端 guess_kind 保持一致：靠模型名判断是聊天还是出图。 */
export function guessKind(modelId) {
  const id = String(modelId || '').toLowerCase();
  // 视频先判：grok-imagine-video 这类 id 同时含 image/video，必须落到 video 上。
  if (VIDEO_HINTS.some((h) => id.includes(h))) return 'video';
  return IMAGE_HINTS.some((h) => id.includes(h)) ? 'image' : 'chat';
}

export function normalizeModels(payload, catalog = {}) {
  const raw = Array.isArray(payload) ? payload : ((payload && payload.data) || []);
  return raw
    .filter((it) => it && typeof it.id === 'string' && it.id.trim() && !isHiddenModel(it.id))
    .map((it) => {
      const cap = modelCapabilities(it, catalog);
      return {
        id: it.id,
        name: it.display_name || it.name || it.id,
        ...cap,
        // 目录（openrouter.ai 同步来的快照）里明确标了 kind 就以它为准，否则按 id 猜。
        // 新模型在上游出现时，只要目录里有它，前端不用改代码就能走对接口。
        kind: cap.kind || guessKind(it.id),
      };
    });
}

export async function withModelCapabilities(models) {
  return normalizeModels(models, await loadCapabilityCatalog());
}

/** 三套协议的用量字段名各不相同，在这里统一（与后端 summarize_usage 对齐）。 */
export function summarizeUsage(mode, raw) {
  const empty = {
    input_tokens: null, output_tokens: null,
    cache_write_tokens: null, cache_read_tokens: null,
  };
  if (!raw || typeof raw !== 'object') return empty;
  const pick = (obj, k) => ((obj && obj[k] != null) ? obj[k] : null);
  if (['responses', 'images_generate', 'images_edit'].includes(mode)) {
    const d = raw.input_tokens_details || {};
    return {
      input_tokens: pick(raw, 'input_tokens'),
      output_tokens: pick(raw, 'output_tokens'),
      cache_write_tokens: pick(d, 'cache_write_tokens'),
      cache_read_tokens: pick(d, 'cached_tokens'),
    };
  }
  if (mode === 'chat_completions') {
    const d = raw.prompt_tokens_details || {};
    return {
      input_tokens: pick(raw, 'prompt_tokens'),
      output_tokens: pick(raw, 'completion_tokens'),
      cache_write_tokens: pick(d, 'cache_write_tokens'),
      cache_read_tokens: pick(d, 'cached_tokens'),
    };
  }
  return {
    input_tokens: pick(raw, 'input_tokens'),
    output_tokens: pick(raw, 'output_tokens'),
    cache_write_tokens: pick(raw, 'cache_creation_input_tokens'),
    cache_read_tokens: pick(raw, 'cache_read_input_tokens'),
  };
}

/* ---------------------------------------------------------------------------
 * 通用小工具
 * ------------------------------------------------------------------------- */

function buildHeaders(profile, extra = {}) {
  const headers = {
    'X-Upstream-Base': encodeBase64Url(profile.baseUrl || DEFAULT_UPSTREAM),
    'X-Upstream-Key': profile.apiKey || '',
    ...extra,
  };
  return headers;
}

/** 直连时的鉴权头。Anthropic 用 x-api-key，其余用 Bearer。 */
function upstreamHeaders(profile, mode) {
  if (mode === 'messages') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': profile.apiKey || '',
      'anthropic-version': '2023-06-01',
    };
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${profile.apiKey || ''}`,
  };
}

async function readError(resp) {
  let detail = `HTTP ${resp.status}`;
  try {
    const body = await resp.json();
    detail = body.detail || JSON.stringify(body);
  } catch {
    const text = await resp.text().catch(() => '');
    if (text) detail = text.slice(0, 300);
  }
  return detail;
}

/** Key 摘要：保留 sk- 前缀、正文前后各 4 位；短密钥全部打码，避免首尾重叠。 */
export function maskKey(key) {
  const k = String(key || '');
  if (!k) return '';
  const prefix = k.startsWith('sk-') ? 'sk-' : '';
  const body = k.slice(prefix.length);
  if (body.length <= 8) return '*'.repeat(k.length);
  return `${prefix}${body.slice(0, 4)} *** ${body.slice(-4)}`;
}

export async function healthz() {
  const resp = await fetch('/api/healthz');
  if (!resp.ok) throw new ApiError(await readError(resp), resp.status);
  return resp.json();
}

/**
 * 解析一段 SSE 文本。格式是：
 *   event: content\n
 *   data: {"text":"..."}\n\n
 */
export function parseSSEChunk(raw) {
  let name = 'message';
  const dataLines = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) name = line.slice(7).trim();
    else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
    else if (line.startsWith('data:')) dataLines.push(line.slice(5));
  }
  if (!dataLines.length) return null;
  try {
    return { event: name, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

/** base64 转 Blob，供前端直接展示或存 IndexedDB。 */
export function b64ToBlob(b64, mime) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'image/png' });
}

function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      const comma = url.indexOf(',');
      resolve(comma >= 0 ? url.slice(comma + 1) : '');
    };
    reader.onerror = () => reject(reader.error || new Error(tr("读取图片失败")));
    reader.readAsDataURL(blob);
  });
}

/** 看 base64 开头几个字节判断图片类型（和后端 sniff_image_mime 一个思路）。 */
function mimeFromB64(b64) {
  if (!b64) return 'image/png';
  if (b64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return 'image/png';
}

function toImages(list) {
  return (list || []).map((item) => {
    const blob = b64ToBlob(item.b64, item.mime);
    return { blob, mime: item.mime, url: URL.createObjectURL(blob) };
  });
}

/* ---------------------------------------------------------------------------
 * 模型列表
 * ------------------------------------------------------------------------- */

async function fetchModelsDirect(profile, signal) {
  const base = normalizeBaseUrl(profile.baseUrl);
  const resp = await fetch(`${base}/models`, {
    method: 'GET',
    headers: upstreamHeaders(profile, 'chat'),
    signal,
  });
  if (!resp.ok) throw new ApiError(await readError(resp), resp.status);
  const payload = await resp.json();
  let raw = (Array.isArray(payload) ? payload : payload?.data || []).filter((m) => m && typeof m.id === 'string');
  if (raw.some((m) => guessKind(m.id) === 'image' && !optionValues(m.qualityOptions || m.quality_options || m.supportedQualities).length)) {
    const probe = new AbortController();
    const cancel = () => probe.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timeout = setTimeout(cancel, 3000);
    try {
      const extra = await fetch(`${base}/images/models`, { headers: upstreamHeaders(profile, 'chat'), signal: probe.signal });
      if (extra.ok) {
        const data = await extra.json();
        const list = Array.isArray(data) ? data : data?.data || [];
        const byId = new Map(list.filter((m) => m && typeof m.id === 'string').map((m) => [m.id, m]));
        raw = raw.map((item) => {
          const detail = byId.get(item.id);
          if (!detail) return item;
          const merged = { ...detail, ...item };
          if (detail.supported_parameters && !Array.isArray(detail.supported_parameters)) {
            merged.supported_parameters = { ...detail.supported_parameters,
              ...(Array.isArray(item.supported_parameters) ? {} : item.supported_parameters) };
          }
          return merged;
        });
      }
    } catch { /* 可选元数据接口不受支持时，继续使用已有模型列表。 */ }
    finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); }
  }
  const catalog = await loadCapabilityCatalog();
  return normalizeModels(raw, catalog);
}

async function fetchModelsViaBackend(profile, signal) {
  const resp = await fetch('/api/models', {
    method: 'POST',
    headers: buildHeaders(profile),
    signal,
  });
  if (!resp.ok) throw new ApiError(await readError(resp), resp.status);
  return withModelCapabilities(await resp.json());
}

/** 拉取上游模型列表。返回 [{ id, name, kind, reasoning }]，kind 为 chat | image。 */
export async function fetchModels(profile, signal) {
  if (shouldTryDirect(profile)) {
    try {
      const models = await fetchModelsDirect(profile, signal);
      markCors(profile, true);
      return models;
    } catch (err) {
      // 能拿到 HTTP 响应说明 CORS 是通的（只是 Key/参数有问题），没必要改走中转
      if (!isCorsFailure(err)) throw err;
      markCors(profile, false);
    }
  }
  return fetchModelsViaBackend(profile, signal);
}

/* ---------------------------------------------------------------------------
 * 流式聊天
 * ------------------------------------------------------------------------- */

/** 把上游原生 SSE 事件翻成前端统一的 content / reasoning / usage / error。 */
export function convertUpstreamEvent(mode, ev, state) {
  const out = [];
  const d = (ev && ev.data) || {};

  if (mode === 'chat_completions') {
    const choices = d.choices || [];
    if (choices.length) {
      const delta = choices[0].delta || {};
      if (delta.reasoning_content) out.push({ event: 'reasoning', data: { text: delta.reasoning_content } });
      if (delta.content) out.push({ event: 'content', data: { text: delta.content } });
    }
    if (d.usage) state.usage = summarizeUsage('chat_completions', d.usage);
    return out;
  }

  if (mode === 'responses') {
    const type = d.type || '';
    if (type.endsWith('output_text.delta')) {
      out.push({ event: 'content', data: { text: d.delta || '' } });
    } else if (type.endsWith('reasoning_summary_text.delta')) {
      out.push({ event: 'reasoning', data: { text: d.delta || '' } });
    } else if (type === 'response.completed' || type === 'response.failed') {
      const resp = d.response || {};
      state.usage = summarizeUsage('responses', resp.usage);
      if (type === 'response.failed') {
        out.push({ event: 'error', data: { message: (resp.error || {}).message || tr("响应失败") } });
      }
    }
    return out;
  }

  // Anthropic /messages：事件类型在 event: 行里
  if (ev.event === 'content_block_delta') {
    const delta = d.delta || {};
    if (delta.type === 'text_delta') out.push({ event: 'content', data: { text: delta.text || '' } });
    else if (delta.type === 'thinking_delta') out.push({ event: 'reasoning', data: { text: delta.thinking || '' } });
  } else if (ev.event === 'message_delta') {
    state.usage = summarizeUsage('messages', d.usage);
  }
  return out;
}

/** 拆 data URL。只认内联图片，外链一律不发（后端同样拒绝，防服务器被当探针）。 */
export function splitDataUrl(url) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(String(url || ''));
  return match ? { mime: match[1].toLowerCase(), b64: match[2] } : null;
}

/**
 * 中间格式 → 某套协议的图片写法。与后端 protocols/multimodal.py 一一对应。
 * 中间格式：'纯文本' 或 [{type:'text',text}, {type:'image',image:'data:image/png;base64,...'}]
 *   /responses         input_text    / input_image + image_url
 *   /chat/completions  text          / image_url + {url}
 *   /messages (Claude) text          / image + base64 source
 */
export function toUpstreamContent(mode, content) {
  if (!Array.isArray(content)) return content;
  // 文本片段在 /responses 里叫 input_text，另外两套都叫 text
  const textType = mode === 'responses' ? 'input_text' : 'text';
  const parts = content.map((part) => {
    if (!part || part.type !== 'image') return { type: textType, text: String(part?.text ?? '') };
    const split = splitDataUrl(part.image);
    if (!split) throw new Error(tr("参考图只支持内联图片，无法发送外部链接。"));
    const url = `data:${split.mime};base64,${split.b64}`;
    if (mode === 'responses') return { type: 'input_image', image_url: url, detail: 'auto' };
    if (mode === 'messages') return { type: 'image', source: { type: 'base64', media_type: split.mime, data: split.b64 } };
    return { type: 'image_url', image_url: { url } };
  });
  // 没有图的时候还原成纯字符串：和历史消息一个形状，也避免上游不认数组
  if (parts.every((part) => part.type === textType)) return parts.map((part) => part.text).join('');
  return parts;
}

async function* streamUpstream(profile, mode, payload, signal) {
  const base = normalizeBaseUrl(profile.baseUrl);
  const messages = (payload.messages || []).map((m) => ({
    role: m.role,
    content: toUpstreamContent(mode, m.content),
  }));

  let url;
  let body;
  if (mode === 'messages') {
    url = `${base}/messages`;
    body = { model: payload.model, max_tokens: payload.max_tokens || 2048, messages, stream: true };
    if (payload.reasoning_effort) body.output_config = { effort: payload.reasoning_effort };
  } else if (mode === 'responses') {
    url = `${base}/responses`;
    body = { model: payload.model, input: messages, stream: true };
    if (payload.reasoning_effort) body.reasoning = { effort: payload.reasoning_effort, summary: 'auto' };
  } else {
    url = `${base}/chat/completions`;
    body = { model: payload.model, messages, stream: true };
    if (payload.reasoning_effort) body.reasoning_effort = payload.reasoning_effort;
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: upstreamHeaders(profile, mode),
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw new ApiError(await readError(resp), resp.status);
  if (!resp.body) throw new ApiError(tr("浏览器不支持流式响应。"), 0);

  const state = { usage: null };
  let completed = false;
  let hasContent = false;
  for await (const event of readSSE(resp.body)) {
    if (event.data === '[DONE]') { completed = true; break; }
    let data;
    try { data = JSON.parse(event.data); }
    catch { throw new ApiError(tr('无法解析聊天流式响应。'), 502); }
    const ev = { event: event.event || 'message', data };
    if (ev.event === 'error' || data.type === 'error') throw new ApiError(data.error?.message || data.message || tr('响应失败'), 502);
    if (data.type === 'response.failed' || data.type === 'response.incomplete') throw new ApiError(data.response?.error?.message || tr('回复尚未完成，请重试。'), 502);
    for (const out of convertUpstreamEvent(mode, ev, state)) {
      if ((out.event === 'content' || out.event === 'reasoning') && out.data.text?.trim()) hasContent = true;
      yield out;
    }
    if (data.type === 'response.completed' || ev.event === 'message_stop') { completed = true; break; }
  }
  if (!hasContent) throw new ApiError(tr('聊天接口没有返回任何内容。'), 502);
  if (!completed) throw new ApiError(tr('回复尚未完成，请重试。'), 502);
  if (state.usage) yield { event: 'usage', data: state.usage };
  yield { event: 'done', data: {} };
}

async function* streamChatDirect(profile, payload, signal) {
  // 与后端 _auto() 同样的顺序：claude 走 messages，其余先 responses 再 chat/completions
  const id = String(payload.model || '').toLowerCase();
  const modes = payload.mode !== 'auto'
    ? [payload.mode]
    : (id.includes('claude') ? ['messages'] : ['responses', 'chat_completions']);

  let lastError = null;
  for (const mode of modes) {
    let emitted = 0;
    try {
      for await (const ev of streamUpstream(profile, mode, payload, signal)) {
        if (ev.event === 'content' || ev.event === 'reasoning') emitted += 1;
        yield ev;
      }
      return;
    } catch (err) {
      lastError = err;
      // 已经出过半截就别换协议了，否则用户会看到两段回答拼在一起
      // 自动模式遇到接口不兼容/网关失败也要尝试下一套；认证、限流和用户取消不重试。
      const canFallback = isCorsFailure(err) || (err instanceof ApiError
        && [400, 404, 405, 415, 422, 500, 501, 502, 503, 504].includes(err.status));
      if (emitted > 0 || !canFallback) throw err;
    }
  }
  throw lastError;
}

async function* streamChatViaBackend(profile, payload, signal) {
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: buildHeaders(profile, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    signal,
  });
  if (!resp.ok) throw new ApiError(await readError(resp), resp.status);
  if (!resp.body) throw new ApiError(tr("浏览器不支持流式响应。"), 0);

  let completed = false, hasContent = false;
  for await (const event of readSSE(resp.body)) {
    let data;
    try { data = JSON.parse(event.data); }
    catch { throw new ApiError(tr('无法解析聊天流式响应。'), 502); }
    if (event.event === 'error') throw new ApiError(data.message || tr('响应失败'), 502);
    if ((event.event === 'content' || event.event === 'reasoning') && data.text?.trim()) hasContent = true;
    if (event.event === 'done') { completed = true; break; }
    yield { event: event.event || 'message', data };
  }
  if (!hasContent) throw new ApiError(tr('聊天接口没有返回任何内容。'), 502);
  if (!completed) throw new ApiError(tr('回复尚未完成，请重试。'), 502);
  yield { event: 'done', data: {} };
}

/**
 * 流式聊天。异步生成器，逐个产出 { event, data }。
 * 事件类型：content（正文增量）、reasoning（推理过程）、usage（用量）、error、done
 */
export async function* streamChat(profile, payload, signal) {
  if (shouldTryDirect(profile)) {
    let emitted = 0;
    try {
      for await (const ev of streamChatDirect(profile, payload, signal)) {
        if (ev.event === 'content' || ev.event === 'reasoning') emitted += 1;
        yield ev;
      }
      markCors(profile, true);
      return;
    } catch (err) {
      if (emitted > 0) throw err;   // 已经出内容了，不能换通道
      if (!isCorsFailure(err)) throw err;
      markCors(profile, false);     // 记下来，下次直接走中转
    }
  }
  yield* streamChatViaBackend(profile, payload, signal);
}

/* ---------------------------------------------------------------------------
 * 生图 / 改图
 * ------------------------------------------------------------------------- */

/** 图片辅助模型由后端固定选择，不复用聊天界面的模型、推理或协议偏好。 */
/**
 * 辅助文本模型本身不可用（上游没这个模型 / 模型列表里挑不出可用的文本模型）。
 *
 * 这类失败与用户选中的图像模型无关，也不该让整张图生不出来——2026-10-12 的真实
 * 故障是后端把辅助模型写死成上游没有的 gpt-5.6-sol，上游回
 *   {"message":"Model \"gpt-5.6-sol\" is not supported by any configured account..."}
 * 结果**所有**图像模型都报「该模型当前不可用」。
 */
const PLAN_MODEL_UNAVAILABLE = /not supported|does not exist|model_not_found|没有可用于解析图片需求的文本模型/i

export async function planImage(profile, payload, signal) {
  const modes = ['responses', 'chat_completions'];
  let lastError = null;
  for (let i = 0; i < modes.length; i++) {
    const mode = modes[i];
    const body = imagePlanBody(payload, mode);
    const resp = await fetch('/api/image-plan', {
      method: 'POST', headers: buildHeaders(profile, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ mode, body }), signal,
    });
    if (!resp.ok) {
      const error = new ApiError(await readError(resp), resp.status);
      // 标记来源：这一步说的是「辅助文本模型」的事，不是用户选中的那个模型，
      // 上层不能把它翻成「该模型当前不可用」（见 app.js 的错误归类）。
      error.stage = 'image-plan';
      lastError = error;
      if (i + 1 < modes.length && [400, 404, 405, 415, 422, 501].includes(resp.status)) continue;
      break;
    }
    const data = await resp.json();
    try {
      const plan = readImagePlan(data, mode, payload.images?.length || 0);
      return { ...plan, usage: summarizeUsage(mode, data.usage) };
    } catch (err) {
      lastError = err;
      break;
    }
  }
  // 「解析图片需求」只是锦上添花的一步。辅助模型不可用时退回用户原始描述、参考图按
  // 顺序全带上，让生图这一步自己去报真正的问题；比整张图生不出来好得多。
  if (!lastError || !PLAN_MODEL_UNAVAILABLE.test(String(lastError.message || ''))) throw lastError;
  console.warn('[image-plan] 辅助文本模型不可用，改用原始描述直接生图：', lastError.message);
  return {
    prompt: payload.prompt,
    reference_images: (payload.images || []).map((_, i) => i + 1),
    usage: null,
    planFailed: true,
  };
}

/** 上游可能返回 b64_json，也可能返回一个要再下载一次的 url，两种都处理。 */
async function collectUpstreamImages(payload) {
  const list = (payload && payload.data) || [];
  const images = [];
  const errors = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    if (item.b64_json) {
      images.push({ b64: item.b64_json, mime: mimeFromB64(item.b64_json) });
      continue;
    }
    if (!item.url) continue;
    try {
      const resp = await fetch(item.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      images.push({ b64: await blobToB64(blob), mime: blob.type || 'image/png' });
    } catch (err) {
      errors.push(String((err && err.message) || err));
    }
  }
  if (!images.length) {
    throw new ApiError(errors.length ? tr("无法取得生成的图片（{0}）", errors.slice(0, 2).join('；')) : tr("上游没有返回任何图片"), 0);
  }
  return images;
}

/**
 * 沿用 Temp_ByChat_IMG.py 的稳定请求方式：图片等待完整 JSON 结果，不发送
 * stream、partial_images、response_format 或 Codex CLI 专用参数。
 * 自动接收 Base64/URL；选择透明背景时只发送原生 background 参数。
 * 直连和中转共用这份白名单，旧配置里的开关也不能混入请求。
 */
function generateBody(params) {
  const body = {
    model: params.model,
    prompt: params.prompt,
  };
  if (params.output_format) body.output_format = params.output_format;
  if (params.size && params.size !== 'auto') body.size = params.size;
  if (params.quality && params.quality !== 'auto') body.quality = params.quality;
  if (params.background) body.background = params.background;
  return body;
}

function editForm(params, files, imageField) {
  const form = new FormData();
  const body = generateBody(params);
  for (const [key, value] of Object.entries(body)) form.append(key, value);
  for (const file of files) form.append(imageField, file, file.name);
  return form;
}

async function generateImageDirect(profile, params, signal) {
  const base = normalizeBaseUrl(profile.baseUrl);
  const resp = await fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: upstreamHeaders(profile, 'chat'),
    body: JSON.stringify(generateBody(params)),
    signal,
  });
  if (!resp.ok) throw new ApiError(await readError(resp), resp.status);
  const payload = await resp.json();
  const images = await collectUpstreamImages(payload);
  return { images: toImages(images), usage: summarizeUsage('images_generate', payload.usage) };
}

async function editImageDirect(profile, params, files, signal) {
  const base = normalizeBaseUrl(profile.baseUrl);
  const form = editForm(params, files, 'image');

  // multipart 不要手动设 Content-Type，让浏览器生成 boundary
  const headers = profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {};
  const resp = await fetch(`${base}/images/edits`, {
    method: 'POST', headers, body: form, signal,
  });
  if (!resp.ok) throw new ApiError(await readError(resp), resp.status);
  const payload = await resp.json();
  const images = await collectUpstreamImages(payload);
  return { images: toImages(images), usage: summarizeUsage('images_edit', payload.usage) };
}

/** 文生图。返回 [{ blob, url, mime }] */
export async function generateImage(profile, params, signal) {
  if (shouldTryDirect(profile)) {
    try {
      const result = await generateImageDirect(profile, params, signal);
      markCors(profile, true);
      return result;
    } catch (err) {
      if (!isCorsFailure(err)) throw err;
      markCors(profile, false);
    }
  }
  const resp = await fetch('/api/images/generate', {
    method: 'POST',
    headers: buildHeaders(profile, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(generateBody(params)),
    signal,
  });
  if (!resp.ok) throw new ApiError(await readError(resp), resp.status);
  const payload = await resp.json();
  return { images: toImages(payload.images), usage: payload.usage, errors: payload.errors || [] };
}

/** 改图。files 为 File 对象数组。 */
export async function editImage(profile, params, files, signal) {
  if (shouldTryDirect(profile)) {
    try {
      const result = await editImageDirect(profile, params, files, signal);
      markCors(profile, true);
      return result;
    } catch (err) {
      if (!isCorsFailure(err)) throw err;
      markCors(profile, false);
    }
  }
  const form = editForm(params, files, 'images');

  const resp = await fetch('/api/images/edit', {
    method: 'POST',
    headers: buildHeaders(profile), // 不要设 Content-Type，让浏览器生成 boundary
    body: form,
    signal,
  });
  if (!resp.ok) throw new ApiError(await readError(resp), resp.status);
  const payload = await resp.json();
  return { images: toImages(payload.images), usage: payload.usage, errors: payload.errors || [] };
}

/* ---------------------------------------------------------------------------
 * 视频生成
 * ------------------------------------------------------------------------- */

/** 视频以 base64 返回，这里转成 Blob；和图片一样不依赖服务器上的文件路径。 */
function toVideos(list) {
  return (list || []).map((item) => {
    const mime = item.mime || 'video/mp4';
    const blob = b64ToBlob(item.b64, mime);
    return { blob, mime, url: URL.createObjectURL(blob) };
  });
}

/** 只发上游认识的字段；'auto' 一律不传，交给上游自己决定。 */
function videoBody(params) {
  const body = { model: params.model, prompt: params.prompt };
  if (params.duration) body.duration = Number(params.duration);
  if (params.resolution && params.resolution !== 'auto') body.resolution = params.resolution;
  if (params.aspect_ratio && params.aspect_ratio !== 'auto') body.aspect_ratio = params.aspect_ratio;
  if (params.image) body.image = params.image;   // 图生视频的首帧（data: 内联图片）
  return body;
}

/**
 * 视频生成。上游是**异步**任务（提交 → 轮询 → 下载内容），统一走后端中转：
 * 浏览器侧要实现三段状态机 + 带鉴权下载内容，收敛在后端只有一处实现，
 * Key 也不会被拼进轮询地址。图片仍保留「能直连就直连」的两条通道。
 */
export async function generateVideo(profile, params, signal) {
  const resp = await fetch('/api/videos/generate', {
    method: 'POST',
    headers: buildHeaders(profile, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(videoBody(params)),
    signal,
  });
  if (!resp.ok) throw new ApiError(await readError(resp), resp.status);
  const payload = await resp.json();
  return { videos: toVideos(payload.videos), usage: payload.usage, errors: payload.errors || [] };
}

/* ---------------------------------------------------------------------------
 * 上游体检（只有走中转通道时才有意义）
 * ------------------------------------------------------------------------- */

/**
 * 上游体检：让后端把上游的几个接口各打一遍，返回每项的 HTTP 状态和人话结论。
 * 只在请求失败时调用，用来分清是「我们的代码/后端问题」还是「上游挂了」。
 *
 * probe：'chat'（默认，探模型列表+两个聊天口）/ 'images'（探模型列表+生图）/ 'all'
 *        生图失败时一定要传 'images' —— 拿生图模型去探聊天口会得到
 *        「模型不存在」这种误导性结论。
 *
 * 返回 { base_url, ok, results: [{ name, method, path, http, ms, verdict }] }
 */
export async function diagUpstream(profile, model = '', probe = 'chat', signal) {
  const qs = new URLSearchParams({ probe });
  if (model) qs.set('model', model);
  const resp = await fetch(`/api/diag/upstream?${qs}`, {
    method: 'POST',
    headers: buildHeaders(profile),
    signal,
  });
  if (!resp.ok) throw new ApiError(await readError(resp), resp.status);
  return resp.json();
}

/**
 * 原型的 app.js 是普通脚本、用 onclick="fn()" 内联调用，拿不到模块作用域。
 * 这里把接口挂到 window，让 app.js 能直接用 ByCanvasAPI.xxx。
 */
if (typeof window !== 'undefined') {
  window.ByCanvasAPI = {
    healthz, fetchModels, streamChat, planImage, combineImageUsage, generateImage, editImage, generateVideo, b64ToBlob,
    diagUpstream, encodeBase64Url, parseSSEChunk, ApiError, DEFAULT_UPSTREAM,
    normalizeBaseUrl, normalizeModels, withModelCapabilities, guessKind, summarizeUsage,
    maskKey, setTransportOverride, transportName,
    splitDataUrl, toUpstreamContent,
  };
}
