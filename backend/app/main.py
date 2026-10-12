"""ByCanvas 后端入口。

本服务只是一层**透传代理**，不持有任何用户数据：
    - API 地址 / Key：由浏览器在请求头带来，用完即弃（见 deps.py）
    - 会话历史 / 图片：只存在浏览器，服务器不落盘
"""
from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import log as applog
from .config import settings
from .routers import chat, diag, images, models, videos


def _log_startup_help(application: FastAPI) -> None:
    """启动横幅：把「这次跑的是什么配置」和「日志怎么查」一次说清。

    使用者拿到问题现场时只有一条 `journalctl -u bycanvas-backend -f` 可用，
    所以这些排查入口必须写在日志里，而不是只躺在文档里。
    """
    applog.log('后端已启动 v%s', application.version)
    applog.log('上游白名单：%s', '、'.join(sorted(settings.allowlist)) or '（未配置，所有转发都会被拒）')

    frontend = settings.frontend_path
    if frontend.is_dir():
        applog.log('前端目录：%s', frontend)
    else:
        applog.warn('前端目录不存在：%s —— 页面会 404，检查 backend/.env 的 FRONTEND_DIR', frontend)

    applog.log('日志怎么看：[xxxxxx] 是请求号，同一次请求的日志串得起来')
    applog.log('           [%s] 是分类，只看某条链路：'
               "journalctl -u bycanvas-backend -f | grep '[视频]'",
               ']/['.join(applog.CATEGORIES))
    applog.log('           只看问题行：[WARN]/[ERROR] 前缀，'
               "journalctl -u bycanvas-backend -f | grep -E '\\[(WARN|ERROR)\\]'")
    applog.log('           「排队 x.xs」超过 1 秒 = 服务端忙不过来，请求在干等')
    applog.log('           「线程 N 个」只涨不跌 = 有连接没关干净（常见于聊天流没结束）')


@asynccontextmanager
async def lifespan(application: FastAPI):
    cat = applog.set_category('启动')
    try:
        _log_startup_help(application)
    finally:
        applog.reset_category(cat)
    yield
    cat = applog.set_category('启动')
    try:
        applog.log('后端正在关闭')
    finally:
        applog.reset_category(cat)


app = FastAPI(
    title='ByCanvas',
    version='0.3.0',
    docs_url='/api/docs',
    openapi_url='/api/openapi.json',
    lifespan=lifespan,
)

# 前后端同源部署（前端由本服务静态托管），正常不需要跨域。
# 网站公开使用；每位用户在自己的浏览器中提供上游 API Key。
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.middleware('http')
async def log_requests(request: Request, call_next):
    """把每次 API 调用的来龙去脉打全。

    这个中间件是 async，跑在事件循环里 —— 所以它记的时间是「请求真正到达应用」
    的时刻；路由里记的是「开始执行」的时刻。两者之差就是**在线程池排队的时间**。
    差值异常大 = 线程被占光了 = 浏览器那边表现为连不上。

    顺便在这里按路径打上**日志分类**（[视频]/[生图]/[聊天]/[模型]/[体检]）。
    放在中间件而不是各路由里：一处覆盖全部日志，连上面这两行 `→` / `←` 也带分类，
    而且路由里新增日志时不用记得补分类。
    """
    path = request.url.path
    watched = path.startswith('/api/') and path != '/api/healthz'

    token = applog.set_request(uuid.uuid4().hex[:6])
    cat_token = applog.set_category(applog.category_for_path(path))
    started = time.time()
    try:
        if watched:
            applog.log(
                '→ %s %s（请求已到达，当前在处理 %d 个）',
                request.method, path, applog.http_count(),
            )
        try:
            response = await call_next(request)
        except Exception:
            applog.log_exception('未捕获异常：%s %s', request.method, path)
            raise
        if watched:
            elapsed = time.time() - started
            # 慢请求单独提级：这些是用户会直接感知到「卡住了」的那几次。
            # 阈值取得比较宽 —— 生图/视频本来就慢，正常几十秒不算问题。
            if elapsed >= 60:
                applog.warn(
                    '← %d  %s %s  总耗时 %.1fs（慢请求，看上面同一请求号的耗时分布定位卡在哪一步）',
                    response.status_code, request.method, path, elapsed,
                )
            else:
                applog.log(
                    '← %d  %s %s  总耗时 %.1fs',
                    response.status_code, request.method, path, elapsed,
                )
        return response
    finally:
        applog.reset_category(cat_token)
        applog.reset_request(token)


app.include_router(models.router)
app.include_router(chat.router)
app.include_router(images.router)
app.include_router(videos.router)
app.include_router(diag.router)


@app.get('/api/healthz')
async def healthz():
    """async：这个接口每次开页面都会调，别让它去占线程池线程。"""
    return {
        'ok': True,
        'upstream_allowlist': sorted(settings.allowlist),
    }


# 放最后注册：/api/* 已被上面的路由吃掉，剩下的交给前端静态文件
_frontend = settings.frontend_path
if _frontend.is_dir():
    app.mount('/', StaticFiles(directory=str(_frontend), html=True), name='frontend')
