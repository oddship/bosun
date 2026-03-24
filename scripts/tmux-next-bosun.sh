#!/usr/bin/env bash
# Find the next available <prefix>-N name.
# Checks tmux windows, tmux sessions, AND mesh registry (live PIDs).
# Prints the number to stdout.
#
# Usage: tmux-next-bosun.sh [prefix]
#   prefix defaults to the current tmux session name, or "bosun" if not in tmux.
#
# Used by tmux keybindings (prefix+n, prefix+N) in config/tmux.conf.
# Requires $BOSUN_ROOT to be set (via tmux global env).

set -euo pipefail

# Determine the agent/session prefix:
# 1. Explicit argument
# 2. Current tmux session name
# 3. Fallback to "bosun"
if [ -n "${1:-}" ]; then
  PREFIX="$1"
elif [ -n "${TMUX:-}" ]; then
  PREFIX=$(tmux display-message -p '#{session_name}' 2>/dev/null || echo "bosun")
else
  PREFIX="bosun"
fi

MESH_DIR="${BOSUN_ROOT:-.}/.pi/mesh/registry"

name_taken() {
  local name="${PREFIX}-$1"  # uses $PREFIX from outer scope

  # Check all tmux windows and sessions
  tmux list-windows -a -F '#W' 2>/dev/null | grep -q "^${name}$" && return 0
  tmux list-sessions -F '#S' 2>/dev/null | grep -q "^${name}$" && return 0

  # Check mesh registry for live process
  local reg="$MESH_DIR/${name}.json"
  if [ -f "$reg" ]; then
    local pid
    pid=$(grep -o '"pid": *[0-9]*' "$reg" | grep -o '[0-9]*') 2>/dev/null
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && return 0
  fi

  return 1
}

NUM=2
while name_taken "$NUM"; do
  NUM=$((NUM + 1))
done

echo "$NUM"
