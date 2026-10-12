"""与上游通信的公共工具：超时、请求头、错误归一化、用量统计、图片收集。

硬性约定：本模块（以及整个后端）绝不把 api_key 写进日志或异常信息。
"""
from __future__ import annotations

import asyncio
import json
import random
import time

import httpx

from . import log as applog
from .config import settings
from .redact import redact_text

# 网关（Cloudflare 等）没能把请求转发到源站时的状态码，同 routers/diag.py::_classify
# 的判据。524 尤其容易误判成"彻底失败"——它的意思是"网关等源站等到不耐烦了才
# 撂挑子"，源站往往还在处理、甚至已经处理完了，只是这一条连接被网关掐断。
# 502/503/522 同理：网关没能把请求转发成功，换一次连接常常就通了。
RETRYABLE_GATEWAY_STATUS = {502, 503, 522, 524}


def response_reached_origin(resp: httpx.Response) -> bool:
    """这次响应是不是源站真给出的（哪怕是报错），而不是网关自己短路。

    判据（实测总结，同 routers/diag.py::_classify）：源站处理过的响应会带
    x-request-id / x-client-request-id；Cloudflare 之类的网关自己短路时
    （从未把请求转发到源站，或转发了但没等到回应）没有这两个头。

    这是个"确凿的结论 vs 还是个谜"的判据，用途不只一处：
    - is_retryable_gateway_error()：判断值不值得原样重试；
    - routers/images.py：源站真给出的拒绝（比如 400 内容审核不通过）原样把
      状态码传回前端，前端据此跳过"再体检一次上游"——那一步只在真的没到
      源站、说不清是谁的问题时才有意义，源站已经把话说清楚了就不用再猜。
    """
    return bool(resp.headers.get('x-request-id') or resp.headers.get('x-client-request-id'))


def is_retryable_gateway_error(resp: httpx.Response) -> bool:
    """这次失败是不是"网关层、大概率暂时性"的，值不值得原样重试一次。

    只有网关层（response_reached_origin() 为假）+ 这几个状态码才判定为
    可重试——401/403/404 这类源站真给出的错误，重试多少次结果都一样，
    只会让用户白等。
    """
    if resp.status_code not in RETRYABLE_GATEWAY_STATUS:
        return False
    return not response_reached_origin(resp)


async def request_with_gateway_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    label: str,
    budget_deadline: float,
    min_remaining: float = 20.0,
    max_attempts: int = 4,
    backoff_seconds: float = 1.5,
    nominal_read_timeout: float | None = None,
    **kwargs,
) -> tuple[httpx.Response, int]:
    """发一次请求；命中 is_retryable_gateway_error() 就原样重试，直到成功、
    遇到非网关错误、或者 budget_deadline（time.time() 的绝对时刻）之前已经
    没有足够时间再撑一次为止。返回 (最后一次的响应, 尝试次数)——**失败时报什么
    错误由调用方决定**，这里只管"值不值得再打一次"。

    2026-09-20 加入的真实故障：生图请求在 Cloudflare 层等了 126.9 秒后收到
    HTTP 524（网关等源站等到超时），但上游自己的后台记录显示这次请求其实
    只用了 19.25 秒就正常处理完——是 Cloudflare 的边缘节点先撂了挑子，源站
    还在好好干活。紧跟着打的诊断探针（同一个模型、同一个上游）28.7 秒就成功，
    说明"重试一次"这个动作本身大概率就能解决问题，不该让用户自己手动点
    「重新生成」来做这件事。

    budget_deadline 存在的意义：如果重试不设上限，最坏情况下"原始请求的读超时
    + 重试的读超时"会超过外层网络设施允许的总时长，从"我们如实报错"变成连接
    被提前中断、前端只看到一个更难看的网络错误——所以每次重试前都要检查预算
    还够不够，不够就不再重试，如实把上一次的失败报上去。

    **只检查"要不要发起下一次尝试"还不够**：如果每次尝试仍然按完整的
    nominal_read_timeout（默认 settings.read_timeout，比 budget_deadline
    留给这次尝试的时间还长）去等，"预算只剩 20 秒"时发起的重试仍然可能
    自己再跑 180 秒——等于白设了预算上限。所以每次尝试都会把这次的读超时
    收紧到 min(nominal_read_timeout, 距 budget_deadline 还剩多久)；第一次
    尝试通常够不到这个上限（默认读超时本来就比预算短），只有到了后面几次
    重试、预算所剩不多时才会被真正收紧。

    max_attempts / backoff_seconds 存在的意义：上面那次真实故障里网关是等了
    126.9 秒才认输的"慢失败"，但网关也可能"秒拒"（比如直接连不上源站）——
    如果只看 budget_deadline，秒拒的失败会在预算耗尽前被一遍遍不停重试，
    变成对着一个明显没缓过来的上游疯狂发请求。所以重试之间总要停一下，
    并且总次数不超过 max_attempts，双重兜底。

    退避节奏参考了 Codex 自己的实现（codex-rs/codex-client/src/retry.rs）：
    第 1 次重试等 backoff_seconds，第 2 次等 2 倍，第 3 次等 4 倍……每次再乘
    一个 0.9~1.1 的随机抖动——指数增长让"秒拒"场景的请求间隔越来越松，
    抖动避免多个并发请求（比如批量改图时的好几张图）在同一时刻集体重试、
    对上游造成新的一波压力。
    """
    nominal_read_timeout = nominal_read_timeout if nominal_read_timeout is not None else settings.read_timeout
    attempt = 0
    while True:
        attempt += 1
        call_kwargs = kwargs
        if 'timeout' not in kwargs:
            read_for_this_attempt = min(nominal_read_timeout, max(1.0, budget_deadline - time.time()))
            call_kwargs = {**kwargs, 'timeout': http_timeout(read=read_for_this_attempt)}
        resp = await client.request(method, url, **call_kwargs)
        if resp.status_code == 200 or not is_retryable_gateway_error(resp):
            return resp, attempt
        remaining = budget_deadline - time.time()
        delay = backoff_seconds * (2 ** (attempt - 1)) * random.uniform(0.9, 1.1)
        if attempt >= max_attempts or remaining < min_remaining + delay:
            return resp, attempt
        await resp.aread()  # 把这次的响应体读完/连接释放干净，再发下一次
        applog.warn(
            '%s：上游返回 HTTP %d 且没有 x-request-id（网关层失败，源站大概率'
            '没收到、或者还在处理），%.1fs 后自动重试第 %d 次（预算还剩 %.0fs）',
            label, resp.status_code, delay, attempt + 1, remaining,
        )
        await asyncio.sleep(delay)


def http_timeout(read: float | None = None) -> httpx.Timeout:
    return httpx.Timeout(
        connect=settings.connect_timeout,
        read=read if read is not None else settings.read_timeout,
        write=settings.write_timeout,
        pool=10.0,
    )


def bearer_headers(api_key: str) -> dict[str, str]:
    return {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}


def anthropic_headers(api_key: str) -> dict[str, str]:
    """Anthropic 用 x-api-key + anthropic-version，不是 Authorization: Bearer。"""
    return {
        'x-api-key': api_key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
    }


def extract_upstream_error(resp: httpx.Response) -> str:
    """把上游错误响应转成一句人话。只取 message，不回显请求头（里面有 Key）。"""
    # 网关（如 Cloudflare）出错时返回的是一整页 HTML，不是 API 的 JSON 错误。
    # 直接把 HTML 丢给用户毫无意义，这里翻译成能看懂的提示。
    if 'html' in resp.headers.get('content-type', '').lower():
        return (
            f'上游网关返回 HTTP {resp.status_code}，且返回的是网关错误页而不是接口报错。'
            '这通常是 API 服务商那边暂时故障或过载，与本项目代码无关，请稍后重试；'
            '若持续出现，需要联系你的 API 服务商。'
        )

    try:
        body = resp.json()
        error_field = body.get('error') if isinstance(body, dict) else None
        message = (
            error_field.get('message') if isinstance(error_field, dict)
            else error_field or (body.get('message') if isinstance(body, dict) else None)
        )
        message = message or json.dumps(body, ensure_ascii=False)
    except ValueError:
        message = resp.text[:300]
    return f'上游返回 HTTP {resp.status_code}：{message}'


def describe_error(exc: Exception) -> str:
    """Client errors must not reveal server environment or proxy credentials."""
    if isinstance(exc, httpx.ConnectError):
        return '无法连接上游服务，请稍后重试。'
    return redact_text(exc)


def sniff_image_mime(data: bytes) -> str:
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if data.startswith(b'\xff\xd8'):
        return 'image/jpeg'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    return 'application/octet-stream'


def summarize_usage(mode: str, raw: dict | None) -> dict:
    """三套协议的用量字段名各不相同，在这里统一。缺失的字段保持 None，不编造数据。"""
    empty = {
        'input_tokens': None, 'output_tokens': None,
        'cache_write_tokens': None, 'cache_read_tokens': None,
    }
    if not isinstance(raw, dict):
        return empty

    if mode in ('responses', 'images_generate', 'images_edit', 'videos_generate'):
        details = raw.get('input_tokens_details') or {}
        return {
            'input_tokens': raw.get('input_tokens'),
            'output_tokens': raw.get('output_tokens'),
            'cache_write_tokens': details.get('cache_write_tokens'),
            'cache_read_tokens': details.get('cached_tokens'),
        }

    if mode == 'chat_completions':
        details = raw.get('prompt_tokens_details') or {}
        return {
            'input_tokens': raw.get('prompt_tokens'),
            'output_tokens': raw.get('completion_tokens'),
            'cache_write_tokens': details.get('cache_write_tokens'),
            'cache_read_tokens': details.get('cached_tokens'),
        }

    return {
        'input_tokens': raw.get('input_tokens'),
        'output_tokens': raw.get('output_tokens'),
        'cache_write_tokens': raw.get('cache_creation_input_tokens'),
        'cache_read_tokens': raw.get('cache_read_input_tokens'),
    }
