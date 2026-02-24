---
name: q-projects
description: Project management skill for Q agent. Provides qp CLI for project CRUD, task aggregation, and progress tracking. Use when managing projects or viewing task rollups.
---

# Q Projects Skill

Project management layer for the Q agent system. Composes tasks into projects.

## What I Do

- Create, update, query, and archive projects
- Aggregate tasks into projects
- Calculate project progress from task completion
- Track project health and timelines

## When to Use Me

Use this skill when:
- Creating or editing projects (`qp new`, `qp edit`)
- Viewing project task lists (`qp tasks`)
- Checking project progress (`qp progress`)
- Archiving completed projects (`qp archive`)

Do NOT use for:
- Individual task operations (use q-tasks skill)
- Roadmap planning (use q-roadmaps skill)
- Cross-module sync (use q-review skill)

## Script Location

The `qp` CLI script is located at:
```
.pi/skills/q-projects/scripts/qp
```

Run with full path: `.pi/skills/q-projects/scripts/qp <command>`

## Quick Start

```bash
# Create a project
.pi/skills/q-projects/scripts/qp new "GTT v2 Migration" -p P0 --repo github/myorg/myrepo -t infra,trading

# List active projects
qp list

# View project tasks
qp tasks tsl-myproject

# Check progress
qp progress tsl-myproject

# Archive completed projects
qp archive --older-than 60d
```

## CLI Reference

### Core Operations

| Command | Description |
|---------|-------------|
| `qp list` | List all active projects |
| `qp show <id>` | Display project details |
| `qp new "name" [options]` | Create new project |
| `qp archive <id>` | Archive project |

**List filters:**
- `--status active|completed|archived`
- `--priority P0|P1|P2|P3`
- `--repo <path>`
- `--team <name>`
- `-t, --tags <tags>` - Filter by tags (comma-separated)

**New options:**
- `-p, --priority P0|P1|P2|P3` - Priority (default: P1)
- `-d, --due YYYY-MM-DD` - Due date
- `-t, --tags <tags>` - Comma-separated tags
- `--repo <path>` - Repository path

### Task Composition

| Command | Description |
|---------|-------------|
| `qp tasks <id>` | List project tasks |
| `qp tasks <id> --status active` | Filter by status |
| `qp progress <id>` | Calculate progress |

### Publishing

| Command | Description |
|---------|-------------|
| `qp publish <id>` | Move to public/projects/ |
| `qp unpublish <id>` | Remove from public |

### Update Log

| Command | Description |
|---------|-------------|
| `qp log` | Recent updates |
| `qp log <id>` | Updates for project |

### Archival

| Command | Description |
|---------|-------------|
| `qp archive <id>` | Archive single project |
| `qp archive --dry-run` | Preview eligible |
| `qp archive --older-than 60d` | Archive old completed |
| `qp list --include-archived` | Include archived |
| `qp unarchive <id>` | Restore from archive |

## Project Lifecycle

```
planning -> active -> completed -> [60d] -> archived
              |
           blocked
```

## Progress Calculation

```
progress = completed_tasks / total_tasks
```

Health derivation:
- **green**: progress >= 0.7 or on track
- **yellow**: behind schedule but recoverable  
- **red**: blocked or past deadline

## File Format

Projects are markdown files with YAML frontmatter:

```yaml
---
id: tsl-myproject
title: TSL & GTT v2 Migration
status: active
priority: P0
created: 2025-12-06
updated: 2026-01-08
due: 2026-02-01

owner: alice
repos:
  - github/myorg/myrepo
  - github/myorg/mylib
team: myorg

roadmap: myorg-q1-2026
promoted_from: task:x7y8

health: green
progress: 0.80

stakeholders: [kailash, vivek]
tags: [infrastructure, trading]
---

## Overview
...
```

## Composable Piping

```bash
# Find P0 projects in JSON
qp list --priority P0 --json | jq '.projects[]'

# Get tasks for a project
qp tasks tsl-myproject --json | jq '.tasks[]'

# Export project data
qp show tsl-myproject --json > project.json
```

## Detailed References

- [FRONTMATTER.md](references/FRONTMATTER.md) - Complete project schema
