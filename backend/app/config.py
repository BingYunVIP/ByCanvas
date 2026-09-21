"""服务器自己的运行参数。

注意这里**不包含任何用户数据**：用户的 API 地址与 Key 由浏览器在每次请求时
通过请求头带来（见 deps.py），用完即弃。
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / '.env',
        env_file_encoding='utf-8',
        extra='ignore',
    )

    host: str = '127.0.0.1'
    port: int = 7391

    # 允许转发到的上游 host，逗号分隔。上游地址由浏览器传入，若不校验，本服务就会
    # 变成 SSRF 跳板（可被用于探测内网、或读取 169.254.169.254 云厂商元数据）。
    # 填 '*' 表示允许任意公网 host，但仍会拒绝内网 / 回环 / 链路本地地址。
    upstream_allowlist: str = 'api.bingyun.vip'

    # 仅当上游确实跑在内网时才打开；打开后上面那条 IP 保护失效，请自行承担风险。
    allow_private_upstream: bool = False

    connect_timeout: float = 10.0
    read_timeout: float = 180.0
    write_timeout: float = 30.0

    # 聊天 mode=auto 时，首选协议这么久还没吐出第一个字/没出结果，就并发起备选协议
    # 一起等（谁先吐字用谁，不放弃首选）。见 protocols/streaming.py::_auto 的详细说明。
    auto_first_token_timeout: float = 30.0

    # 生图 / 改图遇到"网关层、大概率暂时性"的失败（502/503/522/524 且没有
    # x-request-id，见 upstream.py::is_retryable_gateway_error）时，允许自动重试
    # 的总时间预算。外层网络设施的请求超时应大于这个值。
    image_retry_budget_seconds: float = 250.0

    # 前端静态目录，相对 backend/
    frontend_dir: str = '../frontend'

    @property
    def allowlist(self) -> set[str]:
        return {h.strip().lower() for h in self.upstream_allowlist.split(',') if h.strip()}

    @property
    def frontend_path(self) -> Path:
        p = Path(self.frontend_dir)
        return p if p.is_absolute() else (BACKEND_ROOT / p).resolve()


settings = Settings()
