"""端到端确认：文本模型带的参考图**真的**进了发给上游的请求体。

单测只验证了转换函数对不对；这个测试验证的是「转换函数有没有被接上」——
中间格式进了 /api/chat，出去的时候必须是对应协议的图片写法。
只测转换不测接线，就会出现「函数写对了但没人调用」这种看不出来问题。
"""
from __future__ import annotations

import base64
import json
import types

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main as main_mod
from app.protocols import streaming as streaming_mod

B64_BASE = base64.urlsafe_b64encode(b'https://mock.test/v1').decode().rstrip('=')
HEADERS = {
    'X-Upstream-Base': B64_BASE,
    'X-Upstream-Key': 'sk-test',
    'Content-Type': 'application/json',
}

PNG = 'data:image/png;base64,' + base64.b64encode(b'hello').decode()
MESSAGES = [{'role': 'user', 'content': [
    {'type': 'text', 'text': '这是什么'},
    {'type': 'image', 'image': PNG},
]}]


def _sse(obj: dict) -> bytes:
    return f'data: {json.dumps(obj, ensure_ascii=False)}\n\n'.encode()


@pytest.fixture
def capture(monkeypatch):
    """接住实际发出的请求体，按协议返回一段能正常收尾的流。"""
    sent: dict[str, dict] = {}
    real_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        sent['body'] = json.loads(request.content)
        sent['path'] = request.url.path
        if request.url.path.endswith('/messages'):
            content = (
                b'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"ok"}}\n\n'
                b'event: message_stop\ndata: {}\n\n'
            )
        elif request.url.path.endswith('/responses'):
            content = b''.join([
                _sse({'type': 'response.output_text.delta', 'delta': 'ok'}),
                _sse({'type': 'response.completed', 'response': {'usage': {'input_tokens': 1}}}),
            ])
        else:
            content = _sse({'choices': [{'delta': {'content': 'ok'}}]}) + b'data: [DONE]\n\n'
        return httpx.Response(200, content=content, headers={'content-type': 'text/event-stream'})

    def fake_client(*args, **kwargs):
        kwargs['transport'] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(
        streaming_mod, 'httpx',
        types.SimpleNamespace(
            AsyncClient=fake_client,
            TimeoutException=httpx.TimeoutException,
            HTTPError=httpx.HTTPError,
            ReadTimeout=httpx.ReadTimeout,
        ),
    )
    return sent


@pytest.fixture(autouse=True)
def clear_preference():
    streaming_mod._preferred.clear()
    yield
    streaming_mod._preferred.clear()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr('app.config.settings.upstream_allowlist', 'api.bingyun.vip,mock.test')
    return TestClient(main_mod.app)


def test_responses_sends_input_image(client, capture):
    resp = client.post('/api/chat', headers=HEADERS,
                       json={'mode': 'responses', 'model': 'gpt-5.6-terra', 'messages': MESSAGES})
    assert resp.status_code == 200, resp.text
    body = capture['body']
    assert capture['path'] == '/v1/responses'
    assert body['input'][0]['content'] == [
        {'type': 'input_text', 'text': '这是什么'},
        {'type': 'input_image', 'image_url': PNG, 'detail': 'auto'},
    ]


def test_chat_completions_sends_image_url(client, capture):
    resp = client.post('/api/chat', headers=HEADERS,
                       json={'mode': 'chat_completions', 'model': 'gpt-5.6-terra', 'messages': MESSAGES})
    assert resp.status_code == 200, resp.text
    body = capture['body']
    assert capture['path'] == '/v1/chat/completions'
    assert body['messages'][0]['content'] == [
        {'type': 'text', 'text': '这是什么'},
        {'type': 'image_url', 'image_url': {'url': PNG}},
    ]


def test_messages_sends_base64_source(client, capture):
    resp = client.post('/api/chat', headers=HEADERS,
                       json={'mode': 'messages', 'model': 'claude-x', 'messages': MESSAGES})
    assert resp.status_code == 200, resp.text
    body = capture['body']
    assert capture['path'] == '/v1/messages'
    assert body['messages'][0]['content'] == [
        {'type': 'text', 'text': '这是什么'},
        {'type': 'image', 'source': {
            'type': 'base64', 'media_type': 'image/png', 'data': base64.b64encode(b'hello').decode(),
        }},
    ]


def test_external_image_is_rejected_before_touching_upstream(client, capture):
    """外链必须被 422 挡在门口，绝不能转发给上游。"""
    resp = client.post('/api/chat', headers=HEADERS, json={
        'mode': 'responses',
        'model': 'gpt-5.6-terra',
        'messages': [{'role': 'user', 'content': [
            {'type': 'image', 'image': 'http://169.254.169.254/latest/meta-data'},
        ]}],
    })
    assert resp.status_code == 422, resp.text
    assert 'body' not in capture, '外链图片一个字节都不能发给上游'


def test_plain_text_request_body_is_unchanged(client, capture):
    """不带图时线上格式必须和以前完全一致，不能因为加了功能就都变成数组。"""
    resp = client.post('/api/chat', headers=HEADERS, json={
        'mode': 'responses', 'model': 'gpt-5.6-terra',
        'messages': [{'role': 'user', 'content': '纯文本提问'}],
    })
    assert resp.status_code == 200, resp.text
    assert capture['body']['input'] == [{'role': 'user', 'content': '纯文本提问'}]
