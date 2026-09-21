"""三套聊天协议的流式实现（从临时脚本移植）。

上游协议可用性实测记录（api.bingyun.vip，2026-09-15）：
    /responses          ✅ 通。gpt-5.6-sol 一次普通问答约 28 秒出完整回复
    /chat/completions   ❌ 网关 502（响应头没有 x-request-id，请求没到源站）
    /images/*           ✅ 通（生图约 48 秒）
所以默认走 /responses，/chat/completions 只作为兜底。
上游随时可能变，这个判断集中放在 _auto() 和前端 chatModeFor() 两处，改一处即可。

为什么这里是 async：
  上游一次流式响应可能持续几十秒到几分钟。用同步 httpx 就必须靠线程去等，
  而 FastAPI 的同步路由 + 同步生成器的 StreamingResponse 会**占死一个线程池线程**
  整整一个流的时长（Starlette 对同步生成器走 iterate_in_threadpool）。
  线程数有限，几次聊天就能占满，之后所有请求都排队 —— 表现就是浏览器端
  「连不上本地服务」。改成 async 后全程在事件循环里等待，不占线程。
"""
from __future__ import annotations

import asyncio
import json

import httpx

from .. import log as applog
from ..config import settings
from ..deps import Upstream
from ..upstream import (
    anthropic_headers,
    bearer_headers,
    extract_upstream_error,
    http_timeout,
)
from .multimodal import to_anthropic, to_chat_completions, to_responses

CHAT_MODES = ('responses', 'chat_completions', 'messages', 'auto')

# 读超时是「距上一次收到数据」的等待上限，不是整次请求的总时长。
# 实测该上游首字可能要 28 秒才来，给 90 秒留足余量；真挂死时也不会无限占连接。
_RESPONSES_READ_TIMEOUT = 90.0

# auto 模式下，首选协议这么久还没吐出第一个字，就**并发**起备选协议一起等
# （见 _auto() 的详细说明）——注意这已经不是"等不到就放弃"的期限了，只是
# "要不要多起一路"的判断点，所以调这个数字不再是"等太久 vs 太早放弃"的两难：
# 调小只是让备选路更早介入（多花一次上游请求换取更快的失败发现），
# 调大则更倾向于"再等等首选"。默认值来自实测：/responses 首字约 21~28 秒。
# 可通过 .env 的 AUTO_FIRST_TOKEN_TIMEOUT 覆盖，不用改代码。
AUTO_FIRST_TOKEN_TIMEOUT = settings.auto_first_token_timeout

# 记住每个上游上次是靠哪套协议成功的，下次先试它，省掉一次白跑的失败请求。
# 只存「上游地址 → 协议名」，不碰 Key、不碰会话内容，重启即清空。
_preferred: dict[str, str] = {}

OnEvent = 'callable[[str, str], None]'  # (kind, text)：kind 为 content / reasoning


async def stream_chat(
    mode: str,
    up: Upstream,
    model: str,
    reasoning_effort: str | None,
    messages: list[dict],
    max_tokens: int,
    on_event,
) -> dict | None:
    """统一入口，返回上游给出的 usage 原始字典（可能没有）。"""
    if mode == 'chat_completions':
        return await _chat_completions(up, model, reasoning_effort, messages, on_event)
    if mode == 'responses':
        return await _responses(up, model, reasoning_effort, messages, on_event)
    if mode == 'messages':
        return await _messages(up, model, messages, max_tokens, on_event, reasoning_effort)
    if mode == 'auto':
        return await _auto(up, model, reasoning_effort, messages, on_event)
    raise ValueError(f'未知的聊天模式：{mode}')


async def _auto(
    up: Upstream, model: str, reasoning_effort: str | None,
    messages: list[dict], on_event,
) -> dict | None:
    """拿不准用哪套协议时的兜底：先试首选，迟迟不吐字就**并发**试备选（hedge）。

    默认顺序见本文件顶部的实测记录（该上游 /responses 通、/chat/completions 502）。
    `_preferred` 会记住这个上游上次是靠哪套成功的，下次优先试它 —— 上游要是哪天
    反过来，第一轮失败后自动换，不用改代码也不用重启。

    2026-09-19 改动记录（真实故障：用户在浏览器里收到
    "/chat_completions 在 30 秒内一个字都没吐，已放弃"，但同样的请求用命令行 /
    Codex 桌面端打同一个中转站却能正常出结果）——

    旧版本是**串行 + 放弃**：一套协议 30 秒内不吐字就 `task.cancel()` 直接扔掉，
    再串行试下一套；两套都撞上这道 30 秒的闸，最坏要等 60 秒才报错，而且被放弃的
    那一套哪怕本来 32 秒后就会正常吐字，也没有机会——等于用一个偏保守的"首字慢"
    阈值把「协议真的坏了」和「模型这次思考得比较久」两种情况一刀切地判了同一种
    死刑。命令行 / Codex 这类客户端没有这道闸，就是老老实实等一个更长的读超时，
    所以「体验更好」——差的不是网络，是这道过早放弃的看门狗。

    新版本改成**首选先跑 + 迟到才并发**：
      1. 首选协议照常先起；
      2. 等 AUTO_FIRST_TOKEN_TIMEOUT 秒还没吐字、也没出结果（成功或报错），
         不再 cancel 它——而是**再起一个备选协议并发跑**，两个一起等；
      3. 谁先吐出第一个字就用谁，另一个立刻取消（就算它取消前抢先吐了个字，
         也会被 `winner` 那道判定直接丢弃，不会混进已经在展示的那份回答里）；
      4. 只有两套都跑到失败（或者都正常结束但从没吐过字——极端的空结果）才真正
         报错，错误信息会把两套的失败原因都列出来，而不是只报最后一个。

    这样最坏情况下的等待时间是"单个协议的真实读超时"（90~180 秒，见
    `_RESPONSES_READ_TIMEOUT` / `settings.read_timeout`），而不是"协议数 × 30 秒"
    的累加；而且只要有一套协议最终能吐字，用户就总能拿到回答，不会出现
    "其实等等就成了，却被这道闸提前判死"的情况。代价是：一旦触发并发，
    这次请求会短暂地同时打两路上游（多花一次请求的成本），只在首选明显偏慢时
    才会发生，不是每次请求都会翻倍。

    仍然保留的老规矩：**已经吐出内容后才失败，不会再切协议或吞掉错误** ——
    那样会让用户看到两段拼在一起的回答，不如把错误如实报上去。
    """
    callers = {'responses': _responses, 'chat_completions': _chat_completions}
    order = ['responses', 'chat_completions']
    preferred = _preferred.get(up.base_url)
    if preferred in callers and preferred != order[0]:
        order.remove(preferred)
        order.insert(0, preferred)
    first, second = order

    winner: dict[str, str | None] = {'name': None}
    won = asyncio.Event()
    tasks: dict[str, asyncio.Task] = {}
    errors: dict[str, Exception] = {}
    leading: dict[str, list[tuple[str, str]]] = {name: [] for name in order}

    def make_on_event(name: str):
        def _on_event(kind: str, text: str) -> None:
            if not text:
                return
            if winner['name'] is None and not text.strip():
                leading[name].append((kind, text))
                return
            if winner['name'] is None:
                # 第一个吐字的赢家，立刻取消还在跑的另一路——省上游资源，
                # 也避免它稍后也吐字、跟赢家的内容拼在一起。
                winner['name'] = name
                won.set()
                for event in leading[name]:
                    on_event(*event)
                for other, other_task in tasks.items():
                    if other != name and not other_task.done():
                        other_task.cancel()
            if winner['name'] == name:
                on_event(kind, text)
        return _on_event

    def start(name: str) -> None:
        tasks[name] = asyncio.create_task(
            callers[name](up, model, reasoning_effort, messages, make_on_event(name))
        )

    def resolve_if_done(name: str, task: asyncio.Task) -> None:
        """An empty successful transport still counts as a failed chat response."""
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            errors[name] = exc
            applog.log('[auto] /%s 失败：%s: %s', name, type(exc).__name__, exc)
        elif winner['name'] != name:
            errors[name] = RuntimeError('聊天接口没有返回任何内容。')

    try:
        start(first)

        # 首选要么在时限内吐字/出结果，要么就迟到——迟到不等于坏，只是不再让它一个人扛。
        won_waiter = asyncio.ensure_future(won.wait())
        try:
            await asyncio.wait(
                {tasks[first], won_waiter},
                timeout=AUTO_FIRST_TOKEN_TIMEOUT,
                return_when=asyncio.FIRST_COMPLETED,
            )
        finally:
            if not won_waiter.done():
                won_waiter.cancel()

        if tasks[first].done():
            resolve_if_done(first, tasks[first])

        if winner['name'] is None:
            applog.log(
                '[auto] /%s 在 %.0f 秒内没有结果，不放弃它，改为并发试 /%s——谁先吐字用谁',
                first, AUTO_FIRST_TOKEN_TIMEOUT, second,
            )
            start(second)

        while winner['name'] is None:
            pending = {t for t in tasks.values() if not t.done()}
            if not pending:
                break
            done, _ = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for name, task in tasks.items():
                if task in done:
                    resolve_if_done(name, task)

        if winner['name'] is None:
            detail = '；'.join(f'/{name} 失败：{err}' for name, err in errors.items())
            raise RuntimeError(detail or '两套协议都没有返回任何内容。')

        name = winner['name']
        if preferred != name:
            applog.log('[auto] 这个上游改用 /%s（记住了，下次直接先试它）', name)
        _preferred[up.base_url] = name
        return await tasks[name]
    finally:
        # 兜底清理：不管是正常赢出、两套都失败、还是这次请求本身被取消
        # （比如浏览器断开连接），陪跑的任务都不该继续占着上游连接。
        stragglers = [t for t in tasks.values() if not t.done()]
        for t in stragglers:
            t.cancel()
        if stragglers:
            await asyncio.gather(*stragglers, return_exceptions=True)


async def _chat_completions(
    up: Upstream, model: str, reasoning_effort: str | None,
    messages: list[dict], on_event,
) -> dict | None:
    body: dict = {
        'model': model,
        'messages': [{'role': m['role'], 'content': to_chat_completions(m['content'])} for m in messages],
        'stream': True,
    }
    if reasoning_effort:
        # xAI/Grok 的 chat/completions 用顶层 reasoning_effort（已实测）。
        body['reasoning_effort'] = reasoning_effort

    usage = None
    completed = False
    try:
        async with httpx.AsyncClient(timeout=http_timeout()) as client:
            async with client.stream(
                'POST', f'{up.base_url}/chat/completions', json=body,
                headers=bearer_headers(up.api_key),
            ) as resp:
                if resp.status_code != 200:
                    await resp.aread()
                    raise RuntimeError(extract_upstream_error(resp))
                async for line in resp.aiter_lines():
                    if not line or not line.startswith('data: '):
                        continue
                    payload = line[len('data: '):]
                    if payload.strip() == '[DONE]':
                        completed = True
                        break
                    chunk = json.loads(payload)
                    choices = chunk.get('choices') or []
                    if choices:
                        delta = choices[0].get('delta', {})
                        if delta.get('reasoning_content'):
                            on_event('reasoning', delta['reasoning_content'])
                        if delta.get('content'):
                            on_event('content', delta['content'])
                    if chunk.get('usage'):
                        usage = chunk['usage']
    except httpx.ReadTimeout as exc:
        # httpx 的 ReadTimeout 经常不带任何 message，直接 str() 会是空字符串，
        # 对用户毫无意义——翻成人话（同 _responses 的处理）。
        raise TimeoutError(
            f'请求 /chat/completions 超时（{settings.read_timeout:.0f} 秒内上游没有再发来数据）。'
            '可能是上游这个接口暂时不可用，也可能是本次回答生成太慢。'
        ) from exc
    if not completed:
        raise RuntimeError('回复尚未完成，请重试。')
    return usage


async def _responses(
    up: Upstream, model: str, reasoning_effort: str | None,
    messages: list[dict], on_event,
) -> dict | None:
    body: dict = {
        'model': model,
        'input': [{'role': m['role'], 'content': to_responses(m['content'])} for m in messages],
        'stream': True,
    }
    if reasoning_effort:
        # summary: 'auto' 是为了尽量拿到可读的推理摘要，不是所有模型都会返回。
        body['reasoning'] = {'effort': reasoning_effort, 'summary': 'auto'}

    usage = None
    completed = False
    timeout = http_timeout(read=_RESPONSES_READ_TIMEOUT)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                'POST', f'{up.base_url}/responses', json=body,
                headers=bearer_headers(up.api_key),
            ) as resp:
                if resp.status_code != 200:
                    await resp.aread()
                    raise RuntimeError(extract_upstream_error(resp))
                async for line in resp.aiter_lines():
                    if not line or not line.startswith('data: '):
                        continue
                    payload = line[len('data: '):]
                    if payload.strip() == '[DONE]':
                        completed = True
                        break
                    event = json.loads(payload)
                    etype = event.get('type', '')
                    if etype.endswith('output_text.delta'):
                        on_event('content', event.get('delta', ''))
                    elif etype.endswith('reasoning_summary_text.delta'):
                        on_event('reasoning', event.get('delta', ''))
                    elif etype in ('response.completed', 'response.failed', 'response.incomplete'):
                        response_obj = event.get('response', {})
                        usage = response_obj.get('usage')
                        if etype != 'response.completed':
                            error = response_obj.get('error', {}).get('message', '响应失败')
                            raise RuntimeError(f'Responses API 失败：{error}')
                        completed = True
                        break
    except httpx.ReadTimeout as exc:
        raise TimeoutError(
            f'请求 /responses 超时（{_RESPONSES_READ_TIMEOUT:.0f} 秒内上游没有再发来数据）。'
            '可能是上游这个接口暂时不可用，也可能是本次回答生成太慢。'
        ) from exc
    if not completed:
        raise RuntimeError('回复尚未完成，请重试。')
    return usage


async def _messages(
    up: Upstream, model: str, messages: list[dict], max_tokens: int, on_event, reasoning_effort: str | None = None,
) -> dict | None:
    body = {
        'model': model,
        'max_tokens': max_tokens,
        'messages': [{'role': m['role'], 'content': to_anthropic(m['content'])} for m in messages],
        'stream': True,
    }

    if reasoning_effort:
        body['output_config'] = {'effort': reasoning_effort}

    usage = None
    completed = False
    try:
        async with httpx.AsyncClient(timeout=http_timeout()) as client:
            async with client.stream(
                'POST', f'{up.base_url}/messages', json=body,
                headers=anthropic_headers(up.api_key),
            ) as resp:
                if resp.status_code != 200:
                    await resp.aread()
                    raise RuntimeError(extract_upstream_error(resp))
                event_name = 'message'
                async for line in resp.aiter_lines():
                    if line.startswith('event: '):
                        event_name = line[len('event: '):].strip()
                    elif line.startswith('data: '):
                        payload = json.loads(line[len('data: '):])
                        handled = False
                        if event_name == 'content_block_delta':
                            delta = payload.get('delta', {})
                            if delta.get('type') == 'text_delta':
                                on_event('content', delta.get('text', ''))
                                handled = True
                            elif delta.get('type') == 'thinking_delta':
                                on_event('reasoning', delta.get('thinking', ''))
                                handled = True
                        if event_name == 'message_delta':
                            usage = payload.get('usage')
                            handled = True
                        if event_name == 'error':
                            raise RuntimeError(payload.get('error', {}).get('message', '响应失败'))
                        if event_name == 'message_stop':
                            completed = True
                            break
                        if handled:
                            # 处理完一条事件，下一条 event: / 空行 才算新事件
                            event_name = 'message'
                    elif line == '':
                        event_name = 'message'
    except httpx.ReadTimeout as exc:
        raise TimeoutError(
            f'请求 /messages 超时（{settings.read_timeout:.0f} 秒内上游没有再发来数据）。'
            '可能是上游这个接口暂时不可用，也可能是本次回答生成太慢。'
        ) from exc
    if not completed:
        raise RuntimeError('回复尚未完成，请重试。')
    return usage
