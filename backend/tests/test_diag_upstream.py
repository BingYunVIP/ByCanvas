"""上游体检接口 /api/diag/upstream 的行为。

重点验证的是**结论能不能看懂**：上游返回 Cloudflare 式的 502 HTML 时
（响应头没有 x-request-id），接口要说清楚「请求没到源站、与本项目无关」，
而不是把一整页 HTML 丢给用户。

用 MockTransport 顶掉真实网络，不依赖外部服务、不消耗真实 Key。
"""
from __future__ import annotations

import base64
import types

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main as main_mod
from app.routers import diag as diag_mod

B64_BASE = base64.urlsafe_b64encode(b'https://mock.test/v1').decode().rstrip('=')
HEADERS = {'X-Upstream-Base': B64_BASE, 'X-Upstream-Key': 'sk-test'}

_GATEWAY_HTML = b'<html><head><title>api.bingyun.vip | 502: Bad gateway</title></head></html>'


def _install_transport(monkeypatch, handler):
    """把 diag 模块里的 httpx 换成走 MockTransport 的版本。"""
    real_client = httpx.AsyncClient

    def fake_client(*args, **kwargs):
        kwargs['transport'] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(
        diag_mod, 'httpx',
        types.SimpleNamespace(
            AsyncClient=fake_client,
            TimeoutException=httpx.TimeoutException,
            HTTPError=httpx.HTTPError,
        ),
    )


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr('app.config.settings.upstream_allowlist', 'api.bingyun.vip,mock.test')
    return TestClient(main_mod.app)


def _sse_chat(request: httpx.Request) -> httpx.Response:
    """聊天口按流式探，mock 也要给 SSE —— 给纯 JSON 会被判成「没吐数据」。"""
    return httpx.Response(
        200,
        content=b'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
        headers={'x-request-id': 'abc', 'content-type': 'text/event-stream'},
    )


def test_all_healthy(client, monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == 'GET':
            return httpx.Response(200, json={'data': []}, headers={'x-request-id': 'abc'})
        return _sse_chat(request)

    _install_transport(monkeypatch, handler)
    data = client.post('/api/diag/upstream', headers=HEADERS).json()
    assert data['ok'] is True, data
    assert {r['name'] for r in data['results']} == {'模型列表', '聊天', '聊天(responses)'}
    assert all(r['verdict'] == '正常' for r in data['results']), data['results']


def test_connected_but_silent_is_reported(client, monkeypatch):
    """连上了（200）但一直不吐数据，不能报「正常」—— 这正是 /responses 的典型病。"""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == 'GET':
            return httpx.Response(200, json={'data': []}, headers={'x-request-id': 'abc'})
        return httpx.Response(200, content=b'', headers={'x-request-id': 'abc'})

    _install_transport(monkeypatch, handler)
    data = client.post('/api/diag/upstream', headers=HEADERS).json()
    assert data['ok'] is False
    for item in data['results'][1:]:
        assert item['http'] == 0 and '一个数据片段都没吐' in item['verdict'], item


def test_gateway_502_is_explained(client, monkeypatch):
    """网关 502（没到源站）必须被翻译成人话，不能回显 HTML。"""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith('/models'):
            return httpx.Response(200, json={'data': []}, headers={'x-request-id': 'abc'})
        return httpx.Response(502, content=_GATEWAY_HTML,
                              headers={'content-type': 'text/html; charset=UTF-8'})

    _install_transport(monkeypatch, handler)
    data = client.post('/api/diag/upstream', headers=HEADERS).json()

    assert data['ok'] is False
    assert data['results'][0]['http'] == 200
    for item in data['results'][1:]:
        assert item['http'] == 502
        assert '网关 502' in item['verdict']
        assert '<html' not in item['verdict']


def test_origin_401_points_at_key(client, monkeypatch):
    """带 x-request-id 的 401 说明到了源站，结论应该是「Key 无效」而不是网关故障。"""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={'error': {'message': 'invalid api key'}},
                              headers={'x-request-id': 'abc'})

    _install_transport(monkeypatch, handler)
    data = client.post('/api/diag/upstream', headers=HEADERS).json()
    assert data['ok'] is False
    assert all('Key 无效' in r['verdict'] for r in data['results'])


def test_probe_images_skips_chat_endpoints(client, monkeypatch):
    """生图失败时探 images，不该去碰聊天口 —— 拿生图模型探聊天只会得到
    「模型不存在」这种误导结论。"""
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        return httpx.Response(200, json={'data': []}, headers={'x-request-id': 'abc'})

    _install_transport(monkeypatch, handler)
    data = client.post('/api/diag/upstream?probe=images', headers=HEADERS).json()

    assert [r['name'] for r in data['results']] == ['模型列表', '生图'], data['results']
    assert not any('chat' in p for p in seen), seen


def test_probe_model_is_passed_through(client, monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == 'POST':
            seen['body'] = request.content
        return httpx.Response(200, json={'data': []}, headers={'x-request-id': 'abc'})

    _install_transport(monkeypatch, handler)
    client.post('/api/diag/upstream?model=gpt-5.6-sol', headers=HEADERS)
    assert b'gpt-5.6-sol' in seen['body']
    assert b'mock.test' not in seen['body']  # 别把地址写进请求体
