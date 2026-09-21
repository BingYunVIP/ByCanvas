"""生图 / 改图请求体的组装：按需省略默认值参数；数量（n）和审核（moderation）
已经整个下线（前后端都删除，鸡肋功能——见 2026-09-20 的改动），不会再出现在
请求体里、也不接受调用方传入。"""
import asyncio
import json
from tempfile import SpooledTemporaryFile

import httpx
import pytest
from fastapi import UploadFile

from app.deps import Upstream
from app.routers import images
from app.schemas import GenerateRequest


def _install(monkeypatch, handler):
    # 必须先把真正的 AsyncClient 存下来再传给 lambda：images.httpx 和这里的
    # httpx 是同一个模块对象，monkeypatch 覆盖的是全局属性——lambda 内部若直接
    # 写 httpx.AsyncClient(...)，调用时查到的就是这个 lambda 自己，会死循环。
    real_client = httpx.AsyncClient
    monkeypatch.setattr(images.httpx, 'AsyncClient',
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))


def test_generate_omits_default_value_parameters(monkeypatch):
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(200, json={'data': [{'b64_json': 'aW1hZ2U='}]})

    _install(monkeypatch, respond)

    async def exercise():
        up = Upstream(base_url='https://example.test/v1', api_key='fake-key')
        return await images.generate(GenerateRequest(model='custom-image', prompt='a flower'), up)

    result = asyncio.run(exercise())
    assert len(result.images) == 1
    assert len(calls) == 1
    assert json.loads(calls[0].content) == {'model': 'custom-image', 'prompt': 'a flower'}


def test_generate_includes_only_explicit_non_default_parameters(monkeypatch):
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(200, json={'data': [{'b64_json': 'aW1hZ2U='}]})

    _install(monkeypatch, respond)

    async def exercise():
        up = Upstream(base_url='https://example.test/v1', api_key='fake-key')
        req = GenerateRequest(model='custom-image', prompt='a flower', size='1024x1536',
                              quality='high', output_format='webp', background='transparent')
        return await images.generate(req, up)

    asyncio.run(exercise())
    assert json.loads(calls[0].content) == {
        'model': 'custom-image', 'prompt': 'a flower', 'output_format': 'webp',
        'size': '1024x1536', 'quality': 'high', 'background': 'transparent',
    }


async def _edit_one(**overrides):
    file = SpooledTemporaryFile(max_size=1024)
    file.write(b'image')
    file.seek(0)
    upload = UploadFile(filename='reference.png', file=file)
    params = dict(up=Upstream(base_url='https://example.test/v1', api_key='fake-key'),
                  model='gpt-image-2.5-sunburst', prompt='change the background',
                  size='auto', quality='auto', output_format=None, background=None,
                  images=[upload])
    params.update(overrides)
    try:
        return await images.edit(**params)
    finally:
        await upload.close()


def test_edit_omits_default_value_parameters(monkeypatch):
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(200, json={'data': [{'b64_json': 'aW1hZ2U='}]})

    _install(monkeypatch, respond)

    result = asyncio.run(_edit_one())
    assert len(result.images) == 1
    assert len(calls) == 1
    multipart = calls[0].content
    assert b'name="image"; filename="reference.png"' in multipart
    # n / moderation 已经下线：函数签名里都不接受了，请求体里更不会出现。
    for key in ('n', 'size', 'quality', 'output_format', 'moderation', 'background'):
        assert f'name="{key}"'.encode() not in multipart


def test_edit_does_not_accept_removed_quantity_or_moderation_kwargs():
    """n / moderation 已经整个下线：edit() 的签名里不再有这两个参数，
    调用方传了就该立刻报参数错误，而不是被静默吞掉。"""
    with pytest.raises(TypeError):
        asyncio.run(_edit_one(n=2))
    with pytest.raises(TypeError):
        asyncio.run(_edit_one(moderation='low'))


def test_cancelling_edit_cancels_inflight_request(monkeypatch):
    """客户端断开时，正在等待上游的改图请求要能被干净取消，不留孤儿连接。"""
    async def exercise():
        calls = 0
        active = 0
        started = asyncio.Event()
        waiting = asyncio.Event()

        async def respond(_request):
            nonlocal calls, active
            calls += 1
            active += 1
            started.set()
            try:
                await waiting.wait()
            finally:
                active -= 1

        _install(monkeypatch, respond)
        task = asyncio.create_task(_edit_one())
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return calls, active

    calls, active = asyncio.run(exercise())
    assert calls == 1
    assert active == 0
