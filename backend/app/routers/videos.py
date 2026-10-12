"""视频生成。

上游（api.bingyun.vip → xAI）的视频接口是**异步**的，一次生成要走三步：

    1. POST {base}/videos/generations   → {"request_id": "..."}
    2. GET  {base}/videos/{request_id}  → {"status": "pending|done|failed|expired",
                                           "progress": 0-100,
                                           "video": {"url": "/v1/videos/{id}/content", "duration": 5}}
    3. GET  那个 video.url              → 视频字节（video/mp4）

本服务把它收敛成一次同步调用：提交 → 轮询 → 下载 → base64 返回给浏览器。
服务器不落盘，与生图 / 改图一致（见 PLAN.md 的安全边界）。

为什么不把轮询交给浏览器直连：三段状态机 + 带鉴权下载内容，浏览器侧要处理
CORS 预检、轮询节奏和错误归类；收敛在后端只有一处实现，Key 也不会出现在
轮询 URL 里。图片仍然保留「能直连就直连」的两条通道，视频只走中转。

为什么整条链路都是 async：一次视频生成可能要几分钟。同步写法会把线程池线程
占死，几次并发就能把线程吃光（症状和生图一样：所有请求排队，浏览器表现为
「连不上本地服务」）。async 只在事件循环里等，不占线程。

## 关于上游有两个后端（2026-10-12 实测）

中转站不是只有一个后端。同一个 `POST /v1/videos/generations` 会返回两种
形式的 id：

* **UUID**（`977cd75f-76c1-9573-b621-d99efa07a598`）—— 直通 xAI 原生异步接口。
  轮询响应是 `{"status","progress"}`，终态 `done` 带 `video.url`，此时内容
  一定可取。
* **`task_*`**（`task_kI3xCwIES9wKrjY2bCa2XQbckowckc3a`）—— 落到网关**自己**
  的任务队列。轮询响应是 `{"id","request_id","status","model"}`，**没有
  `progress`**；它的 `done` 也**不保证**内容已经落盘，实测此时下载
  `/v1/videos/task_.../content` 会返回 **502 且没有 x-request-id**
  （网关自己短路，源站没收到）。

哪种会出现是随机的（同一份请求体连着两次 `task_*`，之后几十次全是 UUID），
复现不了，所以下载这一段不能写成「拿到 done 就下载一次，失败重试几次拉倒」——
必须把「等」和「取」交替进行：取不到就回去重新轮询，直到真的拿到文件或者
预算耗尽。这就是 `_fetch_content()` 存在的原因，也是用户报的
「502 Bad Gateway for url .../videos/task_.../content」的修复。

## 关于「为什么生成的视频都是 8 秒」（2026-10-12）

用户反馈两段提示词都用 `grok-imagine-video-1.5`、出来的视频都是 8 秒。查下来：

* 本服务**没有任何 8 秒限制**：`VideoRequest.duration` 允许 1~15 秒，`_build_body()`
  原样透传，不做钳制；界面上的时长档位现在覆盖 1~15 秒的整数（含 8），与官方规格一致
  （官方原文：`Set duration from 1 to 15 seconds; the default is 8.`
  https://docs.x.ai/developers/model-capabilities/video/generation#duration）。
* 界面上「时长」选**「自动」时，`duration` 根本不会发给上游** ——
  `frontend/js/api.js::videoBody()` 只在有值时带上这个字段。
* 上游不传 `duration` 时给的默认值就是 **8 秒**。
* 传了 `duration` 上游是认的（实测 `duration=10` → 下载后用 ffprobe 量出 10.04 秒）。

也就是说：8 秒 = 上游默认值，不是我们限的。为了让这类问题**不用再靠猜**，
日志里现在会明确写出「时长有没有发出去」「上游回报了什么」「下载到的文件实际多少秒」
（`mp4_duration_seconds()` 直接解析 MP4 的 moov→mvhd，不依赖上游回报）。
"""
from __future__ import annotations

import asyncio
import base64
import time
from urllib.parse import urlparse, urlunparse

import httpx
from fastapi import APIRouter, Depends, HTTPException

from .. import log as applog
from ..config import settings
from ..deps import Upstream, resolve_upstream
from ..schemas import VideoRequest, VideoResponse, VideoResult
from ..security import assert_public_host
from ..upstream import (
    bearer_headers,
    describe_error,
    extract_upstream_error,
    http_timeout,
    is_retryable_gateway_error,
    request_with_gateway_retry,
    response_reached_origin,
    summarize_usage,
)

router = APIRouter(prefix='/api', tags=['videos'])

# 真实路径（已对 api.bingyun.vip 实测确认）：POST 提交、GET 轮询、GET 取内容
GENERATE_PATH = 'videos/generations'

# 轮询间隔：上游一次 8 秒的视频约 30~45 秒完成，5 秒一次足够，也不至于太吵。
POLL_INTERVAL_SECONDS = 5.0
# 每轮询这么多次就记一条心跳日志。网关自管队列（task_*）的响应里没有 progress，
# 只看「进度变化」会让整段轮询一条日志都没有，排查时极易误判成「轮询一次就下载」。
POLL_LOG_EVERY = 6
# 单次下载视频的体积上限。15 秒 1080p 通常几 MB，留足余量；超了如实报错，
# 而不是把几十 MB 的 base64 塞进 JSON 响应把内存和浏览器一起拖垮。
MAX_VIDEO_BYTES = 64 * 1024 * 1024

# 状态机：终态之外都继续轮询
DONE_STATUS = 'done'
FAILED_STATUSES = {'failed', 'expired', 'cancelled', 'canceled'}

# ---- 「已生成但内容还取不到」这一段的等待策略 ----
# 内容没就绪时，回轮询前先等一拍（别对着还没落盘的文件猛打）。
CONTENT_REPOLL_DELAY_SECONDS = POLL_INTERVAL_SECONDS
# 「等内容」这件事单独限个时：上游要是一直取不到，没必要把整个
# video_poll_budget_seconds（默认 600 秒）耗光才报错，那样用户白等十分钟。
CONTENT_READY_BUDGET_SECONDS = 150.0
# 「取内容」最多来回几轮（防止上游一直 done 但一直取不到时死循环）
CONTENT_MAX_ROUNDS = 12
# 单轮下载内部的网关重试次数 / 退避。跨轮的长等待交给上面那个循环，
# 所以这里的次数不用很大。
DOWNLOAD_MAX_ATTEMPTS = 3
DOWNLOAD_BACKOFF_SECONDS = 2.0

# 下载这一跳「还没好」的信号：
#   404 —— xAI 那边文件还没挂上（实测：{"error":{"message":"xAI upstream returned status 404"}}）
#   400 —— 网关自管队列在 pending 时取内容（实测）
#   425 —— Too Early，某些网关会用
#   5xx —— 交给 is_retryable_gateway_error 判（网关层短路才算）
CONTENT_NOT_READY_STATUSES = {400, 404, 425}

# 实测：不传 duration 时，上游给这个默认值（grok-imagine-video-1.5 实测 8 秒）
UPSTREAM_DEFAULT_DURATION_HINT = '8 秒'
# 界面上能选的时长档位（来自 model-capabilities.json），日志里提示用户用。
# 官方规格是 1-15 秒的整数（不传时默认 8 秒），所以不再只列 5/10/15。
UI_DURATION_CHOICES = '1~15'


def _ellipsis(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + '…'


def _absolute_url(base_url: str, url: str) -> str:
    """上游返回的 video.url 是**相对路径**（/v1/videos/{id}/content），补成绝对地址。

    注意是按上游的 origin 补，不是按 base_url 补 —— base_url 已经带 /v1，
    再拼一次会变成 /v1/v1/...。

    空串要原样返回空串：否则补出来的是「裸 origin」（https://api.example.com），
    调用方的 `if not content_url` 就失效了，会静默去下载上游首页。
    """
    if not url:
        return ''
    parsed = urlparse(url)
    if parsed.scheme:
        return url
    origin = urlparse(base_url)
    return urlunparse((origin.scheme, origin.netloc, parsed.path, '', parsed.query, ''))


def _build_body(req: VideoRequest) -> dict:
    body: dict = {'model': req.model, 'prompt': req.prompt}
    if req.duration:
        body['duration'] = req.duration
    if req.resolution and req.resolution != 'auto':
        body['resolution'] = req.resolution
    if req.aspect_ratio and req.aspect_ratio != 'auto':
        body['aspect_ratio'] = req.aspect_ratio
    # 图生视频：首帧。xAI 收 {"url": "..."}，data: 内联图片同样走 url 字段。
    if req.image:
        body['image'] = {'url': req.image}
    return body


def _body_summary(body: dict) -> str:
    """把发给上游的请求体压成一行日志。

    两条硬约束：
      · `image` 是图生视频的首帧，可能是几百 KB 的 data: base64 —— 整段打进日志
        会把日志撑爆且毫无信息量，所以只记长度；
      · `prompt` 可能有几千字（用户写的那种分段视频提示词），截断到 60 字。
    Key 不在 body 里（走请求头），所以这里不用额外脱敏；`redact_text` 还会兜一层。
    """
    parts = []
    for key, value in body.items():
        if key == 'prompt':
            parts.append(f'prompt="{_ellipsis(str(value), 60)}"')
        elif key == 'image':
            url = (value or {}).get('url') if isinstance(value, dict) else ''
            parts.append(f'image=<内联首帧 {len(url or "")} 字符>')
        else:
            parts.append(f'{key}={value!r}')
    return ' '.join(parts)


def _log_video_meta(result: dict) -> None:
    """把上游 done 时回报的视频元信息记下来。

    两个后端给的东西不一样，日志里必须说清是哪种，否则「没有 duration」会被
    误读成「上游没生成」：
      · xAI 原生后端：带 duration / resolution / respect_moderation
      · 网关自管队列（task_*）：只有 url，其余字段一个都没有
    """
    video = result.get('video') or {}
    if not video:
        applog.log('上游没有回报 video 元信息（网关自管队列的响应里连 url 都没有）')
        return
    reported = {k: video[k] for k in ('duration', 'resolution', 'respect_moderation') if k in video}
    if reported:
        applog.log('上游回报的视频元信息：%s', ' '.join(f'{k}={v}' for k, v in reported.items()))
    else:
        applog.log('上游只给了视频地址、没回报时长/清晰度（网关自管队列就是这样）；'
                   '实际时长等下载完从 MP4 容器里读')


def mp4_duration_seconds(data: bytes) -> float | None:
    """从 MP4 字节里读出时长（秒），读不到返回 None。

    为什么要自己解析：上游**两个后端回报的信息不一样** —— xAI 原生后端会在
    `video.duration` 里给出时长，网关自管队列（task_*）的响应里**根本没有这个字段**。
    用户问「为什么我的视频是 8 秒」时，日志得能直接给出答案，而不是只能看上游
    报了什么。时长就写在 MP4 的 moov→mvhd box 里，纯字节解析即可，不引依赖。

    结构（ISO/IEC 14496-12）：
        box = [4 字节长度][4 字节类型][负载...]
        长度 == 1 时，真实长度在后面 8 字节；长度 == 0 表示「一直到文件末尾」。
        mvhd 负载：version(1) + flags(3)，然后
            version 0: creation(4) modification(4) timescale(4) duration(4)
            version 1: creation(8) modification(8) timescale(4) duration(8)
        时长 = duration / timescale
    """
    def iter_boxes(buf: bytes, start: int, end: int):
        pos = start
        while pos + 8 <= end:
            size = int.from_bytes(buf[pos:pos + 4], 'big')
            typ = buf[pos + 4:pos + 8]
            header = 8
            if size == 1:
                # 长度字段写 1 时，真实长度在紧随其后的 8 字节里，头也从 8 变成 16 字节
                if pos + 16 > end:
                    return
                size = int.from_bytes(buf[pos + 8:pos + 16], 'big')
                header = 16
            elif size == 0:
                size = end - pos
            if size < header or pos + size > end:
                return
            yield typ, pos + header, pos + size
            pos += size

    for typ, body_start, body_end in iter_boxes(data, 0, len(data)):
        if typ != b'moov':
            continue
        for inner, s, e in iter_boxes(data, body_start, body_end):
            if inner != b'mvhd' or s + 4 > e:
                continue
            if data[s] == 1:
                if s + 32 > e:
                    return None
                timescale = int.from_bytes(data[s + 20:s + 24], 'big')
                duration = int.from_bytes(data[s + 24:s + 32], 'big')
            else:
                if s + 20 > e:
                    return None
                timescale = int.from_bytes(data[s + 12:s + 16], 'big')
                duration = int.from_bytes(data[s + 16:s + 20], 'big')
            if not timescale:
                return None
            return duration / timescale
    return None


def _content_url(base_url: str, request_id: str, result: dict) -> str:
    """从 done 的响应里取视频地址，取不到就按上游约定拼一个。

    网关自管队列（task_*）的轮询响应里没有 `video` 字段（实测 pending 时是
    `{"id","request_id","status","model"}`），但内容确实挂在
    `/videos/{id}/content` 上——所以给不出地址时按这个约定拼，而不是直接报
    「上游没有返回视频地址」把用户挡回去。拼出来的地址照样要过 SSRF 检查。
    """
    video = result.get('video') or {}
    url = _absolute_url(base_url, str(video.get('url') or result.get('url') or ''))
    if not url:
        url = f'{base_url}/videos/{request_id}/content'
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        raise HTTPException(status_code=502, detail='上游返回的视频地址不合法。')
    return url


def _content_not_ready(resp: httpx.Response) -> bool:
    """下载这一跳的失败是不是「还没好」——值得回去重新轮询，而不是直接报错。"""
    if resp.status_code in CONTENT_NOT_READY_STATUSES:
        return True
    return is_retryable_gateway_error(resp)


def _looks_like_video(data: bytes, content_type: str) -> bool:
    """200 的响应体是不是真的视频字节。

    兜底拼地址（`/videos/{id}/content`）万一拼错、或者网关把错误页当 200 返回，
    就会把一段 JSON / HTML 当成视频存进浏览器。这里用容器魔数 + content-type
    双判，都不像就当成「还没好」继续等。
    """
    if len(data) < 12:
        return False
    if data[4:8] == b'ftyp':            # MP4 / MOV / M4V
        return True
    if data[:4] == b'\x1aE\xdf\xa3':    # WebM / MKV
        return True
    if data[:4] == b'RIFF':             # AVI 容器
        return True
    if data[:3] == b'FLV':
        return True
    # 魔数一个都没命中时，content-type 只是「上游自己声称」。网关把 JSON / HTML
    # 错误页当 200 返回、还挂着 video/* 头的情况必须挡住 —— 这种字节一旦当视频
    # 存进浏览器，用户看到的就是一个永远播不出来的破图。
    if data[:16].lstrip()[:1] in (b'{', b'[', b'<'):
        return False
    return content_type.startswith('video/')


async def _poll(client: httpx.AsyncClient, base_url: str, api_key: str, request_id: str, deadline: float) -> dict:
    """轮询直到出结果、失败或超预算。返回 done 那次的上游响应体。"""
    url = f'{base_url}/videos/{request_id}'
    last_status: str | None = None
    # 哨兵：用一个不可能与 progress 相等的对象，保证第一次一定记日志
    last_progress: object = object()
    polls = 0
    while True:
        polls += 1
        resp = await client.get(url, headers=bearer_headers(api_key))
        if resp.status_code != 200:
            detail = extract_upstream_error(resp)
            status = resp.status_code if response_reached_origin(resp) else 502
            raise HTTPException(status_code=status, detail=detail)
        try:
            data = resp.json()
        except ValueError as exc:
            raise HTTPException(status_code=502, detail='上游返回的视频状态不是合法 JSON。') from exc
        data = data if isinstance(data, dict) else {}
        status = str(data.get('status') or '').lower()
        progress = data.get('progress')
        # 状态变了、进度变了，或者到心跳点，就记一行。只看进度不行：网关自管
        # 队列（task_*）的响应里压根没有 progress 字段，整段轮询会一条日志都不留。
        if status != last_status or progress != last_progress or polls % POLL_LOG_EVERY == 0:
            applog.log(
                '视频任务 %s 第 %d 次轮询 状态=%s 进度=%s',
                request_id, polls, status or '未知', progress if progress is not None else '未知',
            )
        last_status, last_progress = status, progress
        if status == DONE_STATUS:
            return data
        if status in FAILED_STATUSES:
            reason = data.get('error') or data.get('message') or status
            raise HTTPException(status_code=502, detail=f'上游视频任务{status}：{reason}')
        if time.time() >= deadline:
            raise HTTPException(
                status_code=504,
                detail=f'视频生成超过 {int(settings.video_poll_budget_seconds)} 秒仍未完成（最后状态：{status or "未知"}）。'
                       '视频越长越慢，可改用更短的时长或更低清晰度后重试。',
            )
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def _fetch_content(
    client: httpx.AsyncClient, base_url: str, api_key: str, request_id: str, deadline: float,
) -> tuple[bytes, str, dict]:
    """拿到视频字节：轮询到 done → 解析地址 → 下载；取不到就回去重新轮询。

    为什么不是「拿到 done 就下载一次，失败重试几次就报错」（这正是原来 502 的成因）：
    网关自管队列（task_*）的 `done` 不保证内容已落盘，实测下载会 502 且没有
    x-request-id，而内容往往再过几十秒就好了。原来 `max_attempts=4` + 1.5s 退避
    只撑了约 11 秒就放弃，于是把一个「再等等就行」的情况报成了硬失败。

    这里把等待拉长、并且**交替进行**：每轮都重新问一次状态（`_poll` 在已是 done
    时会立刻返回，只多一个请求），再试着取内容；「还没好」就等一拍再来。只有
    预算耗尽或明确不是「还没好」的错误（401/403 等）才真的失败。

    返回 (视频字节, mime, done 那次的上游响应体)，最后一个给调用方算用量。
    """
    ready_deadline = min(deadline, time.time() + CONTENT_READY_BUDGET_SECONDS)
    last_detail = ''
    last_result: dict = {}
    for round_no in range(1, CONTENT_MAX_ROUNDS + 1):
        last_result = await _poll(client, base_url, api_key, request_id, deadline)
        if round_no == 1:
            _log_video_meta(last_result)
        content_url = _content_url(base_url, request_id, last_result)
        # 下载同样要防 SSRF：只允许公网地址（与生图下载 URL 同一套检查）。
        assert_public_host(urlparse(content_url).hostname or '')
        applog.log('视频已生成，开始下载 %s（第 %d 轮）', content_url[:120], round_no)
        t0 = time.time()
        resp, attempts = await request_with_gateway_retry(
            client, 'GET', content_url, label='下载生成的视频',
            budget_deadline=deadline, backoff_seconds=DOWNLOAD_BACKOFF_SECONDS,
            max_attempts=DOWNLOAD_MAX_ATTEMPTS,
            headers=bearer_headers(api_key),
        )
        content_type = (resp.headers.get('content-type') or '').split(';')[0].strip()
        if resp.status_code == 200 and _looks_like_video(resp.content, content_type):
            mime = content_type or 'video/mp4'
            applog.log('视频下载完成 %.2f MB，耗时 %.1fs%s', len(resp.content) / 1e6, time.time() - t0,
                       f'（单轮内重试了 {attempts - 1} 次）' if attempts > 1 else '')
            return resp.content, mime, last_result

        if resp.status_code == 200:
            # 200 但不是视频字节：兜底地址拼错了，或者网关把错误页当 200 返回。
            last_detail = f'上游返回的 HTTP 200 内容不是视频（content-type={content_type or "未知"}）'
            not_ready = True
        else:
            last_detail = extract_upstream_error(resp)
            not_ready = _content_not_ready(resp)

        if not not_ready:
            # 源站真给出的拒绝（401 鉴权失败、403 等），再等也不会变
            raise HTTPException(
                status_code=resp.status_code if response_reached_origin(resp) else 502,
                detail=last_detail,
            )
        if round_no >= CONTENT_MAX_ROUNDS or time.time() >= ready_deadline:
            break
        applog.log(
            '⚠️ 视频内容还没取到（%s），%.0fs 后回去重新轮询（第 %d/%d 轮）',
            last_detail, CONTENT_REPOLL_DELAY_SECONDS, round_no + 1, CONTENT_MAX_ROUNDS,
        )
        await asyncio.sleep(CONTENT_REPOLL_DELAY_SECONDS)

    raise HTTPException(
        status_code=502,
        detail=f'视频已生成，但上游内容接口一直取不到文件（{last_detail}）。'
               '这通常是中转站这一侧节点的临时故障，稍后重试即可；若反复出现请联系你的 API 服务商。',
    )


@router.post('/videos/generate', response_model=VideoResponse)
async def generate_video(req: VideoRequest, up: Upstream = Depends(resolve_upstream)):
    body = _build_body(req)

    waited, running = applog.route_enter()
    # 时长这一项刻意写全：用户问过「为什么生成的视频都是 8 秒」，而旧日志只打一个
    # `duration=None`，既看不出「没指定」也看不出「上游会给默认值」。
    applog.log(
        '进入视频路由 model=%s 时长=%s 清晰度=%s 画面比例=%s 首帧=%s'
        '（排队 %.1fs，并发 %d 个，系统线程 %d 个）',
        req.model,
        f'{req.duration} 秒' if req.duration else f'未指定（上游默认 {UPSTREAM_DEFAULT_DURATION_HINT}）',
        req.resolution or '未指定（上游默认）',
        req.aspect_ratio or '未指定（上游默认）',
        '有' if req.image else '无',
        waited, running, applog.thread_count(),
    )
    applog.log('发给上游的请求体：%s', _body_summary(body))
    if not req.duration:
        applog.log(
            '提示：本次没有指定时长（界面上「时长」选的是「自动」），上游会用它的默认值；'
            '想要确定的秒数，请在界面上把「时长」改成 %s 秒之间的任意值', UI_DURATION_CHOICES,
        )
    if waited > 1:
        applog.warn('排队 %.1fs —— 服务端忙不过来，请求在干等', waited)

    sent_at = time.time()
    deadline = sent_at + settings.video_poll_budget_seconds
    data: bytes | None = None
    mime = 'video/mp4'
    result: dict = {}
    try:
        try:
            async with httpx.AsyncClient(timeout=http_timeout()) as client:
                url = f'{up.base_url}/{GENERATE_PATH}'
                applog.log('开始请求上游 POST %s（读超时 %ss）', url, http_timeout().read)
                resp, attempts = await request_with_gateway_retry(
                    client, 'POST', url, label=f'视频提交 model={req.model}',
                    budget_deadline=deadline, backoff_seconds=1.5,
                    json=body, headers=bearer_headers(up.api_key),
                )
                if resp.status_code != 200:
                    detail = extract_upstream_error(resp)
                    applog.error('视频提交失败（共尝试 %d 次）：%s', attempts, detail)
                    status = resp.status_code if response_reached_origin(resp) else 502
                    raise HTTPException(status_code=status, detail=detail)
                request_id = str((resp.json() or {}).get('request_id') or '').strip()
                if not request_id:
                    raise HTTPException(status_code=502, detail='上游没有返回视频任务编号。')
                applog.log(
                    '视频任务已提交 request_id=%s（%s），开始轮询（预算 %.0fs）',
                    request_id,
                    '网关自管队列 task_*' if request_id.startswith('task_') else 'xAI 原生',
                    settings.video_poll_budget_seconds,
                )
                if request_id.startswith('task_'):
                    # 网关自己的队列：done 不保证内容已落盘，取不到会继续等
                    applog.log('注意：这次落到网关自管队列（task_*），内容可能要比 done 晚一会儿才取得到，'
                               '而且它的响应里不会回报时长/清晰度')
                data, mime, result = await _fetch_content(client, up.base_url, up.api_key, request_id, deadline)
        except HTTPException:
            raise
        except (httpx.HTTPError, RuntimeError) as exc:
            applog.error('视频请求出错：%s —— %s', type(exc).__name__, describe_error(exc))
            raise HTTPException(status_code=502, detail=describe_error(exc)) from exc
    finally:
        applog.route_exit()

    if not data:
        applog.error('上游没有返回视频内容')
        raise HTTPException(status_code=502, detail='上游没有返回视频内容。')
    if len(data) > MAX_VIDEO_BYTES:
        applog.error('视频体积超限：%.1f MB', len(data) / 1e6)
        raise HTTPException(
            status_code=502,
            detail=f'生成的视频过大（{len(data) / 1e6:.1f} MB，上限 {MAX_VIDEO_BYTES // (1024 * 1024)} MB）。'
                   '请降低清晰度或缩短时长后重试。',
        )

    # 实际时长以**文件本身**为准：上游两个后端回报的东西不一样（网关队列压根不报时长），
    # 从容器里读出来的数字才是用户真正会看到的那个「8 秒」。
    real_seconds = mp4_duration_seconds(data)
    if real_seconds is None:
        applog.log('视频实际时长：没能从容器里读出（不是标准 MP4，或 moov box 缺失）')
    else:
        if req.duration and abs(real_seconds - req.duration) > 0.5:
            note = f' ⚠️ 与请求的 {req.duration} 秒不符，上游没按参数出片'
        elif req.duration:
            note = f'（与请求的 {req.duration} 秒一致）'
        else:
            note = '（本次没指定时长，这是上游的默认值）'
        applog.log('视频实际时长 %.2f 秒（从 MP4 容器读出）%s', real_seconds, note)

    usage = summarize_usage('videos_generate', (result or {}).get('usage'))
    usage['duration_seconds'] = round(time.time() - sent_at, 1)
    out = VideoResponse(videos=[VideoResult(b64=base64.b64encode(data).decode('ascii'), mime=mime)], usage=usage)
    applog.log('✓ 视频完成 %.2f MB（%s），总耗时 %.1fs', len(data) / 1e6, mime, time.time() - sent_at)
    return out
