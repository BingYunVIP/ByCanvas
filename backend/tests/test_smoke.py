"""装配冒烟：app 能导入、healthz 能通、非法上游会被挡在门外。"""
from __future__ import annotations

import base64

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

client = TestClient(app)


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip('=')


def test_healthz():
    resp = client.get('/api/healthz')
    assert resp.status_code == 200
    assert resp.json()['ok'] is True


def test_missing_credentials_rejected():
    resp = client.post('/api/models')
    assert resp.status_code == 422  # 缺必填请求头


def test_host_outside_allowlist_rejected(monkeypatch):
    monkeypatch.setattr(settings, 'upstream_allowlist', 'api.bingyun.vip')
    resp = client.post('/api/models', headers={
        'X-Upstream-Base': _b64('https://evil.example.com/v1'),
        'X-Upstream-Key': 'sk-test',
    })
    assert resp.status_code == 403


def test_healthz_needs_no_credentials():
    # 不带任何凭证也能探活，方便前端启动时先确认后端在不在
    assert client.get('/api/healthz').status_code == 200
