---
title: Workflows
description: Background daemon and scheduled automation
---

# Workflows

Bosun's daemon runs in the background, executing workflows on a schedule. It summarizes sessions, fills handoffs, generates chronicles, and backs up your workspace — without you thinking about it.

## How the daemon works

The daemon starts automatically with `just start`. It runs a heartbeat every 30 seconds, checking which workflows need to run based on their schedule and input validators.

```
heartbeat (30s)
    │
    ├── Check schedules (hourly, daily:HH)
    │       │
    │       └── Has enough time elapsed?
    │
    ├── Run input validators
    │       │
    │       └── Is there work to do?
    │
    └── Queue matching workflows
            │
            └── Execute sequentially, retry on failure
```

### Input validators

Each workflow has a `validate-input.ts` that checks whether there's work to do. If not, the workflow is skipped — no agent spawned, no resources wasted.

For example, `catchup-sessions` checks whether any session JSONL files exist that don't have a corresponding summary. If all sessions are summarized, it skips.

### Schedules

| Schedule | Meaning |
|----------|---------|
| `hourly` | Run once per hour (checks elapsed time) |
| `daily:02` | Run once per day at 02:00 |
| `startup = true` | Also run when the daemon starts |

## Built-in workflows

### catchup-sessions

**Schedule:** Hourly + startup

Finds completed Pi session files (`.jsonl`) that don't have summaries yet. Spawns a lite agent to read the session and write a structured summary:

```
workspace/users/{user}/sessions/2026-02/2026-02-24-refactor-auth-module.md
```

Summaries include:
- Title and date
- What was accomplished
- Key decisions
- Files modified
- Reference to the original session file

### fill-handoff

**Schedule:** Hourly + startup

Scans for handoff documents with `status: pending`. Spawns a lite agent to fill them with session analysis — what was done, what's next, key context for resuming.

### chronicle-analyzer

**Schedule:** Hourly

Groups session summaries into development "journeys" — multi-session arcs that tell the story of a feature or investigation. Writes analysis JSON files that the scribe consumes.

### chronicle-scribe

**Schedule:** Hourly

Reads chronicle analyses and generates readable builder's log narratives in markdown. These are the public-facing output:

```
workspace/users/{user}/public/chronicles/2026-02/24-daemon-infrastructure-cleanup.md
```

### backup-workspace

**Schedule:** Daily at 02:00

Creates a compressed backup of the workspace directory.

## Daemon commands

Check daemon status from any agent:

```typescript
// Current status
daemon({ action: "status" })

// Recent logs
daemon({ action: "logs", lines: 20 })

// Manually trigger a workflow
daemon({ action: "trigger", handler: "catchup-sessions" })

// Reload after config changes
daemon({ action: "reload" })
```

## Writing custom workflows

A workflow is a directory with:

```
packages/your-package/workflows/your-workflow/
├── config.toml          # Schedule and settings
├── agent.md             # Agent prompt (if agent-based)
├── validate-input.ts    # Input validator (optional)
└── validate-output.ts   # Output validator (optional)
```

### config.toml

```toml
[workflow]
name = "your-workflow"
description = "What this workflow does"
schedule = "hourly"        # or "daily:HH"
startup = false            # run on daemon start?

[workflow.agent]
model = "lite"             # model tier for the agent
```

### validate-input.ts

Returns exit code 0 if there's work to do, non-zero to skip:

```typescript
import { existsSync } from "node:fs";

const pendingDir = `${process.env.BOSUN_WORKSPACE}/pending`;
if (!existsSync(pendingDir)) {
  console.error("No pending work");
  process.exit(1);
}

// Check for actual work...
console.log("Found pending items");
process.exit(0);
```

### agent.md

The agent prompt — what the spawned agent should do. Can reference environment variables set by the daemon:

```markdown
You are a workflow agent. Your task:

1. Scan {{ BOSUN_WORKSPACE }} for pending items
2. Process each one
3. Write output to the expected location
```

Workflows are discovered automatically from packages listed in `package.json`'s `"pi"` config.
