#!/usr/bin/env bash
# Shared helpers for bosun tmux management.
# Source this file — requires BOSUN_ROOT and TMUX_CMD to be set.
#
# Usage:
#   BOSUN_ROOT=/path/to/bosun
#   TMUX_SOCK=$(bash "$BOSUN_ROOT/scripts/tmux-socket.sh" "$BOSUN_ROOT")
#   TMUX_CMD="tmux -S $TMUX_SOCK"
#   source scripts/tmux-helpers.sh

# List bosun sessions (excludes bosun-daemon), one per line.
# Returns empty string if none running.
bosun_sessions() {
  $TMUX_CMD list-sessions -F '#{session_name}' 2>/dev/null \
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
# Optional: BOSUN_DEFAULT_AGENT — override the agent used by prefix+n/N keybindings.
# Defaults to "bosun" if not set. Downstream projects should set this to their orchestrator name.
set_tmux_env() {
  $TMUX_CMD set-environment -g BOSUN_ROOT "$BOSUN_ROOT"
  $TMUX_CMD set-environment -g BOSUN_PI_PATH "$(command -v pi)"
  $TMUX_CMD set-environment -g BOSUN_BUN_PATH "$(command -v bun)"
  $TMUX_CMD set-environment -g BOSUN_BWRAP_PATH "$(command -v bwrap)"
  # Set default agent for prefix+n/N keybindings if provided by caller
  if [[ -n "${BOSUN_DEFAULT_AGENT:-}" ]]; then
    $TMUX_CMD set-environment -g BOSUN_DEFAULT_AGENT "$BOSUN_DEFAULT_AGENT"
  fi
}

# Ensure workspace directories exist.
ensure_dirs() {
  mkdir -p "$BOSUN_ROOT/.bosun-home" "$BOSUN_ROOT/workspace"
}
