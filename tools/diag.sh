#!/usr/bin/env bash
# 一键诊断「连不上本地服务」。把需要的信息全打出来，方便一眼看出卡在哪。
#
# 用法：
#   bash tools/diag.sh            # 默认查 7400
#   bash tools/diag.sh 8080
#
# 只看服务在不在、监听在哪个地址、IPv4/IPv6 通不通、最近有没有请求进来。
# 不涉及任何用户数据 —— 后端是纯透传，本来也不存东西。
set -uo pipefail

PORT="${1:-7400}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
VENV="$BACKEND/.venv"
SERVICE="bychat-backend"

hr() { echo "────────────────────────────────────────────"; }

hr
echo "1) 服务状态"
hr
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "$SERVICE"; then
  systemctl is-active "$SERVICE" >/dev/null 2>&1 \
    && echo "   $SERVICE：● 运行中" \
    || echo "   $SERVICE：○ 没在跑（以 root 身份运行：systemctl start $SERVICE）"
  systemctl --no-pager -l status "$SERVICE" 2>/dev/null | grep -E "Active:|Main PID:|ExecStart" | sed 's/^/   /'
else
  echo "   没有装 systemd 服务（本机多半是前台跑的，终端一关就没了）"
  echo "   建议：以 root 身份运行 bash deploy.sh install"
fi

hr
echo "2) 端口监听（重点看这一行）"
hr
if command -v ss >/dev/null 2>&1; then
  found="$(ss -lntp 2>/dev/null | grep ":$PORT" || true)"
  if [ -z "$found" ]; then
    echo "   ✗ 没有任何进程在监听 $PORT —— 这就是「连不上本地服务」的直接原因"
  else
    echo "$found" | sed 's/^/   /'
    case "$found" in
      *":::$PORT"*|*"*:*"*)  echo "   → 双栈监听，IPv4 / IPv6 都接 ✓" ;;
      *"0.0.0.0:$PORT"*)     echo "   → 只听 IPv4：localhost 解析成 ::1 的浏览器会连不上 ✗" ;;
      *"127.0.0.1:$PORT"*)   echo "   → 只听 127.0.0.1：Windows 侧的浏览器访问不到 ✗（改成 :: 或 0.0.0.0）" ;;
      *"::1:$PORT"*)         echo "   → 只听 ::1：只有 IPv6 回环能连 ✗" ;;
    esac
  fi
else
  echo "   （没有 ss，跳过）"
fi

hr
echo "3) 连通性自检（在 WSL 内部发起）"
hr
for target in "127.0.0.1" "[::1]"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://$target:$PORT/api/healthz" 2>/dev/null || echo 000)"
  [ "$code" = "200" ] \
    && echo "   http://$target:$PORT/api/healthz → $code ✓" \
    || echo "   http://$target:$PORT/api/healthz → $code ✗"
done

hr
echo "4) 最近日志（看有没有真实请求进来）"
hr
if command -v journalctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "$SERVICE"; then
  journalctl -u "$SERVICE" -n 12 --no-pager 2>/dev/null | sed 's/^/   /'
else
  echo "   （没有 systemd 日志）"
fi

hr
echo "5) 浏览器该怎么开"
hr
WSL_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "   首选：http://localhost:$PORT"
echo "   次选：http://127.0.0.1:$PORT      ← Edge / Firefox 打不开时先试这个"
[ -n "${WSL_IP:-}" ] && echo "   再选：http://$WSL_IP:$PORT"
echo
echo "   三个浏览器都试试上面三个地址，哪个能开就把结论告诉我："
echo "     · 全部能开            → 已经好了"
echo "     · 只有 127.0.0.1 能开 → localhost 被解析成了 ::1，双栈没生效，重装服务"
echo "     · 全都打不开          → 多半是浏览器走了系统代理，见下"
echo
echo "   系统代理排查（这是「Chrome 能开、Edge/Firefox 不能」最常见的原因）："
echo "     Windows 设置 → 网络和 Internet → 代理 → 关掉「使用代理服务器」，"
echo "     或在「不使用代理服务器的地址」里加上 localhost;127.0.0.1"
echo "     Firefox 另外还要检查：设置 → 网络设置 → 连接 → 不使用代理的地址"
hr
