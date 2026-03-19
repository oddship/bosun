---
name: context-management
description: Manage plans, handoffs, forks, and pickups. Load for /handoff, /fork, /pickup, or when planning complex tasks.
license: MIT
compatibility: pi
metadata:
  category: workflow
  version: "1.0"
---

# Context Management

Manage session context: plans, handoffs, forks, pickups.

## Scripts

Run via bash from project root:

| Script | Purpose | Usage |
|--------|---------|-------|
| `list.ts` | List documents | `bun .pi/skills/context-management/scripts/list.ts [all\|plans\|handoffs\|forks\|pending]` |
| `create-handoff.ts` | Create handoff | `bun .pi/skills/context-management/scripts/create-handoff.ts <sessionID> [focus]` |
| `create-fork.ts` | Create fork | `bun .pi/skills/context-management/scripts/create-fork.ts <sessionID> <reason>` |
| `load.ts` | Load & mark picked_up | `bun .pi/skills/context-management/scripts/load.ts <path>` |

## Workspace Structure

```
workspace/users/{username}/
├── plans/       # Task plans (YYYY-MM/DD-HH-MM-name.md)
├── handoffs/    # Session checkpoints
├── forks/       # Exploration branches
└── sessions/    # Auto-logged (read-only)
```

## Workflows

### /pickup
1. List shown via inline shell in command
2. User selects number
3. Run `load.ts <path>`
4. Present content and next steps

### /handoff
1. Call `handoff({ focus })` tool - creates file and triggers daemon
2. Daemon auto-fills content (analyzes session, fills sections)
3. Track status via `qt list --status ready` or check file for `status: ready`
4. Report path to user

The handoff tool:
- Creates handoff file with `status: pending`
- Daemon watcher triggers fill-handoff handler
- Handler extracts session context, calls pi with lite agent
- Updates file with filled content, sets `status: ready`
- Tracks progress (use `qt list` to monitor)

### /fork
1. Call `session-context` tool to get sessionID
2. Run `create-fork.ts <sessionID> <reason>`
3. Report path to user

### Planning (complex tasks)
1. Gather context, ask clarifying questions
2. Create plan at `workspace/users/$USER/plans/YYYY-MM/DD-HH-MM-name.md`
3. Get user approval before execution
4. Execute with phase gates (verify + review before each commit)

**Proactively load** `references/planning.md` for the full planning workflow.
See `references/templates.md` for document templates.

## Session Analysis

For analyzing session exports (jq patterns, trimming, deliverable verification), load the **session-analysis** skill:

```
skill({ name: "session-analysis" })
```

This skill covers:
- Exporting and trimming sessions for LLM processing
- jq patterns for tool usage, steering prompts, file operations
- Comparing session evidence to documented deliverables

## Q Task Integration

When creating handoffs/forks while working on a Q-tracked task, pass task context to the spawned agent so it can suggest appropriate Q commands.

### How It Works

1. **You (the agent) know the task**: From conversation context, you know which Q task is being worked on
2. **Pass context to spawned agent**: Include task ID and title in the spawn_agent prompt
3. **Subagent fills Q Updates section**: Using the context you provide

### Example: Handoff with Q Task

When spawning the lite agent, add Q task context:

```
Session export: /tmp/session-{sessionID}.json
Handoff document: {handoffPath}
Focus area: {focus}
Q Task: {taskID} - {taskTitle}   <-- Add this line

Instructions:
...
6. If Q Task is provided, fill "## Q Updates" section with:
   - The linked task reference
   - Suggested commands: qt show/edit {taskID}
   - Status update suggestions if work is pausing
```

### When No Q Task

If not working on a Q-tracked task, omit the Q Task line. The spawn_agent will add a helpful note about linking tasks manually.

### Templates

The handoff and fork templates in `references/templates.md` include a `## Q Updates` section for this purpose.
