# Daemon Configuration

## Overview

The daemon runs in its own tmux session (`bosun-daemon`), inside the sandbox.

Config is in `config.toml` under `[daemon]` and `[[daemon.watch]]`/`[[daemon.schedule]]`.

## Config Reference

```toml
[daemon]
enabled = true
heartbeat_interval_seconds = 10  # Rule evaluation frequency
debounce_ms = 5000               # Default watcher debounce
log_level = "debug"              # debug, info, warn, error

# File watchers - trigger flags on file changes
[[daemon.watch]]
name = "session-summarizer"
pattern = "..bosun-home/.pi/agent/sessions/**/*.jsonl"
handler = "summarize-session"
debounce_ms = 5000
enabled = true

[[daemon.watch]]
name = "handoff-filler"
pattern = "workspace/users/*/handoffs/**/*.md"
handler = "fill-handoff"
debounce_ms = 2000
enabled = true

[[daemon.watch]]
name = "chronicle-trigger"
pattern = "workspace/users/*/plans/**/*.md"
handler = "chronicle-trigger"
debounce_ms = 10000
enabled = false  # Disabled by default

# Cron schedules
[[daemon.schedule]]
name = "heartbeat-log"
cron = "*/5 * * * *"
handler = "log-heartbeat"
enabled = true
```

## Session Logging

```toml
[session_logging]
enabled = true
min_messages = 5           # Min messages before summarizing
debounce_seconds = 5       # Wait for idle
analysis_model = "${models.lite}"  # Uses template interpolation
agents = ["bosun"]          # Only summarize these agents
```

## Rule-Based Architecture

The daemon uses a rule engine (not just watchers/cron):

1. **Watchers** detect file changes and set trigger flags in `.bosun-daemon/triggers.json`
2. **Heartbeat** fires every N seconds, evaluates all rules
3. **Rules** check conditions (triggers, time-based, session counts)
4. **Queue** executes matching tasks sequentially with retry

See the `bosun-daemon` skill for handler development details.

## Managing

See the `bosun-daemon` skill for daemon management commands, handler development, and file locations.
