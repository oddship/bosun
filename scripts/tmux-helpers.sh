#!/usr/bin/env bash
# Shared helpers for bosun tmux management.
# Source this file — requires BOSUN_ROOT and TMUX_CMD to be set.
#
# Usage:
#   BOSUN_ROOT=/path/to/bosun
#   TMUX_CMD="tmux -S $BOSUN_ROOT/.bosun-home/tmux.sock"
#   source scripts/tmux-helpers.sh

# List bosun sessions (excludes bosun-daemon), one per line.
# Returns empty string if none running.
bosun_sessions() {
  $TMUX_CMD list-sessions -F '#{session_name}' 2>/dev/null \
    | grep '^bosun' \
    | grep -v '^bosun-daemon$' \
    || true
}

# Exit with message if already inside bosun's tmux.
check_inside_tmux() {
  if [[ -n "${TMUX:-}" ]] && [[ "$TMUX" == *bosun* ]]; then
    echo ""
    echo "Already inside Bosun's tmux."
    echo ""
    echo "  Ctrl+A s      - Switch session"
    echo "  Ctrl+A w      - List windows"
    exit 0
  fi
}

# Set standard tmux global environment variables for bosun.
set_tmux_env() {
  $TMUX_CMD set-environment -g BOSUN_ROOT "$BOSUN_ROOT"
  $TMUX_CMD set-environment -g BOSUN_PI_PATH "$(command -v pi)"
  $TMUX_CMD set-environment -g BOSUN_BUN_PATH "$(command -v bun)"
  $TMUX_CMD set-environment -g BOSUN_BWRAP_PATH "$(command -v bwrap)"
}

# Ensure workspace directories exist.
ensure_dirs() {
  mkdir -p "$BOSUN_ROOT/.bosun-home" "$BOSUN_ROOT/workspace"
}
