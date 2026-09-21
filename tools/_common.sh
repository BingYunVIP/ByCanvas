#!/usr/bin/env bash
# 供本地前台启动工具使用的小工具。
# 由调用方 source：source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

# uv 可能安装在用户目录或系统目录，这里检查常见位置。
_resolve_uv() {
  local c
  for c in \
    "$(command -v uv 2>/dev/null || true)" \
    "${HOME:-/root}/.local/bin/uv" \
    "/root/.local/bin/uv" \
    "${HOME:-/root}/.cargo/bin/uv" \
    "/usr/local/bin/uv" \
    "/usr/bin/uv" \
    "/snap/bin/uv"
  do
    if [ -n "$c" ] && [ -x "$c" ]; then echo "$c"; return 0; fi
  done
  return 1
}

# 设置全局变量 UV；找不到就现场装一个。
ensure_uv() {
  export PATH="$PATH:/usr/local/bin:/usr/bin:/bin:${HOME:-/root}/.local/bin:/root/.local/bin:${HOME:-/root}/.cargo/bin"

  UV="$(_resolve_uv || true)"
  if [ -z "${UV:-}" ]; then
    echo "→ 没找到 uv，正在安装（https://astral.sh/uv）"
    if command -v curl >/dev/null 2>&1; then
      curl -LsSf https://astral.sh/uv/install.sh | sh
    elif command -v wget >/dev/null 2>&1; then
      wget -qO- https://astral.sh/uv/install.sh | sh
    else
      echo "✗ 既没有 curl 也没有 wget，装不了 uv" >&2
      exit 1
    fi
    UV="$(_resolve_uv || true)"
  fi

  if [ -z "${UV:-}" ]; then
    echo "✗ 仍然找不到 uv。请手动安装后重试：https://docs.astral.sh/uv/" >&2
    exit 1
  fi
  echo "→ 使用 uv：$UV"
}

# venv 坏了就重建：bin/python 是 0 字节的普通文件（本该是符号链接）就是坏了
ensure_venv() {
  local venv="$1" backend="$2"
  if [ -e "$venv/bin/python" ] && [ ! -s "$venv/bin/python" ]; then
    echo "⚠️  发现损坏的虚拟环境，删除重建"
    rm -rf "$venv"
  fi
  if [ ! -x "$venv/bin/python" ]; then
    echo "→ 创建虚拟环境：$venv"
    (cd "$backend" && "$UV" venv .venv --python 3.12)
  fi
}

install_deps() {
  local venv="$1" backend="$2"
  echo "→ 安装 / 补齐依赖"
  (cd "$backend" && "$UV" pip install --python "$venv/bin/python" -r requirements.txt)
}

# 说明：监听地址由 backend/serve.py 决定，不在 shell 里猜。
#
# 只绑 IPv4（0.0.0.0）→ 浏览器把 localhost 解析成 ::1 时连不上，Firefox / Edge 会失败；
# 只绑 IPv6（::）    → 实测 WSL 上拿到的是 IPv6-only socket，127.0.0.1 反而连不上。
# 两者都会造成「某些浏览器能开、某些不能」。
# serve.py 用 dualstack_ipv6=True 显式建双栈 socket，拿不到再退回 IPv4。
