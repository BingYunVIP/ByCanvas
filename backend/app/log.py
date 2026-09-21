"""诊断日志。

设计前提：使用者只会跑一条命令 `sudo journalctl -u bychat-backend -f`，
然后把输出整段复制过来。所以日志必须**自己就能说明问题**，不能只打 "request ok"。

每条日志都带：
  · [请求号]  —— 同一次请求的日志串得起来
  · 耗时      —— 卡在哪一步一眼看得出
  · 并发数    —— 判断是不是被线程池堵了

最关键的是 **「排队 x.xs」**：
  本项目的路由都是同步 def，FastAPI 会把它们丢进线程池执行，
  线程池大小有限。请求进来后如果线程都被占着，就会在这里排队。
  排队时间一长，浏览器那边就表现为「连不上本地服务」。
  所以这个数字大于 1 秒，基本就能定性。
"""
from __future__ import annotations

import contextvars
import logging
import sys
import threading
import time
from .redact import redact_text

_logger = logging.getLogger('app')

_req_id: contextvars.ContextVar[str] = contextvars.ContextVar('req_id', default='------')
_req_start: contextvars.ContextVar[float] = contextvars.ContextVar('req_start', default=0.0)

_lock = threading.Lock()
_inflight_http = 0     # 已连进来、还没返回响应的请求数
_inflight_route = 0    # 真正占用线程池线程、正在执行路由的数量


class RedactedFormatter(logging.Formatter):
    def formatException(self, ei) -> str:
        return redact_text(super().formatException(ei))


def configure_logging() -> None:
    """给 app 包单独挂一个 handler。

    uvicorn 只配它自己的 logger，不管 root；而 Python 在没有 handler 时会退到
    lastResort（级别 WARNING），于是 logger.info() 会被**静默丢弃** ——
    这就是为什么以前加了日志却什么都看不到。
    """
    _logger.setLevel(logging.INFO)
    _logger.propagate = False      # 不再往 root 冒泡，否则会和 uvicorn 的日志重复两遍
    if _logger.handlers:
        return
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(RedactedFormatter('%(message)s'))
    _logger.addHandler(handler)


def log(msg: str, *args) -> None:
    _logger.info('[%s] %s', _req_id.get(), redact_text(msg % args if args else msg))


def log_exception(msg: str, *args) -> None:
    """连堆栈一起打，排查未捕获异常用。"""
    _logger.exception('[%s] %s', _req_id.get(), redact_text(msg % args if args else msg))


def set_request(rid: str) -> contextvars.Token:
    """进入请求时调用，返回 token 供 reset 使用。"""
    global _inflight_http
    with _lock:
        _inflight_http += 1
    _req_start.set(time.time())
    return _req_id.set(rid)


def reset_request(token: contextvars.Token) -> None:
    global _inflight_http
    with _lock:
        _inflight_http -= 1
    _req_id.reset(token)


def http_count() -> int:
    with _lock:
        return _inflight_http


def route_enter() -> tuple[float, int]:
    """在路由函数第一行调用。返回 (排队了多久, 线程池里正在跑几个)。"""
    global _inflight_route
    with _lock:
        _inflight_route += 1
        running = _inflight_route
    return time.time() - _req_start.get(), running


def route_exit() -> None:
    global _inflight_route
    with _lock:
        _inflight_route -= 1


def thread_count() -> int:
    """系统当前总线程数。线程泄漏（比如 SSE 没关掉）会让这个数只涨不跌。"""
    return threading.active_count()
