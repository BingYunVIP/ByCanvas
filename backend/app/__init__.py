"""ByCanvas 后端：只做透传代理，不持有任何用户数据。"""

from .log import configure_logging

# 必须在任何模块打出第一条日志之前跑起来，否则 INFO 会被静默丢掉
configure_logging()
