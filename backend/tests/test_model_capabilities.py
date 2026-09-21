import asyncio
import json

import httpx
import pytest

from app.model_capabilities import model_capabilities
from app.deps import Upstream
from app.routers import models
from app.protocols import streaming


def test_upstream_enumeration_overrides_fallback():
    value = model_capabilities({'id': 'gpt-6-astra', 'reasoningEfforts': [
        {'value': 'minimal'}, {'value': 'ultra', 'default': True},
    ], 'supported_parameters': {'quality': {'type': 'enum', 'values': ['draft', 'best']}}})
    assert value['reasoningEfforts'] == ['minimal', 'ultra']
    # 不再采信上游标的 default（哪怕它标了 'ultra' 是默认档）——那经常就是
    # 最高档，会让每次选中模型都默认跑最贵最慢的一挡。固定为 None，前端退回
    # 「自动」。见 2026-09-20 的改动。
    assert value['defaultReasoningEffort'] is None
    assert value['qualityOptions'] == ['draft', 'best']
    assert value['defaultQuality'] is None


def test_per_model_fallback_and_unknown_model():
    assert model_capabilities({'id': 'gpt-5.5'})['reasoningEfforts'] == ['none', 'low', 'medium', 'high', 'xhigh']
    assert model_capabilities({'id': 'gpt-6-astra'})['reasoningEfforts'] == ['low', 'medium', 'high', 'xhigh', 'max']
    assert model_capabilities({'id': 'gpt-image-2.5-flare'})['qualityOptions'] == ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
    assert model_capabilities({'id': 'unknown', 'supportsReasoningEffort': True})['reasoningEfforts'] == []
    assert model_capabilities({'id': 'gpt-6-astra', 'supportsReasoningEffort': False})['reasoningEfforts'] == []
    assert model_capabilities({'id': 'gpt-image-2.5-flare', 'qualityOptions': []})['qualityOptions'] == []


def test_image_parameters_preserve_provider_limits_and_disable_unknown_options():
    # 数量（n）、审核（moderation）已经整个下线，imageParameters 里不会再有
    # 这两个键——见 2026-09-20 的改动。
    value = model_capabilities({'id': 'gpt-image-2.5-sunburst', 'supported_parameters': {
        'background': False, 'output_format': {'enum': ['webp']},
    }})
    assert value['imageParameters']['background'] is False
    assert 'n' not in value['imageParameters']
    assert 'moderation' not in value['imageParameters']
    assert value['imageParameters']['output_format'] == {'options': ['webp']}
    assert model_capabilities({'id': 'gpt-image-2.5-sunburst', **value})['imageParameters'] == value['imageParameters']
    assert model_capabilities({'id': 'custom-image', 'supported_parameters': ['size']})['imageParameters'] == {
        'size': {}, 'output_format': False, 'background': False,
    }
    assert model_capabilities({'id': 'gpt-image-2', 'supported_parameters': []})['imageParameters']['size'] is False
    assert model_capabilities({'id': 'gpt-image-2.5-sunburst-2026-09-08'}) == model_capabilities({'id': 'gpt-image-2.5-sunburst'})


def test_models_route_returns_capabilities_and_hides_internal_model(monkeypatch):
    client = httpx.AsyncClient

    def respond(request):
        assert request.headers['authorization'] == 'Bearer fake-key'
        return httpx.Response(200, json={'data': [
            {'id': 'codex-auto-review\r\n'},
            {'id': 'gpt-6-astra', 'reasoningEfforts': [{'value': 'high'}, {'value': 'ultra'}]},
            {'id': 'gpt-image-2.5-sunburst'},
        ]})

    monkeypatch.setattr(models.httpx, 'AsyncClient', lambda **kw: client(transport=httpx.MockTransport(respond), **kw))
    result = asyncio.run(models.list_models(Upstream(base_url='https://example.test/v1', api_key='fake-key')))
    assert len(result) == 2
    assert result[0].reasoningEfforts == ['high', 'ultra']
    assert result[1].qualityOptions == ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
    assert result[1].imageParameters['output_format']['options'] == ['png', 'jpeg', 'webp']


@pytest.mark.parametrize('supported', [True, False])
def test_optional_image_catalog(monkeypatch, supported):
    client = httpx.AsyncClient
    paths = []

    def respond(request):
        paths.append(request.url.path)
        if request.url.path.endswith('/images/models'):
            if not supported:
                raise httpx.ReadTimeout('catalog unavailable')
            return httpx.Response(200, json={'data': [{'id': 'custom-image', 'supported_parameters': {
                'quality': {'type': 'enum', 'values': ['draft', 'photo', 'ultra']},
            }}]})
        return httpx.Response(200, json={'data': [{'id': 'custom-image'}]})

    monkeypatch.setattr(models.httpx, 'AsyncClient', lambda **kw: client(transport=httpx.MockTransport(respond), **kw))
    result = asyncio.run(models.list_models(Upstream(base_url='https://example.test/v1', api_key='fake-key')))
    assert paths == ['/v1/models', '/v1/images/models']
    assert result[0].qualityOptions == (['draft', 'photo', 'ultra'] if supported else [])


@pytest.mark.parametrize('mode', ['responses', 'chat_completions', 'messages'])
def test_backend_forwards_effort_in_each_protocol(monkeypatch, mode):
    client = httpx.AsyncClient
    requests = []

    def respond(request):
        body = json.loads(request.content)
        requests.append(body)
        actual = body['output_config']['effort'] if mode == 'messages' else body['reasoning']['effort'] if mode == 'responses' else body['reasoning_effort']
        assert actual == 'max'
        content = 'event: message_stop\ndata: {}\n\n' if mode == 'messages' else 'data: [DONE]\n\n'
        return httpx.Response(200, text=content, headers={'content-type': 'text/event-stream'})

    monkeypatch.setattr(streaming.httpx, 'AsyncClient', lambda **kw: client(transport=httpx.MockTransport(respond), **kw))
    asyncio.run(streaming.stream_chat(mode, Upstream(base_url='https://example.test/v1', api_key='fake-key'),
                                    'test-model', 'max', [{'role': 'user', 'content': 'hello'}], 2048, lambda *_: None))
    assert len(requests) == 1


def test_models_route_fills_capabilities_when_upstream_declares_nothing(monkeypatch):
    """上游一个能力字段都不给时，能力必须靠 OpenRouter 目录补上。

    这是真实故障：我们的上游 /v1/models 只有 created/display_name/id/object/
    owned_by/type，而代码去读一个根本不存在的 supportsReasoningEffort，
    结果所有模型一律被标成「不支持推理」。这个用例用上游的真实字段形状，
    确保以后再也不会回到那种误判。
    """
    client = httpx.AsyncClient

    def respond(request):
        return httpx.Response(200, json={'data': [
            {'id': 'gpt-5.6-terra', 'display_name': 'GPT-5.6 Terra', 'object': 'model',
             'owned_by': 'openai', 'type': 'chat', 'created': 1783000000},
            {'id': 'gpt-image-2.5-sunburst', 'display_name': 'Sunburst', 'object': 'model',
             'owned_by': 'openai', 'type': 'image', 'created': 1783000000},
        ]})

    monkeypatch.setattr(models.httpx, 'AsyncClient', lambda **kw: client(transport=httpx.MockTransport(respond), **kw))
    result = asyncio.run(models.list_models(Upstream(base_url='https://example.test/v1', api_key='fake-key')))

    terra = result[0]
    assert terra.id == 'gpt-5.6-terra'
    assert terra.reasoning is True, '上游不声明时不能判成不支持推理'
    assert terra.reasoningEfforts == ['none', 'low', 'medium', 'high', 'xhigh', 'max']
    assert terra.vision is True, 'OpenRouter 标了它能看图'

    sunburst = result[1]
    assert sunburst.kind == 'image'
    assert sunburst.qualityOptions == ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
    assert sunburst.vision is None, '目录里没有就标未知，不能顺手判成 False'
