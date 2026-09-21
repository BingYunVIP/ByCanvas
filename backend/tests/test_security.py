"""SSRF 防护与凭证解析的测试。

上游地址由浏览器传入，这几条断言是"服务器不会被当跳板"的底线。
注意：settings 是全局单例，必须用 monkeypatch 改，否则会污染其他测试。
"""
from __future__ import annotations

import base64

import pytest
from fastapi import HTTPException

from app.config import settings
from app.deps import decode_base64url, normalize_base_url
from app.security import assert_upstream_allowed


def b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip('=')


def test_normalize_base_url_appends_v1():
    assert normalize_base_url('api.bingyun.vip') == 'https://api.bingyun.vip/v1'
    assert normalize_base_url('https://api.bingyun.vip/v1') == 'https://api.bingyun.vip/v1'


def test_normalize_base_url_trailing_slash_keeps_path():
    assert normalize_base_url('https://example.com/openai/') == 'https://example.com/openai/'


def test_base64url_roundtrip():
    assert decode_base64url(b64('https://api.bingyun.vip/v1')) == 'https://api.bingyun.vip/v1'


def test_invalid_base64_rejected():
    with pytest.raises(HTTPException) as exc:
        decode_base64url('!!!!not-base64!!!!')
    assert exc.value.status_code == 400


def test_allowlisted_host_passes(monkeypatch):
    monkeypatch.setattr(settings, 'upstream_allowlist', 'api.bingyun.vip')
    assert_upstream_allowed('https://api.bingyun.vip/v1')  # 不抛异常即通过


def test_host_not_in_allowlist_rejected(monkeypatch):
    monkeypatch.setattr(settings, 'upstream_allowlist', 'api.bingyun.vip')
    with pytest.raises(HTTPException) as exc:
        assert_upstream_allowed('https://evil.example.com/v1')
    assert exc.value.status_code == 403


def test_loopback_rejected_even_with_wildcard(monkeypatch):
    monkeypatch.setattr(settings, 'upstream_allowlist', '*')
    monkeypatch.setattr(settings, 'allow_private_upstream', False)
    with pytest.raises(HTTPException) as exc:
        assert_upstream_allowed('http://127.0.0.1/v1')
    assert exc.value.status_code == 403


def test_cloud_metadata_ip_rejected(monkeypatch):
    monkeypatch.setattr(settings, 'upstream_allowlist', '*')
    monkeypatch.setattr(settings, 'allow_private_upstream', False)
    with pytest.raises(HTTPException) as exc:
        assert_upstream_allowed('http://169.254.169.254/latest/meta-data/')
    assert exc.value.status_code == 403


def test_non_http_scheme_rejected(monkeypatch):
    monkeypatch.setattr(settings, 'upstream_allowlist', '*')
    with pytest.raises(HTTPException) as exc:
        assert_upstream_allowed('file:///etc/passwd')
    assert exc.value.status_code == 400
