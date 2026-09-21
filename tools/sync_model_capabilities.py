#!/usr/bin/env python3
"""从 OpenRouter 拉取模型能力，生成 frontend/data/model-capabilities.json。

数据源只有两个，各管一段，不要混：

  ① OpenRouter /api/v1/models（权威，本脚本联网拉取）
       - 推理档位   ← reasoning.supported_efforts
       - 多模态     ← architecture.input_modalities 是否含 image

  ② 官方公开档位（写死在下面的 OFFICIAL_IMAGE 里）
       - 生图质量档位 ← OpenAI 官方文档列出的 quality 枚举

     为什么只有质量档位要写死：OpenRouter 全站 446 个模型的
     supported_parameters 里根本没有 quality / size / output_format /
     background 任何一个，而且我们上游的 gpt-image-2、gpt-image-2.5-sunburst、
     gpt-image-2.5-flare 在 OpenRouter 目录里压根不存在。这不是懒，是它真没有。

     尺寸 / 输出格式 / 透明背景三项按用户要求**保持原样**，本脚本不碰。

用法：
    python3 tools/sync_model_capabilities.py            # 拉 openai/* 并写出
    python3 tools/sync_model_capabilities.py --all      # 拉全部厂商
    python3 tools/sync_model_capabilities.py --ids gpt-5.6-terra,gpt-6-astra
    python3 tools/sync_model_capabilities.py --dry-run  # 只打印，不落盘

输出文件的 key 是「上游会报出来的模型 ID」：OpenAI 的模型去掉 openai/ 前缀
（上游 api.bingyun.vip 报的就是裸名），其他厂商保留 vendor/name。
前端后端查表时也会先把 openai/ 前缀剥掉，两边对得上。
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

API = 'https://openrouter.ai/api/v1/models'
OUT = Path(__file__).resolve().parents[1] / 'frontend/data/model-capabilities.json'

# 推理强度从弱到强排序。OpenRouter 返回的 supported_efforts 顺序是乱的
# （实测给的是 ["max","xhigh","high","medium","low","none"]），
# 直接拿去渲染会变成「自动 / max / xhigh / high …」，所以按强度重排。
EFFORT_RANK = {'none': 0, 'minimal': 1, 'low': 2, 'medium': 3, 'high': 4, 'xhigh': 5, 'max': 6}

# ---------------------------------------------------------------------------
# ② 官方公开档位：生图质量。OpenRouter 不提供，只能按官方写死。
#    这几项连同 imageParameters（尺寸 / 输出格式 / 背景）一起原样保留。
# ---------------------------------------------------------------------------
OFFICIAL_IMAGE = {
    'gpt-image-2.5-sunburst': {
        'qualityOptions': ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
        'source': 'https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst',
        'imageParameters': {
            'size': {},
            'output_format': {'options': ['png', 'jpeg', 'webp']},
            'background': {'options': ['auto', 'opaque', 'transparent']},
        },
    },
    'gpt-image-2.5-flare': {
        'qualityOptions': ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
        'source': 'https://developers.openai.com/api/docs/models/gpt-image-2.5-flare',
        'imageParameters': {
            'size': {},
            'output_format': {'options': ['png', 'jpeg', 'webp']},
            'background': {'options': ['auto', 'opaque', 'transparent']},
        },
    },
    'gpt-image-2': {
        'qualityOptions': ['auto', 'low', 'medium', 'high'],
        'source': 'https://developers.openai.com/api/reference/cli/resources/images/methods/generate',
        'imageParameters': {
            'size': {},
            'output_format': {'options': ['png', 'jpeg', 'webp']},
            'background': {'options': ['auto', 'opaque', 'transparent']},
        },
    },
    'dall-e-3': {
        'qualityOptions': ['standard', 'hd'],
        'source': 'https://developers.openai.com/api/reference/cli/resources/images/methods/generate',
        'imageParameters': {
            'size': {'options': ['1024x1024', '1792x1024', '1024x1792']},
            'output_format': False,
            'background': False,
        },
    },
    'dall-e-2': {
        'qualityOptions': ['standard'],
        'source': 'https://developers.openai.com/api/reference/cli/resources/images/methods/generate',
        'imageParameters': {
            'size': {'options': ['256x256', '512x512', '1024x1024']},
            'output_format': False,
            'background': False,
        },
    },
    'gpt-image-1': {
        'qualityOptions': ['auto', 'low', 'medium', 'high'],
        'source': 'https://developers.openai.com/api/reference/resources/images/methods/generate',
        'imageParameters': {
            'size': {'options': ['auto', '1024x1024', '1536x1024', '1024x1536']},
            'output_format': {'options': ['png', 'jpeg', 'webp']},
            'background': {'options': ['auto', 'opaque', 'transparent']},
        },
    },
    'gpt-image-1-mini': {
        'qualityOptions': ['auto', 'low', 'medium', 'high'],
        'source': 'https://developers.openai.com/api/reference/resources/images/methods/generate',
        'imageParameters': {
            'size': {'options': ['auto', '1024x1024', '1536x1024', '1024x1536']},
            'output_format': {'options': ['png', 'jpeg', 'webp']},
            'background': {'options': ['auto', 'opaque', 'transparent']},
        },
    },
    'gpt-image-1.5': {
        'qualityOptions': ['auto', 'low', 'medium', 'high'],
        'source': 'https://developers.openai.com/api/reference/resources/images/methods/generate',
        'imageParameters': {
            'size': {'options': ['auto', '1024x1024', '1536x1024', '1024x1536']},
            'output_format': {'options': ['png', 'jpeg', 'webp']},
            'background': {'options': ['auto', 'opaque', 'transparent']},
        },
    },
}

# 带日期后缀的快照 ID 指向同一个模型，查表时先归一到主 ID。
OFFICIAL_ALIASES = {
    'gpt-image-2-2026-04-21': 'gpt-image-2',
    'gpt-image-2.5-sunburst-2026-09-08': 'gpt-image-2.5-sunburst',
    'gpt-image-2.5-flare-2026-09-08': 'gpt-image-2.5-flare',
}


def fetch(url: str) -> dict:
    req = urllib.request.Request(url, headers={'User-Agent': 'bychat-img-capability-sync/1.0'})
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 - 固定 https 地址
        return json.loads(resp.read().decode('utf-8'))


def openrouter_key(model_id: str) -> str:
    """OpenRouter 的 openai/xxx 剥成 xxx —— 上游报的就是裸名。"""
    return model_id[len('openai/'):] if model_id.startswith('openai/') else model_id


def normalize_efforts(raw) -> list[str]:
    if not isinstance(raw, list):
        return []
    values = [v for v in raw if isinstance(v, str) and v in EFFORT_RANK]
    return sorted(set(values), key=lambda v: EFFORT_RANK[v])


def from_openrouter(entry: dict) -> dict:
    reasoning = entry.get('reasoning') or {}
    modalities = (entry.get('architecture') or {}).get('input_modalities') or []
    supported = entry.get('supported_parameters') or []
    efforts = normalize_efforts(reasoning.get('supported_efforts') if isinstance(reasoning, dict) else None)
    out = {
        'reasoningEfforts': efforts,
        # 多模态：OpenRouter 的 input_modalities 是权威判据。
        # 只有它明确列出支持哪些输入时才能判「不支持」；字段缺失就是未知（null）。
        'vision': True if 'image' in modalities else (False if modalities else None),
        'source': 'https://openrouter.ai/api/v1/models',
    }
    # reasoning 参数被支持但没给档位枚举时（比如 gpt-5-image 只有 mandatory: true），
    # 不要当成「不支持推理」，只是档位未知。
    if not efforts and ('reasoning' in supported or 'reasoning_effort' in supported):
        out['reasoningUnknownEfforts'] = True
    if isinstance(reasoning, dict) and reasoning.get('mandatory'):
        out['reasoningMandatory'] = True
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--all', action='store_true', help='导出全部厂商，默认只导出 openai/*')
    parser.add_argument('--ids', default='', help='只导出这些模型 ID（逗号分隔），忽略 --all')
    parser.add_argument('--dry-run', action='store_true', help='只打印不落盘')
    parser.add_argument('--url', default=API, help='OpenRouter 地址（便于离线用本地快照测试）')
    args = parser.parse_args()

    payload = fetch(args.url)
    entries = payload.get('data') or []
    if not entries:
        print('✗ OpenRouter 没返回任何模型，不写文件（免得把现有表清空）', file=sys.stderr)
        return 1

    wanted = {s.strip() for s in args.ids.split(',') if s.strip()}
    models: dict[str, dict] = {}

    for entry in entries:
        oid = entry.get('id') or ''
        if not oid:
            continue
        # :batch / :free 这些变体能力同主模型，留主模型就够了
        if ':' in oid:
            continue
        if wanted:
            if oid not in wanted and openrouter_key(oid) not in wanted:
                continue
        elif not args.all and not oid.startswith('openai/'):
            continue
        models[openrouter_key(oid)] = from_openrouter(entry)

    # 生图模型（OpenRouter 没有）由官方固定档位补齐，不覆盖已有项
    for key, spec in OFFICIAL_IMAGE.items():
        merged = dict(models.get(key, {}))
        merged.update(spec)
        # 官方表里的模型：OpenRouter 查不到时 vision 标未知，别误判成不支持
        merged.setdefault('vision', None)
        merged.setdefault('reasoningEfforts', [])
        models[key] = merged

    if wanted:
        missing = sorted(wanted - set(models))
        if missing:
            print(f'⚠️ OpenRouter 上没有这些模型，已跳过：{", ".join(missing)}', file=sys.stderr)

    doc = {
        'verifiedAt': date.today().isoformat(),
        'sources': {
            'reasoningEfforts': 'OpenRouter /api/v1/models → reasoning.supported_efforts',
            'vision': 'OpenRouter /api/v1/models → architecture.input_modalities',
            'qualityOptions': '官方公开档位（OpenRouter 不提供图片参数，见 tools/sync_model_capabilities.py）',
        },
        'models': dict(sorted(models.items())),
        'aliases': dict(sorted(OFFICIAL_ALIASES.items())),
    }
    text = json.dumps(doc, ensure_ascii=False, indent=2) + '\n'

    if args.dry_run:
        print(text)
        return 0

    OUT.write_text(text, encoding='utf-8')
    chat = [k for k, v in models.items() if v.get('reasoningEfforts')]
    vision = [k for k, v in models.items() if v.get('vision')]
    print(f'✓ 写出 {OUT.relative_to(Path.cwd())}')
    print(f'  模型 {len(models)} 个｜有推理档位 {len(chat)} 个｜支持图像输入 {len(vision)} 个')
    for key in ('gpt-5.6-terra', 'gpt-6-astra', 'gpt-image-2.5-sunburst'):
        if key in models:
            v = models[key]
            print(f'  {key}: 档位={v.get("reasoningEfforts") or "无"} 图像输入={v.get("vision")}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
