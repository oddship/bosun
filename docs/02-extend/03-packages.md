---
title: Packages
description: Package reference — independent Pi packages that compose into bosun
---

# Packages

Every component in bosun is an independent Pi package, publishable to npm and usable standalone via `pi install npm:<name>`.

## Framework

### pi-bosun

Bosun's framework identity — default agents (bosun, lite, oracle, review, scout, verify), prompt slots (delegation, workspace, git etiquette), and bosun-specific skills (context management, config, daemon, bootstrap).

Override any agent by placing a file with the same name in `.pi/agents/`.

[Source](https://github.com/oddship/bosun/tree/main/packages/pi-bosun)

## Orchestration

### pi-agents

Agent discovery and spawning. Resolves agent names to definitions, maps model tiers to actual models, and spawns Pi instances in tmux windows or sessions.

**Key tools:** `spawn_agent`

```typescript
spawn_agent({ agent: "lite", task: "..." })
spawn_agent({ agent: "verify", task: "...", session: true })
```

[Source](https://github.com/oddship/bosun/tree/main/packages/pi-agents)

### pi-mesh

Multi-agent coordination — peer awareness, file reservations, messaging, and optional runtime identity sync between mesh, tmux, and the Pi UI. Agents auto-join on spawn.

**Key tools:** `mesh_peers`, `mesh_reserve`, `mesh_release`, `mesh_send`, `mesh_manage`

```typescript
mesh_peers({})
mesh_reserve({ paths: ["src/auth/"], reason: "Refactoring" })
mesh_send({ to: "bosun", message: "Done. Tests pass." })
```

[npm](https://www.npmjs.com/package/pi-mesh) · [Source](https://github.com/oddship/bosun/tree/main/packages/pi-mesh)

### pi-auto-resume

Automatically resume after context compaction. When Pi compacts a session, the agent normally goes idle. This extension sends a follow-up prompt so the agent continues from the summary's next steps.

**Commands:** `/autoresume` (toggle on/off)

**Footer:** `🔁 auto` when enabled

Configure in `config.toml`:

```toml
[auto_resume]
enabled = true
cooldown_seconds = 60
```

[Source](https://github.com/oddship/bosun/tree/main/packages/pi-auto-resume)

### pi-session-context

Session context and handoff tools. Provides session metadata and the handoff/pickup workflow.

**Key tools:** `session_context`, `handoff`

[Source](https://github.com/oddship/bosun/tree/main/packages/pi-session-context)

## Tools

### pi-tmux

Terminal tools for tmux interaction — split panes, send keystrokes, capture output, list windows, kill windows.

**Key tools:** `split_pane`, `send_keys`, `capture_pane`, `list_windows`, `kill_window`

```typescript
split_pane({ command: "npm run dev" })
capture_pane({ target: "lite-1", lines: 50 })
```

[Source](https://github.com/oddship/bosun/tree/main/packages/pi-tmux)

### pi-question

Enhanced question tool with TUI rendering, multi-select support, and custom option descriptions.

**Key tools:** `question`

```typescript
question({
  question: "Which files to include?",
  options: [{ label: "All" }, { label: "Modified only" }],
  multiple: true
})
```

[Source](https://github.com/oddship/bosun/tree/main/packages/pi-question)

### pi-sandbox

Tool-level sandboxing. Intercepts read/write/bash calls and enforces access control — deny reads to sensitive paths, whitelist write directories, block dangerous file patterns.

Active even without process-level (bwrap) sandboxing.

[Source](https://github.com/oddship/bosun/tree/main/packages/pi-sandbox)

### pi-memory

Curated markdown memory retrieval backed by qmd v2's library API. It provides
memory-oriented tools for sessions, plans, docs, skills, and other markdown
knowledge bases without requiring MCP.

**Key tool:** `memory` with actions `search`, `get`, `multi_get`, `status`

```typescript
memory({ action: "search", query: "daemon path isolation" })
memory({ action: "get", id: "#abc123" })
```

[Source](https://github.com/oddship/bosun/tree/main/packages/pi-memory)

## Background

### pi-daemon

Background automation engine. Discovers workflows from packages, runs them on schedule (hourly, daily), manages a task queue with retry and crash recovery.

**Key tools:** `daemon` (status, logs, trigger, reload, stop)

```typescript
daemon({ action: "status" })
daemon({ action: "trigger", handler: "catchup-sessions" })
```

[Source](https://github.com/oddship/bosun/tree/main/packages/pi-daemon)

### pi-session-tools

Session lifecycle workflows:

- **catchup-sessions**: Summarize completed sessions into readable markdown
- **fill-handoff**: Fill pending handoff documents with session analysis

[Source](https://github.com/oddship/bosun/tree/main/packages/pi-session-tools)

### pi-chronicles

Builder's log generation:

- **chronicle-analyzer**: Group sessions into development journeys
- **chronicle-scribe**: Generate narrative markdown from analyses

[Source](https://github.com/oddship/bosun/tree/main/packages/pi-chronicles)

### pi-weaver

Self-correction extension for Pi agents. Gives the model three context-management tools:

- **checkpoint(label, state)** — mark a position in the conversation with structured state
- **time_lapse(label, steering)** — rewind to a checkpoint, shedding all context since then
- **done(result)** — signal task completion

The model checkpoints early, explores, and rewinds when a line of attack goes stale. Context pruning happens at the event level — dead branches are removed from the conversation, not just summarized.

**Commands:** `/weaver on` · `/weaver off` (toggle mid-session)

**Footer:** `🕸️ weaver` when active

Best for insight tasks (hidden structure, forensic recovery) and multi-step debugging. Less useful for straight-line edits or capability-bound tasks. See the [evaluation write-up](https://rohanverma.net/pages/harness-engineering/research/pi-weaver/) for a 15-task Terminal-Bench 2.0 comparison.

[Source](https://github.com/oddship/bosun/tree/main/packages/pi-weaver)

## Domain

### pi-q

Task, project, and roadmap management. Used by the Q agent for structured planning and tracking.

**Skills:** `q-tasks`, `q-projects`, `q-roadmaps`, `q-review`

```bash
qt list              # List tasks
qt add "Fix auth"    # Add task
qp show my-project   # Show project
```

[Source](https://github.com/oddship/bosun/tree/main/packages/pi-q)

## Meta

### pi-meta-skills

Meta skills for creating new bosun components:

- **meta-agent-creator**: Scaffold agent definitions
- **meta-skill-creator**: Create skills with proper structure
- **meta-extension-creator**: Build Pi extensions
- **meta-tool-creator**: Add custom tools
- **meta-workflow-creator**: Build daemon workflows
- **meta-command-creator**: Create slash commands

[Source](https://github.com/oddship/bosun/tree/main/packages/pi-meta-skills)

## Updating dependencies

Pin exact versions — use `"1.2.3"` not `"^1.2.3"` in all `package.json` files. `workspace:*` is fine for local packages.

After changing any dependency version:

```bash
bun install        # update node_modules and lockfile
just init          # regenerate .pi/settings.json
```

**Why both steps?** Pi discovers packages via `.pi/settings.json`, which is generated by `just init` from `package.json`. Without `just init`, new agent windows will load the old version even though `node_modules` has the new one.

## Using packages standalone

Any package can be installed independently:

```bash
pi install npm:pi-mesh
pi install npm:pi-tmux
```

They work outside of bosun. The only requirement is Pi itself.
