"""生图 / 改图。

图片以 base64 直接返回给浏览器，服务器**不落盘、不留任何副本**。

为什么这里全部是 async：
  生图一次要 40 秒以上。同步写法会把 FastAPI 的线程池线程占死 40 秒，
  几次并发就把线程吃光，之后所有请求（连 healthz 都算）排队干等，
  浏览器端表现为「连不上本地服务」。改成 async 后只在事件循环里等待，不占线程。

两条上游通路（实测得出，不是假设）：
  1) OpenAI 图像接口 `images/generations` / `images/edits` —— grok-imagine、gpt-image
     这些模型走这条，图片在 `data[].b64_json` 或 `data[].url` 里。
  2) `chat/completions` —— Gemini 系（gemini-3-pro-image、gemini-nano-banana 等）
     只认这条：`images/generations` 会回
       HTTP 404 {"error":{"message":"Images API is not supported for this platform"}}
     图片以内联 data URL 的形式塞在助手消息里（`![image](data:image/jpeg;base64,...)`）。
     见 uses_chat_image_api() 与 _images_from_chat_payload()。

  选哪条先用模型名判定（跟 routers/models.py::guess_kind 同一套思路，上游新增同类模型
  无需改代码）；万一判错，`images/generations` 撞上上面那句 404 时会自动改走 chat。
"""
from __future__ import annotations

import base64
import re
import time
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from .. import log as applog
from ..config import settings
from ..deps import Upstream, resolve_upstream
from ..schemas import GenerateRequest, ImageResponse, ImageResult
from ..security import assert_public_host
from ..upstream import (
    bearer_headers,
    describe_error,
    extract_upstream_error,
    http_timeout,
    request_with_gateway_retry,
    response_reached_origin,
    sniff_image_mime,
    summarize_usage,
)

router = APIRouter(prefix='/api', tags=['images'])

# 真实路径是复数形式（已对 api.bingyun.vip 实测确认），菜单里显示的单数只是显示名
GENERATE_PATH = 'images/generations'
EDIT_PATH = 'images/edits'
# Gemini 系图像模型只认这条（图片以 markdown base64 内联返回）。
CHAT_IMAGE_PATH = 'chat/completions'

# 走 chat/completions 出图的图像模型，按名字判定。gemini 系靠前缀 + image，
# nano-banana 是 Gemini 图像模型的产品代号（id 里不含 image），单独列出。
_CHAT_IMAGE_PREFIXES = ('gemini',)
_CHAT_IMAGE_HINTS = ('nano-banana',)
# 上游明确说"这个平台不支持图像接口"时的原文片段，用来触发 chat 兜底。
_IMAGES_API_UNSUPPORTED = 'Images API is not supported'
_DATA_URL_RE = re.compile(r'data:(image/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)')

MAX_UPLOAD_IMAGES = 8

# 生图 / 改图允许"网关层失败自动重试一次"的总预算（见 upstream.py::request_with_gateway_retry）。
# 总预算要留出排队、转发和响应体读取余量，并受外层网络设施的请求超时约束。
# 可通过 .env 的 IMAGE_RETRY_BUDGET_SECONDS 覆盖，不用改代码。
IMAGE_RETRY_BUDGET_SECONDS = settings.image_retry_budget_seconds
# 重试之间等多久：给上游一点缓冲时间，也避免对着一个明显没缓过来的上游连续发请求。
IMAGE_RETRY_BACKOFF_SECONDS = 1.5


def uses_chat_image_api(model_id: str) -> bool:
    """这个图像模型是不是只能走 chat/completions 出图（Gemini 系）。"""
    lower = (model_id or '').lower()
    if any(hint in lower for hint in _CHAT_IMAGE_HINTS):
        return True
    return lower.startswith(_CHAT_IMAGE_PREFIXES) and 'image' in lower


def _images_api_unsupported(detail) -> bool:
    return _IMAGES_API_UNSUPPORTED in str(detail or '')


def _encode(images: list[bytes]) -> list[ImageResult]:
    return [
        ImageResult(b64=base64.b64encode(data).decode('ascii'), mime=sniff_image_mime(data))
        for data in images
    ]


def _to_data_url(data: bytes) -> str:
    return f'data:{sniff_image_mime(data)};base64,{base64.b64encode(data).decode("ascii")}'


def _content_texts(content) -> list[str]:
    """把 message.content 摊平成若干字符串。

    上游两种形态都见过：纯字符串，或 `[{type:text,...},{type:image_url,...}]` 这种
    多模态数组。图片既可能直接写进正文（markdown data URL），也可能放在 image_url 里。
    """
    if isinstance(content, str):
        return [content]
    if not isinstance(content, list):
        return []
    texts: list[str] = []
    for part in content:
        if isinstance(part, str):
            texts.append(part)
            continue
        if not isinstance(part, dict):
            continue
        for key in ('text', 'url'):
            if isinstance(part.get(key), str):
                texts.append(part[key])
        image_url = part.get('image_url')
        if isinstance(image_url, str):
            texts.append(image_url)
        elif isinstance(image_url, dict) and isinstance(image_url.get('url'), str):
            texts.append(image_url['url'])
    return texts


def _images_from_chat_payload(payload: dict) -> list[bytes]:
    """从 chat/completions 响应里抠出内联的 base64 图片。"""
    blobs: list[bytes] = []
    choices = payload.get('choices') if isinstance(payload, dict) else None
    for choice in choices or []:
        message = choice.get('message') if isinstance(choice, dict) else None
        if not isinstance(message, dict):
            continue
        for text in _content_texts(message.get('content')):
            for _mime, encoded in _DATA_URL_RE.findall(text or ''):
                try:
                    blobs.append(base64.b64decode(re.sub(r'\s+', '', encoded) + '=' * (-len(encoded) % 4)))
                except Exception:  # 截断 / 非法 base64 的片段直接跳过，别让整张图失败
                    continue
    return blobs


def _chat_image_body(model: str, prompt: str, reference_images: list[bytes] | None = None) -> dict:
    """Gemini 系的出图请求体：文生图就是一句话；改图把参考图作为 image_url 附上。"""
    images = list(reference_images or [])
    if not images:
        content: object = prompt
    else:
        content = [{'type': 'text', 'text': prompt}]
        content += [{'type': 'image_url', 'image_url': {'url': _to_data_url(data)}} for data in images]
    return {'model': model, 'messages': [{'role': 'user', 'content': content}]}


async def _collect(data_list: list[dict], client: httpx.AsyncClient, budget_deadline: float) -> list[bytes]:
    """上游可能返回 b64_json，也可能返回一个要再下载一次的 url，两种都处理。

    budget_deadline：跟生成/改图那次请求共用同一个重试预算（见调用方），
    不是每下载一张图就重新给满 250 秒——不然多张图都触发网关重试时，
    总耗时会不受控地叠加上去。
    """
    images: list[bytes] = []
    errors: list[str] = []
    for item in data_list:
        if not isinstance(item, dict):
            continue
        if item.get('b64_json'):
            images.append(base64.b64decode(item['b64_json']))
            continue
        url = item.get('url')
        if not url:
            continue
        # 部分上游（如 grok-imagine）返回的是图片 URL 而不是 base64，需要再下载一次。
        # 下载同样要防 SSRF：只允许公网地址。
        try:
            parsed = urlparse(url)
            if parsed.scheme not in ('http', 'https'):
                errors.append(f'非法的图片地址：{url[:80]}')
                continue
            assert_public_host(parsed.hostname or '')
            applog.log('上游给的是图片地址，还要再下载一次：%s', url[:80])
            t0 = time.time()
            resp, attempts = await request_with_gateway_retry(
                client, 'GET', url, label='下载生成的图片', budget_deadline=budget_deadline,
                backoff_seconds=IMAGE_RETRY_BACKOFF_SECONDS,
            )
            resp.raise_for_status()
            images.append(resp.content)
            applog.log('图片下载完成 %.2f MB，耗时 %.1fs%s', len(resp.content) / 1e6, time.time() - t0,
                       f'（重试了 {attempts - 1} 次）' if attempts > 1 else '')
        except Exception as exc:  # 下载失败要变成明确错误，不能让服务直接 500
            applog.error('图片下载失败：%s: %s', type(exc).__name__, exc)
            errors.append(f'{type(exc).__name__}: {exc}')
            continue

    if not images and errors:
        raise RuntimeError('无法取得生成的图片（' + '；'.join(errors[:2]) + '）')
    return images


async def _post_image_request(
    client: httpx.AsyncClient, url: str, label: str, budget_deadline: float, **kwargs,
) -> tuple[dict, float]:
    """生图 / 改图共用的请求 + 重试 + 错误归一化，只有 body 的组装方式不同。

    返回 (上游 JSON 响应体, 请求耗时)；失败时直接抛 HTTPException，调用方
    不用重复写"源站确凿结论原样传回状态码、网关模糊失败报 502"这套判断。
    """
    t0 = time.time()
    resp, attempts = await request_with_gateway_retry(
        client, 'POST', url, label=label, budget_deadline=budget_deadline,
        backoff_seconds=IMAGE_RETRY_BACKOFF_SECONDS, **kwargs,
    )
    elapsed = time.time() - t0
    applog.log('上游返回 HTTP %d，耗时 %.1fs%s', resp.status_code, elapsed,
               f'（重试了 {attempts - 1} 次）' if attempts > 1 else '')
    if resp.status_code != 200:
        detail = extract_upstream_error(resp)
        applog.error('%s 失败（共尝试 %d 次）：%s', label, attempts, detail)
        # 源站真给出的响应（哪怕是拒绝，比如内容审核不通过的 400）原样把状态码
        # 传回前端——这是个确凿的结论，不该被当成"連不上上游"的 502。前端会
        # 据此跳过再触发一次 /api/diag/upstream 体检：那一步是用来分辨"到底是
        # 谁的锅"的，源站已经把话说清楚了就没必要再猜，白白多等半分钟。只有
        # 网关层的模糊失败（没到源站、重试也没挽回）才报成我们自己的 502。
        status = resp.status_code if response_reached_origin(resp) else 502
        raise HTTPException(status_code=status, detail=detail)
    return resp.json(), elapsed


async def _generate_via_chat(
    client: httpx.AsyncClient, up: Upstream, model: str, prompt: str,
    budget_deadline: float, reference_images: list[bytes] | None = None,
) -> tuple[list[bytes], dict]:
    """走 chat/completions 出图 / 改图（Gemini 系）。图片以 base64 内联返回。"""
    body = _chat_image_body(model, prompt, reference_images)
    url = f'{up.base_url}/{CHAT_IMAGE_PATH}'
    applog.log('开始请求上游 POST %s（chat 出图，读超时 %ss）', url, http_timeout().read)
    payload, _elapsed = await _post_image_request(
        client, url, f'生图(chat) model={model}', budget_deadline,
        json=body, headers=bearer_headers(up.api_key),
    )
    return _images_from_chat_payload(payload), payload


async def _generate_via_images_api(
    client: httpx.AsyncClient, up: Upstream, model: str, body: dict, budget_deadline: float,
) -> tuple[list[bytes], dict]:
    """走 OpenAI 的 images/generations；撞上"平台不支持图像接口"时自动改走 chat。"""
    url = f'{up.base_url}/{GENERATE_PATH}'
    applog.log('开始请求上游 POST %s（读超时 %ss）', url, http_timeout().read)
    try:
        payload, _elapsed = await _post_image_request(
            client, url, f'生图 model={model}', budget_deadline,
            json=body, headers=bearer_headers(up.api_key),
        )
    except HTTPException as exc:
        if exc.status_code == 404 and _images_api_unsupported(exc.detail):
            applog.log('上游不支持 images/generations（%s），改用 chat/completions 出图', exc.detail)
            return await _generate_via_chat(client, up, model, body.get('prompt', ''), budget_deadline)
        raise
    return await _collect(payload.get('data') or [], client, budget_deadline), payload


async def _edit_via_images_api(
    client: httpx.AsyncClient, up: Upstream, model: str, form: dict,
    files: list, raw_images: list[bytes], budget_deadline: float,
) -> tuple[list[bytes], dict]:
    """走 OpenAI 的 images/edits；撞上"平台不支持图像接口"时自动改走 chat。"""
    # multipart 请求不能手动设 Content-Type，交给 httpx 自动生成 boundary。
    url = f'{up.base_url}/{EDIT_PATH}'
    applog.log('开始请求上游 POST %s（读超时 %ss）', url, http_timeout().read)
    try:
        payload, _elapsed = await _post_image_request(
            client, url, f'改图 model={model}', budget_deadline,
            data=form, files=files, headers={'Authorization': f'Bearer {up.api_key}'},
        )
    except HTTPException as exc:
        if exc.status_code == 404 and _images_api_unsupported(exc.detail):
            applog.log('上游不支持 images/edits（%s），改用 chat/completions 改图', exc.detail)
            return await _generate_via_chat(
                client, up, model, form.get('prompt', ''), budget_deadline,
                reference_images=raw_images,
            )
        raise
    return await _collect(payload.get('data') or [], client, budget_deadline), payload


def _usage_of(payload: dict, chat: bool, sent_at: float) -> dict:
    """chat 与 images 两条通路的用量字段名不同，按通路归一化。"""
    raw = (payload or {}).get('usage')
    usage = summarize_usage('chat_completions' if chat else 'images_generate', raw)
    usage['duration_seconds'] = round(time.time() - sent_at, 1)
    return usage


@router.post('/images/generate', response_model=ImageResponse)
async def generate(req: GenerateRequest, up: Upstream = Depends(resolve_upstream)):
    body: dict = {
        'model': req.model,
        'prompt': req.prompt,
    }
    if req.output_format:
        body['output_format'] = req.output_format
    if req.size != 'auto':
        body['size'] = req.size
    if req.quality != 'auto':
        body['quality'] = req.quality
    if req.background:
        body['background'] = req.background

    waited, running = applog.route_enter()
    applog.log(
        '进入生图路由 model=%s size=%s（排队 %.1fs，并发 %d 个，系统线程 %d 个）',
        req.model, req.size, waited, running, applog.thread_count(),
    )
    if waited > 1:
        applog.warn('排队 %.1fs —— 服务端忙不过来，请求在干等', waited)

    chat_path = uses_chat_image_api(req.model)
    if chat_path:
        applog.log('model=%s 属 Gemini 系，走 chat/completions 出图（该上游不支持 images/generations）', req.model)

    sent_at = time.time()
    budget_deadline = sent_at + IMAGE_RETRY_BUDGET_SECONDS
    payload: dict | None = None
    try:
        try:
            async with httpx.AsyncClient(timeout=http_timeout()) as client:
                if chat_path:
                    images, payload = await _generate_via_chat(
                        client, up, req.model, req.prompt, budget_deadline)
                else:
                    images, payload = await _generate_via_images_api(
                        client, up, req.model, body, budget_deadline)
        except (httpx.HTTPError, RuntimeError) as exc:
            applog.error('请求上游出错：%s —— %s', type(exc).__name__, describe_error(exc))
            raise HTTPException(status_code=502, detail=describe_error(exc)) from exc
    finally:
        applog.route_exit()

    if not images:
        applog.error('上游没返回任何图片')
        raise HTTPException(status_code=502, detail='上游没有返回任何图片。')

    usage = _usage_of(payload or {}, chat_path, sent_at)
    result = ImageResponse(images=_encode(images), usage=usage)
    total = sum(len(i.b64) for i in result.images)
    applog.log(
        '✓ 生图完成 %d 张，base64 共 %.2f MB，总耗时 %.1fs',
        len(result.images), total / 1e6, time.time() - sent_at,
    )
    return result


@router.post('/images/edit', response_model=ImageResponse)
async def edit(
    up: Upstream = Depends(resolve_upstream),
    model: str = Form(...),
    prompt: str = Form(...),
    size: str = Form('auto'),
    quality: str = Form('auto'),
    output_format: str | None = Form(None),
    background: str | None = Form(None),
    images: list[UploadFile] = File(...),
):
    if not images:
        raise HTTPException(status_code=400, detail='至少上传一张参考图。')
    if len(images) > MAX_UPLOAD_IMAGES:
        raise HTTPException(status_code=400, detail=f'最多上传 {MAX_UPLOAD_IMAGES} 张参考图。')

    form: dict = {
        'model': model,
        'prompt': prompt,
    }
    if output_format:
        form['output_format'] = output_format
    if size != 'auto':
        form['size'] = size
    if quality != 'auto':
        form['quality'] = quality
    if background:
        form['background'] = background

    files = []
    raw_images: list[bytes] = []
    for upload in images:
        data = await upload.read()          # 异步读，别把事件循环堵住
        if not data:
            raise HTTPException(status_code=400, detail=f'参考图 {upload.filename} 是空文件。')
        raw_images.append(data)
        files.append(('image', (upload.filename or 'upload.png', data, sniff_image_mime(data))))

    waited, running = applog.route_enter()
    applog.log(
        '进入改图路由 model=%s 参考图 %d 张（排队 %.1fs，并发 %d 个，系统线程 %d 个）',
        model, len(images), waited, running, applog.thread_count(),
    )
    if waited > 1:
        applog.warn('排队 %.1fs —— 服务端忙不过来，请求在干等', waited)

    chat_path = uses_chat_image_api(model)
    if chat_path:
        applog.log('model=%s 属 Gemini 系，走 chat/completions 改图（参考图内联为 data URL）', model)

    sent_at = time.time()
    budget_deadline = sent_at + IMAGE_RETRY_BUDGET_SECONDS
    payload: dict | None = None
    try:
        try:
            async with httpx.AsyncClient(timeout=http_timeout()) as client:
                if chat_path:
                    images_out, payload = await _generate_via_chat(
                        client, up, model, prompt, budget_deadline, reference_images=raw_images)
                else:
                    images_out, payload = await _edit_via_images_api(
                        client, up, model, form, files, raw_images, budget_deadline)
        except (httpx.HTTPError, RuntimeError) as exc:
            applog.error('请求上游出错：%s —— %s', type(exc).__name__, describe_error(exc))
            raise HTTPException(status_code=502, detail=describe_error(exc)) from exc
    finally:
        applog.route_exit()

    if not images_out:
        applog.error('上游没返回任何图片')
        raise HTTPException(status_code=502, detail='上游没有返回任何图片。')

    usage = _usage_of(payload or {}, chat_path, sent_at)
    out = ImageResponse(images=_encode(images_out), usage=usage)
    applog.log('✓ 改图完成 %d 张，总耗时 %.1fs', len(out.images), time.time() - sent_at)
    return out
