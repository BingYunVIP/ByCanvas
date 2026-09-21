"""流式聊天（SSE）。

前端用 fetch + ReadableStream 解析，不能用 EventSource —— 后者无法自定义请求头，
而我们的 Key 必须放在请求头里。

为什么路由和生成器都是 async：
  同步版本要开一条线程去等上游，而 Starlette 对**同步**生成器会走
  iterate_in_threadpool —— 等于整个流的时长都占着一个线程池线程。
  线程数有限，几路聊天就能占满，之后所有请求排队，浏览器端就表现为「连不上」。
  改成 async 后全程在事件循环里等，一个线程都不占（见 protocols/streaming.py 顶部）。
"""
from __future__ import annotations

import asyncio
import json
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from .. import log as applog
from ..deps import Upstream, resolve_upstream
from ..protocols.streaming import CHAT_MODES, stream_chat
from ..schemas import ChatRequest, ImagePlanRequest
from ..upstream import bearer_headers, describe_error, extract_upstream_error, http_timeout, summarize_usage

router = APIRouter(prefix='/api', tags=['chat'])
IMAGE_TEXT_MODEL = 'gpt-5.6-sol'


@router.post('/image-plan')
async def image_plan(req: ImagePlanRequest, up: Upstream = Depends(resolve_upstream)):
    """生图辅助模型独立于聊天选择；推理自动，服务器不保存上下文或图片。"""
    paths = {'responses': 'responses', 'chat_completions': 'chat/completions'}
    allowed = {'input', 'instructions', 'messages', 'tools', 'tool_choice', 'parallel_tool_calls'}
    body = {key: value for key, value in req.body.items() if key in allowed}
    # 不接收界面或旧任务中的 model / reasoning 设置；省略推理字段即自动。
    body['model'] = IMAGE_TEXT_MODEL
    body['stream'] = False
    if req.mode == 'responses':
        body['store'] = False
    headers = bearer_headers(up.api_key)
    try:
        async with httpx.AsyncClient(timeout=http_timeout()) as client:
            response = await client.post(f'{up.base_url}/{paths[req.mode]}', headers=headers, json=body)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=describe_error(exc)) from exc
    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=extract_upstream_error(response))
    try:
        return response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail='文本模型未返回有效的工具调用响应') from exc


def _sse(event: str, data: dict) -> str:
    return f'event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n'


@router.post('/chat')
async def chat(req: ChatRequest, up: Upstream = Depends(resolve_upstream)):
    if req.mode not in CHAT_MODES:
        raise HTTPException(status_code=400, detail=f'未知的接口模式：{req.mode}')

    history = [{'role': m.role, 'content': m.content} for m in req.messages]
    sent_at = time.time()
    events: asyncio.Queue = asyncio.Queue()

    async def worker() -> None:
        """在事件循环里等上游，把吐出来的片段塞进队列。全程不需要线程。"""
        try:
            received = False

            def on_event(kind, text):
                nonlocal received
                if kind in ('content', 'reasoning') and text.strip():
                    received = True
                events.put_nowait((kind, text))

            usage = await stream_chat(
                req.mode, up, req.model, req.reasoning_effort,
                history, req.max_tokens,
                on_event,
            )
            if not received:
                raise RuntimeError('聊天接口没有返回任何内容。')
            events.put_nowait(('__usage__', usage))
        except Exception as exc:  # 兜底：不能让连接断掉却不给任何提示
            events.put_nowait(('__error__', exc))
        finally:
            events.put_nowait(('__end__', None))

    task = asyncio.create_task(worker())

    async def sse():
        waited, running = applog.route_enter()
        first_at = [0.0]
        chunks = [0]
        applog.log(
            '聊天流开始 mode=%s model=%s（排队 %.1fs，并发 %d 个，系统线程 %d 个）',
            req.mode, req.model, waited, running, applog.thread_count(),
        )
        if waited > 1:
            applog.log('⚠️ 排队 %.1fs —— 服务端忙不过来，请求在干等', waited)

        try:
            while True:
                kind, payload = await events.get()
                if kind == '__end__':
                    break
                if kind == '__error__':
                    applog.log('✗ 聊天流出错：%s', describe_error(payload))
                    yield _sse('error', {'message': describe_error(payload)})
                    break
                if kind == '__usage__':
                    report = summarize_usage(req.mode, payload)
                    report['duration_seconds'] = round(time.time() - sent_at, 1)
                    applog.log(
                        '✓ 聊天流正常结束，共 %d 段，耗时 %.1fs',
                        chunks[0], report['duration_seconds'],
                    )
                    yield _sse('usage', report)
                    continue
                if not first_at[0]:
                    first_at[0] = time.time()
                    applog.log('上游吐出第一个字，等待 %.1fs', first_at[0] - sent_at)
                chunks[0] += 1
                yield _sse(kind, {'text': payload})

            # 出错时也要补一个 done，前端才有明确的收尾信号
            yield _sse('done', {})
        finally:
            # 客户端断开时把上游任务一起收掉，别留下孤儿任务
            if not task.done():
                task.cancel()
            applog.route_exit()
            applog.log(
                '聊天流收尾，占用 %.1fs（并发还剩 %d 个，系统线程 %d 个）',
                time.time() - sent_at, applog.http_count(), applog.thread_count(),
            )

    return StreamingResponse(sse(), media_type='text/event-stream')
