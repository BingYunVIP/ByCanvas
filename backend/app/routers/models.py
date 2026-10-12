"""拉取上游模型列表。

用 POST 而不是 GET：语义上是"拿凭证去换列表"，同时也避免自定义头出现在
GET 请求的 access log 里。
"""
from __future__ import annotations

import time

import httpx
from fastapi import APIRouter, Depends, HTTPException

from .. import log as applog
from ..deps import Upstream, resolve_upstream
from ..schemas import ModelInfo
from ..model_capabilities import model_capabilities, option_values
from ..upstream import bearer_headers, describe_error, extract_upstream_error, http_timeout

router = APIRouter(prefix='/api', tags=['models'])

# 用于区分聊天 / 生图 / 视频模型，前端据此决定走哪个接口
# nano-banana 是 Gemini 图像模型的产品代号，id 里不含 image/video，必须显式列出。
_IMAGE_HINTS = ('image', 'dall', 'flux', 'midjourney', 'imagen', 'seedream', 'nano-banana')
_VIDEO_HINTS = ('video', 'sora', 'veo', 'kling', 'runway')

# 不向用户展示的模型 id（小写）。内部审核模型 + 产品侧要求隐藏的三个。
HIDDEN_MODEL_IDS = frozenset({
    'codex-auto-review',
    'gpt-image-medium',
    'gpt-reserve',
    'grok-4.7-build-fast',
})


def guess_kind(model_id: str) -> str:
    """视频先判：grok-imagine-video 之类同时含 image/video 的 id，要落到 video 上。"""
    lower = model_id.lower()
    if any(hint in lower for hint in _VIDEO_HINTS):
        return 'video'
    return 'image' if any(hint in lower for hint in _IMAGE_HINTS) else 'chat'


@router.post('/models', response_model=list[ModelInfo])
async def list_models(up: Upstream = Depends(resolve_upstream)):
    waited, running = applog.route_enter()
    applog.log(
        '进入模型列表路由（排队 %.1fs，并发 %d 个，系统线程 %d 个）',
        waited, running, applog.thread_count(),
    )
    if waited > 1:
        applog.warn('排队 %.1fs —— 服务端忙不过来，请求在干等', waited)

    try:
        try:
            async with httpx.AsyncClient(timeout=http_timeout()) as client:
                url = f'{up.base_url}/models'
                t0 = time.time()
                resp = await client.get(url, headers=bearer_headers(up.api_key))
                applog.log('上游返回 HTTP %d，耗时 %.1fs', resp.status_code, time.time() - t0)
        except httpx.HTTPError as exc:
            applog.error('拉模型列表出错：%s —— %s', type(exc).__name__, describe_error(exc))
            raise HTTPException(status_code=502, detail=describe_error(exc)) from exc
    finally:
        applog.route_exit()

    if resp.status_code != 200:
        detail = extract_upstream_error(resp)
        applog.error('拉模型列表失败：%s', detail)
        raise HTTPException(status_code=502, detail=detail)

    payload = resp.json()
    raw_models = payload.get('data') if isinstance(payload, dict) else payload
    raw_models = [item for item in raw_models or [] if isinstance(item, dict) and isinstance(item.get('id'), str)]

    # 一些供应商（如 OpenRouter）把图片质量枚举放在单独的图像模型目录。
    # 此探测只读元数据，不生成图片；不支持目录时仍使用 /models 和公开资料。
    missing_quality = any(guess_kind(str(item.get('id', ''))) == 'image'
                          and not any(option_values(item.get(key)) for key in ('qualityOptions', 'quality_options', 'supportedQualities'))
                          for item in raw_models)
    if missing_quality:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(3.0)) as client:
                extra = await client.get(f'{up.base_url}/images/models', headers=bearer_headers(up.api_key))
                if extra.status_code == 200:
                    data = extra.json()
                    data = data.get('data', []) if isinstance(data, dict) else data
                    by_id = {m['id']: m for m in data if isinstance(m, dict) and isinstance(m.get('id'), str)} if isinstance(data, list) else {}
                    for index, item in enumerate(raw_models):
                        detail = by_id.get(item.get('id'))
                        if not detail:
                            continue
                        merged = {**detail, **item}
                        detail_params = detail.get('supported_parameters')
                        main_params = item.get('supported_parameters')
                        if isinstance(detail_params, dict):
                            merged['supported_parameters'] = {**detail_params, **(main_params if isinstance(main_params, dict) else {})}
                        raw_models[index] = merged
        except (httpx.HTTPError, ValueError):
            pass

    models: list[ModelInfo] = []
    for item in raw_models or []:
        model_id = item.get('id') if isinstance(item, dict) else None
        if not isinstance(model_id, str) or not model_id.strip():
            continue
        if model_id.strip().lower() in HIDDEN_MODEL_IDS:
            continue
        caps = model_capabilities(item)
        # 目录（openrouter.ai 同步来的快照）里标了种类就以它为准，否则按 id 猜。
        # 这样上游新增图像 / 视频模型时，后端不用改代码就能报对 kind。
        kind = caps.pop('kind', None) or guess_kind(model_id)
        models.append(ModelInfo(
            id=model_id,
            name=item.get('display_name') or item.get('name') or model_id,
            kind=kind,
            **caps,
        ))
    return models
