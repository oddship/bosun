---
title: Walkthrough
description: A guided tour of a bosun session from start to finish
---

# Walkthrough

This walkthrough shows a typical bosun session — from starting up to shutting down, with multi-agent coordination, background automation, and context management along the way.

## Starting up

```bash
just start
```

Tmux launches with the bosun session. The daemon starts in the background. You're talking to bosun, the orchestrator agent:

```
[bosun] Ready. I'm Bosun, your orchestrator agent.
```

## Exploring a codebase

You want to understand a new repo:

```
You: Clone github.com/myorg/myapi and explore it
```

Bosun clones the repo and spawns scout for reconnaissance:

```typescript
spawn_agent({
  agent: "scout",
  task: "Explore workspace/code/github.com/myorg/myapi — report via mesh_send to bosun"
})
```

A new tmux window appears: `scout-1`. It scans the repo and reports back via mesh:

```
[mesh] scout-1: "Go API. 45 files. Entry: cmd/server/main.go.
       Middleware auth, PostgreSQL, REST+gRPC. Tests in _test.go files."
```

You can switch to the scout window (`Alt+2`) to watch it work, or stay in bosun's window and wait for the mesh message.

## Planning work

You ask for something non-trivial:

```
You: Add rate limiting to the API
```

Bosun recognizes this touches multiple files and creates a plan:

```
Bosun: This touches multiple files. Let me create a plan first.
```

A plan appears at `workspace/users/{you}/plans/2026-02/20-21-22-rate-limiting.md`. You review it — either in your editor or in a split pane — and approve:

```
You: Looks good, proceed.
```

## Multi-agent delegation

Bosun delegates to the right agents:

- **lite** for straightforward implementation (fast, cheap model)
- **verify** to run tests (medium model, focused on validation)
- **review** for code review (medium model, read-only)

```typescript
spawn_agent({ agent: "lite", task: "Implement rate limiter middleware..." })
spawn_agent({ agent: "verify", task: "Run tests in workspace/code/..." })
```

Both agents work simultaneously in their own tmux windows. You can watch either one.

## Mesh coordination

When lite needs to edit files that verify is also reading, mesh handles it:

```typescript
// lite reserves the file before editing
mesh_reserve({ paths: ["middleware/ratelimit.go"], reason: "Implementing rate limiter" })

// When done, releases it
mesh_release({})
```

Results arrive as mesh messages:

```
[mesh] lite-1: "Rate limiter implemented. Token bucket. Files:
       middleware/ratelimit.go, middleware/ratelimit_test.go"

[mesh] verify-1: "42 tests pass, 0 fail. New tests all passing."
```

Bosun summarizes and commits.

## Saving context

End of session — save a handoff:

```
You: /handoff
```

Bosun creates a handoff file with:
- What you were working on
- Key decisions made
- Files modified
- Suggested next steps

The daemon detects the handoff and fills it with session analysis automatically.

## Next session

```bash
just start
```

```
You: /pickup
```

Select the handoff. Context restored — you're back where you left off.

## Background automation

While you work, the daemon runs scheduled workflows:

- **catchup-sessions** (hourly): Summarizes completed Pi sessions into readable markdown
- **fill-handoff** (hourly): Fills pending handoff documents with session analysis
- **chronicle-analyzer** (hourly): Groups sessions into development journeys
- **chronicle-scribe** (hourly): Generates builder's log narratives
- **backup-workspace** (daily): Backs up your workspace

Check daemon status:

```typescript
daemon({ action: "status" })
daemon({ action: "logs", lines: 20 })
```

## Task management with Q

For longer-running projects, spawn the Q agent:

```typescript
spawn_agent({ agent: "q", session: true, task: "Let's plan next week" })
```

Q manages tasks, projects, and roadmaps:

```
Q: Here's your current state:
   - 3 active tasks (2 P0, 1 P1)
   - 1 project at 60% completion

   What would you like to focus on?
```

## Shutting down

```bash
just stop
```

All tmux windows closed. Daemon stopped. Your work is saved — handoffs, session summaries, and chronicles are all generated automatically.
