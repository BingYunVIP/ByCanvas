#!/usr/bin/env bash
# ByChat_IMG deployment manager for Ubuntu/Debian systems using systemd.
set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
STATE_DIR="$PROJECT_DIR/.deploy"
SERVICE="bychat-backend"
UNIT_FILE="/etc/systemd/system/$SERVICE.service"
OS_RELEASE_FILE="/etc/os-release"
SYSTEMD_RUNTIME_DIR="/run/systemd/system"
UV_VERSION="0.12.7"

COMMAND=""
PORT=""
BIND=""
RUN_USER=""
PORT_SET=false
BIND_SET=false
USER_SET=false
ASSUME_YES=false

NEW_RELEASE=""
BACKUP_DIR=""
OLD_CURRENT=""
OLD_PREVIOUS=""
OLD_ACTIVE=false
OLD_ENABLED=false
TRANSACTION=false

info() { printf '==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
ByChat_IMG deployment manager

Usage:
  bash deploy.sh [command] [options]       # from a root shell
  sudo bash deploy.sh [command] [options]  # from a sudo-enabled account

Commands:
  install      First installation or redeployment (default interactive menu)
  update       Build and activate a new release
  status       Show service status
  logs         Follow service logs
  restart      Restart and verify the service
  stop         Stop the service
  start        Start and verify the service
  doctor       Check files, service, port and health endpoint
  rollback     Switch to the previous successful release
  uninstall    Remove the service and .deploy data, preserving source and .env
  help         Show this help

Options:
  --port PORT  Listen port, default 7400
  --host HOST  One of: auto, ::, ::1, 0.0.0.0, 127.0.0.1
  --user USER  Existing Linux account used by the service
  --yes        Skip uninstall confirmation

The project runs from the directory containing deploy.sh. It may be placed in
any readable path, including paths with spaces or non-ASCII characters.
This script does not install or configure a reverse proxy.
EOF
}

menu() {
  [[ -t 0 ]] || die "no command supplied; run 'bash deploy.sh help'"
  cat <<'EOF'
ByChat_IMG deployment manager
  1) Install / update
  2) Status
  3) Logs
  4) Restart
  5) Doctor
  6) Rollback
  7) Uninstall
  0) Exit
EOF
  local choice
  read -r -p "Select: " choice
  case "$choice" in
    1) COMMAND="install" ;;
    2) COMMAND="status" ;;
    3) COMMAND="logs" ;;
    4) COMMAND="restart" ;;
    5) COMMAND="doctor" ;;
    6) COMMAND="rollback" ;;
    7) COMMAND="uninstall" ;;
    0) exit 0 ;;
    *) die "invalid selection" ;;
  esac
}

validate_port() {
  [[ "$1" =~ ^[0-9]{1,5}$ ]] || die "invalid port: $1"
  local value=$((10#$1))
  (( value >= 1 && value <= 65535 )) || die "port must be between 1 and 65535"
}

validate_bind() {
  case "$1" in
    auto|::|::1|0.0.0.0|127.0.0.1) ;;
    *) die "invalid host: $1" ;;
  esac
}

validate_user() {
  [[ "$1" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] || die "invalid Linux user name: $1"
  id "$1" >/dev/null 2>&1 || die "Linux user does not exist: $1"
}

parse_args() {
  if (( $# > 0 )) && [[ "$1" != --* ]]; then
    COMMAND="$1"
    shift
  fi

  while (( $# > 0 )); do
    case "$1" in
      --port)
        (( $# >= 2 )) || die "--port requires a value"
        PORT="$2"; PORT_SET=true; shift 2 ;;
      --host)
        (( $# >= 2 )) || die "--host requires a value"
        BIND="$2"; BIND_SET=true; shift 2 ;;
      --user)
        (( $# >= 2 )) || die "--user requires a value"
        RUN_USER="$2"; USER_SET=true; shift 2 ;;
      --yes) ASSUME_YES=true; shift ;;
      -h|--help) COMMAND="help"; shift ;;
      *) die "unknown option: $1" ;;
    esac
  done

  [[ -n "$COMMAND" ]] || menu
  case "$COMMAND" in
    install|update|status|logs|restart|stop|start|doctor|rollback|uninstall|help) ;;
    *) die "unknown command: $COMMAND" ;;
  esac

  if [[ "$COMMAND" != "install" && "$COMMAND" != "update" ]]; then
    $PORT_SET && die "--port is only valid with install/update"
    $BIND_SET && die "--host is only valid with install/update"
    $USER_SET && die "--user is only valid with install/update"
  fi
  [[ -z "$PORT" ]] || validate_port "$PORT"
  [[ -z "$BIND" ]] || validate_bind "$BIND"
  [[ -z "$RUN_USER" ]] || validate_user "$RUN_USER"
}

check_system() {
  if [[ "$(id -u)" -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
      die "root privileges are required; run: sudo bash deploy.sh $COMMAND"
    fi
    die "root privileges are required; switch to root (for example, 'su - root'), then run: bash deploy.sh $COMMAND"
  fi
  [[ -r "$OS_RELEASE_FILE" ]] || die "cannot read $OS_RELEASE_FILE"

  local ID="" VERSION_ID="" PRETTY_NAME=""
  # shellcheck disable=SC1090
  source "$OS_RELEASE_FILE"
  case "${ID:-}" in
    ubuntu|debian) ;;
    *) die "only Ubuntu and Debian are supported (detected: ${ID:-unknown})" ;;
  esac

  case "$(uname -m)" in
    x86_64|aarch64) ;;
    *) die "unsupported CPU architecture: $(uname -m)" ;;
  esac

  command -v systemctl >/dev/null 2>&1 || die "systemctl is not installed"
  [[ -d "$SYSTEMD_RUNTIME_DIR" ]] || die "systemd is not running as PID 1"
  systemctl show --property=Version --value >/dev/null 2>&1 || die "cannot communicate with systemd"

  if printf '%s' "$PROJECT_DIR" | LC_ALL=C grep -q '[[:cntrl:]]'; then
    die "the project path contains unsupported control characters"
  fi
  info "system: ${PRETTY_NAME:-$ID}, architecture $(uname -m)"
  info "project: $PROJECT_DIR"
}

check_source() {
  local required=(
    backend/serve.py backend/pyproject.toml backend/uv.lock backend/.env.example
    backend/app/main.py frontend/index.html frontend/js/app.js
    frontend/css/app.css frontend/data/model-capabilities.json
  )
  local item
  for item in "${required[@]}"; do
    [[ -f "$PROJECT_DIR/$item" ]] || die "missing project file: $item"
  done
  if find "$PROJECT_DIR/backend/app" "$PROJECT_DIR/frontend/css" "$PROJECT_DIR/frontend/js" \
      "$PROJECT_DIR/frontend/assets" "$PROJECT_DIR/frontend/data" -type l -print -quit | grep -q .; then
    die "production source directories must not contain symbolic links"
  fi
}

check_disk() {
  local free_kb
  free_kb="$(df -Pk "$PROJECT_DIR" | awk 'NR == 2 {print $4}')"
  [[ "$free_kb" =~ ^[0-9]+$ ]] || die "unable to determine free disk space"
  (( free_kb >= 1048576 )) || die "at least 1 GiB of free disk space is required"
}

install_packages() {
  local packages=(ca-certificates curl rsync python3 python3-venv build-essential iproute2 util-linux passwd)
  local missing=() package status
  for package in "${packages[@]}"; do
    status="$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)"
    [[ "$status" == "install ok installed" ]] || missing+=("$package")
  done
  if (( ${#missing[@]} == 0 )); then
    info "system dependencies are already installed"
    return
  fi
  info "installing missing packages: ${missing[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 update
  DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 install -y --no-install-recommends "${missing[@]}"
}

init_state() {
  [[ ! -L "$STATE_DIR" ]] || die "$STATE_DIR must not be a symbolic link"
  if [[ -d "$STATE_DIR" && ! -f "$STATE_DIR/.managed" ]]; then
    [[ -z "$(find "$STATE_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]] || \
      die "$STATE_DIR already exists but is not managed by this script"
  fi
  install -d -m 0755 "$STATE_DIR" "$STATE_DIR/bin" "$STATE_DIR/python" "$STATE_DIR/releases"
  install -d -m 0700 "$STATE_DIR/cache" "$STATE_DIR/backups"
  printf '%s\n' 'bychat-deploy-v1' > "$STATE_DIR/.managed"
  if [[ ! -s "$STATE_DIR/project-id" ]]; then
    if [[ -r /proc/sys/kernel/random/uuid ]]; then
      tr -d '\n' < /proc/sys/kernel/random/uuid > "$STATE_DIR/project-id"
    else
      printf '%s-%s-%s' "$PROJECT_DIR" "$(date +%s%N)" "$$" | sha256sum | awk '{print $1}' > "$STATE_DIR/project-id"
    fi
    printf '\n' >> "$STATE_DIR/project-id"
    chmod 0600 "$STATE_DIR/project-id"
  fi
}

require_state() {
  [[ -f "$STATE_DIR/.managed" && -s "$STATE_DIR/project-id" ]] || \
    die "this project has not been installed; run 'bash deploy.sh install' as root"
}

lock_deployment() {
  exec 9>"$STATE_DIR/deploy.lock"
  flock -n 9 || die "another deployment operation is running"
}

managed_release() {
  local path="$1" real
  [[ -d "$path" && ! -L "$path" && -f "$path/.release" ]] || return 1
  real="$(realpath -e -- "$path" 2>/dev/null)" || return 1
  [[ "$(dirname -- "$real")" == "$(realpath -e -- "$STATE_DIR/releases")" ]]
}

current_release() {
  local current
  [[ -L "$STATE_DIR/current" ]] || return 1
  current="$(realpath -e -- "$STATE_DIR/current" 2>/dev/null)" || return 1
  managed_release "$current" || return 1
  printf '%s\n' "$current"
}

read_release_value() {
  local release="$1" name="$2"
  [[ -f "$release/.$name" ]] || return 1
  IFS= read -r REPLY < "$release/.$name"
  printf '%s\n' "$REPLY"
}

load_options() {
  local release="" saved="" owner
  release="$(current_release 2>/dev/null || true)"

  if ! $PORT_SET; then
    saved="$(read_release_value "$release" port 2>/dev/null || true)"
    PORT="${saved:-7400}"
  fi
  if ! $BIND_SET; then
    saved="$(read_release_value "$release" host 2>/dev/null || true)"
    BIND="${saved:-::}"
  fi
  if ! $USER_SET; then
    saved="$(read_release_value "$release" user 2>/dev/null || true)"
    if [[ -n "$saved" ]]; then
      RUN_USER="$saved"
    else
      owner="$(stat -c '%U' "$PROJECT_DIR")"
      [[ "$owner" != "UNKNOWN" ]] || die "project owner does not map to a Linux account"
      RUN_USER="$owner"
    fi
  fi

  validate_port "$PORT"
  validate_bind "$BIND"
  validate_user "$RUN_USER"
}

unit_fragment() {
  systemctl show "$SERVICE.service" --property=FragmentPath --value 2>/dev/null || true
}

service_exists() {
  local fragment
  fragment="$(unit_fragment)"
  [[ -n "$fragment" && "$fragment" != "/dev/null" && -f "$fragment" ]]
}

assert_service_owned() {
  [[ ! -L "$UNIT_FILE" ]] || die "$UNIT_FILE must not be a symbolic link"
  service_exists || return 0
  local fragment id expected exec_start dropins
  fragment="$(unit_fragment)"
  dropins="$(systemctl show "$SERVICE.service" --property=DropInPaths --value 2>/dev/null || true)"
  [[ -z "$dropins" ]] || die "$SERVICE has systemd drop-ins; remove them before deployment"

  id="$(sed -n 's/^# ByChatProjectId=//p' "$fragment" | head -n 1)"
  expected="$(tr -d '\r\n' < "$STATE_DIR/project-id")"
  if [[ -n "$id" ]]; then
    [[ "$id" == "$expected" ]] || die "$SERVICE belongs to another ByChat_IMG project"
    return 0
  fi

  exec_start="$(systemctl show "$SERVICE.service" --property=ExecStart --value 2>/dev/null || true)"
  [[ "$exec_start" == *"$PROJECT_DIR/backend/serve.py"* ]] || \
    die "$SERVICE already exists and is not owned by this project"
  warn "adopting the legacy service created by tools/install_service.sh"
}

check_port() {
  local rows main_pid line
  rows="$(ss -H -ltnp "sport = :$PORT" 2>/dev/null || true)"
  [[ -z "$rows" ]] && return 0

  main_pid="$(systemctl show "$SERVICE.service" --property=MainPID --value 2>/dev/null || true)"
  [[ "$main_pid" =~ ^[1-9][0-9]*$ ]] || die "port $PORT is already in use"
  while IFS= read -r line; do
    [[ "$line" == *"pid=$main_pid,"* ]] || die "port $PORT is used by a process outside $SERVICE"
  done <<< "$rows"
}

setup_runtime() {
  local uv="$STATE_DIR/bin/uv" installer="$STATE_DIR/uv-installer.sh"
  if [[ ! -x "$uv" ]]; then
    info "installing uv $UV_VERSION into $STATE_DIR/bin"
    curl --fail --show-error --location --retry 3 --connect-timeout 15 --max-time 180 \
      "https://astral.sh/uv/$UV_VERSION/install.sh" -o "$installer"
    UV_UNMANAGED_INSTALL="$STATE_DIR/bin" sh "$installer"
    rm -f -- "$installer"
  fi
  "$uv" --version | grep -Fq "uv $UV_VERSION" || \
    die "unexpected uv version in $uv (expected $UV_VERSION)"

  info "ensuring managed Python 3.12 is available"
  UV_CACHE_DIR="$STATE_DIR/cache/uv" UV_PYTHON_INSTALL_DIR="$STATE_DIR/python" \
    "$uv" python install 3.12 --managed-python --no-bin
  chmod -R a+rX "$STATE_DIR/python"
}

setup_config() {
  local config="$PROJECT_DIR/backend/.env" group
  if [[ ! -e "$config" ]]; then
    group="$(id -gn "$RUN_USER")"
    install -m 0600 -o "$RUN_USER" -g "$group" "$PROJECT_DIR/backend/.env.example" "$config"
    info "created $config from .env.example"
  fi
  [[ -f "$config" && ! -L "$config" ]] || die "backend/.env must be a regular file"
  runuser -u "$RUN_USER" -- test -r "$config" || \
    die "$RUN_USER cannot read $config; fix directory/file permissions or choose another --user"
}

run_as_service_user() {
  if [[ "$RUN_USER" == "root" ]]; then
    "$@"
  else
    runuser -u "$RUN_USER" -- "$@"
  fi
}

preflight_release() {
  local release="$1" python
  python="$release/backend/.venv/bin/python"
  [[ -x "$python" ]] || die "release Python is missing: $python"
  run_as_service_user env -u PYTHONPATH -u VIRTUAL_ENV \
    PYTHONDONTWRITEBYTECODE=1 FRONTEND_DIR="$release/frontend" \
    "$python" -c '
import sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root / "backend"))
from app.config import settings
from app.main import app
from app.model_capabilities import CATALOG
assert settings.frontend_path == root / "frontend"
assert (settings.frontend_path / "index.html").is_file()
assert (settings.frontend_path / "js" / "app.js").is_file()
assert CATALOG
assert any(getattr(route, "path", None) == "/api/healthz" for route in app.routes)
' "$release" || die "release import/static-file preflight failed"
}

prepare_release() {
  local name release uv
  name="$(date -u +%Y%m%dT%H%M%S)-$(date +%N)-$$"
  release="$STATE_DIR/releases/$name"
  uv="$STATE_DIR/bin/uv"
  NEW_RELEASE="$release"

  info "building release $name"
  install -d -m 0755 "$release/backend/app" "$release/frontend"
  printf '%s\n' "$name" > "$release/.release"

  rsync -a --exclude='__pycache__/' --exclude='*.py[co]' \
    "$PROJECT_DIR/backend/app/" "$release/backend/app/"
  install -m 0644 "$PROJECT_DIR/backend/serve.py" "$release/backend/serve.py"
  install -m 0644 "$PROJECT_DIR/backend/pyproject.toml" "$release/backend/pyproject.toml"
  install -m 0644 "$PROJECT_DIR/backend/uv.lock" "$release/backend/uv.lock"
  install -m 0644 "$PROJECT_DIR/backend/.env.example" "$release/backend/.env.example"
  install -m 0644 "$PROJECT_DIR/frontend/index.html" "$release/frontend/index.html"
  rsync -a "$PROJECT_DIR/frontend/css" "$PROJECT_DIR/frontend/js" \
    "$PROJECT_DIR/frontend/assets" "$PROJECT_DIR/frontend/data" "$release/frontend/"

  UV_CACHE_DIR="$STATE_DIR/cache/uv" \
  UV_PYTHON_INSTALL_DIR="$STATE_DIR/python" \
  UV_PROJECT_ENVIRONMENT="$release/backend/.venv" \
    env -u VIRTUAL_ENV -u PYTHONPATH "$uv" sync \
      --project "$release/backend" --frozen --no-dev --no-install-project \
      --python 3.12 --managed-python

  chmod -R a+rX "$release"
  ln -s "$PROJECT_DIR/backend/.env" "$release/backend/.env"
  printf '%s\n' "$PORT" > "$release/.port"
  printf '%s\n' "$BIND" > "$release/.host"
  printf '%s\n' "$RUN_USER" > "$release/.user"
  printf '%s\n' "$PROJECT_DIR" > "$release/.project"
  preflight_release "$release"
}

systemd_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//%/%%}"
  printf '"%s"' "$value"
}

systemd_path() {
  local value="$1" output="" character index
  for ((index = 0; index < ${#value}; index++)); do
    character="${value:index:1}"
    case "$character" in
      ' ') output+='\x20' ;;
      \\) output+='\x5c' ;;
      '"') output+='\x22' ;;
      "'") output+='\x27' ;;
      '%') output+='%%' ;;
      *) output+="$character" ;;
    esac
  done
  printf '%s' "$output"
}

write_unit() {
  local release="$1" output="$2" project_id group work python script frontend
  project_id="$(tr -d '\r\n' < "$STATE_DIR/project-id")"
  group="$(id -gn "$RUN_USER")"
  work="$(systemd_path "$release/backend")"
  python="$(systemd_quote "$release/backend/.venv/bin/python")"
  script="$(systemd_quote "$release/backend/serve.py")"
  frontend="$(systemd_quote "FRONTEND_DIR=$release/frontend")"

  {
    printf '# Managed by ByChat_IMG deploy.sh\n'
    printf '# ByChatProjectId=%s\n' "$project_id"
    printf '[Unit]\n'
    printf 'Description=ByChat_IMG backend\n'
    printf 'After=network-online.target\n'
    printf 'Wants=network-online.target\n'
    printf 'StartLimitIntervalSec=0\n\n'
    printf '[Service]\n'
    printf 'Type=simple\n'
    printf 'User=%s\n' "$RUN_USER"
    printf 'Group=%s\n' "$group"
    printf 'WorkingDirectory=%s\n' "$work"
    printf 'ExecStart=:%s %s %s %s\n' "$python" "$script" "$PORT" "$(systemd_quote "$BIND")"
    printf 'Environment=PYTHONUNBUFFERED=1\n'
    printf 'Environment=PYTHONDONTWRITEBYTECODE=1\n'
    printf 'Environment=%s\n' "$frontend"
    printf 'Restart=always\n'
    printf 'RestartSec=5\n'
    printf 'TimeoutStopSec=310\n'
    printf 'KillMode=mixed\n'
    printf 'NoNewPrivileges=true\n'
    printf 'ProtectSystem=full\n'
    printf 'RestrictSUIDSGID=true\n'
    printf 'UMask=0027\n'
    printf 'LimitNOFILE=65536\n'
    printf 'StandardOutput=journal\n'
    printf 'StandardError=journal\n\n'
    printf '[Install]\n'
    printf 'WantedBy=multi-user.target\n'
  } > "$output"
}

set_link() {
  local name="$1" target="$2" temp
  temp="$STATE_DIR/.${name}.$$"
  rm -f -- "$temp"
  ln -s "$target" "$temp"
  mv -Tf -- "$temp" "$STATE_DIR/$name"
}

remove_link() {
  local name="$1"
  [[ ! -e "$STATE_DIR/$name" && ! -L "$STATE_DIR/$name" ]] || rm -f -- "$STATE_DIR/$name"
}

backup_service() {
  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%S)-$(date +%N)"
  BACKUP_DIR="$STATE_DIR/backups/$stamp"
  install -d -m 0700 "$BACKUP_DIR"
  [[ ! -e "$UNIT_FILE" ]] || cp -a -- "$UNIT_FILE" "$BACKUP_DIR/unit.service"
  OLD_CURRENT="$(readlink "$STATE_DIR/current" 2>/dev/null || true)"
  OLD_PREVIOUS="$(readlink "$STATE_DIR/previous" 2>/dev/null || true)"
  systemctl is-active --quiet "$SERVICE.service" && OLD_ACTIVE=true || OLD_ACTIVE=false
  systemctl is-enabled --quiet "$SERVICE.service" && OLD_ENABLED=true || OLD_ENABLED=false
  printf '%s\n' "$OLD_CURRENT" > "$BACKUP_DIR/current"
  printf '%s\n' "$OLD_PREVIOUS" > "$BACKUP_DIR/previous"
  printf '%s\n' "$OLD_ACTIVE" > "$BACKUP_DIR/active"
  printf '%s\n' "$OLD_ENABLED" > "$BACKUP_DIR/enabled"
  TRANSACTION=true
}

restore_service() {
  warn "activation failed; restoring the previous service"
  systemctl stop "$SERVICE.service" >/dev/null 2>&1 || true
  if [[ -f "$BACKUP_DIR/unit.service" ]]; then
    cp -a -- "$BACKUP_DIR/unit.service" "$UNIT_FILE"
  else
    rm -f -- "$UNIT_FILE"
  fi
  if [[ -n "$OLD_CURRENT" ]]; then set_link current "$OLD_CURRENT"; else remove_link current; fi
  if [[ -n "$OLD_PREVIOUS" ]]; then set_link previous "$OLD_PREVIOUS"; else remove_link previous; fi
  systemctl daemon-reload >/dev/null 2>&1 || true
  if $OLD_ENABLED; then
    systemctl enable "$SERVICE.service" >/dev/null 2>&1 || true
  else
    systemctl disable "$SERVICE.service" >/dev/null 2>&1 || true
  fi
  systemctl reset-failed "$SERVICE.service" >/dev/null 2>&1 || true
  $OLD_ACTIVE && systemctl start "$SERVICE.service" >/dev/null 2>&1 || true
  TRANSACTION=false
  warn "previous files restored; backup: $BACKUP_DIR"
}

health_url() {
  case "$BIND" in
    ::1) printf 'http://[::1]:%s/api/healthz\n' "$PORT" ;;
    *) printf 'http://127.0.0.1:%s/api/healthz\n' "$PORT" ;;
  esac
}

health_once() {
  local body
  systemctl is-active --quiet "$SERVICE.service" || return 1
  body="$(curl --noproxy '*' --fail --silent --show-error \
    --connect-timeout 1 --max-time 3 "$(health_url)" 2>/dev/null)" || return 1
  python3 -c 'import json,sys; data=json.load(sys.stdin); raise SystemExit(0 if data.get("ok") is True else 1)' \
    <<< "$body"
}

wait_healthy() {
  local attempt
  for attempt in $(seq 1 20); do
    if health_once; then
      info "health check passed"
      return 0
    fi
    sleep 1
  done
  systemctl --no-pager -l status "$SERVICE.service" >&2 || true
  journalctl -u "$SERVICE.service" -n 30 --no-pager >&2 || true
  return 1
}

check_assets() {
  local release="$1" base temp path source
  base="$(health_url)"
  base="${base%/api/healthz}"
  temp="$STATE_DIR/asset-check.$$"
  for path in / /css/app.css /js/app.js /assets/logo.png /data/model-capabilities.json; do
    case "$path" in
      /) source="$release/frontend/index.html" ;;
      *) source="$release/frontend$path" ;;
    esac
    curl --noproxy '*' --fail --silent --show-error --connect-timeout 1 --max-time 5 \
      "$base$path" -o "$temp" || { rm -f -- "$temp"; return 1; }
    cmp -s -- "$source" "$temp" || { rm -f -- "$temp"; return 1; }
  done
  rm -f -- "$temp"
  info "static asset check passed"
}

activate_release() {
  local release="$1" staged="$STATE_DIR/$SERVICE.service" old="" target
  managed_release "$release" || die "invalid release: $release"
  target="releases/$(basename -- "$release")"
  old="$(readlink "$STATE_DIR/current" 2>/dev/null || true)"

  write_unit "$release" "$staged"
  systemd-analyze verify "$staged"
  backup_service
  systemctl stop "$SERVICE.service" >/dev/null 2>&1 || true
  [[ -z "$old" ]] || set_link previous "$old"
  set_link current "$target"
  install -m 0644 "$staged" "$UNIT_FILE"
  rm -f -- "$staged"
  systemctl daemon-reload
  systemctl enable "$SERVICE.service" >/dev/null
  systemctl reset-failed "$SERVICE.service" >/dev/null 2>&1 || true
  systemctl restart "$SERVICE.service"
  wait_healthy || die "service did not become healthy"
  check_assets "$release" || die "served static files do not match the active release"
  touch "$release/.success"
  TRANSACTION=false
  NEW_RELEASE=""
  info "active release: $(basename -- "$release")"
  info "site: $(health_url | sed 's#/api/healthz$##')"
}

prune_releases() {
  local current previous name path kept=0
  declare -A preserve=()
  current="$(readlink "$STATE_DIR/current" 2>/dev/null || true)"
  previous="$(readlink "$STATE_DIR/previous" 2>/dev/null || true)"
  if [[ -n "$current" ]]; then
    preserve["$(basename -- "$current")"]=1
    ((kept += 1))
  fi
  if [[ -n "$previous" && "$(basename -- "$previous")" != "$(basename -- "$current")" ]]; then
    preserve["$(basename -- "$previous")"]=1
    ((kept += 1))
  fi

  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    if [[ -n "${preserve[$name]:-}" ]]; then
      continue
    fi
    if (( kept < 3 )); then
      preserve["$name"]=1
      ((kept += 1))
      continue
    fi
    path="$STATE_DIR/releases/$name"
    managed_release "$path" && rm -rf -- "$path"
  done < <(find "$STATE_DIR/releases" -mindepth 1 -maxdepth 1 -type d -name '*T*' -printf '%f\n' | sort -r)
}

deploy_release() {
  check_source
  check_disk
  init_state
  lock_deployment
  assert_service_owned
  if [[ "$COMMAND" == "update" ]]; then
    current_release >/dev/null 2>&1 || die "nothing is installed; use the install command first"
  fi
  install_packages
  load_options
  check_port
  setup_runtime
  setup_config
  prepare_release
  activate_release "$NEW_RELEASE"
  prune_releases
}

require_managed_service() {
  require_state
  current_release >/dev/null 2>&1 || die "the active release is missing"
  assert_service_owned
  service_exists || die "$SERVICE.service is not installed"
  load_options
}

show_status() {
  require_managed_service
  systemctl --no-pager -l status "$SERVICE.service" || true
  printf '\nActive release: %s\n' "$(current_release)"
  printf 'Health URL: %s\n' "$(health_url)"
}

service_action() {
  local action="$1"
  require_managed_service
  lock_deployment
  [[ "$action" == "stop" ]] || check_port
  systemctl "$action" "$SERVICE.service"
  if [[ "$action" == "start" || "$action" == "restart" ]]; then
    wait_healthy || die "service failed its health check after $action"
  fi
}

doctor() {
  check_source
  require_managed_service
  local release failures=0
  release="$(current_release)"
  info "release: $release"
  info "service user: $RUN_USER"
  preflight_release "$release" || failures=1
  runuser -u "$RUN_USER" -- test -r "$PROJECT_DIR/backend/.env" || { warn "configuration is unreadable"; failures=1; }
  systemctl is-enabled --quiet "$SERVICE.service" || { warn "service is not enabled at boot"; failures=1; }
  systemctl is-active --quiet "$SERVICE.service" || { warn "service is not active"; failures=1; }
  [[ -n "$(ss -H -ltnp "sport = :$PORT" 2>/dev/null || true)" ]] || \
    { warn "nothing is listening on port $PORT"; failures=1; }
  health_once || { warn "health endpoint failed: $(health_url)"; failures=1; }
  check_assets "$release" || { warn "static asset verification failed"; failures=1; }
  (( failures == 0 )) || die "doctor found one or more problems"
  info "all checks passed"
}

rollback_release() {
  require_managed_service
  lock_deployment
  local previous project
  [[ -L "$STATE_DIR/previous" ]] || die "no previous release is available"
  previous="$(realpath -e -- "$STATE_DIR/previous" 2>/dev/null)" || die "previous release is missing"
  managed_release "$previous" || die "previous release is invalid"
  [[ -f "$previous/.success" ]] || die "previous release was not marked successful"
  project="$(read_release_value "$previous" project 2>/dev/null || true)"
  [[ "$project" == "$PROJECT_DIR" ]] || \
    die "previous release belongs to the project's old location; install a new release first"
  PORT="$(read_release_value "$previous" port)"
  BIND="$(read_release_value "$previous" host)"
  RUN_USER="$(read_release_value "$previous" user)"
  validate_port "$PORT"; validate_bind "$BIND"; validate_user "$RUN_USER"
  check_port
  preflight_release "$previous"
  activate_release "$previous"
  prune_releases
}

uninstall_service() {
  require_managed_service
  lock_deployment
  if ! $ASSUME_YES; then
    [[ -t 0 ]] || die "uninstall requires --yes in non-interactive mode"
    local answer
    read -r -p "Remove $SERVICE and $STATE_DIR? Source files and backend/.env are preserved. [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || { info "cancelled"; return; }
  fi
  systemctl disable --now "$SERVICE.service" >/dev/null 2>&1 || true
  rm -f -- "$UNIT_FILE"
  systemctl daemon-reload
  systemctl reset-failed "$SERVICE.service" >/dev/null 2>&1 || true
  rm -rf -- "$STATE_DIR"
  info "service and deployment state removed; source files and backend/.env were preserved"
}

on_exit() {
  local code=$?
  trap - EXIT
  set +e
  if $TRANSACTION; then restore_service; fi
  if [[ -n "$NEW_RELEASE" && -d "$NEW_RELEASE" ]]; then
    local active=""
    active="$(realpath -e -- "$STATE_DIR/current" 2>/dev/null || true)"
    [[ "$active" == "$NEW_RELEASE" ]] || rm -rf -- "$NEW_RELEASE"
  fi
  exit "$code"
}

main() {
  parse_args "$@"
  [[ "$COMMAND" != "help" ]] || { usage; return 0; }
  check_system
  trap on_exit EXIT

  case "$COMMAND" in
    install|update) deploy_release ;;
    status) show_status ;;
    logs)
      require_managed_service
      exec journalctl -u "$SERVICE.service" -f --no-pager
      ;;
    restart|stop|start) service_action "$COMMAND" ;;
    doctor) doctor ;;
    rollback) rollback_release ;;
    uninstall) uninstall_service ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
