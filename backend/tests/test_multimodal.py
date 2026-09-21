"""文本模型带参考图：中间格式 → 三套协议各自的图片写法。

重点盯两件事：
  1. 三套协议的字段名各不相同，写错一个上游就 400，而且报错信息通常不说清哪错了
  2. 图片只收 data: 内联，外链必须拒 —— 否则我们的服务器就成了别人的内网探针
"""
from __future__ import annotations

import base64

import pytest
from pydantic import ValidationError

from app.protocols.multimodal import (
    MAX_IMAGES_PER_MESSAGE,
    normalize_content,
    to_anthropic,
    to_chat_completions,
    to_responses,
)
from app.schemas import ChatMessage, ChatRequest

PNG = 'data:image/png;base64,' + base64.b64encode(b'hello').decode()
TEXT = '这是什么'


def test_responses_uses_input_image():
    content = normalize_content([{'type': 'text', 'text': TEXT}, {'type': 'image', 'image': PNG}])
    assert to_responses(content) == [
        {'type': 'input_text', 'text': TEXT},
        {'type': 'input_image', 'image_url': PNG, 'detail': 'auto'},
    ]


def test_chat_completions_uses_image_url_object():
    content = normalize_content([{'type': 'text', 'text': TEXT}, {'type': 'image', 'image': PNG}])
    assert to_chat_completions(content) == [
        {'type': 'text', 'text': TEXT},
        {'type': 'image_url', 'image_url': {'url': PNG}},
    ]


def test_anthropic_uses_base64_source_without_prefix():
    content = normalize_content([{'type': 'text', 'text': TEXT}, {'type': 'image', 'image': PNG}])
    assert to_anthropic(content) == [
        {'type': 'text', 'text': TEXT},
        {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': base64.b64encode(b'hello').decode()}},
    ]


def test_plain_text_stays_a_string():
    """不带图时线上格式必须和以前一模一样，不能为了统一就都改成数组。"""
    assert normalize_content('纯文本') == '纯文本'
    assert to_responses('纯文本') == '纯文本'
    # 只有一段文本、没有图，也还原成字符串
    assert normalize_content([{'type': 'text', 'text': '只有文字'}]) == '只有文字'


@pytest.mark.parametrize('bad', [
    'http://169.254.169.254/latest/meta-data',   # 云厂商元数据，典型的 SSRF 目标
    'https://example.com/a.png',
    'data:text/html;base64,PHNjcmlwdD4=',        # 不是图片
    'data:image/png;base64,!!!!',                # base64 不合法
    '',
])
def test_external_or_broken_images_are_rejected(bad):
    with pytest.raises(ValueError):
        normalize_content([{'type': 'image', 'image': bad}])


def test_unknown_part_type_is_rejected():
    with pytest.raises(ValueError):
        normalize_content([{'type': 'file', 'file': PNG}])


def test_too_many_images_are_rejected():
    parts = [{'type': 'text', 'text': TEXT}] + [{'type': 'image', 'image': PNG}] * (MAX_IMAGES_PER_MESSAGE + 1)
    with pytest.raises(ValueError, match='最多'):
        normalize_content(parts)


def test_empty_and_wrong_shaped_content_are_rejected():
    for bad in ([], {}, [1, 2], None):
        with pytest.raises((ValueError, ValidationError)):
            normalize_content(bad)


def test_chat_request_accepts_multimodal_messages():
    req = ChatRequest(model='gpt-5.6-terra', messages=[ChatMessage(
        role='user',
        content=[{'type': 'text', 'text': TEXT}, {'type': 'image', 'image': PNG}],
    )])
    assert isinstance(req.messages[0].content, list)
    assert req.messages[0].content[1]['mime'] == 'image/png'


def test_chat_request_rejects_external_image_url():
    with pytest.raises(ValidationError):
        ChatRequest(model='gpt-5.6-terra', messages=[ChatMessage(
            role='user',
            content=[{'type': 'image', 'image': 'http://169.254.169.254/x'}],
        )])
