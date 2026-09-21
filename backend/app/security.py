"""上游地址的 SSRF 防护。

上游地址由浏览器传入，若不校验，本服务就会变成一台任人驱使的请求跳板：
攻击者传 http://169.254.169.254/ 就能读云厂商元数据，传内网地址就能探测你的局域网。
所以这里做两道检查：host 白名单 + 解析后的 IP 不能是内网 / 回环 / 链路本地。
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import HTTPException

from .config import settings


def _is_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def assert_public_host(host: str) -> None:
    """解析域名的全部 A/AAAA 记录，只要有一条指向内网就拒绝（防域名解析绕过）。"""
    if settings.allow_private_upstream:
        return
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise HTTPException(status_code=400, detail=f'上游主机无法解析：{host}') from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if _is_blocked(ip):
            raise HTTPException(
                status_code=403,
                detail=(
                    f'上游主机解析到内网 / 保留地址（{ip}），已拒绝。'
                    '若上游确实在内网，请设置 ALLOW_PRIVATE_UPSTREAM=true。'
                ),
            )


def assert_upstream_allowed(base_url: str) -> None:
    parsed = urlparse(base_url)
    if parsed.scheme not in ('http', 'https'):
        raise HTTPException(status_code=400, detail='上游地址只支持 http / https。')

    host = (parsed.hostname or '').lower()
    if not host:
        raise HTTPException(status_code=400, detail='上游地址缺少主机名。')

    allowlist = settings.allowlist
    if host in allowlist:
        # 显式信任的域名，直接放行（不必每次请求都做 DNS 解析）
        return
    if '*' in allowlist:
        # 通配符放行时没有域名可依，只能靠解析后的 IP 兜底
        assert_public_host(host)
        return

    raise HTTPException(
        status_code=403,
        detail=(
            f'上游主机不在白名单内：{host}。'
            '请在 backend/.env 的 UPSTREAM_ALLOWLIST 中添加后再试。'
        ),
    )
