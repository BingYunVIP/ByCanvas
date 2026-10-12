#!/usr/bin/env python3
"""从 OpenRouter 拉取模型能力，生成 frontend/data/model-capabilities.json。

数据源有三个，各管一段，不要混：

  ① OpenRouter /api/v1/models（权威，本脚本联网拉取）
       - 推理档位   ← reasoning.supported_efforts
       - 多模态     ← architecture.input_modalities 是否含 image
       - 模型种类   ← architecture.output_modalities（含 image → 图像模型，含 video → 视频模型）

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

# ---------------------------------------------------------------------------
# ③ 视频模型：OpenRouter 目前**没有**任何输出视频的模型（实测全站 458 个模型的
#    output_modalities 里都没有 video），所以视频能力只能按上游 xAI 的公开规格写死。
#    来源：https://docs.x.ai/developers/model-capabilities/video/overview
#      - 时长 1-15 秒（整数；不传时上游默认 8 秒）
#      - 清晰度 480p / 720p / 1080p（grok-imagine-video 只到 720p）
#      - 画面比例 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 21:9 / 5:2
#    上游新增视频模型时：往这里加一条；等 OpenRouter 收录视频模型后，① 会自动接管。
# ---------------------------------------------------------------------------
VIDEO_SOURCE = 'https://docs.x.ai/developers/model-capabilities/video/overview'
VIDEO_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2']
# 官方规格：`duration` 取 1-15 秒的整数，不传时上游默认 8 秒。
# 来源：https://docs.x.ai/developers/model-capabilities/video/generation#duration
VIDEO_DURATIONS = [str(seconds) for seconds in range(1, 16)]
OFFICIAL_VIDEO = {
    'grok-imagine-video-1.5': {
        'kind': 'video',
        'videoParameters': {
            'duration': VIDEO_DURATIONS,
            'resolution': ['480p', '720p', '1080p'],
            'aspectRatio': VIDEO_ASPECT_RATIOS,
        },
        'source': VIDEO_SOURCE,
    },
    'grok-imagine-video-1.5-lite': {
        'kind': 'video',
        'videoParameters': {
            'duration': VIDEO_DURATIONS,
            'resolution': ['480p', '720p', '1080p'],
            'aspectRatio': VIDEO_ASPECT_RATIOS,
        },
        'source': VIDEO_SOURCE,
    },
    'grok-imagine-video': {
        'kind': 'video',
        'videoParameters': {
            'duration': VIDEO_DURATIONS,
            'resolution': ['480p', '720p'],
            'aspectRatio': VIDEO_ASPECT_RATIOS,
        },
        'source': VIDEO_SOURCE,
    },
}

# 带日期后缀的快照 ID / 预览版指向同一个模型，查表时先归一到主 ID。
OFFICIAL_ALIASES = {
    'gpt-image-2-2026-04-21': 'gpt-image-2',
    'gpt-image-2.5-sunburst-2026-09-08': 'gpt-image-2.5-sunburst',
    'gpt-image-2.5-flare-2026-09-08': 'gpt-image-2.5-flare',
    'grok-imagine-video-1.5-preview': 'grok-imagine-video-1.5',
    # 中转站（api.bingyun.vip）报的是裸名 gemini-*，OpenRouter 目录里带 google/ 前缀，
    # 两边对不上会导致 kind / vision 兜底失效（nano-banana 还会被误判成聊天模型）。
    'gemini-2.5-flash-image': 'google/gemini-2.5-flash-image',
    'gemini-3-pro-image': 'google/gemini-3-pro-image',
    'gemini-3-pro-image-preview': 'google/gemini-3-pro-image-preview',
    'gemini-3.1-flash-image': 'google/gemini-3.1-flash-image',
    'gemini-3.1-flash-image-preview': 'google/gemini-3.1-flash-image-preview',
    'gemini-3.1-flash-lite-image': 'google/gemini-3.1-flash-lite-image',
    'gemini-nano-banana-2.1': 'google/gemini-nano-banana-2.1',
}


def fetch(url: str) -> dict:
    req = urllib.request.Request(url, headers={'User-Agent': 'bycanvas-capability-sync/1.0'})
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
    architecture = entry.get('architecture') or {}
    modalities = architecture.get('input_modalities') or []
    outputs = architecture.get('output_modalities') or []
    supported = entry.get('supported_parameters') or []
    efforts = normalize_efforts(reasoning.get('supported_efforts') if isinstance(reasoning, dict) else None)
    out = {
        'reasoningEfforts': efforts,
        # 多模态：OpenRouter 的 input_modalities 是权威判据。
        # 只有它明确列出支持哪些输入时才能判「不支持」；字段缺失就是未知（null）。
        'vision': True if 'image' in modalities else (False if modalities else None),
        # 模型种类：输出模态里带 image / video 的就不是普通聊天模型。上游（中转站）
        # 自己不声明，靠这份目录让前后端自动走对接口（/images/* 还是 /videos/*）。
        'kind': 'video' if 'video' in outputs else 'image' if 'image' in outputs else 'chat',
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
        elif not args.all:
            # 默认范围：openai/* 全部 + 任何输出图像 / 视频的模型（不限厂商）。
            # 这样上游新上图像 / 视频模型时，目录里自然就有它的种类和参数。
            outputs = (entry.get('architecture') or {}).get('output_modalities') or []
            if not oid.startswith('openai/') and not ({'image', 'video'} & set(outputs)):
                continue
        models[openrouter_key(oid)] = from_openrouter(entry)

    # 生图 / 视频模型（OpenRouter 目录里没有）由官方固定档位补齐，不覆盖已有项
    for key, spec in {**OFFICIAL_IMAGE, **OFFICIAL_VIDEO}.items():
        merged = dict(models.get(key, {}))
        merged.update(spec)
        # 官方表里的模型：OpenRouter 查不到时 vision 标未知，别误判成不支持
        merged.setdefault('vision', None)
        merged.setdefault('reasoningEfforts', [])
        merged.setdefault('kind', 'video' if key in OFFICIAL_VIDEO else 'image')
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
            'kind': 'OpenRouter /api/v1/models → architecture.output_modalities',
            'qualityOptions': '官方公开档位（OpenRouter 不提供图片参数，见 tools/sync_model_capabilities.py）',
            'videoParameters': 'xAI 视频接口公开规格（OpenRouter 尚无视频模型，见 tools/sync_model_capabilities.py）',
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
    kinds = {kind: sum(1 for v in models.values() if v.get('kind') == kind) for kind in ('chat', 'image', 'video')}
    print(f'✓ 写出 {OUT.relative_to(Path.cwd())}')
    print(f'  模型 {len(models)} 个｜有推理档位 {len(chat)} 个｜支持图像输入 {len(vision)} 个')
    print(f'  种类：chat {kinds["chat"]}｜image {kinds["image"]}｜video {kinds["video"]}')
    for key in ('gpt-5.6-terra', 'gpt-6-astra', 'gpt-image-2.5-sunburst'):
        if key in models:
            v = models[key]
            print(f'  {key}: 档位={v.get("reasoningEfforts") or "无"} 图像输入={v.get("vision")}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
