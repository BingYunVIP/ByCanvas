"""网关层暂时性失败（502/503/522/524）的自动重试。

背景：真实故障（2026-09-20）——生图请求在 Cloudflare 层等了 126.9 秒后收到
HTTP 524，但上游自己的后台记录显示这次请求其实只用了 19.25 秒就正常处理完；
紧跟着打的诊断探针同一个模型 28.7 秒就成功。524/502/503/522 且响应头没有
x-request-id / x-client-request-id 时，说明请求根本没到源站或源站还在处理，
原样重试一次往往就通——这里锁住 is_retryable_gateway_error() 的判据和
request_with_gateway_retry() 的重试/预算行为。
"""
from __future__ import annotations

import asyncio
import time

import httpx
import pytest

from app.upstream import is_retryable_gateway_error, request_with_gateway_retry


def _resp(status: int, *, with_request_id: bool = False) -> httpx.Response:
    headers = {'x-request-id': 'abc123'} if with_request_id else {}
    return httpx.Response(status, content=b'{}', headers=headers)


@pytest.mark.parametrize('status', [502, 503, 522, 524])
def test_gateway_status_without_request_id_is_retryable(status):
    assert is_retryable_gateway_error(_resp(status)) is True


@pytest.mark.parametrize('status', [502, 503, 522, 524])
def test_same_status_with_request_id_is_not_retryable(status):
    """源站真的处理过（哪怕是报错）就带 x-request-id——重试结果不会变。"""
    assert is_retryable_gateway_error(_resp(status, with_request_id=True)) is False


@pytest.mark.parametrize('status', [200, 400, 401, 403, 404, 429, 500])
def test_other_statuses_are_never_retryable(status):
    assert is_retryable_gateway_error(_resp(status)) is False
    assert is_retryable_gateway_error(_resp(status, with_request_id=True)) is False


def _mock_client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_retries_once_on_524_then_succeeds():
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(524, content=b'<html>gateway timeout</html>')
        return httpx.Response(200, json={'ok': True})

    async def run():
        async with _mock_client(handler) as client:
            resp, attempts = await request_with_gateway_retry(
                client, 'POST', 'https://example.test/v1/images/generations',
                json={'prompt': 'x'}, label='生图', budget_deadline=time.time() + 999,
                backoff_seconds=0.001,
            )
            return resp, attempts

    resp, attempts = asyncio.run(run())
    assert len(calls) == 2
    assert attempts == 2
    assert resp.status_code == 200
    assert resp.json() == {'ok': True}


def test_does_not_retry_when_origin_actually_answered():
    """带 x-request-id 的 524/502 是源站真给的（少见但可能），重试没有意义。"""
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(502, content=b'{"error":"boom"}', headers={'x-request-id': 'r-1'})

    async def run():
        async with _mock_client(handler) as client:
            return await request_with_gateway_retry(
                client, 'GET', 'https://example.test/v1/models',
                label='探测', budget_deadline=1e18,
            )

    resp, attempts = asyncio.run(run())
    assert len(calls) == 1
    assert attempts == 1
    assert resp.status_code == 502


def test_gives_up_once_budget_is_exhausted():
    """一直是网关层失败（源站似乎彻底没缓过来）时，预算耗尽就不再重试，
    而不是无限重试拖成一次更长的挂起。"""
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(524, content=b'<html>still down</html>')

    async def run():
        async with _mock_client(handler) as client:
            # 预算给 45ms、退避 10ms、min_remaining 给 1ms：够重试几次，
            # 但预算迟早耗尽，测试跑起来还是毫秒级的（不用真的等 1.5s 的默认退避）。
            deadline = time.time() + 0.045
            return await request_with_gateway_retry(
                client, 'POST', 'https://example.test/v1/images/generations',
                json={}, label='生图', budget_deadline=deadline,
                min_remaining=0.001, backoff_seconds=0.010, max_attempts=100,
            )

    resp, attempts = asyncio.run(run())
    assert resp.status_code == 524
    assert len(calls) == attempts
    # 预算很紧，重试次数应该是个位数，不会因为"响应特别快"而失控地一直打下去。
    assert 2 <= attempts <= 6


def test_max_attempts_caps_retries_even_with_huge_budget():
    """网关秒拒（比如直接连不上源站）时响应极快，光靠"预算还够不够"挡不住
    短时间内打出一长串请求——必须有个独立于时间预算的重试次数上限。"""
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(502, content=b'<html>immediate reject</html>')

    async def run():
        async with _mock_client(handler) as client:
            return await request_with_gateway_retry(
                client, 'POST', 'https://example.test/v1/images/generations',
                json={}, label='生图', budget_deadline=time.time() + 999,
                backoff_seconds=0.001, max_attempts=3,
            )

    resp, attempts = asyncio.run(run())
    assert resp.status_code == 502
    assert attempts == 3
    assert len(calls) == 3


def test_retry_attempt_read_timeout_shrinks_to_fit_remaining_budget():
    """光靠"预算够不够发起下一次尝试"还不够——如果重试本身仍然按完整的
    默认读超时去等，"预算只剩 5 秒"时发起的重试仍可能自己再跑很久，
    等于白设了预算上限。第二次尝试的读超时必须被收紧到接近剩余预算，
    而不是沿用第一次的完整 settings.read_timeout。"""
    seen_read_timeouts = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen_read_timeouts.append(request.extensions['timeout']['read'])
        if len(seen_read_timeouts) == 1:
            return httpx.Response(524, content=b'<html>gateway timeout</html>')
        return httpx.Response(200, json={'ok': True})

    async def run():
        async with _mock_client(handler) as client:
            deadline = time.time() + 5.0  # 远小于 settings.read_timeout（180s）
            return await request_with_gateway_retry(
                client, 'POST', 'https://example.test/v1/images/generations',
                json={}, label='生图', budget_deadline=deadline,
                min_remaining=1.0, backoff_seconds=0.001,
            )

    resp, attempts = asyncio.run(run())
    assert attempts == 2
    assert resp.status_code == 200
    first, second = seen_read_timeouts
    assert first > second, seen_read_timeouts
    # 第二次的读超时应该贴着"预算还剩多少"，不是沿用第一次那个完整的默认值。
    assert second <= 5.0, seen_read_timeouts


def test_never_retries_when_status_is_not_in_retryable_set():
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(401, content=b'{"error":"invalid key"}')

    async def run():
        async with _mock_client(handler) as client:
            return await request_with_gateway_retry(
                client, 'POST', 'https://example.test/v1/images/generations',
                json={}, label='生图', budget_deadline=1e18,
            )

    resp, attempts = asyncio.run(run())
    assert len(calls) == 1
    assert attempts == 1
    assert resp.status_code == 401
