#!/usr/bin/env bash
# Bosun process-level sandbox using bubblewrap (bwrap).
#
# Wraps a single command (typically `pi` or `bun`) in a bwrap sandbox:
#   - Fakes HOME to .bosun-home/
#   - Restricts filesystem access
#   - Filters environment variables via .pi/bwrap.json allowlist
#   - Passes through tmux socket for agent spawning
#
# Usage:
#   scripts/sandbox.sh pi                          # main agent
#   scripts/sandbox.sh bun packages/pi-daemon/src/index.ts  # daemon

set -euo pipefail

# --- Find BOSUN_ROOT ---
find_bosun_root() {
  local dir="$PWD"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/.bosun-root" ]]; then
      echo "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

BOSUN_ROOT=$(find_bosun_root) || {
  echo "Error: Could not find .bosun-root marker file."
  echo "Are you inside the bosun repository?"
  exit 1
}

# --- Resolve tool paths from tmux env (if in tmux and not already set) ---
if [[ -n "${TMUX:-}" ]] && command -v tmux &>/dev/null; then
  TMUX_SOCK="${TMUX%%,*}"
  for VAR in BOSUN_PI_PATH BOSUN_BUN_PATH BOSUN_BWRAP_PATH; do
    if [[ -z "${!VAR:-}" ]]; then
      VAL=$(tmux -S "$TMUX_SOCK" show-environment -g "$VAR" 2>/dev/null | cut -d= -f2- || true)
      if [[ -n "$VAL" ]]; then
        export "$VAR=$VAL"
      fi
    fi
  done
fi

# --- Setup .bosun-home ---
mkdir -p "$BOSUN_ROOT/.bosun-home"

# Symlink SSH (idempotent)
if [[ -d "$HOME/.ssh" ]] && [[ ! -L "$BOSUN_ROOT/.bosun-home/.ssh" ]]; then
  ln -sf "$HOME/.ssh" "$BOSUN_ROOT/.bosun-home/.ssh"
fi

# Build .gitconfig by merging host config with any bosun-specific config
SANDBOX_GITCONFIG="$BOSUN_ROOT/.bosun-home/.gitconfig"
rm -f "$SANDBOX_GITCONFIG"
touch "$SANDBOX_GITCONFIG"

if [[ -f "$HOME/.gitconfig" ]]; then
  cat "$HOME/.gitconfig" >> "$SANDBOX_GITCONFIG"
  echo "" >> "$SANDBOX_GITCONFIG"
elif [[ -f "$HOME/.config/git/config" ]]; then
  cat "$HOME/.config/git/config" >> "$SANDBOX_GITCONFIG"
  echo "" >> "$SANDBOX_GITCONFIG"
fi

# Symlink tmux config
if [[ -f "$BOSUN_ROOT/config/tmux.conf" ]] && [[ ! -L "$BOSUN_ROOT/.bosun-home/.tmux.conf" ]]; then
  ln -sf "$BOSUN_ROOT/config/tmux.conf" "$BOSUN_ROOT/.bosun-home/.tmux.conf"
fi

# --- Read bwrap.json config ---
BWRAP_CONFIG="$BOSUN_ROOT/.pi/bwrap.json"

# Parse env_allow from bwrap.json (or default allowlist)
ENV_ARGS=""
if [[ -f "$BWRAP_CONFIG" ]] && command -v jq &>/dev/null; then
  while IFS= read -r var; do
    if [[ -n "$var" ]] && [[ -n "${!var:-}" ]]; then
      ENV_ARGS="$ENV_ARGS --setenv $var ${!var}"
    fi
  done < <(jq -r '.env_allow[]? // empty' "$BWRAP_CONFIG" 2>/dev/null)
else
  # Default allowlist
  for var in ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY OPENROUTER_API_KEY USER LOGNAME TERM COLORTERM LANG TZ; do
    if [[ -n "${!var:-}" ]]; then
      ENV_ARGS="$ENV_ARGS --setenv $var ${!var}"
    fi
  done
fi

# --- Build bind mounts ---
RO_BIND_ARGS=""
for p in /nix /etc/resolv.conf /etc/ssl /etc/pki /etc/static /etc/hosts /etc/localtime /etc/passwd /etc/group /lib /lib64 /run/current-system; do
  if [[ -e "$p" ]]; then
    RO_BIND_ARGS="$RO_BIND_ARGS --ro-bind $p $p"
  fi
done

# Bind user's SSH for symlink target
if [[ -d "$HOME/.ssh" ]]; then
  RO_BIND_ARGS="$RO_BIND_ARGS --ro-bind $HOME/.ssh $HOME/.ssh"
fi

# Bind tmux socket directory
TMUX_BIND=""
_UID=$(id -u)
TMUX_SOCKET_DIR="/run/user/$_UID/tmux-$_UID"
if [[ -d "$TMUX_SOCKET_DIR" ]]; then
  TMUX_BIND="--bind $TMUX_SOCKET_DIR $TMUX_SOCKET_DIR"
fi

# Also bind the bosun tmux socket directory if it exists
if [[ -e "$BOSUN_ROOT/.bosun-home/tmux.sock" ]]; then
  # Socket is inside .bosun-home which is already bound
  :
fi

# Extra ro_bind from bwrap.json
if [[ -f "$BWRAP_CONFIG" ]] && command -v jq &>/dev/null; then
  while IFS= read -r p; do
    if [[ -n "$p" ]] && [[ -e "$p" ]]; then
      RO_BIND_ARGS="$RO_BIND_ARGS --ro-bind $p $p"
    fi
  done < <(jq -r '.ro_bind[]? // empty' "$BWRAP_CONFIG" 2>/dev/null)
fi

# --- Resolve workspace path ---
WORKSPACE="workspace"
if [[ -f "$BWRAP_CONFIG" ]] && command -v jq &>/dev/null; then
  WS=$(jq -r '.workspace // empty' "$BWRAP_CONFIG" 2>/dev/null)
  if [[ -n "$WS" ]]; then
    WORKSPACE="$WS"
  fi
fi

# --- Build PATH ---
# Include nix profile bins + node_modules/.bin
SANDBOX_PATH="$BOSUN_ROOT/node_modules/.bin"
for p in /run/current-system/sw/bin /nix/var/nix/profiles/default/bin /usr/local/bin /usr/bin /bin; do
  if [[ -d "$p" ]]; then
    SANDBOX_PATH="$SANDBOX_PATH:$p"
  fi
done

# Also include nix store paths from current PATH (for tools from nix develop)
IFS=':' read -ra PATH_PARTS <<< "$PATH"
for p in "${PATH_PARTS[@]}"; do
  if [[ "$p" == /nix/store/* ]]; then
    SANDBOX_PATH="$SANDBOX_PATH:$p"
  fi
done

USER_UID=$(id -u)
USER_GID=$(id -g)

# --- Build optional symlink args ---
# These create /bin/sh and /usr/bin/env for scripts with shebangs
SYMLINK_ARGS=""
if [[ -x /run/current-system/sw/bin/bash ]]; then
  SYMLINK_ARGS="$SYMLINK_ARGS --symlink /run/current-system/sw/bin/bash /bin/sh"
elif [[ -x /usr/bin/bash ]]; then
  SYMLINK_ARGS="$SYMLINK_ARGS --symlink /usr/bin/bash /bin/sh"
fi

USR_SYMLINK_ARGS=""
if [[ -x /run/current-system/sw/bin/env ]]; then
  USR_SYMLINK_ARGS="$USR_SYMLINK_ARGS --symlink /run/current-system/sw/bin/env /usr/bin/env"
elif [[ -x /usr/bin/env ]]; then
  # /usr/bin/env exists on host, bind it
  USR_SYMLINK_ARGS="$USR_SYMLINK_ARGS --ro-bind /usr/bin/env /usr/bin/env"
fi

# --- Find bwrap ---
BWRAP="${BOSUN_BWRAP_PATH:-$(command -v bwrap 2>/dev/null || echo "")}"
if [[ -z "$BWRAP" ]]; then
  echo "Error: bwrap not found. Install bubblewrap or use: just start-unsandboxed"
  exit 1
fi

# --- Resolve command to absolute path ---
# The first argument (e.g., "pi", "bun") must be resolved now because
# the sandbox has a restricted PATH.
# Check BOSUN_*_PATH from tmux env first (set by just start), then fall back to PATH.
CMD="$1"
shift
if [[ "$CMD" != /* ]]; then
  RESOLVED=""
  # Try tmux-saved paths first (handles nix/fnm tools not on bare tmux PATH)
  case "$CMD" in
    pi)  RESOLVED="${BOSUN_PI_PATH:-}" ;;
    bun) RESOLVED="${BOSUN_BUN_PATH:-}" ;;
    bwrap) RESOLVED="${BOSUN_BWRAP_PATH:-}" ;;
  esac
  # Fall back to PATH lookup
  if [[ -z "$RESOLVED" ]]; then
    RESOLVED=$(command -v "$CMD" 2>/dev/null || echo "")
  fi
  if [[ -z "$RESOLVED" ]]; then
    echo "Error: '$CMD' not found on PATH. Is it installed?"
    exit 1
  fi
  CMD="$RESOLVED"
fi

# Bind the directory containing the resolved command (and its symlink targets)
CMD_BIND_ARGS=""
CMD_REAL=$(realpath "$CMD" 2>/dev/null || echo "$CMD")
CMD_DIR=$(dirname "$CMD_REAL")
# Bind the fnm/node multishell dir tree if the command lives there
if [[ "$CMD_DIR" == /run/user/* ]] || [[ "$CMD_DIR" == /home/* ]]; then
  # Walk up to find a bindable root (e.g., the fnm node version dir)
  CMD_BIND_ROOT="$CMD_DIR"
  # Also bind the node_modules tree that pi's symlink points into
  CMD_TARGET_DIR=$(dirname "$CMD_REAL")
  if [[ "$CMD_TARGET_DIR" != "$CMD_DIR" ]]; then
    # Bind the target dir (e.g., fnm node installation)
    CMD_BIND_ARGS="$CMD_BIND_ARGS --ro-bind $CMD_TARGET_DIR $CMD_TARGET_DIR"
  fi
fi
# Always bind the immediate parent of the resolved binary
if [[ -n "$CMD_REAL" ]] && [[ "$CMD_REAL" == /nix/* ]]; then
  : # Already covered by /nix ro-bind
elif [[ -n "$CMD_REAL" ]]; then
  # Bind the full chain: symlink source dir + real target dir
  LINK_DIR=$(dirname "$CMD")
  REAL_DIR=$(dirname "$CMD_REAL")
  if [[ "$LINK_DIR" != "$REAL_DIR" ]]; then
    CMD_BIND_ARGS="$CMD_BIND_ARGS --ro-bind $LINK_DIR $LINK_DIR"
  fi
  CMD_BIND_ARGS="$CMD_BIND_ARGS --ro-bind $REAL_DIR $REAL_DIR"
  # If the real binary is a node script, also bind the node installation
  NODE_BASE=$(echo "$REAL_DIR" | sed -n 's|\(.*node-versions/[^/]*/installation\).*|\1|p')
  if [[ -n "$NODE_BASE" ]] && [[ -d "$NODE_BASE" ]]; then
    CMD_BIND_ARGS="$CMD_BIND_ARGS --ro-bind $NODE_BASE $NODE_BASE"
  fi
  # Bind the fnm multishell dir for the symlink
  FNM_SHELL_DIR=$(echo "$CMD" | sed -n 's|\(.*/fnm_multishells/[^/]*\).*|\1|p')
  if [[ -n "$FNM_SHELL_DIR" ]] && [[ -d "$FNM_SHELL_DIR" ]]; then
    CMD_BIND_ARGS="$CMD_BIND_ARGS --ro-bind $FNM_SHELL_DIR $FNM_SHELL_DIR"
  fi
fi

# --- Bind extra tool paths (for daemon handlers that spawn pi) ---
EXTRA_BIND_ARGS=""
for TOOL_PATH_VAR in BOSUN_PI_PATH BOSUN_BUN_PATH; do
  TOOL_PATH="${!TOOL_PATH_VAR:-}"
  if [[ -n "$TOOL_PATH" ]] && [[ -f "$TOOL_PATH" ]]; then
    TOOL_DIR=$(dirname "$(readlink -f "$TOOL_PATH")")
    EXTRA_BIND_ARGS="$EXTRA_BIND_ARGS --ro-bind $TOOL_DIR $TOOL_DIR"
    # Also bind fnm shell dir if applicable
    FNM_DIR=$(echo "$TOOL_PATH" | sed -n 's|\(.*/fnm_multishells/[^/]*\).*|\1|p')
    if [[ -n "$FNM_DIR" ]] && [[ -d "$FNM_DIR" ]]; then
      EXTRA_BIND_ARGS="$EXTRA_BIND_ARGS --ro-bind $FNM_DIR $FNM_DIR"
    fi
  fi
done

# --- Run in sandbox ---
exec "$BWRAP" \
  --unshare-user \
  --uid "$USER_UID" --gid "$USER_GID" \
  --proc /proc \
  --dev /dev \
  --tmpfs /tmp \
  --tmpfs /bin \
  $SYMLINK_ARGS \
  --tmpfs /usr \
  $USR_SYMLINK_ARGS \
  $RO_BIND_ARGS \
  $CMD_BIND_ARGS \
  $EXTRA_BIND_ARGS \
  $TMUX_BIND \
  --bind "$BOSUN_ROOT" "$BOSUN_ROOT" \
  --bind "$BOSUN_ROOT/.bosun-home" "$BOSUN_ROOT/.bosun-home" \
  --bind "$BOSUN_ROOT/.pi" "$BOSUN_ROOT/.pi" \
  --chdir "$BOSUN_ROOT" \
  --setenv HOME "$BOSUN_ROOT/.bosun-home" \
  --setenv BOSUN_ROOT "$BOSUN_ROOT" \
  --setenv BOSUN_WORKSPACE "$BOSUN_ROOT/$WORKSPACE" \
  --setenv PI_CODING_AGENT_DIR "$BOSUN_ROOT/.bosun-home/.pi/agent" \
  --setenv PI_AGENT "${PI_AGENT:-bosun}" \
  --setenv PI_AGENT_NAME "${PI_AGENT_NAME:-bosun}" \
  --setenv SHELL "/bin/bash" \
  --setenv TMUX "${TMUX:-}" \
  --setenv PATH "$SANDBOX_PATH" \
  --setenv BOSUN_SANDBOX "1" \
  --setenv BOSUN_PI_PATH "${BOSUN_PI_PATH:-pi}" \
  $ENV_ARGS \
  "$CMD" "$@"
