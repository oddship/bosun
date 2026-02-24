# Bosun — personal multi-agent Pi coding environment

bosun_root := justfile_directory()
tmux_sock := bosun_root / ".bosun-home" / "tmux.sock"
tmux_cmd := "tmux -S " + tmux_sock

# Preamble sourced by all bash recipes that need tmux helpers
_helpers := 'export BOSUN_ROOT="' + bosun_root + '" TMUX_CMD="' + tmux_cmd + '"; source "' + bosun_root + '/scripts/tmux-helpers.sh"'

# Default: show help
default:
    @just --list

# Check all required tools
doctor:
    #!/usr/bin/env bash
    ok=true
    for cmd in tmux bun pi git rg; do
      if command -v "$cmd" &>/dev/null; then
        printf "✓ %-10s %s\n" "$cmd" "$(command -v "$cmd")"
      else
        printf "✗ %-10s missing\n" "$cmd"
        ok=false
      fi
    done
    # Optional: bwrap (only needed for sandboxed mode)
    if command -v bwrap &>/dev/null; then
      printf "✓ %-10s %s\n" "bwrap" "$(command -v bwrap)"
    else
      printf "○ %-10s missing (optional — needed for 'just start')\n" "bwrap"
    fi
    echo ""
    $ok && echo "All good. Run: just start" || echo "Install missing tools or use: nix develop"

# Start bosun (sandboxed via bwrap)
start:
    #!/usr/bin/env bash
    just _ensure bwrap tmux bun pi
    {{_helpers}}
    ensure_dirs
    check_inside_tmux

    if {{tmux_cmd}} has-session -t bosun 2>/dev/null; then
      echo "Attaching to existing session 'bosun'..."
      exec {{tmux_cmd}} attach -t bosun
    fi

    echo "Creating new session 'bosun'..."
    echo ""
    echo "Keybindings:"
    echo "  Ctrl+A       - Prefix"
    echo "  Alt+1-5      - Switch to window 1-5"
    echo "  Alt+0        - Toggle last window"
    echo "  Shift+←/→    - Previous/next window"
    echo ""

    {{tmux_cmd}} -f "{{bosun_root}}/config/tmux.conf" new-session -d -s bosun -n bosun
    set_tmux_env
    {{tmux_cmd}} send-keys -t bosun:bosun "cd {{bosun_root}} && scripts/sandbox.sh pi" Enter
    just _ensure-daemon
    {{tmux_cmd}} attach -t bosun

# Start without process-level sandbox (pi-sandbox still active)
start-unsandboxed:
    #!/usr/bin/env bash
    just _ensure tmux bun pi
    {{_helpers}}
    ensure_dirs
    check_inside_tmux

    if {{tmux_cmd}} has-session -t bosun 2>/dev/null; then
      echo "Attaching to existing session 'bosun'..."
      exec {{tmux_cmd}} attach -t bosun
    fi

    echo "Creating new session 'bosun'..."
    {{tmux_cmd}} -f "{{bosun_root}}/config/tmux.conf" new-session -d -s bosun -n bosun
    set_tmux_env
    {{tmux_cmd}} send-keys -t bosun:bosun "cd {{bosun_root}} && BOSUN_ROOT={{bosun_root}} BOSUN_WORKSPACE={{bosun_root}}/workspace PI_CODING_AGENT_DIR={{bosun_root}}/.bosun-home/.pi/agent PI_AGENT=bosun PI_AGENT_NAME=bosun pi" Enter
    {{tmux_cmd}} attach -t bosun

# Run a new bosun session (creates bosun, bosun-2, bosun-3, ...)
run *args:
    #!/usr/bin/env bash
    just _ensure bwrap tmux bun pi
    {{_helpers}}
    ensure_dirs
    # Find next available name (checks sessions, windows, AND mesh registry)
    if {{tmux_cmd}} has-session -t bosun 2>/dev/null; then
      N=$(BOSUN_ROOT="{{bosun_root}}" "{{bosun_root}}/scripts/tmux-next-bosun.sh")
      SESSION="bosun-$N"
    else
      SESSION="bosun"
    fi

    echo "Creating new session '$SESSION'..."
    {{tmux_cmd}} -f "{{bosun_root}}/config/tmux.conf" new-session -d -s "$SESSION" -n bosun
    set_tmux_env
    {{tmux_cmd}} send-keys -t "$SESSION":bosun "cd {{bosun_root}} && PI_AGENT_NAME=$SESSION scripts/sandbox.sh pi {{args}}" Enter
    {{tmux_cmd}} attach -t "$SESSION"

# Attach to running session (auto-detects available sessions)
attach session="":
    #!/usr/bin/env bash
    {{_helpers}}
    if [[ -n "{{session}}" ]]; then
      exec {{tmux_cmd}} attach -t "{{session}}"
    fi
    SESSIONS=$(bosun_sessions)
    if [[ -z "$SESSIONS" ]]; then
      echo "No bosun sessions running. Start one with: just start"
      exit 1
    fi
    COUNT=$(echo "$SESSIONS" | wc -l)
    if [[ "$COUNT" -eq 1 ]]; then
      exec {{tmux_cmd}} attach -t "$SESSIONS"
    fi
    echo "Multiple sessions available:"
    echo "$SESSIONS" | nl -w2 -s'. '
    echo ""
    read -rp "Pick session number [1]: " PICK
    PICK=${PICK:-1}
    TARGET=$(echo "$SESSIONS" | sed -n "${PICK}p")
    if [[ -z "$TARGET" ]]; then
      echo "Invalid selection"
      exit 1
    fi
    exec {{tmux_cmd}} attach -t "$TARGET"

# Stop everything
stop:
    #!/usr/bin/env bash
    if ! {{tmux_cmd}} list-sessions 2>/dev/null; then
      echo "No bosun sessions running"
      exit 0
    fi
    # Collect PIDs of all processes in bosun tmux panes before killing
    PIDS=$({{tmux_cmd}} list-panes -a -F '#{pane_pid}' 2>/dev/null || true)
    # Kill tmux server (sends SIGHUP to direct children)
    {{tmux_cmd}} kill-server 2>/dev/null || true
    # Wait briefly, then clean up any orphans
    sleep 1
    for pid in $PIDS; do
      if kill -0 "$pid" 2>/dev/null; then
        echo "Cleaning up orphan process $pid"
        kill -TERM "$pid" 2>/dev/null || true
      fi
    done
    echo "Stopped."

# Update pi and ecosystem packages
update:
    #!/usr/bin/env bash
    set -euo pipefail
    CURRENT=$(node -e "console.log(require('./node_modules/@mariozechner/pi-coding-agent/package.json').version)")
    echo "Current: v$CURRENT"
    LATEST=$(npm info @mariozechner/pi-coding-agent version 2>/dev/null || echo "unknown")
    echo "Latest:  v$LATEST"
    if [[ "$CURRENT" == "$LATEST" ]]; then
      echo "Already up to date."
      exit 0
    fi
    echo ""
    echo "Updating pi packages..."
    bun update @mariozechner/pi-coding-agent pi-spawn_agent pi-mcp-adapter pi-interactive-shell pi-mesh
    UPDATED=$(node -e "console.log(require('./node_modules/@mariozechner/pi-coding-agent/package.json').version)")
    echo ""
    echo "Updated: v$CURRENT → v$UPDATED"
    echo ""
    echo "Changelog: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/CHANGELOG.md"
    echo ""
    echo "Next steps:"
    echo "  1. Review changelog for breaking changes"
    echo "  2. git add package.json bun.lock && git commit -m 'build: update pi-coding-agent to v$UPDATED'"
    echo "  3. Restart: exit and run 'just start'"

# Generate .pi/*.json from config.toml
init:
    @test -f config.toml || { echo "config.toml not found. Run: just onboard"; exit 1; }
    bun scripts/init.ts

# First-time setup
onboard:
    #!/usr/bin/env bash
    echo "=== Bosun Onboarding ==="
    if [[ ! -f config.toml ]]; then
        cp config.sample.toml config.toml
        echo "Created config.toml from sample."
        echo "  Edit it with your API keys: vim config.toml"
    fi
    just init
    mkdir -p .bosun-home/.pi/agent workspace
    bun install
    echo ""
    echo "Login to pi (saves auth in .bosun-home/.pi/agent/):"
    echo "  PI_CODING_AGENT_DIR={{bosun_root}}/.bosun-home/.pi/agent pi /login"
    echo ""
    echo "Ready! Run: just start"

# Trigger daemon rule manually
daemon-run rule:
    @mkdir -p "{{bosun_root}}/.bosun-daemon/control"
    echo '{"action":"trigger","handler":"{{rule}}"}' > "{{bosun_root}}/.bosun-daemon/control/manual-$(date +%s).json"
    @echo "Triggered: {{rule}}"

# Show session status
status:
    #!/usr/bin/env bash
    {{_helpers}}
    SESSIONS=$(bosun_sessions)
    if [[ -z "$SESSIONS" ]]; then
      echo "No bosun sessions running."
      exit 0
    fi
    for sess in $SESSIONS; do
      echo "Session: $sess (tmux -S {{tmux_sock}})"
      {{tmux_cmd}} list-windows -t "$sess" -F "  #{window_index}: #{window_name}" 2>/dev/null
      echo ""
    done

# Internal: ensure daemon is running
_ensure-daemon:
    #!/usr/bin/env bash
    # Skip if daemon.json doesn't exist or isn't enabled
    if [[ ! -f "{{bosun_root}}/.pi/daemon.json" ]]; then exit 0; fi
    ENABLED=$(cat "{{bosun_root}}/.pi/daemon.json" | grep -o '"enabled"[[:space:]]*:[[:space:]]*true' || echo "")
    if [[ -z "$ENABLED" ]]; then exit 0; fi

    if {{tmux_cmd}} has-session -t bosun-daemon 2>/dev/null; then
      echo "Daemon already running"
    else
      echo "Starting daemon..."
      {{tmux_cmd}} -f "{{bosun_root}}/config/tmux.conf" new-session -d -s bosun-daemon -n daemon
      {{tmux_cmd}} set-environment -g BOSUN_ROOT "{{bosun_root}}"
      {{tmux_cmd}} send-keys -t bosun-daemon:daemon "cd {{bosun_root}} && BOSUN_PI_PATH=$({{tmux_cmd}} show-environment -g BOSUN_PI_PATH 2>/dev/null | cut -d= -f2-) BOSUN_BUN_PATH=$({{tmux_cmd}} show-environment -g BOSUN_BUN_PATH 2>/dev/null | cut -d= -f2-) scripts/sandbox.sh bun packages/pi-daemon/src/index.ts" Enter
      sleep 2
      if {{tmux_cmd}} has-session -t bosun-daemon 2>/dev/null; then
        echo "Daemon started in tmux session 'bosun-daemon'"
      else
        echo "Warning: Failed to start daemon"
      fi
    fi

# Stop just the daemon
daemon-stop:
    {{tmux_cmd}} kill-session -t bosun-daemon 2>/dev/null || echo "Daemon not running"

# View daemon logs
daemon-logs:
    @tail -50 "{{bosun_root}}/.bosun-daemon/daemon.log" 2>/dev/null || echo "No logs found"

# Generate workflow DAG visualization
workflow-dag:
    bun scripts/workflow-dag.ts
    @echo "Open workspace/workflow-dag.html in your browser"

# Internal: check tools exist
_ensure +tools:
    #!/usr/bin/env bash
    for cmd in {{tools}}; do
      command -v "$cmd" &>/dev/null || { echo "Missing: $cmd — run 'just doctor'"; exit 1; }
    done
