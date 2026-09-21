#!/usr/bin/env bash
# Compatibility entry point. New deployments are managed by ../deploy.sh.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"

# Preserve the old positional form: install_service.sh [port] [host].
if (( $# == 0 )); then
  exec bash "$ROOT/deploy.sh" install
elif [[ "$1" =~ ^[0-9]+$ ]]; then
  (( $# <= 2 )) || { echo "usage: $0 [port] [host]" >&2; exit 2; }
  args=(install --port "$1")
  [[ -z "${2:-}" ]] || args+=(--host "$2")
  exec bash "$ROOT/deploy.sh" "${args[@]}"
else
  exec bash "$ROOT/deploy.sh" "$@"
fi
