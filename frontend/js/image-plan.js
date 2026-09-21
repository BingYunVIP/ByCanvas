import { tr } from './i18n-text.js';

/** 文本模型通过受限的图片工具生成请求，图片模型和输出参数仍由用户选择。 */
const TOOL_NAME = 'create_image';
const INSTRUCTIONS = `你是图像创作助手。根据当前用户要求、对话历史和提供的参考图调用 create_image 工具。
准确保留用户明确要求的人物、数量、文字、风格和构图，不擅自添加要求。工具的 prompt 必须是完整、可独立执行的生图或改图描述。
有明确上传的参考图时应使用它们；若参考图标为上一轮结果，仅在用户要求继续修改、保持主体或引用上一轮时使用。新主题应生成新图。
reference_images 填入实际提供的图片编号；不使用参考图时返回空数组。不要编造图片编号、路径、API 参数或模型名称。
必须只调用一次工具。工具返回的图片会直接展示给用户，无需额外回复。`;
const parameters = {
  type: 'object', additionalProperties: false,
  properties: {
    prompt: { type: 'string', description: '完整的生图或编辑图描述' },
    reference_images: { type: 'array', items: { type: 'integer' }, description: '使用的参考图编号；生成全新图片时为空数组' },
  },
  required: ['prompt', 'reference_images'],
};

export function imagePlanBody(payload, mode) {
  const images = payload.images || [];
  const text = `${payload.prompt}\n\n${payload.reference_source === 'previous' ? '可用的上一轮生成结果' : '用户上传的参考图'}：${images.length ? images.map((_, i) => i + 1).join('、') : '无'}`;
  const history = (payload.history || []).slice(-20).map((m) => ({ role: m.role, content: m.content }));
  // 只构造任务上下文，辅助模型和推理设置交由后端决定。
  const body = { stream: false };
  if (mode === 'responses') {
    body.store = false;
    body.instructions = INSTRUCTIONS;
    body.input = [...history, { role: 'user', content: [
      { type: 'input_text', text }, ...images.map((image_url) => ({ type: 'input_image', image_url })),
    ] }];
    body.tools = [{ type: 'function', name: TOOL_NAME, description: '生成或编辑图片，并将结果展示给用户', strict: true, parameters }];
    body.tool_choice = { type: 'function', name: TOOL_NAME };
    body.parallel_tool_calls = false;
  } else if (mode === 'chat_completions') {
    body.messages = [{ role: 'system', content: INSTRUCTIONS }, ...history, { role: 'user', content: [
      { type: 'text', text }, ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
    ] }];
    body.tools = [{ type: 'function', function: { name: TOOL_NAME, description: '生成或编辑图片', parameters } }];
    body.tool_choice = { type: 'function', function: { name: TOOL_NAME } };
    body.parallel_tool_calls = false;
  } else throw new Error(tr('不支持的文本接口'));
  return body;
}

export function readImagePlan(data, mode, imageCount) {
  const calls = mode === 'responses' ? (data.output || []).filter((item) => item.type === 'function_call')
    : (data.choices?.[0]?.message?.tool_calls || []).map((item) => item.function);
  if (calls.length !== 1 || calls[0]?.name !== TOOL_NAME) throw new Error(tr('图片需求解析失败，请重试'));
  let plan;
  try { plan = JSON.parse(calls[0].arguments); }
  catch { throw new Error(tr('文本模型返回的图片工具参数无法读取')); }
  if (!plan || typeof plan.prompt !== 'string' || !plan.prompt.trim() || plan.prompt.length > 32000
    || !Array.isArray(plan.reference_images) || plan.reference_images.length > 8
    || !plan.reference_images.every((id) => Number.isInteger(id) && id >= 1 && id <= imageCount)) {
    throw new Error(tr('文本模型返回的提示词或参考图编号无效'));
  }
  return { prompt: plan.prompt.trim(), reference_images: [...new Set(plan.reference_images)] };
}

export function combineImageUsage(...reports) {
  const result = {};
  for (const key of ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']) {
    const values = reports.map((r) => r?.[key]).filter((n) => Number.isFinite(n));
    if (values.length) result[key] = values.reduce((sum, n) => sum + n, 0);
  }
  return Object.keys(result).length ? result : null;
}
