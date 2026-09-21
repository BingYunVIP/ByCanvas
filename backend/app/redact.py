"""Remove credentials from diagnostics before they reach a client or log handler."""
from __future__ import annotations

import os
import re
from urllib.parse import parse_qsl, unquote, urlsplit, urlunsplit

PROXY_ENV_VARS = ('ALL_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY', 'all_proxy', 'https_proxy', 'http_proxy')
_URL = re.compile(r"(?:https?|socks[45]h?)://[^\s<>\"']+", re.I)


def safe_url(value: str) -> str:
    try:
        parts = urlsplit(value)
        host = parts.hostname or ''
        if ':' in host:
            host = f'[{host}]'
        if parts.port:
            host += f':{parts.port}'
        return urlunsplit((parts.scheme, host, parts.path, '', ''))
    except ValueError:
        return '[redacted URL]'


def redact_text(value: object) -> str:
    text = str(value)
    secrets = set()
    for name in PROXY_ENV_VARS:
        proxy = os.environ.get(name)
        if not proxy:
            continue
        text = text.replace(proxy, safe_url(proxy))
        try:
            parts = urlsplit(proxy)
            if parts.password:
                secrets.update((parts.password, unquote(parts.password)))
            secrets.update(v for _, v in parse_qsl(parts.query) if v)
        except ValueError:
            continue
    text = _URL.sub(lambda match: safe_url(match[0]), text)
    for secret in sorted(secrets, key=len, reverse=True):
        text = text.replace(secret, '[redacted]')
    return re.sub(r'\bsk-[A-Za-z0-9_-]+', '[redacted key]', text)
