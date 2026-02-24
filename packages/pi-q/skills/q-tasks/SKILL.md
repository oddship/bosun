---
name: q-tasks
description: Task tracking skill for Q agent. Provides qt CLI for task CRUD, queries, dependencies, and archival. Use when managing tasks, tracking blockers, or triaging inbox.
---

# Q Tasks Skill

Task management foundation for the Q agent system.

## What I Do

- Create, update, query, and archive tasks
- Track task dependencies and blockers
- Manage task lifecycle: inbox -> active -> done
- Maintain update logs for team visibility

## When to Use Me

Use this skill when:
- Creating or editing tasks (`qt add`, `qt edit`)
- Querying tasks by status, priority, project, or due date
- Managing task dependencies (`qt deps`, `qt blocked`)
- Archiving completed tasks (`qt archive`)
- Reviewing task history (`qt log`)

Do NOT use for:
- Project-level operations (use q-projects skill)
- Roadmap planning (use q-roadmaps skill)
- Cross-module sync (use q-review skill)

## Script Location

The `qt` CLI script is located at:
```
.pi/skills/q-tasks/scripts/qt
```

Run with full path: `.pi/skills/q-tasks/scripts/qt <command>`

## Finding Tasks

**Always use `qt` CLI to find tasks, not glob/grep.**

```bash
# Find tasks - USE THIS
qt list                          # All active tasks
qt list -t charts                # By tag
qt list --project myproject         # By project
qt show 9173                     # Show specific task

# Search task content - if needed
mcp_grep pattern="chart" path="workspace/users/$USER/tasks"
```

**Known Issue**: The `mcp_glob` tool fails to find files in the tasks directory due to a bug. Always use `qt list` or grep directly instead.

## Quick Start

```bash
# Add a task
.pi/skills/q-tasks/scripts/qt add "Deploy GTT v2" -p P0 -d 2026-01-15 -t deploy,uat --project tsl-myproject

# List active tasks
qt list --status active

# Show blocked tasks
qt blocked

# Mark task done
qt done a3f9

# Archive old completed tasks
qt archive --older-than 30d
```

## CLI Reference

### Core Operations

| Command | Description |
|---------|-------------|
| `qt add "title" [options]` | Create new task |
| `qt show <id>` | Display task details |
| `qt edit <id>` | Edit task in editor |
| `qt done <id>` | Mark task as done |
| `qt cancel <id> [-r reason]` | Cancel task |

**Add options:**
- `-p, --priority P0|P1|P2|P3` - Priority (default: P2)
- `-d, --due YYYY-MM-DD` - Due date
- `-t, --tags <tags>` - Comma-separated tags
- `--project <id>` - Parent project
- `--repo <path>` - Repository path
- `--blocked-by <ids>` - Comma-separated blocker IDs

### Query Operations

| Command | Description |
|---------|-------------|
| `qt list` | List all active tasks |
| `qt list --status <s>` | Filter by status |
| `qt list --priority <p>` | Filter by priority |
| `qt list --project <id>` | Filter by project |
| `qt list --blocked` | Show blocked tasks |
| `qt list --due today` | Due today |
| `qt list --due this-week` | Due this week |
| `qt list -t <tags>` | Filter by tags (comma-separated) |
| `qt list --json` | JSON output |

**Statuses:** inbox, active, blocked, done, cancelled

### Dependency Management

| Command | Description |
|---------|-------------|
| `qt deps <id>` | Show dependency tree |
| `qt deps <id> --blocked-by` | What's blocking this |
| `qt deps <id> --blocks` | What this blocks |
| `qt blocked` | All blocked tasks |
| `qt unblock <id>` | Clear blockers |

### Update Log

| Command | Description |
|---------|-------------|
| `qt log` | Recent updates |
| `qt log --since yesterday` | Updates since date |
| `qt log <id>` | Updates for task |

### Publishing

| Command | Description |
|---------|-------------|
| `qt publish <id>` | Move to public/tasks/ |
| `qt unpublish <id>` | Move back to private |

### Archival

| Command | Description |
|---------|-------------|
| `qt archive <id>` | Archive single task |
| `qt archive --dry-run` | Preview eligible |
| `qt archive --older-than 30d` | Archive old done tasks |
| `qt list --include-archived` | Include archived |
| `qt unarchive <id>` | Restore from archive |

### Linting

| Command | Description |
|---------|-------------|
| `qt lint` | Validate all task files |
| `qt lint <id>` | Validate specific task |
| `qt lint --json` | JSON output (for CI) |

**Checks performed:**
- Duplicate YAML keys
- Unquoted numeric IDs in blocked_by/blocks/related
- Invalid status values
- Full schema validation

```bash
# Run before commits or in CI
qt lint || echo "Fix task file errors"

# Check specific task
qt lint a3f9
```

## Task Lifecycle

```
inbox -> active -> blocked -> done -> [30d] -> archived
                      |
                  cancelled -> [30d] -> archived
```

## File Format

Tasks are markdown files with YAML frontmatter:

```yaml
---
id: a3f9
title: Deploy GTT v2 to production
status: active
priority: P0
created: 2026-01-08
updated: 2026-01-08
due: 2026-01-15
done: null

project: tsl-myproject
repo: github/myorg/myrepo
team: myorg
owner: alice

blocked_by: [b2c4]
blocks: [d4e6]
related: [e5f7]

tags: [deployment, uat]
---

## Description
...
```

## Common Pitfalls (Manual Editing)

When editing task files directly, run `qt lint` to catch issues:

| Issue | Example | Fix |
|-------|---------|-----|
| Duplicate keys | Two `blocked_by:` lines | Update in place, don't add new |
| Numeric IDs | `blocks: [9600]` | Quote: `blocks: ['9600']` |
| Invalid status | `status: planned` | Use: inbox/active/blocked/done/cancelled |

**Note**: `qt edit` opens $EDITOR but doesn't support inline flags like `--due`.

## Composable Piping

```bash
# Find P0 tasks in JSON
qt list --priority P0 --json | jq '.tasks[]'

# Count blocked tasks
qt blocked --json | jq '.count'

# Export for external tools
qt list --json > tasks.json
```

## Interactive Workflows

When user intent matches these triggers, load the corresponding workflow:

| Trigger phrases | Workflow |
|-----------------|----------|
| "standup", "morning", "what to focus on" | [STANDUP](references/workflows/STANDUP.md) |
| "triage", "inbox", "new tasks" | [TRIAGE](references/workflows/TRIAGE.md) |
| "loop", "for each", "collect status", "interview" | [STATUS-COLLECTION](references/workflows/STATUS-COLLECTION.md) |
| "weekly", "review", "retrospective" | [WEEKLY-REVIEW](references/workflows/WEEKLY-REVIEW.md) |
| "archive", "cleanup", "old completed" | [ARCHIVE](references/workflows/ARCHIVE.md) |
| "sync", "update progress", "consistency" | [SYNC](references/workflows/SYNC.md) |
| "publish", "make public", "share" | [PUBLISH](references/workflows/PUBLISH.md) |

## Detailed References

- [FRONTMATTER.md](references/FRONTMATTER.md) - Complete task schema
- [DEPENDENCIES.md](references/DEPENDENCIES.md) - Dependency graph patterns
