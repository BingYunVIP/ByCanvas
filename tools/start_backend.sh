#!/usr/bin/env bash
# 在 WSL 里启动 ByCanvas 后端（纯 Linux，不依赖 Windows 侧的任何进程）
#
# ⚠️ 这个脚本是**前台**运行：终端一关，后端就死。
#    要长期挂着（以及部署到 VPS），请用 systemd：
#       以 root 身份运行 bash deploy.sh install
#
# 用法：
#   bash tools/start_backend.sh          # 默认 7400
#   bash tools/start_backend.sh 7399     # 指定端口
#
# 为什么默认 7400：7399 常被 Windows 侧的遗留进程占着，
# 两边都绑同一个端口时，Windows 浏览器访问 localhost:7399 命中的是 Windows 那个，
# 会让人误以为 WSL 没起来。换端口最省心。
#
# Windows 浏览器访问：
#   http://localhost:<端口>          （WSL2 默认开了 localhostForwarding）
#   不行就用 WSL 的 IP：              （脚本启动时会打印出来）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-7400}"
BIND="${2:-auto}"          # auto = 双栈 ::（IPv4/IPv6 都接）
BACKEND="$ROOT/backend"
VENV="$BACKEND/.venv"

# shellcheck source=_common.sh
source "$ROOT/tools/_common.sh"

cd "$BACKEND"

ensure_uv
ensure_venv "$VENV" "$BACKEND"
install_deps "$VENV" "$BACKEND"

# 顺手把 WSL 的 IP 打出来，Windows 浏览器连不上 localhost 时可以用它
WSL_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "→ 启动后端（前台；关掉终端就停。要常驻请以 root 身份运行 bash deploy.sh install）"
echo "   WSL 内访问：     http://127.0.0.1:$PORT"
echo "   Windows 浏览器： http://localhost:$PORT"
[ -n "${WSL_IP:-}" ] && echo "                 或 http://$WSL_IP:$PORT"
echo "   健康检查：       curl http://127.0.0.1:$PORT/api/healthz"
echo

exec "$VENV/bin/python" "$BACKEND/serve.py" "$PORT" "$BIND"
