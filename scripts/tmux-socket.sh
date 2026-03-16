#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-${BOSUN_ROOT:-$PWD}}"
UID_NUM=$(id -u)
RUNTIME_BASE="${BOSUN_TMUX_DIR:-${XDG_RUNTIME_DIR:-/run/user/$UID_NUM}/bosun-tmux}"
HASH=$(printf '%s' "$ROOT" | sha1sum | cut -c1-12)
mkdir -p "$RUNTIME_BASE"
printf '%s/bosun-%s.sock\n' "$RUNTIME_BASE" "$HASH"
