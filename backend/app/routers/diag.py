"""上游连通性自检。

为什么需要它：
  排查「浏览器里生成失败」时，最难的一件事是分清到底是谁的锅 ——
  我们的代码、用户的 Key、还是上游服务商自己挂了。这条接口把上游的几个口
  都打一遍，直接给出结论。前端在聊天/生图失败时会自动调一次，把结论
  并进错误提示里，用户不用再来翻日志。

关键判据（实测总结出来的）：
  上游正常时响应里会带 `x-request-id` / `x-client-request-id`；
  Cloudflare 自己返回的 502/403 **没有**这两个头 ——
  有 origin 头 = 源站给的错（Key 无效、参数错、限流），
  没 origin 头 = 网关层就失败了（服务挂了、被 WAF 拦了），跟我们的代码无关。
"""
from __future__ import annotations

import asyncio
import time

import httpx
from fastapi import APIRouter, Depends, Query

from .. import log as applog
from ..config import settings
from ..deps import Upstream, resolve_upstream
from ..upstream import bearer_headers, http_timeout

router = APIRouter(prefix='/api', tags=['diag'])

# /models 这类一次性返回的，等满 30 秒还没响应就算不正常
PROBE_READ_TIMEOUT = 30.0
# 聊天口**必须按流式探**。实测（2026-09-15）：同一个 /responses，
# 流式 20.9 秒就吐出首段，非流式要 80.9 秒才给完整结果 ——
# 拿非流式去探、再配个 20 秒超时，会把好端端的接口误报成「超时」。
# 所以这里只等「第一个数据片段」，等到了立刻收工。
FIRST_TOKEN_TIMEOUT = 45.0
# 整体兜底，免得几个口都挂起时一直卡着
TOTAL_BUDGET = 120.0
FALLBACK_MODEL = 'gpt-5.4'


def _classify(resp: httpx.Response) -> tuple[int, str]:
    """返回 (http 状态码, 人话结论)。"""
    status = resp.status_code
    hit_origin = bool(resp.headers.get('x-request-id') or resp.headers.get('x-client-request-id'))

    if status == 200:
        return status, '正常'

    if not hit_origin:
        # 请求根本没到源站，是边缘网关层就失败了
        if status == 502:
            return status, '网关 502：请求没到服务商的源站，通常是对方服务故障或过载，与本项目代码无关。'
        if status == 503:
            return status, '网关 503：服务商暂时不可用（多半在维护或过载）。'
        if status == 403:
            return status, '网关 403：被 WAF / 防火墙挡了（请求没到源站）。'
        if status == 429:
            return status, '网关 429：被限流了，稍等一会儿再试。'
        if status == 522:
            return status, '网关 522：连源站超时，服务商那边响应不过来。'
        return status, f'网关返回 HTTP {status}（请求没到源站）。'

    # 到了源站，错在源站
    if status in (401, 403):
        return status, '源站说 Key 无效或没权限，去设置里检查一下 API Key。'
    if status == 429:
        return status, '源站限流（余额不足或速率超了）。'
    if status == 404:
        return status, '源站说接口或模型不存在，在设置里重新「获取模型」试试。'
    return status, f'源站返回 HTTP {status}。'


async def _probe(
    name: str, method: str, url: str, headers: dict,
    json_body: dict | None, read: float, wait_first_token: bool,
) -> dict:
    """打一个口，返回 {name, method, path, http, ms, verdict}。

    wait_first_token=True 时按**流式**发请求，只等第一个数据片段就收工 ——
    完整回复可能要几十秒甚至更久，等它不是体检该干的事。
    """
    started = time.time()
    timeout = http_timeout(read=read)

    def fail(verdict: str) -> dict:
        return {'name': name, 'method': method, 'path': url, 'http': 0,
                'ms': round((time.time() - started) * 1000), 'verdict': verdict}

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if wait_first_token:
                async with client.stream(
                    method, url, headers=headers, json=json_body,
                ) as resp:
                    status, verdict = _classify(resp)
                    if status != 200:
                        return {'name': name, 'method': method, 'path': url,
                                'http': status,
                                'ms': round((time.time() - started) * 1000),
                                'verdict': verdict}
                    async for line in resp.aiter_lines():
                        if line.startswith('data: '):
                            break
                    else:
                        return fail(f'连上了但 {read:.0f} 秒内一个数据片段都没吐。')
            else:
                resp = await client.request(method, url, headers=headers, json=json_body)
                status, verdict = _classify(resp)
                if status != 200:
                    return {'name': name, 'method': method, 'path': url, 'http': status,
                            'ms': round((time.time() - started) * 1000), 'verdict': verdict}
    except httpx.TimeoutException:
        return fail(f'超时（{read:.0f} 秒内上游没有响应）。')
    except httpx.HTTPError as exc:
        return fail(f'连不上：{type(exc).__name__}')

    return {'name': name, 'method': method, 'path': url, 'http': status,
            'ms': round((time.time() - started) * 1000), 'verdict': '正常'}


@router.post('/diag/upstream')
async def diag_upstream(
    up: Upstream = Depends(resolve_upstream),
    model: str = Query(default='', description='用哪个模型探测，默认 gpt-5.4'),
    probe: str = Query(default='chat', description='探什么：chat | images | all'),
):
    """逐个探测上游接口。前端在请求失败时会自动调一次，把结论并进错误提示。

    probe 分开是有意的：生图一次要几十秒，聊天失败时没必要为它多等；
    反过来生图失败时也别去探聊天口，否则会给出「模型不存在」这种误导结论。
    """
    waited, running = applog.route_enter()
    probe_model = (model or '').strip() or FALLBACK_MODEL
    probe = probe if probe in ('chat', 'images', 'all') else 'chat'
    want_chat = probe in ('chat', 'all')
    want_images = probe in ('images', 'all')

    applog.log('上游自检开始 %s（模型 %s，范围 %s，排队 %.1fs，并发 %d 个）',
               up.base_url, probe_model, probe, waited, running)
    results: list[dict] = []
    try:
        headers = bearer_headers(up.api_key)
        # (名字, 方法, URL, 请求体, 读超时, 是否按流式等首段)
        targets: list[tuple] = [
            ('模型列表', 'GET', f'{up.base_url}/models', None, PROBE_READ_TIMEOUT, False),
        ]
        if want_chat:
            targets += [
                (
                    '聊天', 'POST', f'{up.base_url}/chat/completions',
                    {'model': probe_model, 'messages': [{'role': 'user', 'content': 'hi'}],
                     'stream': True, 'max_tokens': 16},
                    FIRST_TOKEN_TIMEOUT, True,
                ),
                (
                    '聊天(responses)', 'POST', f'{up.base_url}/responses',
                    {'model': probe_model, 'input': [{'role': 'user', 'content': 'hi'}],
                     'stream': True, 'max_tokens': 16},
                    FIRST_TOKEN_TIMEOUT, True,
                ),
            ]
        if want_images:
            # 生图没有流式，只能等完整结果；实测约 48 秒，给它 90 秒
            targets.append((
                '生图', 'POST', f'{up.base_url}/images/generations',
                {'model': probe_model, 'prompt': 'a red dot', 'n': 1, 'size': '512x512'},
                90.0, False,
            ))

        for name, method, url, body, read, wait_first in targets:
            # 单个口有各自的读超时；整体再兜一层，免得几个口都挂起时一直卡着
            try:
                item = await asyncio.wait_for(
                    _probe(name, method, url, headers, body, read, wait_first),
                    timeout=TOTAL_BUDGET,
                )
            except asyncio.TimeoutError:
                item = {'name': name, 'method': method, 'path': url, 'http': 0,
                        'ms': int(TOTAL_BUDGET * 1000),
                        'verdict': f'整体超过 {TOTAL_BUDGET:.0f} 秒没结果，已放弃这个口。'}
            results.append(item)
            applog.log('   · %-16s HTTP %-3s %5dms  %s',
                       item['name'], item['http'] or '-', item['ms'], item['verdict'])
    finally:
        applog.route_exit()

    ok = all(r['http'] == 200 for r in results)
    applog.log('上游自检结束：%s', '全部正常' if ok else '有接口不可用（见上，不是本项目的问题）')
    return {
        'base_url': up.base_url,
        'model': probe_model,
        'probe': probe,
        'ok': ok,
        'read_timeout': settings.read_timeout,
        'results': results,
    }
