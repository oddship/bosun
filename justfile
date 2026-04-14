# Bosun — personal multi-agent Pi coding environment
#
# Two path variables:
#   bosun_pkg    — where bosun's scripts live (repo root, or node_modules/bosun)
#   project_root — where the user's project lives (config.toml, .pi/, workspace/)
#
# When running inside the bosun repo, both point to the same place.
# When a downstream project imports this justfile, BOSUN_PKG is set via env.

bosun_pkg := env("BOSUN_PKG", justfile_directory())
project_root := justfile_directory()
bosun_cli := 'bun "' + bosun_pkg + '/packages/pi-bosun/src/cli.ts"'
tmux_sock := '$(bash "' + bosun_pkg + '/scripts/tmux-socket.sh" "' + project_root + '")'
tmux_cmd := "tmux -S " + tmux_sock

# Preamble sourced by all bash recipes that need tmux helpers
_helpers := 'export BOSUN_ROOT="' + project_root + '"; export BOSUN_PKG="' + bosun_pkg + '"; TMUX_SOCK="$(bash "' + bosun_pkg + '/scripts/tmux-socket.sh" "' + project_root + '")"; export TMUX_SOCK; export TMUX_CMD="tmux -S $TMUX_SOCK"; source "' + bosun_pkg + '/scripts/tmux-helpers.sh"'

# Default: show help
default:
    @just --list

# Check all required tools
doctor:
    #!/usr/bin/env bash
    ok=true
    for cmd in bash tmux bun pi git rg jq; do
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
start *args:
    #!/usr/bin/env bash
    PKG="{{project_root}}"
    if [[ ! -f "$PKG/packages/pi-bosun/src/cli.ts" ]]; then
      PKG="{{bosun_pkg}}"
    fi
    BOSUN_PKG="$PKG" bun "$PKG/packages/pi-bosun/src/cli.ts" start {{args}}

# Start without process-level sandbox (pi-sandbox still active)
start-unsandboxed *args:
    #!/usr/bin/env bash
    PKG="{{project_root}}"
    if [[ ! -f "$PKG/packages/pi-bosun/src/cli.ts" ]]; then
      PKG="{{bosun_pkg}}"
    fi
    BOSUN_PKG="$PKG" bun "$PKG/packages/pi-bosun/src/cli.ts" start-unsandboxed {{args}}

# Run a new bosun session (creates bosun, bosun-2, bosun-3, ...)
run *args:
    #!/usr/bin/env bash
    PKG="{{project_root}}"
    if [[ ! -f "$PKG/packages/pi-bosun/src/cli.ts" ]]; then
      PKG="{{bosun_pkg}}"
    fi
    BOSUN_PKG="$PKG" bun "$PKG/packages/pi-bosun/src/cli.ts" run {{args}}

# Attach to running session (auto-detects available sessions)
attach session="":
    #!/usr/bin/env bash
    PKG="{{project_root}}"
    if [[ ! -f "$PKG/packages/pi-bosun/src/cli.ts" ]]; then
      PKG="{{bosun_pkg}}"
    fi
    if [[ -n "{{session}}" ]]; then
      BOSUN_PKG="$PKG" bun "$PKG/packages/pi-bosun/src/cli.ts" attach {{session}}
    else
      BOSUN_PKG="$PKG" bun "$PKG/packages/pi-bosun/src/cli.ts" attach
    fi

# Stop everything
stop:
    #!/usr/bin/env bash
    PKG="{{project_root}}"
    if [[ ! -f "$PKG/packages/pi-bosun/src/cli.ts" ]]; then
      PKG="{{bosun_pkg}}"
    fi
    BOSUN_PKG="$PKG" bun "$PKG/packages/pi-bosun/src/cli.ts" stop

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

# Run tests (scoped to packages/ to avoid workspace clutter)
test *args:
    bun test packages/ {{args}}

# Generate .pi/*.json from config.toml
init:
    @test -f config.toml || { echo "config.toml not found. Run: just onboard"; exit 1; }
    bun {{bosun_pkg}}/scripts/init.ts

# Memory helpers
memory-status:
    @test -f config.toml || { echo "config.toml not found. Run: just onboard"; exit 1; }
    bun {{bosun_pkg}}/scripts/init.ts >/dev/null
    bun {{bosun_pkg}}/scripts/memory.ts status

memory-search query:
    @test -f config.toml || { echo "config.toml not found. Run: just onboard"; exit 1; }
    bun {{bosun_pkg}}/scripts/init.ts >/dev/null
    bun {{bosun_pkg}}/scripts/memory.ts search {{query}}

memory-get id max-lines="":
    @test -f config.toml || { echo "config.toml not found. Run: just onboard"; exit 1; }
    bun {{bosun_pkg}}/scripts/init.ts >/dev/null
    if [ -n "{{max-lines}}" ]; then bun {{bosun_pkg}}/scripts/memory.ts get {{id}} {{max-lines}}; else bun {{bosun_pkg}}/scripts/memory.ts get {{id}}; fi

memory-multi-get pattern max-bytes="":
    @test -f config.toml || { echo "config.toml not found. Run: just onboard"; exit 1; }
    bun {{bosun_pkg}}/scripts/init.ts >/dev/null
    if [ -n "{{max-bytes}}" ]; then bun {{bosun_pkg}}/scripts/memory.ts multi-get {{pattern}} {{max-bytes}}; else bun {{bosun_pkg}}/scripts/memory.ts multi-get {{pattern}}; fi

# First-time setup
onboard:
    {{bosun_pkg}}/scripts/onboard.sh onboard

# Trigger daemon rule manually
daemon-run rule:
    @mkdir -p "{{project_root}}/.bosun-daemon/control"
    echo '{"action":"trigger","handler":"{{rule}}"}' > "{{project_root}}/.bosun-daemon/control/manual-$(date +%s).json"
    @echo "Triggered: {{rule}}"

# Run E2E validations

e2e-runtime-identity:
    bun {{bosun_pkg}}/scripts/e2e/runtime-identity-sync.ts

e2e-runtime-identity-live-pi:
    bun {{bosun_pkg}}/scripts/e2e/runtime-identity-live-pi.ts

e2e-memory-init:
    bun {{bosun_pkg}}/scripts/e2e/memory-init.ts

e2e-memory-cli:
    bun {{bosun_pkg}}/scripts/e2e/memory-cli-flow.ts

e2e-agent-slots:
    bun {{bosun_pkg}}/scripts/e2e/agent-slots-live-pi.ts

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
    if [[ ! -f "{{project_root}}/.pi/daemon.json" ]]; then exit 0; fi
    ENABLED=$(cat "{{project_root}}/.pi/daemon.json" | grep -o '"enabled"[[:space:]]*:[[:space:]]*true' || echo "")
    if [[ -z "$ENABLED" ]]; then exit 0; fi

    if {{tmux_cmd}} has-session -t bosun-daemon 2>/dev/null; then
      echo "Daemon already running"
    else
      echo "Starting daemon..."
      # If tmux server already exists (sandboxed), just add a session.
      # Otherwise wrap in sandbox.sh to start server inside bwrap.
      if {{tmux_cmd}} has-session 2>/dev/null; then
        VERSION=$({{tmux_cmd}} show-environment -g BOSUN_SANDBOX_VERSION 2>/dev/null | cut -d= -f2- || echo "1")
        if [[ "$VERSION" != "2" ]]; then
          echo "Security update: tmux server must run inside sandbox."
          echo "Old session detected. Please restart: just stop && just start"
          exit 1
        fi
        {{tmux_cmd}} new-session -d -s bosun-daemon -n daemon \
          "/bin/sh -c 'cd {{project_root}} && BOSUN_PKG={{bosun_pkg}} {{bosun_pkg}}/scripts/sandbox.sh bun {{bosun_pkg}}/packages/pi-daemon/src/index.ts; sleep 300'"
      else
        {{bosun_pkg}}/scripts/sandbox.sh {{tmux_cmd}} -f "{{bosun_pkg}}/config/tmux.conf" \
          new-session -d -s bosun-daemon -n daemon \
          "/bin/sh -c 'cd {{project_root}} && BOSUN_PKG={{bosun_pkg}} {{bosun_pkg}}/scripts/sandbox.sh bun {{bosun_pkg}}/packages/pi-daemon/src/index.ts; sleep 300'"
        {{tmux_cmd}} set-environment -g BOSUN_SANDBOX_VERSION "2"
      fi
      {{tmux_cmd}} set-environment -g BOSUN_ROOT "{{project_root}}"
      sleep 2
      if {{tmux_cmd}} has-session -t bosun-daemon 2>/dev/null; then
        echo "Daemon started in tmux session 'bosun-daemon'"
      else
        echo "Warning: Failed to start daemon"
      fi
    fi

# Internal: start gateway if enabled. Pass FORCE=1 to ignore autoStart.
_start-gateway FORCE="0":
    #!/usr/bin/env bash
    if [[ ! -f "{{project_root}}/.pi/pi-gateway.json" ]]; then exit 0; fi
    ENABLED=$(jq -r '.enabled // false' "{{project_root}}/.pi/pi-gateway.json")
    AUTOSTART=$(jq -r '.autoStart // true' "{{project_root}}/.pi/pi-gateway.json")
    if [[ "$ENABLED" != "true" ]]; then exit 0; fi
    if [[ "{{FORCE}}" != "1" && "$AUTOSTART" != "true" ]]; then exit 0; fi

    if {{tmux_cmd}} has-session -t bosun-gateway 2>/dev/null; then
      echo "Gateway already running"
    else
      echo "Starting gateway..."
      if {{tmux_cmd}} has-session 2>/dev/null; then
        VERSION=$({{tmux_cmd}} show-environment -g BOSUN_SANDBOX_VERSION 2>/dev/null | cut -d= -f2- || echo "1")
        if [[ "$VERSION" != "2" ]]; then
          echo "Security update: tmux server must run inside sandbox."
          echo "Old session detected. Please restart: just stop && just start"
          exit 1
        fi
        {{tmux_cmd}} new-session -d -s bosun-gateway -n gateway \
          "/bin/sh -c 'cd {{project_root}} && BOSUN_PKG={{bosun_pkg}} {{bosun_pkg}}/scripts/sandbox.sh bun {{bosun_pkg}}/packages/pi-gateway/src/index.ts; sleep 300'"
      else
        {{bosun_pkg}}/scripts/sandbox.sh {{tmux_cmd}} -f "{{bosun_pkg}}/config/tmux.conf" \
          new-session -d -s bosun-gateway -n gateway \
          "/bin/sh -c 'cd {{project_root}} && BOSUN_PKG={{bosun_pkg}} {{bosun_pkg}}/scripts/sandbox.sh bun {{bosun_pkg}}/packages/pi-gateway/src/index.ts; sleep 300'"
        {{tmux_cmd}} set-environment -g BOSUN_SANDBOX_VERSION "2"
      fi
      {{tmux_cmd}} set-environment -g BOSUN_ROOT "{{project_root}}"
    fi

# Internal: auto-start gateway only when enabled and autoStart=true
_ensure-gateway:
    @just _start-gateway FORCE=0

# Start gateway explicitly (ignores auto_start but still requires enabled=true)
gateway:
    #!/usr/bin/env bash
    if [[ ! -f "{{project_root}}/.pi/pi-gateway.json" ]]; then
      echo "No generated gateway config found. Run: just init"
      exit 1
    fi
    ENABLED=$(jq -r '.enabled // false' "{{project_root}}/.pi/pi-gateway.json")
    if [[ "$ENABLED" != "true" ]]; then
      echo "Gateway disabled in config.toml ([gateway].enabled = false)."
      exit 1
    fi
    just _start-gateway FORCE=1

# Stop just the daemon
daemon-stop:
    {{tmux_cmd}} kill-session -t bosun-daemon 2>/dev/null || echo "Daemon not running"

# Stop just the gateway
gateway-stop:
    {{tmux_cmd}} kill-session -t bosun-gateway 2>/dev/null || echo "Gateway not running"

# View daemon logs
daemon-logs:
    @tail -50 "{{project_root}}/.bosun-daemon/daemon.log" 2>/dev/null || echo "No logs found"

# View gateway logs
gateway-logs:
    @{{tmux_cmd}} capture-pane -pt bosun-gateway:gateway -S -200 2>/dev/null || echo "Gateway not running"

# Generate workflow DAG visualization
workflow-dag:
    bun {{bosun_pkg}}/scripts/workflow-dag.ts
    @echo "Open workspace/workflow-dag.html in your browser"

# Internal: check if config.toml has drifted from generated .pi/*.json
_check-config:
    #!/usr/bin/env bash
    if [[ ! -f config.toml ]]; then exit 0; fi
    if [[ ! -f .pi/settings.json ]]; then
      echo "No generated config found. Running init..."
      just init
      exit 0
    fi
    current=$(sha256sum config.toml | cut -d' ' -f1)
    stored=$(jq -r '._configHash // ""' .pi/settings.json)
    if [[ "$current" != "$stored" ]]; then
      echo "⚠ config.toml has changed since last 'just init'."
      read -rp "Regenerate .pi/*.json? [Y/n] " ans
      if [[ "${ans,,}" != "n" ]]; then
        just init
      fi
    fi

# Internal: check tools exist
_ensure +tools:
    #!/usr/bin/env bash
    for cmd in {{tools}}; do
      command -v "$cmd" &>/dev/null || { echo "Missing: $cmd — run 'just doctor'"; exit 1; }
    done
