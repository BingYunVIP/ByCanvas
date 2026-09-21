import asyncio
import io
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from app import log
from app.config import Settings
from app.deps import Upstream
from app.main import app
from app.protocols import streaming
from app.redact import PROXY_ENV_VARS, redact_text
from app.upstream import describe_error


@pytest.mark.parametrize('name', PROXY_ENV_VARS)
def test_proxy_secrets_are_removed_from_errors_and_logs(monkeypatch, name):
    for key in PROXY_ENV_VARS:
        monkeypatch.delenv(key, raising=False)
    proxy = 'http://review-user:p%40ss-secret@proxy.test:8080/?token=query-secret#fragment-secret'
    monkeypatch.setenv(name, proxy)
    error = httpx.ConnectError(f'Failed: {proxy}; password=p@ss-secret')
    client_error = describe_error(error)
    out = io.StringIO()
    handler = logging.StreamHandler(out)
    handler.setFormatter(log.RedactedFormatter('%(message)s'))
    log._logger.addHandler(handler)
    try:
        log.log('Failed: %s', error)
        try:
            raise error
        except httpx.ConnectError:
            log.log_exception('Connection failed: %s', error)
    finally:
        log._logger.removeHandler(handler)
    for text in [client_error, out.getvalue(), redact_text(error)]:
        for secret in ['review-user', 'p%40ss-secret', 'p@ss-secret', 'query-secret', 'fragment-secret']:
            assert secret not in text


def test_legacy_password_environment_does_not_lock_public_site(monkeypatch):
    monkeypatch.setenv('APP_PASSWORD', 'obsolete-password')
    assert 'app_password' not in Settings(_env_file=None).model_dump()
    client = TestClient(app)
    assert 'password_required' not in client.get('/api/healthz').json()
    # Missing provider credentials fail validation, never site-password authentication.
    assert client.post('/api/models').status_code == 422


@pytest.mark.parametrize('first_text', ['', '   '])
def test_empty_primary_uses_nonempty_backup(monkeypatch, first_text):
    calls = []

    async def primary(*args):
        calls.append('primary')
        args[-1]('content', first_text)
        return {}

    async def backup(*args):
        calls.append('backup')
        args[-1]('content', 'real reply')
        return {}

    monkeypatch.setattr(streaming, '_responses', primary)
    monkeypatch.setattr(streaming, '_chat_completions', backup)
    monkeypatch.setattr(streaming, '_preferred', {})
    events = []
    asyncio.run(streaming._auto(Upstream('https://test.invalid', 'test'), 'test', None, [], lambda *event: events.append(event)))
    assert calls == ['primary', 'backup']
    assert events == [('content', 'real reply')]


def test_all_empty_protocols_fail(monkeypatch):
    async def empty(*args):
        return {}
    monkeypatch.setattr(streaming, '_responses', empty)
    monkeypatch.setattr(streaming, '_chat_completions', empty)
    monkeypatch.setattr(streaming, '_preferred', {})
    with pytest.raises(RuntimeError, match='没有返回任何内容'):
        asyncio.run(streaming._auto(Upstream('https://test.invalid', 'test'), 'test', None, [], lambda *event: None))


@pytest.mark.parametrize('mode', ['responses', 'chat_completions', 'messages'])
def test_upstream_eof_without_completion_is_failure(monkeypatch, mode):
    real_client = httpx.AsyncClient
    payload = {
        'responses': 'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
        'chat_completions': 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
        'messages': 'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"partial"}}\n\n',
    }[mode]
    transport = httpx.MockTransport(lambda request: httpx.Response(200, text=payload))
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw: real_client(transport=transport, **kw))
    events = []
    with pytest.raises(RuntimeError, match='尚未完成'):
        asyncio.run(streaming.stream_chat(mode, Upstream('https://test.invalid', 'test'), 'test', None, [], 2048, lambda *event: events.append(event)))
    assert events == [('content', 'partial')]
