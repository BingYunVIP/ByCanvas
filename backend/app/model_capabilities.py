"""模型档位归一化。明确的上游枚举优先；仅按准确模型 ID 使用公开资料兜底。"""
from __future__ import annotations

import json
from pathlib import Path
import re

_CATALOG_PATH = Path(__file__).resolve().parents[2] / 'frontend/data/model-capabilities.json'
try:
    _catalog = json.loads(_CATALOG_PATH.read_text(encoding='utf-8'))
    CATALOG = _catalog.get('models', {})
    ALIASES = _catalog.get('aliases', {})
except (OSError, ValueError):
    CATALOG = {}
    ALIASES = {}


def option_values(raw) -> list[str]:
    if isinstance(raw, dict):
        raw = raw.get('enum', raw.get('values', raw.get('options')))
    if not isinstance(raw, list):
        return []
    values = []
    for item in raw:
        value = item if isinstance(item, str) else item.get('value', item.get('effort')) if isinstance(item, dict) else None
        if isinstance(value, str) and re.fullmatch(r'[\w.-]{1,64}', value, flags=re.ASCII) and value not in values:
            values.append(value)
    return values[:32]


def _first(*values):
    return next((v for v in values if v is not None), None)


def image_parameters(item: dict, fallback: dict, parameters) -> dict:
    schema = parameters.get('properties', parameters) if isinstance(parameters, dict) else {}
    declared = item.get('imageParameters')
    declared = declared if isinstance(declared, dict) else {}
    result = {}
    for key in ('size', 'output_format', 'background'):
        base = fallback.get('imageParameters', {}).get(key)
        if isinstance(parameters, list):
            upstream = (base if base is not None else True) if key in parameters else False
        else:
            upstream = schema.get(key)
        spec = _first(declared.get(key), upstream, base)
        if spec is None or spec is False or isinstance(spec, dict) and spec.get('supported') is False:
            result[key] = False
            continue
        normalized = {}
        if isinstance(spec, list) or isinstance(spec, dict) and any(k in spec for k in ('enum', 'values', 'options')):
            normalized['options'] = option_values(spec)
            if not normalized['options']:
                result[key] = False
                continue
        if isinstance(spec, dict):
            for bound in ('minimum', 'maximum'):
                value = spec.get(bound)
                if isinstance(value, (int, float)) and not isinstance(value, bool) and float('-inf') < value < float('inf'):
                    normalized[bound] = value
        result[key] = normalized
    return result


def model_capabilities(item: dict) -> dict:
    model_id = str(item.get('id', '')).removeprefix('openai/')
    fallback = CATALOG.get(ALIASES.get(model_id, model_id), {})
    parameters = _first(item.get('supported_parameters'), item.get('parameters'), {})
    schema = parameters.get('properties', parameters) if isinstance(parameters, dict) else {}
    reasoning = schema.get('reasoning', {})
    reasoning = reasoning if isinstance(reasoning, dict) else {}
    spec = schema.get('reasoning_effort', reasoning.get('properties', reasoning).get('effort'))
    quality_spec = schema.get('quality')
    raw_reasoning = _first(item.get('reasoningEfforts'), item.get('supported_reasoning_efforts'), spec)
    raw_quality = _first(item.get('qualityOptions'), item.get('quality_options'), item.get('supportedQualities'), quality_spec)
    disabled = item.get('supportsReasoningEffort') is False
    efforts = [] if disabled else option_values(_first(raw_reasoning, fallback.get('reasoningEfforts')))
    qualities = option_values(_first(raw_quality, fallback.get('qualityOptions')))
    # 能不能看图：目录里的 vision 来自 OpenRouter 的 input_modalities。
    # 目录里也是 None 就标未知（返回 None），不能顺手判成 False。
    vision = item.get('vision')
    if vision is None:
        vision = fallback.get('vision')
    return {
        'vision': None if vision is None else bool(vision),
        'reasoning': not disabled and bool(efforts or item.get('reasoning') or item.get('supportsReasoningEffort')
                                         or isinstance(parameters, list) and any(p in parameters for p in ('reasoning', 'reasoning_effort'))),
        'reasoningEfforts': efforts,
        # 不采信上游 / 目录里声明的"默认档位"——那经常直接就是最高档
        # （比如标了 default 的选项刚好是 xhigh/max），会让每次选中一个模型
        # 就默认跑最贵最慢的一挡。固定不给默认值，前端会退回「自动」，
        # 用户想要更高档位可以自己选。
        'defaultReasoningEffort': None,
        'qualityOptions': qualities,
        'defaultQuality': None,
        'imageParameters': image_parameters(item, fallback, parameters),
    }
