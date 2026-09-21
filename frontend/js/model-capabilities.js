/** 服务商的明确枚举优先；公开资料只作缺失字段的兜底，不猜测未知模型。 */
export function optionValues(raw) {
  if (raw && !Array.isArray(raw) && typeof raw === 'object') raw = raw.enum || raw.values || raw.options;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((item) => typeof item === 'string' ? item : item?.value ?? item?.effort)
    .filter((value) => typeof value === 'string' && /^[\w.-]{1,64}$/.test(value)))].slice(0, 32);
}

function firstDefined(...values) { return values.find((v) => v !== undefined && v !== null); }

/** 只保存输入栏使用的图像参数；false 表示未声明支持，不能靠模型名称猜测。 */
function imageParameters(item, fallback, parameters) {
  const schema = parameters?.properties || parameters || {};
  return Object.fromEntries(['size', 'output_format', 'background'].map((key) => {
    const base = fallback.imageParameters?.[key];
    const spec = firstDefined(item.imageParameters?.[key],
      Array.isArray(parameters) ? (parameters.includes(key) ? base ?? true : false) : schema[key], base);
    if (spec == null || spec === false || spec?.supported === false) return [key, false];
    const result = {};
    if (Array.isArray(spec) || spec.enum || spec.values || spec.options) {
      result.options = optionValues(spec);
      if (!result.options.length) return [key, false];
    }
    for (const bound of ['minimum', 'maximum']) {
      if (typeof spec[bound] === 'number' && Number.isFinite(spec[bound])) result[bound] = spec[bound];
    }
    return [key, result];
  }));
}

export function modelCapabilities(item, catalog = {}) {
  const id = String(item.id || '').replace(/^openai\//, '');
  const fallback = catalog.models?.[catalog.aliases?.[id] || id] || {};
  const parameters = item.supported_parameters ?? item.parameters ?? {};
  const schema = parameters.properties || parameters;
  const reasoningSpec = schema.reasoning_effort || schema.reasoning?.properties?.effort || schema.reasoning?.effort;
  const rawReasoning = firstDefined(item.reasoningEfforts, item.supported_reasoning_efforts, reasoningSpec);
  const rawQuality = firstDefined(item.qualityOptions, item.quality_options, item.supportedQualities, schema.quality);
  const disabled = item.supportsReasoningEffort === false;
  const reasoningEfforts = disabled ? [] : optionValues(rawReasoning ?? fallback.reasoningEfforts);
  const qualityOptions = optionValues(rawQuality ?? fallback.qualityOptions);
  // 能不能看图：OpenRouter 的 input_modalities 是权威判据，写在目录的 vision 里。
  // 上游（中转站）自己不声明，所以基本都走目录；目录里也是 null 就标未知，
  // 不能顺手判成「不支持」——那会把能看图的模型的上传按钮给禁掉。
  const vision = item.vision == null ? (fallback.vision ?? null) : !!item.vision;
  return {
    vision,
    reasoning: !disabled && (reasoningEfforts.length > 0 || item.reasoning === true || item.supportsReasoningEffort === true
      || (Array.isArray(parameters) && parameters.some((p) => p === 'reasoning' || p === 'reasoning_effort'))),
    reasoningEfforts,
    // 不采信上游 / 目录里声明的"默认档位"——那经常直接就是最高档（比如标了
    // default 的选项刚好是 xhigh/max），会让每次选中一个模型就默认跑最贵
    // 最慢的一挡。固定不给默认值，pillOptions() 的候选列表里「自动」总是
    // 排第一个，UI 会自然退回到它；用户想要更高档位可以自己选。
    defaultReasoningEffort: null,
    qualityOptions,
    defaultQuality: null,
    imageParameters: imageParameters(item, fallback, parameters),
  };
}

let catalogPromise;
export function loadCapabilityCatalog() {
  if (!catalogPromise) catalogPromise = fetch(new URL('../data/model-capabilities.json', import.meta.url))
    .then((resp) => resp.ok ? resp.json() : {}).catch(() => ({}));
  return catalogPromise;
}
