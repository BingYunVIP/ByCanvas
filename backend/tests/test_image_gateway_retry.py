"""生图 / 改图接上 upstream.request_with_gateway_retry 之后的端到端行为。

单独的 test_upstream_retry.py 已经锁死了重试机制本身（判据、预算、退避、
读超时收紧）；这里只确认 images.py 真的把它接对了地方——包括
_collect() 里"下载图片 URL"那一跳也一样受益。
"""
from __future__ import annotations

import asyncio
from tempfile import SpooledTemporaryFile

import httpx
import pytest
from fastapi import UploadFile

from app.deps import Upstream
from app.routers import images
from app.schemas import GenerateRequest


def _install(monkeypatch, handler):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(images.httpx, 'AsyncClient',
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))


def test_generate_retries_once_on_524_then_succeeds(monkeypatch):
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(524, content=b'<html>524</html>', headers={'content-type': 'text/html'})
        return httpx.Response(200, json={'data': [{'b64_json': 'aW1hZ2U='}], 'usage': {'input_tokens': 3}})

    _install(monkeypatch, handler)
    monkeypatch.setattr(images, 'IMAGE_RETRY_BUDGET_SECONDS', 250.0)
    monkeypatch.setattr(images, 'IMAGE_RETRY_BACKOFF_SECONDS', 0.001)

    async def exercise():
        up = Upstream(base_url='https://example.test/v1', api_key='fake-key')
        return await images.generate(GenerateRequest(model='gpt-image-2.5-sunburst', prompt='a red cube'), up)

    result = asyncio.run(exercise())
    assert len(calls) == 2
    assert len(result.images) == 1
    assert result.errors == []


def test_generate_gives_up_after_repeated_524_and_reports_it(monkeypatch):
    """一直没缓过来时应该如实报 502，而不是假装成功或者无限重试。"""
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(524, content=b'<html>524</html>', headers={'content-type': 'text/html'})

    _install(monkeypatch, handler)
    # 预算收紧到毫秒级，测试不用真的等 1.5s 默认退避 * 好几次
    monkeypatch.setattr(images, 'IMAGE_RETRY_BUDGET_SECONDS', 0.05)

    async def exercise():
        up = Upstream(base_url='https://example.test/v1', api_key='fake-key')
        with pytest.raises(Exception) as excinfo:
            await images.generate(GenerateRequest(model='gpt-image-2.5-sunburst', prompt='a red cube'), up)
        return excinfo.value

    exc = asyncio.run(exercise())
    assert len(calls) >= 1
    assert getattr(exc, 'status_code', None) == 502
    assert '524' in str(getattr(exc, 'detail', exc))


def test_generate_does_not_retry_real_origin_error(monkeypatch):
    """带 x-request-id 说明源站真处理过（比如模型不存在），重试没有意义，
    应该一次就报错，不浪费用户的等待时间；状态码也原样传回（不是我们自己的 502）。"""
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(404, json={'error': {'message': 'model not found'}},
                              headers={'x-request-id': 'req-123'})

    _install(monkeypatch, handler)

    async def exercise():
        up = Upstream(base_url='https://example.test/v1', api_key='fake-key')
        with pytest.raises(Exception) as excinfo:
            await images.generate(GenerateRequest(model='no-such-model', prompt='a red cube'), up)
        return excinfo.value

    exc = asyncio.run(exercise())
    assert len(calls) == 1
    assert getattr(exc, 'status_code', None) == 404


def test_generate_passes_through_moderation_rejection_status(monkeypatch):
    """回归测试：真实故障（2026-09-20）——内容审核拒绝（400，带 x-request-id）
    被我们自己的重试逻辑正确识别为"源站的确凿结论"，不重试、也不该被硬编码成
    502（那样前端会误以为是网关/网络问题，去跑一次多余的 30 秒体检）。"""
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            400,
            json={'error': {'message': '您的请求无法用于生成图像。该请求可能因安全政策被拦截，或不适合进行图像生成。'}},
            headers={'x-request-id': 'req-reject-1'},
        )

    _install(monkeypatch, handler)

    async def exercise():
        up = Upstream(base_url='https://example.test/v1', api_key='fake-key')
        with pytest.raises(Exception) as excinfo:
            await images.generate(GenerateRequest(model='gpt-image-2.5-sunburst', prompt='something rejected'), up)
        return excinfo.value

    exc = asyncio.run(exercise())
    assert len(calls) == 1  # 没有被误判成网关失败去重试
    assert getattr(exc, 'status_code', None) == 400
    assert '安全政策' in str(getattr(exc, 'detail', exc))


def test_download_url_step_also_retries_on_gateway_error(monkeypatch):
    """grok-imagine 这类返回图片 URL（而不是 b64）的上游，下载那一跳
    同样可能撞上网关层的暂时性失败，也该受益于同一套重试。"""
    calls = {'generate': 0, 'download': 0}

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith('/generations'):
            calls['generate'] += 1
            return httpx.Response(200, json={'data': [{'url': 'https://img.example.test/pic.png'}]})
        calls['download'] += 1
        if calls['download'] == 1:
            return httpx.Response(503, content=b'<html>503</html>', headers={'content-type': 'text/html'})
        return httpx.Response(200, content=b'\x89PNG\r\n\x1a\nfakepngbytes')

    _install(monkeypatch, handler)
    monkeypatch.setattr(images, 'assert_public_host', lambda host: None)
    monkeypatch.setattr(images, 'IMAGE_RETRY_BACKOFF_SECONDS', 0.001)

    async def exercise():
        up = Upstream(base_url='https://example.test/v1', api_key='fake-key')
        return await images.generate(GenerateRequest(model='grok-imagine-image-2.0', prompt='a red cube'), up)

    result = asyncio.run(exercise())
    assert calls['generate'] == 1
    assert calls['download'] == 2
    assert len(result.images) == 1


async def _edit_one(model='gpt-image-2.5-sunburst'):
    file = SpooledTemporaryFile(max_size=1024)
    file.write(b'image')
    file.seek(0)
    upload = UploadFile(filename='reference.png', file=file)
    try:
        return await images.edit(
            up=Upstream(base_url='https://example.test/v1', api_key='fake-key'),
            model=model, prompt='change the background', size='auto',
            quality='auto', output_format=None, background=None,
            images=[upload],
        )
    finally:
        await upload.close()


def test_edit_passes_through_moderation_rejection_status(monkeypatch):
    """改图跟生图共用同一套请求加重试逻辑：源站真的拒绝（400，带
    x-request-id）时，状态码原样传回，不该笼统报成 502，道理同
    test_generate_passes_through_moderation_rejection_status。

    数量（n）已经整个下线，改图现在跟生图一样只发一次请求，不再有
    "多张图各自失败、状态码怎么汇总"这种多图批量场景需要覆盖。
    """
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(400, json={'error': {'message': '内容审核不通过'}},
                              headers={'x-request-id': 'req-edit-reject'})

    _install(monkeypatch, handler)

    async def exercise():
        with pytest.raises(Exception) as excinfo:
            await _edit_one()
        return excinfo.value

    exc = asyncio.run(exercise())
    assert len(calls) == 1  # 没有被误判成网关失败去重试
    assert getattr(exc, 'status_code', None) == 400


def test_edit_retries_once_on_524_then_succeeds(monkeypatch):
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(524, content=b'<html>524</html>', headers={'content-type': 'text/html'})
        return httpx.Response(200, json={'data': [{'b64_json': 'aW1hZ2U='}]})

    _install(monkeypatch, handler)
    monkeypatch.setattr(images, 'IMAGE_RETRY_BACKOFF_SECONDS', 0.001)

    result = asyncio.run(_edit_one())
    assert len(calls) == 2
    assert len(result.images) == 1
    assert result.errors == []
