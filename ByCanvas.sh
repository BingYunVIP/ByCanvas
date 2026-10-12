#!/usr/bin/env bash
# ============================================================================
#  ByCanvas 部署与管理脚本（Linux，不使用 Docker）
#
#  在线体验：https://cvs.bingyun.vip
#
#  做四件事：
#    1) 检查系统环境（发行版 / Python / 端口 / 权限 / systemd / 磁盘）
#    2) 安装缺失的工具（python3、python3-venv、curl、iproute2、uv）
#    3) 询问是否创建系统服务（默认 Y）—— 开机自启、失败自启、后台常驻
#    4) 打印相关日志，最后给出访问地址（IP + 端口）
#
#  用法：
#    bash ByCanvas.sh                    # 等价于 install
#    bash ByCanvas.sh install            # 部署并启动
#    bash ByCanvas.sh install --port 8080 --user appuser
#    bash ByCanvas.sh install --yes      # 全部取默认值，不交互（适合自动化）
#    bash ByCanvas.sh start | stop | restart | status | logs | uninstall
#    bash ByCanvas.sh doctor             # 只做环境体检，不改动系统
#    bash ByCanvas.sh help
#
#  选项：
#    --port N      监听端口（默认 7400）
#    --host H      监听地址（默认 auto：IPv4 / IPv6 双栈都接）
#    --user U      运行服务的系统用户（默认 root）
#    --yes, -y     不交互，全部取默认值
#    --no-service  不创建系统服务，改用后台常驻（nohup）
#
#  日志（排查问题先看这里）：
#    脚本自身日志按 [环境]/[依赖]/[服务]/[启动]/[访问] 分类，
#    同时写入 <项目目录>/.deploy/deploy-YYYYMMDD.log。
#    后端日志：systemd 模式 → journalctl -u bycanvas-backend
#              nohup  模式 → <项目目录>/.deploy/backend.log
#    只看问题行：journalctl -u bycanvas-backend | grep -E '\[WARN|\[ERROR'
# ============================================================================
set -euo pipefail

SERVICE_NAME="bycanvas-backend"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
DEFAULT_PORT=7400
SITE_URL="https://cvs.bingyun.vip"

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV="$BACKEND/.venv"
STATE_DIR="$ROOT/.deploy"
CONF_FILE="$STATE_DIR/bycanvas.conf"
PID_FILE="$STATE_DIR/bycanvas.pid"
NOUP_LOG="$STATE_DIR/backend.log"
SCRIPT_LOG="$STATE_DIR/deploy-$(date +%Y%m%d).log"

PORT="$DEFAULT_PORT"; PORT_GIVEN=0
BIND="auto";         BIND_GIVEN=0
RUN_USER="";         USER_GIVEN=0
ASSUME_YES=0
NO_SERVICE=0
ACTION=""
SUDO=""
HAS_SYSTEMD=0
UV=""
PYTHON=""
LAN_IPS=""
PUBLIC_IP=""

# ---------------------------------------------------------------- 输出与日志
# 只在终端里着色（重定向到文件时输出纯文本）。
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[36m'
else
  C_RESET=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
fi

# 每条日志都是「时间 [级别] [分类] 正文」，级别固定 INFO/WARN/ERROR 且等宽，
# 分类固定为 [环境] [依赖] [服务] [启动] [访问]，grep 起来一目了然。
_emit() {
  local level="$1" cat="$2" color="$3"; shift 3
  local line
  line="$(date '+%Y-%m-%d %H:%M:%S') [${level}] [${cat}] $*"
  printf '%s%s%s\n' "$color" "$line" "$C_RESET"
  mkdir -p "$STATE_DIR" 2>/dev/null || return 0
  printf '%s\n' "$line" >>"$SCRIPT_LOG" 2>/dev/null || true
}
log()   { _emit "INFO " "$1" "" "${@:2}"; }
warn()  { _emit "WARN " "$1" "$C_YELLOW" "${@:2}"; }
error() { _emit "ERROR" "$1" "$C_RED" "${@:2}"; }
step()  { printf '\n%s==> %s%s\n' "$C_BLUE" "$*" "$C_RESET"; }
die()   { error "错误" "$*"; exit 1; }

# ---------------------------------------------------------------- 参数解析
usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"
  exit 0
}

parse_args() {
  while (( $# )); do
    case "$1" in
      install|start|stop|restart|status|logs|uninstall|doctor|help) ACTION="$1"; shift ;;
      --port) PORT="${2:-}"; PORT_GIVEN=1; shift 2 ;;
      --port=*) PORT="${1#*=}"; PORT_GIVEN=1; shift ;;
      --host) BIND="${2:-}"; BIND_GIVEN=1; shift 2 ;;
      --host=*) BIND="${1#*=}"; BIND_GIVEN=1; shift ;;
      --user) RUN_USER="${2:-}"; USER_GIVEN=1; shift 2 ;;
      --user=*) RUN_USER="${1#*=}"; USER_GIVEN=1; shift ;;
      --yes|-y) ASSUME_YES=1; shift ;;
      --no-service) NO_SERVICE=1; shift ;;
      -h|--help) usage ;;
      *) die "未知参数：$1（用 bash ByCanvas.sh help 查看用法）" ;;
    esac
  done

  [[ -n "$ACTION" ]] || ACTION="install"
  [[ "$ACTION" == "help" ]] && usage

  # 在这里就拦住非法值，别等 systemd 起不来才发现
  [[ "$PORT" =~ ^[0-9]+$ ]] || die "--port 必须是数字，收到：$PORT"
  (( PORT >= 1 && PORT <= 65535 )) || die "--port 取值范围 1~65535，收到：$PORT"
  case "$BIND" in
    auto|0.0.0.0|127.0.0.1|::|::1) ;;
    *) die "--host 只接受 auto / 0.0.0.0 / 127.0.0.1 / :: / ::1，收到：$BIND" ;;
  esac
}

# ---------------------------------------------------------------- 小工具
have() { command -v "$1" >/dev/null 2>&1; }
is_root() { [[ "${EUID:-$(id -u)}" -eq 0 ]]; }
can_root() { is_root || have sudo; }

ensure_root() {
  is_root && return 0
  have sudo && { SUDO="sudo"; return 0; }
  die "需要 root 权限（当前用户 $(id -un)）。请先执行：su - root   （或安装 sudo）"
}

detect_distro() {
  DISTRO_ID="unknown"; DISTRO_NAME="未知发行版"; PKG=""
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    DISTRO_ID="${ID:-unknown}"; DISTRO_NAME="${PRETTY_NAME:-$DISTRO_ID}"
  fi
  case "$DISTRO_ID" in
    ubuntu|debian|raspbian|linuxmint|pop) PKG="apt" ;;
    centos|rhel|rocky|almalinux|ol|fedora) PKG="dnf"; have dnf || PKG="yum" ;;
    alpine) PKG="apk" ;;
    arch|manjaro|endeavouros) PKG="pacman" ;;
    *) PKG=""; for c in apt dnf yum apk pacman; do have "$c" && { PKG="$c"; break; }; done ;;
  esac
}

pkg_install() {
  (( $# )) || return 0
  case "$PKG" in
    apt)
      export DEBIAN_FRONTEND=noninteractive
      $SUDO apt-get update -qq || warn "依赖" "apt-get update 失败，继续尝试安装"
      $SUDO apt-get install -y -qq "$@" ;;
    dnf) $SUDO dnf install -y -q "$@" ;;
    yum) $SUDO yum install -y -q "$@" ;;
    apk) $SUDO apk add --no-cache "$@" ;;
    pacman) $SUDO pacman -Sy --noconfirm --needed "$@" ;;
    *) warn "依赖" "没有可用的包管理器，请手工安装：$*"; return 1 ;;
  esac
}

# 端口是否被占用。
# 两个坑都踩过：
#   · 整行 grep "[:.]端口$" 匹配不上 —— `ss -lnt` 的行是 `LISTEN 0 2048 *:7400 *:*`，
#     端口后面还有内容。必须只取第 4 列（Local Address:Port）再比。
#   · `grep -q` 提前退出会给上游发 SIGPIPE，pipefail 下管道整体返回失败，
#     明明占用了却被判成空闲。这里改用 awk 读完全部输入。
port_in_use() {
  local port="$1"
  if have ss; then
    ss -lnt 2>/dev/null | awk -v p="$port" '$4 ~ ("[:.]" p "$") { f = 1; exit } END { exit(f ? 0 : 1) }'
    return
  fi
  if have netstat; then
    netstat -lnt 2>/dev/null | awk -v p="$port" '$4 ~ ("[:.]" p "$") { f = 1; exit } END { exit(f ? 0 : 1) }'
    return
  fi
  if have lsof; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  return 1
}

# 找到可用的 Python（>= 3.11），优先 python3，其次具体小版本
find_python() {
  local candidate
  for candidate in python3 python3.13 python3.12 python3.11 python; do
    if have "$candidate" && "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
      PYTHON="$(command -v "$candidate")"; return 0
    fi
  done
  return 1
}

# 问 Y/N；非交互（--yes、管道执行、无 tty）时直接用默认值
ask_yes_no() {
  local question="$1" default="${2:-y}" reply=""
  if (( ASSUME_YES )) || [[ ! -t 0 ]]; then
    [[ "$default" == "y" ]]
    return
  fi
  local hint="[Y/n]"; [[ "$default" == "n" ]] && hint="[y/N]"
  read -r -p "$question $hint " reply || reply=""
  reply="${reply:-$default}"
  [[ "${reply,,}" == y* ]]
}

# ---------------------------------------------------------------- 部署配置
save_conf() {
  mkdir -p "$STATE_DIR"
  cat >"$CONF_FILE" <<EOF
# ByCanvas 部署参数（由 ByCanvas.sh 生成；可手工修改后重跑 install）
PORT=$PORT
BIND=$BIND
RUN_USER=$RUN_USER
MODE=$MODE
EOF
}

# 只负责取值：文件不存在或没有该键都返回空串，**不能返回非 0**。
# 否则 `v="$(conf_value X)"` 在 set -e 下会静默终止整个脚本。
conf_value() {
  [[ -f "$CONF_FILE" ]] || return 0
  awk -F= -v k="$1" '$1==k {print $2; exit}' "$CONF_FILE"
}

# 回读上次的部署参数，但不覆盖命令行显式给的值
load_conf() {
  local v
  v="$(conf_value PORT)";      (( PORT_GIVEN )) || PORT="${v:-$PORT}"
  v="$(conf_value BIND)";      (( BIND_GIVEN )) || BIND="${v:-$BIND}"
  v="$(conf_value RUN_USER)";  (( USER_GIVEN )) || RUN_USER="${v:-$RUN_USER}"
  return 0
}

service_mode() {
  [[ -f "$SERVICE_FILE" ]] && { echo systemd; return; }
  [[ "$(conf_value MODE)" == "nohup" ]] && { echo nohup; return; }
  echo none
}

bind_desc() {
  case "$BIND" in
    auto|"::") echo "IPv4 + IPv6 双栈" ;;
    0.0.0.0) echo "仅 IPv4" ;;
    127.0.0.1) echo "仅本机 127.0.0.1" ;;
    ::1) echo "仅本机 ::1" ;;
  esac
}

# ---------------------------------------------------------------- 1. 环境检查
check_environment() {
  step "1/5 检查系统环境"

  [[ "$(uname -s)" == "Linux" ]] || die "本脚本只支持 Linux，当前系统：$(uname -s)"
  log "环境" "操作系统：$(uname -sr)"
  detect_distro
  log "环境" "发行版：$DISTRO_NAME（包管理器：${PKG:-未识别}）"
  [[ -n "$PKG" ]] || warn "环境" "没识别出包管理器，缺失的依赖需要手工安装"

  if is_root; then log "环境" "运行身份：root"
  elif have sudo; then warn "环境" "运行身份：$(id -un)（将用 sudo 执行需要权限的步骤）"
  else warn "环境" "运行身份：$(id -un)，且没有 sudo —— 只能后台常驻，装不了系统服务"
  fi

  if have systemctl && [[ -d /run/systemd/system ]]; then
    HAS_SYSTEMD=1; log "环境" "systemd：可用（支持开机自启 / 失败自启）"
  else
    HAS_SYSTEMD=0; warn "环境" "systemd：不可用，只能用后台常驻模式（不会开机自启）"
  fi

  local free_mb
  free_mb="$(df -Pm "$ROOT" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
  if [[ -n "${free_mb:-}" ]] && (( free_mb < 200 )); then
    warn "环境" "项目分区剩余空间仅 ${free_mb}MB，建议先清理（虚拟环境约需 100MB）"
  else
    log "环境" "磁盘剩余：${free_mb:-未知}MB"
  fi

  log "环境" "项目目录：$ROOT"
}

# fatal=1：端口被占用直接中止（install）；fatal=0：只告警（doctor）
check_port() {
  local fatal="${1:-1}"
  if port_in_use "$PORT"; then
    if (( fatal )); then
      die "端口 $PORT 已被占用。先腾出端口，或改用 --port 指定别的端口：
       查看占用者：$SUDO ss -lntp | grep $PORT"
    fi
    warn "环境" "端口 $PORT 已被占用：$SUDO ss -lntp | grep $PORT"
    return 0
  fi
  log "环境" "端口 $PORT 空闲，可以使用"
}

# ---------------------------------------------------------------- 2. 安装依赖
install_uv() {
  if ! have curl && ! have wget; then
    warn "依赖" "缺少 curl / wget，先装一个再装 uv"
    ensure_root; pkg_install curl ca-certificates || true
  fi
  log "依赖" "未找到 uv，正在从 astral.sh 安装"
  if have curl; then
    curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || return 1
  else
    wget -qO- https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || return 1
  fi
  export PATH="$PATH:$HOME/.local/bin:/root/.local/bin"
  ensure_uv
}

ensure_uv() {
  local c
  have uv && { UV="$(command -v uv)"; return 0; }
  for c in "$HOME/.local/bin/uv" /root/.local/bin/uv /usr/local/bin/uv /usr/bin/uv; do
    [[ -x "$c" ]] && { UV="$c"; return 0; }
  done
  return 1
}

install_tools() {
  step "2/5 检查并安装缺失的工具"

  local missing=()
  have curl || missing+=(curl)
  have ss || have netstat || have lsof || missing+=(iproute2)

  if find_python; then
    log "依赖" "Python：$PYTHON（$("$PYTHON" -V 2>&1)）"
    # Debian/Ubuntu 把 venv 拆成独立包，缺了会报 ensurepip is not available
    if [[ "$PKG" == "apt" ]] && ! "$PYTHON" -c 'import ensurepip' >/dev/null 2>&1; then
      missing+=(python3-venv)
    fi
  else
    warn "依赖" "没有找到 Python 3.11+，将尝试用包管理器安装"
    case "$PKG" in
      apt) missing+=(python3 python3-venv python3-pip) ;;
      dnf|yum) missing+=(python3 python3-pip) ;;
      apk) missing+=(python3 py3-pip) ;;
      pacman) missing+=(python3) ;;
      *) missing+=(python3) ;;
    esac
  fi

  if (( ${#missing[@]} )); then
    log "依赖" "需要安装：${missing[*]}"
    ensure_root
    pkg_install "${missing[@]}" || warn "依赖" "自动安装未成功，请手工安装后重跑本脚本"
  else
    log "依赖" "系统自带工具齐全（curl / 端口查询 / Python）"
  fi

  find_python || die "仍然没有可用的 Python 3.11+，请手工安装 python3 后重跑"
  log "依赖" "使用 Python：$PYTHON（$("$PYTHON" -V 2>&1)）"

  if ensure_uv; then
    log "依赖" "uv：$UV"
  elif install_uv; then
    log "依赖" "uv 安装完成：$UV"
  else
    warn "依赖" "uv 不可用，改用 python3 -m venv + pip 安装依赖（较慢，但能跑）"
  fi
}

# ---------------------------------------------------------------- 3. 运行环境
build_venv() {
  step "3/5 准备运行环境（虚拟环境 + 依赖）"
  [[ -f "$BACKEND/requirements.txt" ]] || die "找不到 $BACKEND/requirements.txt，项目目录可能不完整"

  # 已有可用的虚拟环境就直接复用。注意 `uv venv` 在目录已存在时会报错退出
  # （需要 --clear），不判断的话「重跑 install」会卡在这一步。
  if [[ -x "$VENV/bin/python" ]] && "$VENV/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
    log "依赖" "复用已有的虚拟环境：$VENV（$("$VENV/bin/python" -V 2>&1)）"
  elif [[ -n "$UV" ]]; then
    # uv 在系统 Python 太旧时会自己拉一个 3.12，省掉 deadsnakes 那套折腾
    "$UV" venv "$VENV" --clear --python 3.12 >/dev/null 2>&1 \
      || "$UV" venv "$VENV" --clear --python "$PYTHON" >/dev/null 2>&1 \
      || die "创建虚拟环境失败：$VENV"
    log "依赖" "虚拟环境就绪：$VENV（$("$VENV/bin/python" -V 2>&1)）"
  else
    "$PYTHON" -m venv "$VENV" || die "创建虚拟环境失败：$VENV"
    log "依赖" "虚拟环境就绪：$VENV（$("$VENV/bin/python" -V 2>&1)）"
  fi

  # 每次都跑一遍安装：依赖已满足时 uv / pip 会很快返回，等于顺带做了一次校验
  if [[ -n "$UV" ]]; then
    "$UV" pip install --python "$VENV/bin/python" -r "$BACKEND/requirements.txt" >/dev/null 2>&1 \
      || die "后端依赖安装失败，请检查网络后重跑（或手工执行 uv pip install -r backend/requirements.txt）"
    log "依赖" "后端依赖安装完成（uv）"
  else
    "$VENV/bin/python" -m pip install -q --upgrade pip >/dev/null 2>&1 || true
    "$VENV/bin/python" -m pip install -q -r "$BACKEND/requirements.txt" \
      || die "后端依赖安装失败，请检查网络后重跑"
    log "依赖" "后端依赖安装完成（pip）"
  fi

  "$VENV/bin/python" -c 'import fastapi, uvicorn, httpx' \
    || die "依赖不完整（fastapi / uvicorn / httpx 缺失），请重跑或手工 pip install -r backend/requirements.txt"
  log "依赖" "依赖自检通过（fastapi / uvicorn / httpx）"

  if [[ -f "$BACKEND/.env" ]]; then
    log "依赖" "沿用已有的 backend/.env"
  else
    cp "$BACKEND/.env.example" "$BACKEND/.env"
    log "依赖" "已按 backend/.env.example 生成本机配置 backend/.env"
  fi
}

# ---------------------------------------------------------------- 4. 系统服务
write_service_unit() {
  $SUDO tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=ByCanvas —— AI 对话 / 生图 / 视频生成（${SITE_URL}）
Documentation=${SITE_URL}
After=network-online.target
Wants=network-online.target
# 不因「重启太频繁」被 systemd 熔断，保证进程挂了总有人拉起来
StartLimitIntervalSec=0

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${BACKEND}
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart="${VENV}/bin/python" "${BACKEND}/serve.py" ${PORT} ${BIND}
Restart=always
RestartSec=5
TimeoutStopSec=20
KillMode=mixed
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF
}

install_service() {
  ensure_root
  write_service_unit
  log "服务" "已写入单元文件：$SERVICE_FILE"
  $SUDO systemctl daemon-reload || die "systemctl daemon-reload 失败"
  if $SUDO systemctl enable "$SERVICE_NAME" >/dev/null 2>&1; then
    log "服务" "已设置开机自启（systemctl enable）"
  else
    warn "服务" "设置开机自启失败，可稍后手工执行：systemctl enable $SERVICE_NAME"
  fi
  $SUDO systemctl restart "$SERVICE_NAME" \
    || die "启动服务失败，看日志：$SUDO journalctl -u $SERVICE_NAME -n 50 --no-pager"
  log "服务" "服务已启动：失败自动重启（Restart=always，间隔 5 秒）"
}

start_nohup() {
  mkdir -p "$STATE_DIR"
  stop_nohup >/dev/null 2>&1 || true
  nohup "$VENV/bin/python" "$BACKEND/serve.py" "$PORT" "$BIND" >>"$NOUP_LOG" 2>&1 &
  echo $! >"$PID_FILE"
  log "服务" "已后台启动（PID $(cat "$PID_FILE")），日志：$NOUP_LOG"
  warn "服务" "后台常驻模式不会开机自启、也不会失败自启；装上 systemd 后重跑本脚本即可升级"
}

stop_nohup() {
  [[ -f "$PID_FILE" ]] || return 0
  local pid; pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    local i
    for i in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -9 "$pid" 2>/dev/null || true
    log "服务" "已停止后台进程（PID $pid）"
  fi
  rm -f "$PID_FILE"
}

stop_current() {
  case "$(service_mode)" in
    systemd)
      ensure_root
      $SUDO systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
      log "服务" "已停止旧的系统服务，准备重新部署" ;;
    nohup) stop_nohup || true ;;
  esac
}

remove_service() {
  [[ -f "$SERVICE_FILE" ]] || return 0
  ensure_root
  $SUDO systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
  $SUDO rm -f "$SERVICE_FILE"
  $SUDO systemctl daemon-reload
  log "服务" "已移除系统服务 $SERVICE_NAME"
}

# ---------------------------------------------------------------- 5. 验证与输出
# 起服务后必须自己验一遍：systemd 说 active 不等于页面能打开，
# 端口冲突、依赖装坏、前端目录缺失都可能「进程在跑但服务不可用」。
wait_healthy() {
  local url="http://127.0.0.1:${PORT}/api/healthz" waited=0
  have curl || { warn "启动" "没有 curl，跳过健康检查"; return 1; }
  while (( waited < 30 )); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      log "启动" "健康检查通过：$url"
      return 0
    fi
    sleep 1; waited=$((waited + 1))
  done
  warn "启动" "等待 30 秒仍未通过健康检查（$url），请看下面的日志"
  return 1
}

print_logs() {
  step "5/5 相关日志"
  if [[ "$(service_mode)" == "systemd" ]]; then
    log "启动" "后端日志（journalctl -u $SERVICE_NAME -n 40）"
    $SUDO journalctl -u "$SERVICE_NAME" -n 40 --no-pager 2>/dev/null | sed 's/^/    /' || true
    printf '\n%s  持续查看：sudo journalctl -u %s -f%s\n' "$C_DIM" "$SERVICE_NAME" "$C_RESET"
    printf '%s  只看某条链路：sudo journalctl -u %s -f | grep "\\[视频\\]"%s\n' "$C_DIM" "$SERVICE_NAME" "$C_RESET"
    printf '%s  只看问题行：  sudo journalctl -u %s -f | grep -E "\\[WARN|\\[ERROR"%s\n' "$C_DIM" "$SERVICE_NAME" "$C_RESET"
  else
    log "启动" "后端日志（$NOUP_LOG 末尾 40 行）"
    if [[ -f "$NOUP_LOG" ]]; then tail -n 40 "$NOUP_LOG" | sed 's/^/    /'; else warn "启动" "还没有日志文件"; fi
    printf '\n%s  持续查看：tail -f %s%s\n' "$C_DIM" "$NOUP_LOG" "$C_RESET"
  fi
  log "启动" "本次部署日志：$SCRIPT_LOG"
}

detect_ips() {
  if have hostname; then
    LAN_IPS="$(hostname -I 2>/dev/null | tr ' ' '\n' | awk 'NF && !/^127\./ && !/^::1$/ { print; if (++n == 3) exit }' || true)"
  fi
  if [[ -z "$LAN_IPS" ]] && have ip; then
    LAN_IPS="$(ip -4 -o addr show scope global 2>/dev/null | awk '{ print $4 }' | cut -d/ -f1 | awk 'NF { print; if (++n == 3) exit }' || true)"
  fi
  PUBLIC_IP=""
  if have curl; then
    PUBLIC_IP="$(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || true)"
    [[ "$PUBLIC_IP" =~ ^[0-9a-fA-F.:]+$ ]] || PUBLIC_IP=""
  fi
}

print_access() {
  detect_ips
  printf '\n%s────────────────────────────────────────────────────────────%s\n' "$C_GREEN" "$C_RESET"
  printf '%s  ByCanvas 已就绪%s\n' "$C_GREEN" "$C_RESET"
  printf '%s────────────────────────────────────────────────────────────%s\n' "$C_GREEN" "$C_RESET"
  log "访问" "监听：$BIND（$(bind_desc)），端口：$PORT"
  [[ -n "$PUBLIC_IP" ]] && log "访问" "对外地址：http://${PUBLIC_IP}:${PORT}"
  local ip
  for ip in $LAN_IPS; do log "访问" "本机地址：http://${ip}:${PORT}"; done
  log "访问" "本机回环：http://127.0.0.1:${PORT}"
  printf '\n  用浏览器打开上面的地址即可使用。\n'
  printf '  打不开时先确认云服务器安全组 / 防火墙已放行 TCP %s：\n' "$PORT"
  printf '    %sufw allow %s/tcp%s\n' "$C_DIM" "$PORT" "$C_RESET"
  printf '    %sfirewall-cmd --add-port=%s/tcp --permanent && firewall-cmd --reload%s\n' "$C_DIM" "$PORT" "$C_RESET"
  printf '  在线体验：%s\n\n' "$SITE_URL"
}

# ---------------------------------------------------------------- 子命令
cmd_install() {
  load_conf
  # 重新部署时先停掉自己，否则端口检查会把旧实例算成「端口被占」
  stop_current

  check_environment
  install_tools
  check_port
  build_venv

  step "4/5 系统服务"
  if (( NO_SERVICE )); then
    log "服务" "--no-service：跳过系统服务，改用后台常驻"
    MODE=nohup
  elif (( ! HAS_SYSTEMD )); then
    warn "服务" "本机没有 systemd，只能后台常驻（不随开机自启）"
    MODE=nohup
  elif ! can_root; then
    warn "服务" "当前用户既不是 root 也没有 sudo，装不了系统服务，改用后台常驻"
    MODE=nohup
  elif ask_yes_no "是否创建系统服务（开机自启 / 失败自启 / 后台常驻）？" y; then
    RUN_USER="${RUN_USER:-$(is_root && echo root || id -un)}"
    log "服务" "运行用户：$RUN_USER"
    # 以非 root 身份运行时，venv 与前端目录必须对该用户可读可执行
    chmod -R a+rX "$VENV" 2>/dev/null || true
    chmod a+rX "$ROOT" "$BACKEND" "$FRONTEND" 2>/dev/null || true
    install_service
    MODE=systemd
  else
    log "服务" "按你的选择不创建系统服务，改用后台常驻"
    MODE=nohup
  fi

  save_conf
  [[ "$MODE" == "nohup" ]] && start_nohup

  wait_healthy || true
  print_logs
  print_access
}

cmd_start() {
  load_conf
  case "$(service_mode)" in
    systemd)
      ensure_root
      $SUDO systemctl start "$SERVICE_NAME" \
        || die "启动失败，看日志：$SUDO journalctl -u $SERVICE_NAME -n 50 --no-pager"
      log "服务" "已启动 $SERVICE_NAME" ;;
    nohup)   start_nohup ;;
    *)       die "还没有部署过。先执行：bash ByCanvas.sh install" ;;
  esac
  wait_healthy || true
  print_access
}

cmd_stop() {
  load_conf
  case "$(service_mode)" in
    systemd) ensure_root; $SUDO systemctl stop "$SERVICE_NAME"; log "服务" "已停止 $SERVICE_NAME" ;;
    nohup)   stop_nohup ;;
    *)       warn "服务" "没有找到已部署的服务" ;;
  esac
}

cmd_restart() {
  load_conf
  case "$(service_mode)" in
    systemd)
      ensure_root
      $SUDO systemctl restart "$SERVICE_NAME" \
        || die "重启失败，看日志：$SUDO journalctl -u $SERVICE_NAME -n 50 --no-pager"
      log "服务" "已重启 $SERVICE_NAME" ;;
    nohup)   start_nohup ;;
    *)       die "还没有部署过。先执行：bash ByCanvas.sh install" ;;
  esac
  wait_healthy || true
  print_access
}

cmd_status() {
  load_conf
  step "ByCanvas 运行状态"
  log "服务" "部署模式：$(service_mode)"
  log "服务" "监听：$BIND（$(bind_desc)），端口：$PORT"
  log "服务" "项目目录：$ROOT"
  case "$(service_mode)" in
    systemd) $SUDO systemctl status "$SERVICE_NAME" --no-pager -n 0 2>/dev/null | sed 's/^/    /' || true ;;
    nohup)
      if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
        log "服务" "后台进程在跑，PID $(cat "$PID_FILE")"
      else
        warn "服务" "后台进程没在跑"
      fi ;;
    *) warn "服务" "没有找到已部署的服务" ;;
  esac
  if have curl && curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/api/healthz" >/dev/null 2>&1; then
    log "服务" "健康检查通过"
  else
    warn "服务" "健康检查未通过"
  fi
}

cmd_logs() { load_conf; print_logs; }

cmd_doctor() {
  step "ByCanvas 环境体检（只读，不改动系统）"
  check_environment
  if find_python; then log "依赖" "Python：$PYTHON（$("$PYTHON" -V 2>&1)）"; else warn "依赖" "缺少 Python 3.11+"; fi
  if ensure_uv; then log "依赖" "uv：$UV"; else warn "依赖" "未安装 uv（install 时会自动安装）"; fi
  if [[ -x "$VENV/bin/python" ]]; then
    log "依赖" "虚拟环境：$VENV（已就绪）"
    "$VENV/bin/python" -c 'import fastapi, uvicorn, httpx' 2>/dev/null \
      && log "依赖" "后端依赖完整" || warn "依赖" "后端依赖不完整，重跑 install 即可"
  else
    warn "依赖" "虚拟环境尚未创建"
  fi
  log "依赖" "部署模式：$(service_mode)"
  have curl && log "环境" "curl：$(curl --version 2>/dev/null | head -1)" || warn "环境" "缺少 curl"
  detect_ips
  [[ -n "$PUBLIC_IP" ]] && log "环境" "出口公网 IP：$PUBLIC_IP" || warn "环境" "拿不到出口公网 IP（离线或禁止出网）"
  check_port 0
  log "环境" "体检完成"
}

cmd_uninstall() {
  load_conf
  remove_service
  stop_nohup || true
  log "服务" "服务已停止；项目文件与虚拟环境保留在：$ROOT"
  printf '%s  如需彻底清理：rm -rf %s%s\n' "$C_DIM" "$ROOT" "$C_RESET"
}

# ---------------------------------------------------------------- 入口
# 被 `source` 进来时不执行主流程：单测要单独调用里面的函数（比如生成 systemd 单元）。
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  parse_args "$@"
  mkdir -p "$STATE_DIR"

  case "$ACTION" in
    install)   cmd_install ;;
    start)     cmd_start ;;
    stop)      cmd_stop ;;
    restart)   cmd_restart ;;
    status)    cmd_status ;;
    logs)      cmd_logs ;;
    doctor)    cmd_doctor ;;
    uninstall) cmd_uninstall ;;
    *)         die "未知命令：$ACTION" ;;
  esac
fi
