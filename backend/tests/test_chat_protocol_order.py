"""聊天协议的自动选择顺序 —— 这个顺序踩过坑，必须有测试锁住。

背景：本项目的上游（api.bingyun.vip）实测 `/responses` 通、`/chat/completions` 502。
但早期注释写的是反的（说 /responses 会挂起），导致曾经把 gpt 写死走
/chat/completions，聊天全线失败。

所以这里明确验证：mode=auto 时**先打 /responses**。
上游情况变了要改顺序，改完这个测试会红，正好提醒改的是有依据的地方。
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

_GATEWAY_HTML = b'<html><head><title>502 Bad gateway</title></head></html>'


def _sse(obj: dict) -> bytes:
    return f'data: {json.dumps(obj, ensure_ascii=False)}\n\n'.encode()


def _install(monkeypatch, paths: list, responses_ok: bool):
    real_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path.endswith('/responses') and responses_ok:
            # content 必须是 bytes：给迭代器的话 httpx 的 MockTransport 不支持流式读取
            return httpx.Response(
                200,
                content=b''.join([
                    _sse({'type': 'response.reasoning_summary_text.delta', 'delta': '想一下'}),
                    _sse({'type': 'response.output_text.delta', 'delta': '你好'}),
                    _sse({'type': 'response.completed',
                          'response': {'usage': {'input_tokens': 10, 'output_tokens': 2}}}),
                ]),
                headers={'content-type': 'text/event-stream'},
            )
        if request.url.path.endswith('/chat/completions') and not responses_ok:
            return httpx.Response(
                200,
                content=b''.join([
                    _sse({'choices': [{'delta': {'content': '兜底回答'}}]}),
                    _sse({'choices': [{'delta': {}}], 'usage': {'prompt_tokens': 5}}),
                    b'data: [DONE]\n\n',
                ]),
                headers={'content-type': 'text/event-stream'},
            )
        return httpx.Response(502, content=_GATEWAY_HTML,
                              headers={'content-type': 'text/html'})

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


@pytest.fixture(autouse=True)
def clear_preference():
    """_preferred 是模块级缓存，测试之间要清干净，免得互相影响。"""
    streaming_mod._preferred.clear()
    yield
    streaming_mod._preferred.clear()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr('app.config.settings.upstream_allowlist', 'api.bingyun.vip,mock.test')
    return TestClient(main_mod.app)


def _events(resp) -> list[dict]:
    """把 SSE 响应解析成 [{event, data}]。"""
    out, name = [], 'message'
    for raw in resp.text.split('\n\n'):
        data_lines = []
        for line in raw.split('\n'):
            if line.startswith('event: '):
                name = line[7:].strip()
            elif line.startswith('data: '):
                data_lines.append(line[6:])
        if data_lines:
            out.append({'event': name, 'data': json.loads('\n'.join(data_lines))})
    return out


def test_auto_tries_responses_first(client, monkeypatch):
    """/responses 通时，auto 应该第一个就打它，且不再碰 /chat/completions。"""
    paths: list[str] = []
    _install(monkeypatch, paths, responses_ok=True)

    resp = client.post('/api/chat', headers=HEADERS,
                       json={'mode': 'auto', 'model': 'gpt-5.6-sol',
                             'messages': [{'role': 'user', 'content': 'hi'}]})
    assert resp.status_code == 200, resp.text

    assert paths == ['/v1/responses'], f'应该只打 /responses，实际打了 {paths}'
    events = _events(resp)
    assert [e['event'] for e in events] == ['reasoning', 'content', 'usage', 'done'], events
    assert events[1]['data']['text'] == '你好'


def test_auto_falls_back_to_chat_completions(client, monkeypatch):
    """/responses 502、一个字都没吐时，auto 要自动回退 /chat/completions。"""
    paths: list[str] = []
    _install(monkeypatch, paths, responses_ok=False)

    resp = client.post('/api/chat', headers=HEADERS,
                       json={'mode': 'auto', 'model': 'gpt-5.6-sol',
                             'messages': [{'role': 'user', 'content': 'hi'}]})
    assert resp.status_code == 200, resp.text

    assert paths == ['/v1/responses', '/v1/chat/completions'], paths
    texts = [e['data'].get('text') for e in _events(resp) if e['event'] == 'content']
    assert texts == ['兜底回答'], texts


def test_slow_silent_endpoint_is_abandoned(client, monkeypatch):
    """连上了但一直不吐字，要能及时并发试备选 —— 否则用户要干等满一个读超时。

    注意：现在"迟迟不吐字"不再等于直接 cancel 掉它（见下面
    test_slow_endpoint_still_wins_if_the_fallback_also_fails），这里的
    /responses 睡够 30 秒本身就足够久，两套协议里 /chat/completions 会先吐字，
    所以最终结果不受影响，仍然验证的是"不会傻等到 30 秒 sleep 结束才有反应"。
    """
    import asyncio as _asyncio

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith('/responses'):
            await _asyncio.sleep(30)   # 接受连接后就是不吐字
        return httpx.Response(
            200,
            content=_sse({'choices': [{'delta': {'content': '兜底回答'}}]}) + b'data: [DONE]\n\n',
            headers={'content-type': 'text/event-stream'},
        )

    real_client = httpx.AsyncClient

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
    monkeypatch.setattr(streaming_mod, 'AUTO_FIRST_TOKEN_TIMEOUT', 0.5)

    resp = client.post('/api/chat', headers=HEADERS,
                       json={'mode': 'auto', 'model': 'gpt-5.6-sol',
                             'messages': [{'role': 'user', 'content': 'hi'}]})
    assert resp.status_code == 200, resp.text
    texts = [e['data'].get('text') for e in _events(resp) if e['event'] == 'content']
    assert texts == ['兜底回答'], texts


def test_slow_endpoint_still_wins_if_the_fallback_also_fails(client, monkeypatch):
    """回归测试：这是用户真实碰到的故障。

    背景：浏览器里报"/chat_completions 在 30 秒内一个字都没吐，已放弃"，
    但同一个请求用命令行 / Codex 桌面端打同一个中转站却能正常拿到回复。
    根因：旧版 _auto() 一旦首选协议 30 秒没吐字就直接 cancel 掉它、串行换下一套；
    如果下一套恰好也失败，首选协议哪怕本来再等等就会正常吐字，也没有机会了——
    命令行类工具没有这道"过早放弃"的闸，只是老老实实等一个更长的读超时，
    所以显得"体验更好"。

    这里模拟：/responses 只是慢（不是坏，最终会正常吐字），/chat/completions
    直接报错（网关 502）。旧实现会在两套都"失败"后整体报错；新实现应该在
    /chat/completions 报错后继续留着等 /responses，最终拿到它的正常回答。
    """
    import asyncio as _asyncio

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith('/responses'):
            await _asyncio.sleep(0.3)   # 比首字看门狗慢，但不是坏——最终会吐字
            return httpx.Response(
                200,
                content=b''.join([
                    _sse({'type': 'response.output_text.delta', 'delta': '慢但正常的回答'}),
                    _sse({'type': 'response.completed', 'response': {'usage': {'input_tokens': 1}}}),
                ]),
                headers={'content-type': 'text/event-stream'},
            )
        return httpx.Response(502, content=_GATEWAY_HTML, headers={'content-type': 'text/html'})

    real_client = httpx.AsyncClient

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
    # 首字看门狗调到 0.1 秒：/responses 0.3 秒后才吐字，必然会先触发"并发试备选"。
    monkeypatch.setattr(streaming_mod, 'AUTO_FIRST_TOKEN_TIMEOUT', 0.1)

    resp = client.post('/api/chat', headers=HEADERS,
                       json={'mode': 'auto', 'model': 'gpt-5.6-sol',
                             'messages': [{'role': 'user', 'content': 'hi'}]})
    assert resp.status_code == 200, resp.text
    events = _events(resp)
    texts = [e['data'].get('text') for e in events if e['event'] == 'content']
    assert texts == ['慢但正常的回答'], events
    # 备选（chat_completions）报错不该让整体失败，也不该出现在 error 事件里。
    assert not any(e['event'] == 'error' for e in events), events


def test_both_fail_reports_both_reasons(client, monkeypatch):
    """两套协议都真的失败时，错误信息要把两边都列出来，而不是只报后面那个——
    不然会误导排查方向（比如以为只有 chat_completions 坏了，其实 responses 也坏）。
    """
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, content=_GATEWAY_HTML, headers={'content-type': 'text/html'})

    real_client = httpx.AsyncClient

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

    resp = client.post('/api/chat', headers=HEADERS,
                       json={'mode': 'auto', 'model': 'gpt-5.6-sol',
                             'messages': [{'role': 'user', 'content': 'hi'}]})
    assert resp.status_code == 200, resp.text
    events = _events(resp)
    errors = [e['data'].get('message') for e in events if e['event'] == 'error']
    assert len(errors) == 1
    assert '/responses' in errors[0] and '/chat_completions' in errors[0], errors


def test_remembers_which_one_worked(client, monkeypatch):
    """第一次靠回退成功之后，第二次应该直接走那套，不再白跑一次失败请求。"""
    paths: list[str] = []
    _install(monkeypatch, paths, responses_ok=False)
    payload = {'mode': 'auto', 'model': 'gpt-5.6-sol',
               'messages': [{'role': 'user', 'content': 'hi'}]}

    client.post('/api/chat', headers=HEADERS, json=payload)
    assert paths == ['/v1/responses', '/v1/chat/completions'], paths

    paths.clear()
    client.post('/api/chat', headers=HEADERS, json=payload)
    assert paths == ['/v1/chat/completions'], f'第二次应该直奔上次成的那套，实际 {paths}'
