#!/usr/bin/env bash
# Find the next available bosun-N name.
# Checks tmux windows, tmux sessions, AND mesh registry (live PIDs).
# Prints the number to stdout.
#
# Used by tmux keybindings (prefix+n, prefix+N) in config/tmux.conf.
# Requires $BOSUN_ROOT to be set (via tmux global env).

set -euo pipefail

MESH_DIR="${BOSUN_ROOT:-.}/.pi/mesh/registry"

name_taken() {
  local name="bosun-$1"

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
