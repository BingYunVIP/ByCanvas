"""诊断日志。

设计前提：使用者只会跑一条命令 `sudo journalctl -u bycanvas-backend -f`，
然后把输出整段复制过来。所以日志必须**自己就能说明问题**，不能只打 "request ok"。

每条日志都带：
  · [请求号]  —— 同一次请求的日志串得起来
  · [分类]    —— 一眼看出这条属于哪条链路（视频 / 生图 / 聊天 / 模型 / 体检 / 服务 / 启动）
  · 耗时      —— 卡在哪一步一眼看得出
  · 并发数    —— 判断是不是被线程池堵了

## 日志分类（2026-10-12 加入）

用户反馈「同一批提示词生成的视频都是 8 秒，不知道是谁定的」，翻日志时发现
**根本分不清哪条是视频链路的、也看不出时长到底有没有发出去**。所以加一层分类标签：

    [a1b2c3] [视频] 视频任务已提交 request_id=... 开始轮询（预算 600s）

分类由**请求路径**决定（`category_for_path()`），在中间件里设一次、整个请求内
所有日志自动带上（contextvar，不需要每个调用点传参）。请求之外的场景
（进程启动、端口监听、退出）由调用方显式 `set_category('服务')` / `set_category('启动')`。

## 日志级别（2026-10-13 加入）

分类解决了「这是哪条链路」，但没解决「这条是不是坏消息」—— 翻日志时还得一行行读。
所以补一档级别标签，并且**只有 WARN / ERROR 才加标签**（INFO 保持原格式不变）：

    [a1b2c3] [视频] [ERROR] 视频提交失败（共尝试 3 次）：...
    [a1b2c3] [生图] [WARN] 排队 3.2s —— 服务端忙不过来，请求在干等

于是排查时只用记两条命令：

    journalctl -u bycanvas-backend -f                                  # 全量
    journalctl -u bycanvas-backend -f | grep -E '\\[(WARN|ERROR)\\]'   # 只看问题行

刻意不做的事：不引入 JSON 日志、不加日志级别开关、不要求改命令 —— 使用者只有
「复制整段日志」这一个动作，任何需要额外配置的方案都会让日志白打。

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
_cat: contextvars.ContextVar[str] = contextvars.ContextVar('cat', default='')

_lock = threading.Lock()
_inflight_http = 0     # 已连进来、还没返回响应的请求数
_inflight_route = 0    # 真正占用线程池线程、正在执行路由的数量

# 全部日志分类。集中放这里，供启动横幅 / 部署脚本 / 文档引用，避免各处手写字符串对不上。
CATEGORIES: tuple[str, ...] = ('视频', '生图', '聊天', '模型', '体检', '服务', '启动')

# 请求路径 → 分类。放在这里（而不是 main.py）是为了能单独测：不用起整个 app。
# 顺序有意义，长的前缀放前面。
_PATH_CATEGORIES: tuple[tuple[str, str], ...] = (
    ('/api/videos', '视频'),
    ('/api/images', '生图'),
    ('/api/chat', '聊天'),
    ('/api/models', '模型'),
    ('/api/diag', '体检'),
)

# 只有 WARN / ERROR 加标签：INFO 是绝大多数行，加了只会让日志变噪。
# 这些字面量是给人 grep 用的，改动请同步 ByCanvas.sh 与 README 里的提示。
_LEVEL_TAGS: dict[int, str] = {
    logging.WARNING: '[WARN]',
    logging.ERROR: '[ERROR]',
    logging.CRITICAL: '[ERROR]',
}


def category_for_path(path: str) -> str:
    """按请求路径给日志分类；认不出来就返回空串（日志就不带分类标签）。"""
    for prefix, name in _PATH_CATEGORIES:
        if path.startswith(prefix):
            return name
    return ''


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


def set_category(cat: str) -> contextvars.Token:
    """给当前请求（或当前上下文）打上日志分类。返回 token 供 reset_category 使用。"""
    return _cat.set(cat)


def reset_category(token: contextvars.Token) -> None:
    _cat.reset(token)


def current_category() -> str:
    return _cat.get()


def _prefix() -> str:
    """`[请求号] [分类]` —— 级别标签由 _emit 追加，这里只管前两段。"""
    cat = _cat.get()
    return f'[{_req_id.get()}] [{cat}]' if cat else f'[{_req_id.get()}]'


def _emit(level: int, msg: str, args: tuple) -> None:
    text = redact_text(msg % args if args else msg)
    tag = _LEVEL_TAGS.get(level)
    prefix = _prefix()
    if tag:
        prefix = f'{prefix} {tag}'
    _logger.log(level, '%s %s', prefix, text)


def log(msg: str, *args) -> None:
    """常规信息（INFO）。"""
    _emit(logging.INFO, msg, args)


def warn(msg: str, *args) -> None:
    """能自愈、但要留意的问题：重试、兜底、排队过久、上游偶发失败。

    输出带 [WARN] 标签，可直接 `grep -E '\\[(WARN|ERROR)\\]'` 捞出来。
    """
    _emit(logging.WARNING, msg, args)


def error(msg: str, *args) -> None:
    """这一次请求确定失败了（是最终失败，不是重试中的那几次）。"""
    _emit(logging.ERROR, msg, args)


def log_exception(msg: str, *args) -> None:
    """连堆栈一起打，排查未捕获异常用。"""
    _logger.exception('%s [ERROR] %s', _prefix(), redact_text(msg % args if args else msg))


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
    started = _req_start.get()
    # 直接调用路由函数（不经中间件，比如单测）时拿不到起始时间，按 0 算。
    # 否则 time.time() - 0 会算出「排队 56 年」这种荒谬数字，还会误触发下面的排队告警。
    return (time.time() - started if started else 0.0), running


def route_exit() -> None:
    global _inflight_route
    with _lock:
        _inflight_route -= 1


def thread_count() -> int:
    """系统当前总线程数。线程泄漏（比如 SSE 没关掉）会让这个数只涨不跌。"""
    return threading.active_count()
