#!/usr/bin/env bash
# 兼容入口：老部署方式用的是这个脚本名，现在统一由根目录的 ByCanvas.sh 负责。
#
# 保留原来的位置参数写法，方便老的运维脚本不用改：
#   bash tools/install_service.sh              → ByCanvas.sh install
#   bash tools/install_service.sh 8000         → ByCanvas.sh install --port 8000
#   bash tools/install_service.sh 8000 0.0.0.0 → ByCanvas.sh install --port 8000 --host 0.0.0.0
#   bash tools/install_service.sh status       → ByCanvas.sh status
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"

if (( $# == 0 )); then
  exec bash "$ROOT/ByCanvas.sh" install
elif [[ "$1" =~ ^[0-9]+$ ]]; then
  (( $# <= 2 )) || { echo "usage: $0 [port] [host]" >&2; exit 2; }
  args=(install --port "$1")
  [[ -z "${2:-}" ]] || args+=(--host "$2")
  exec bash "$ROOT/ByCanvas.sh" "${args[@]}"
else
  exec bash "$ROOT/ByCanvas.sh" "$@"
fi
