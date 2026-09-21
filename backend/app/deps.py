"""从请求头解析出一次性的上游凭证。

这是"Key 只存在用户侧"这条原则的落地点：
    - 浏览器把 API 地址（base64url 编码）和 Key 放在请求头里带过来
    - 后端解析后只用于这一次转发，函数返回即随请求结束被回收
    - 全程不写入文件、不写入数据库、不打印日志
"""
from __future__ import annotations

import base64
import re
from dataclasses import dataclass
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Header, HTTPException

from .security import assert_upstream_allowed

DEFAULT_BASE_URL = 'https://api.bingyun.vip/v1'


@dataclass(frozen=True)
class Upstream:
    """一次请求的上游凭证。只在内存中存在，请求结束即丢弃。"""

    base_url: str
    api_key: str


def normalize_base_url(raw: str) -> str:
    """补齐 scheme 与 /v1 前缀；以 / 结尾表示原样使用、不自动补 /v1。"""
    raw = raw.strip()
    if not raw:
        return DEFAULT_BASE_URL

    url_with_scheme = raw if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*://', raw) else f'https://{raw}'
    parsed = urlsplit(url_with_scheme)
    origin = f'{parsed.scheme}://{parsed.netloc}'

    if raw.endswith('/'):
        path = re.sub(r'/+$', '/', parsed.path) if parsed.path else '/'
        return f'{origin}{path}'

    segments = [s for s in parsed.path.split('/') if s]
    if 'v1' in segments:
        segments = segments[: segments.index('v1') + 1]
    else:
        segments.append('v1')
    return f"{origin}/{'/'.join(segments)}"


def decode_base64url(raw: str) -> str:
    """前端把上游地址做 base64url 编码，避免 URL 里的字符破坏 HTTP 头。"""
    try:
        padded = raw + '=' * (-len(raw) % 4)
        return base64.urlsafe_b64decode(padded.encode('ascii')).decode('utf-8')
    except Exception as exc:
        raise HTTPException(status_code=400, detail='X-Upstream-Base 不是合法的 base64url 文本。') from exc


def resolve_upstream(
    x_upstream_base: Annotated[str, Header(description='上游地址，base64url 编码')],
    x_upstream_key: Annotated[str, Header(description='上游 API Key，仅本次请求使用')],
) -> Upstream:
    """FastAPI 依赖：把两个请求头解析成一个 Upstream，顺带做白名单 / SSRF 校验。"""
    base_url = normalize_base_url(decode_base64url(x_upstream_base))
    assert_upstream_allowed(base_url)

    api_key = x_upstream_key.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail='X-Upstream-Key 为空。')

    return Upstream(base_url=base_url, api_key=api_key)
