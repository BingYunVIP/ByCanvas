"""按「IPv4 + IPv6 都能连」的方式启动 uvicorn。

为什么要这个文件：

  uvicorn --host 0.0.0.0  → 只听 IPv4。浏览器把 localhost 解析成 ::1 时连不上，
                            Chrome 会回退到 IPv4 所以没事，Firefox / Edge 有些
                            配置下直接失败（Failed to fetch）。
  uvicorn --host ::       → 本以为是双栈，实测在 WSL 上拿到的是 IPv6-only socket，
                            结果反过来：::1 通了，127.0.0.1 连不上。

两条路都会在「某些浏览器能开、某些不能」上翻车。所以这里自己建 socket，
按下面三级降级，尽可能保证两个协议族都有人接：

  1) 双栈：绑 :: 并显式关掉 IPV6_V6ONLY（一个 socket 同时接 IPv4 和 IPv6）
  2) 双绑：拿不到双栈时，IPv4、IPv6 各建一个 socket，一起交给 uvicorn
  3) 单栈：连 IPv6 都建不起来，就只绑 IPv4（至少别让服务起不来）

用法：
  python serve.py [端口] [监听地址]
    端口默认 7400；监听地址默认 ::（走上面的降级链）。
    显式写 0.0.0.0 / 127.0.0.1 时就是纯 IPv4，不降级。
    只允许本机访问时可以传 127.0.0.1。
  python serve.py [端口] [监听地址] --check
    只建监听并自检 IPv4 / IPv6 通不通，不真的启动服务。
"""
from __future__ import annotations

import errno
import os
import socket
import sys

BACKLOG = 2048


def _bind(host: str, port: int, **kw) -> socket.socket:
    try:
        return socket.create_server((host, port), backlog=BACKLOG, **kw)
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            sys.exit(
                f'[serve] 端口 {port} 已被占用。\n'
                f'       先停掉旧服务：sudo systemctl stop bychat-backend\n'
                f'       或看是谁占着：sudo ss -lntp | grep {port}'
            )
        raise


def make_listeners(host: str, port: int) -> list[socket.socket]:
    """返回一组已经 bind + listen 的 socket。"""

    if host not in ('', '::', 'auto'):
        # 用户明确指定了地址，照做
        return [_bind(host, port)]

    # ① 双栈
    try:
        # 两个关键点：
        #   family 必须显式给 AF_INET6 —— create_server 默认是 AF_INET，
        #     不传的话 dualstack_ipv6=True 会直接抛 ValueError。
        #   dualstack_ipv6=True 会显式设 IPV6_V6ONLY=0；平台不支持时抛
        #     OSError，不会悄悄退化成 IPv6-only。
        return [_bind('::', port, family=socket.AF_INET6, dualstack_ipv6=True)]
    except (OSError, ValueError) as exc:
        print(f'[serve] 双栈不可用（{type(exc).__name__}: {exc}），改用 IPv4 + IPv6 分别监听', flush=True)

    # ② 两个单栈各绑一个
    socks: list[socket.socket] = []
    try:
        socks.append(_bind('0.0.0.0', port))
    except OSError as exc:
        print(f'[serve] 绑 IPv4 失败：{exc}', flush=True)
    try:
        socks.append(_bind('::', port, family=socket.AF_INET6))
    except OSError as exc:
        print(f'[serve] 绑 IPv6 失败：{exc}', flush=True)

    if socks:
        return socks

    # ③ 实在不行，退回 IPv4 单栈，让服务至少能起来
    print('[serve] IPv6 也拿不到，退回纯 IPv4', flush=True)
    return [_bind('0.0.0.0', port)]


def describe(sock: socket.socket) -> str:
    if sock.family != socket.AF_INET6:
        return 'IPv4'
    # 别用 getsockname() 判断 —— 单栈绑 :: 时它也返回 '::'，会说成双栈。
    # 真正的判据是 IPV6_V6ONLY：0 = 双栈，1 = 只接 IPv6。
    v6only = sock.getsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY)
    return 'IPv6 单栈（只接 ::1）' if v6only else 'IPv6 双栈（IPv4 也能连）'


def selfcheck(port: int) -> None:
    for target in ('127.0.0.1', '::1'):
        try:
            # create_connection 不接受 family 参数，只能自己建 socket，
            # 否则它会把 ::1 解析回 127.0.0.1，测出来的结果没有意义
            fam = socket.AF_INET6 if ':' in target else socket.AF_INET
            with socket.socket(fam, socket.SOCK_STREAM) as probe:
                probe.settimeout(1)
                probe.connect((target, port))
            print(f'        {target} 连得上 ✓', flush=True)
        except OSError as exc:
            print(f'        {target} 连不上（{type(exc).__name__}）', flush=True)


def main() -> None:
    args = [a for a in sys.argv[1:] if a != '--check']
    check_only = len(args) != len(sys.argv[1:])

    port = int(args[0]) if len(args) > 0 else 7400
    host = args[1] if len(args) > 1 else '::'

    socks = make_listeners(host, port)
    for sock in socks:
        print(f'[serve] 监听 {sock.getsockname()[0]}:{port} —— {describe(sock)}', flush=True)

    if check_only:
        selfcheck(port)
        return

    # import app.main 需要 backend/ 在 sys.path 里；systemd / 脚本的 cwd 不一定对
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

    import uvicorn

    config = uvicorn.Config(
        'app.main:app',
        # 不给 fd / host / port：socket 全部由我们建好传进去，
        # 交给 uvicorn 自己 bind 的话双栈就白做了
        log_level=os.environ.get('UVICORN_LOG_LEVEL', 'info'),
        timeout_keep_alive=75,     # 生图要 40s+，别让 keep-alive 把连接掐了
    )
    print(f'[serve] 启动 uvicorn（{len(socks)} 个监听 socket）', flush=True)
    uvicorn.Server(config).run(sockets=socks)


if __name__ == '__main__':
    main()
