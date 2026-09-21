import asyncio
import json

import httpx
import pytest
from fastapi import HTTPException

from app.deps import Upstream, resolve_upstream
from app.routers import chat
from app.schemas import ImagePlanRequest
from app.upstream import summarize_usage


@pytest.mark.parametrize('mode,path', [('responses', '/v1/responses'),
                                      ('chat_completions', '/v1/chat/completions')])
@pytest.mark.parametrize('overrides', [{}, {
    'model': 'previous-chat-model', 'text_model': 'previous-image-assistant',
    'reasoning': {'effort': 'max'}, 'reasoning_effort': 'high', 'output_config': {'effort': 'low'},
}])
def test_image_plan_uses_independent_backend_defaults(monkeypatch, mode, path, overrides):
    client = httpx.AsyncClient
    tool = {'name': 'create_image', 'type': 'function'}
    result = {'output': [{'type': 'function_call', 'name': 'create_image',
                           'arguments': '{"prompt":"a cat","reference_images":[]}'}]}

    def respond(request):
        assert request.url.path == path
        assert request.headers['authorization'] == 'Bearer fake-key'
        body = json.loads(request.content)
        assert body['stream'] is False
        assert body.get('store') is (False if mode == 'responses' else None)
        assert body['tools'] == [tool]
        assert body['model'] == 'gpt-5.6-sol'
        assert not {'text_model', 'reasoning', 'reasoning_effort', 'output_config'} & body.keys()
        assert 'unknown' not in body
        return httpx.Response(200, json=result)

    monkeypatch.setattr(chat.httpx, 'AsyncClient', lambda **kw: client(transport=httpx.MockTransport(respond), **kw))
    response = asyncio.run(chat.image_plan(ImagePlanRequest(mode=mode, body={
        'tools': [tool], 'stream': True, 'store': True, 'unknown': 'ignored', **overrides,
    }), Upstream(base_url='https://example.test/v1', api_key='fake-key')))
    assert response == result
    assert 'fake-key' not in json.dumps(response)


@pytest.mark.parametrize('status', [401, 404, 429, 500])
def test_image_plan_preserves_upstream_status_for_safe_client_fallback(monkeypatch, status):
    client = httpx.AsyncClient
    monkeypatch.setattr(chat.httpx, 'AsyncClient', lambda **kw: client(
        transport=httpx.MockTransport(lambda _: httpx.Response(status, json={'error': {'message': 'rejected'}})), **kw))
    with pytest.raises(HTTPException) as error:
        asyncio.run(chat.image_plan(ImagePlanRequest(mode='responses', body={}),
                                    Upstream(base_url='https://example.test/v1', api_key='fake-key')))
    assert error.value.status_code == status


def test_image_usage_keeps_reported_tokens_without_guessing_cost():
    assert summarize_usage('images_generate', {'input_tokens': 10, 'output_tokens': 100,
                                               'input_tokens_details': {'cached_tokens': 5}}) == {
        'input_tokens': 10, 'output_tokens': 100, 'cache_read_tokens': 5, 'cache_write_tokens': None,
    }
    assert summarize_usage('images_edit', {'cost': 12})['input_tokens'] is None


def test_image_plan_is_mounted_and_validates_requests(monkeypatch):
    from app.main import app
    from app.config import settings

    client_type = httpx.AsyncClient
    monkeypatch.setattr(chat.httpx, 'AsyncClient', lambda **kw: client_type(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={'output': []})), **kw))
    previous = dict(app.dependency_overrides)
    async def upstream():
        return Upstream(base_url='https://example.test/v1', api_key='fake-key')

    app.dependency_overrides[resolve_upstream] = upstream

    async def check():
        async with client_type(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/api/image-plan', json={'mode': 'responses', 'body': {}})
            assert response.status_code == 200
            assert response.json() == {'output': []}
            response = await client.post('/api/image-plan', json={'mode': 'arbitrary-path', 'body': {}})
            assert response.status_code == 422

    try:
        asyncio.run(check())
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)
