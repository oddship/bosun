---
title: Packages
description: Package reference — independent Pi packages that compose into bosun
---

# Packages

Every component in bosun is an independent Pi package, publishable to npm and usable standalone via `pi install npm:<name>`.

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

Multi-agent coordination — peer awareness, file reservations, and messaging. Agents auto-join on spawn.

**Key tools:** `mesh_peers`, `mesh_reserve`, `mesh_release`, `mesh_send`, `mesh_manage`

```typescript
mesh_peers({})
mesh_reserve({ paths: ["src/auth/"], reason: "Refactoring" })
mesh_send({ to: "bosun", message: "Done. Tests pass." })
```

[npm](https://www.npmjs.com/package/pi-mesh) · [Source](https://github.com/oddship/bosun/tree/main/packages/pi-mesh)

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

## Using packages standalone

Any package can be installed independently:

```bash
pi install npm:pi-mesh
pi install npm:pi-tmux
```

They work outside of bosun. The only requirement is Pi itself.
