"""文本模型带参考图：把「我们自己的中间格式」翻成三套协议各自的图片写法。

为什么要自己定一个中间格式：
  三套协议的图片写法各不相同，而且都不接受对方那套 ——
    /responses          input:  [{type:'input_text'}, {type:'input_image', image_url:'data:...'}]
    /chat/completions   messages:[{type:'text'}, {type:'image_url', image_url:{url:'data:...'}}]
    /messages (Claude)  messages:[{type:'text'}, {type:'image', source:{type:'base64', ...}}]
  前端如果直接按某一套拼，换协议就得全改；后端如果直接把前端的 body 透传，
  又等于让浏览器决定上游收到什么。所以定一个最小中间格式，两边各自翻译：
    content = '纯文本'
    或 [{type:'text', text:'...'}, {type:'image', image:'data:image/png;base64,...'}]

安全上的硬要求：image 只接受 data: 开头的内联图片，不接受任何 http(s) 链接。
否则浏览器传一个 http://169.254.169.254/ 过来，我们的服务器就变成别人的探针了
（上游地址本身有 SSRF 白名单，但图片 URL 是走上游去取的，同样会被利用）。
"""
from __future__ import annotations

import base64
import binascii
import re
from typing import Any

# 单条消息最多几张图（和前端 MAX_INPUT_IMAGES 保持一致）
MAX_IMAGES_PER_MESSAGE = 8
# 单张图解出后的字节上限。base64 会膨胀约 1/3，20 MB 的图在线上大约 27 MB 正文，
# 再大不管是上游还是本地内存都吃不消。
MAX_IMAGE_BYTES = 20 * 1024 * 1024
# 单条文本上限，防止一条消息把整个请求撑爆
MAX_TEXT_CHARS = 200_000

_DATA_URL = re.compile(r'^data:(?P<mime>image/[a-z0-9.+-]+);base64,(?P<b64>[A-Za-z0-9+/=_-]+)$', re.IGNORECASE)


def _bad(what: str) -> ValueError:
    return ValueError(what)


def parse_data_url(value: str) -> tuple[str, str]:
    """拆 data URL，返回 (mime, base64 正文)。不合法的直接抛 ValueError（→ 422）。"""
    match = _DATA_URL.match(value or '')
    if not match:
        raise _bad('参考图只支持 data: 开头的内联图片（data:image/...;base64,...），不接受外链。')
    b64 = match.group('b64')
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise _bad('参考图的 base64 内容无法解析。') from exc
    if not raw:
        raise _bad('参考图内容为空。')
    if len(raw) > MAX_IMAGE_BYTES:
        raise _bad(f'单张参考图不能超过 {MAX_IMAGE_BYTES // 1024 // 1024} MB。')
    return match.group('mime').lower(), b64


def normalize_content(content: Any) -> str | list[dict]:
    """校验并规范化一条消息的 content。

    纯文本仍然返回字符串 —— 这样不带图时发出去的请求体和以前一模一样，
    不会碰运气去试上游接不接数组。
    """
    if isinstance(content, str):
        if len(content) > MAX_TEXT_CHARS:
            raise _bad(f'单条消息文本不能超过 {MAX_TEXT_CHARS} 字。')
        return content
    if not isinstance(content, list) or not content:
        raise _bad('消息内容必须是文本，或由文本 / 图片组成的数组。')

    parts: list[dict] = []
    images = 0
    for item in content:
        if not isinstance(item, dict):
            raise _bad('消息内容里的每一项都必须是对象。')
        kind = item.get('type')
        if kind == 'text':
            text = item.get('text')
            if not isinstance(text, str):
                raise _bad('text 片段缺少 text 字段。')
            if len(text) > MAX_TEXT_CHARS:
                raise _bad(f'单条消息文本不能超过 {MAX_TEXT_CHARS} 字。')
            parts.append({'type': 'text', 'text': text})
        elif kind == 'image':
            images += 1
            if images > MAX_IMAGES_PER_MESSAGE:
                raise _bad(f'单条消息最多 {MAX_IMAGES_PER_MESSAGE} 张参考图。')
            mime, b64 = parse_data_url(item.get('image') if isinstance(item.get('image'), str) else '')
            parts.append({'type': 'image', 'mime': mime, 'b64': b64})
        else:
            raise _bad(f'不支持的消息片段类型：{kind!r}')

    texts = [p for p in parts if p['type'] == 'text']
    # 只有一段文本、没有图的时候还原成字符串，保持和旧版一致的线上格式
    if len(texts) == len(parts) == 1:
        return texts[0]['text']
    if not parts:
        raise _bad('消息内容不能为空。')
    return parts


def to_responses(content: str | list[dict]) -> str | list[dict]:
    """/responses 的 input 内容：input_text / input_image。"""
    if isinstance(content, str):
        return content
    return [
        {'type': 'input_text', 'text': part['text']}
        if part['type'] == 'text'
        else {'type': 'input_image', 'image_url': f"data:{part['mime']};base64,{part['b64']}", 'detail': 'auto'}
        for part in content
    ]


def to_chat_completions(content: str | list[dict]) -> str | list[dict]:
    """/chat/completions 的 messages 内容：text / image_url。"""
    if isinstance(content, str):
        return content
    return [
        {'type': 'text', 'text': part['text']}
        if part['type'] == 'text'
        else {'type': 'image_url', 'image_url': {'url': f"data:{part['mime']};base64,{part['b64']}"}}
        for part in content
    ]


def to_anthropic(content: str | list[dict]) -> str | list[dict]:
    """/messages（Claude）的内容：text / image + base64 source。"""
    if isinstance(content, str):
        return content
    return [
        {'type': 'text', 'text': part['text']}
        if part['type'] == 'text'
        else {'type': 'image', 'source': {'type': 'base64', 'media_type': part['mime'], 'data': part['b64']}}
        for part in content
    ]


CONVERTERS = {
    'responses': to_responses,
    'chat_completions': to_chat_completions,
    'messages': to_anthropic,
}


def for_mode(mode: str, content: str | list[dict]) -> str | list[dict]:
    convert = CONVERTERS.get(mode)
    if convert is None:
        raise ValueError(f'未知的聊天模式：{mode}')
    return convert(content)
