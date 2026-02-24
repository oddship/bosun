---
name: q-roadmaps
description: Roadmap planning skill for Q agent. Provides qr CLI for roadmap CRUD and project aggregation. Use when planning quarterly roadmaps or coordinating across teams.
---

# Q Roadmaps Skill

Strategic planning layer for the Q agent system. Aggregates projects into roadmaps.

## What I Do

- Create, update, and query roadmaps
- Aggregate projects into roadmaps
- Calculate roadmap progress from projects
- Coordinate across teams via repo ownership

## When to Use Me

Use this skill when:
- Creating or editing roadmaps (`qr new`)
- Viewing roadmap project lists (`qr projects`)
- Checking roadmap progress (`qr progress`)
- Planning quarterly goals

Do NOT use for:
- Individual task operations (use q-tasks skill)
- Project management (use q-projects skill)
- Cross-module sync (use q-review skill)

## Script Location

The `qr` CLI script is located at:
```
.pi/skills/q-roadmaps/scripts/qr
```

Run with full path: `.pi/skills/q-roadmaps/scripts/qr <command>`

## Quick Start

```bash
# Create a roadmap
.pi/skills/q-roadmaps/scripts/qr new "Q1 2026" --teams frontend,backend

# List roadmaps
qr list

# View roadmap projects
qr projects myorg-q1-2026

# Check progress
qr progress myorg-q1-2026
```

## CLI Reference

### Core Operations

| Command | Description |
|---------|-------------|
| `qr list` | List all roadmaps |
| `qr show <id>` | Display roadmap details |
| `qr new "name" --teams <t>` | Create new roadmap |

**New options:**
- `--teams <teams>` - Comma-separated team names (required)
- `--start YYYY-MM-DD` - Start date
- `--end YYYY-MM-DD` - End date

### Project Composition

| Command | Description |
|---------|-------------|
| `qr projects <id>` | List roadmap projects |
| `qr progress <id>` | Calculate progress |

### Publishing

| Command | Description |
|---------|-------------|
| `qr publish <id>` | Move to public/roadmaps/ |

### Update Log

| Command | Description |
|---------|-------------|
| `qr log` | Recent updates |
| `qr log <id>` | Updates for roadmap |

## Roadmap Lifecycle

Roadmaps are **living documents** - they are NEVER archived.

```
active -> completed (when all projects done)
```

## Progress Calculation

```
progress = avg(project_progress for each project)
```

Health derivation (based on blockers, NOT calendar):
- **green**: No blockers, work progressing
- **yellow**: Has blockers, but path forward exists
- **red**: Critical blockers, needs intervention

## Planning Philosophy

Focus on ORDER and EFFORT, not calendar predictions:
- List goals in priority/dependency order
- Use effort points (0-10), not time estimates
- Define milestones as completions ("after X") not dates ("by Jan 15")
- NO monthly breakdowns (January goals, February goals, etc.)

## File Format

```yaml
---
id: myorg-q1-2026
title: Platform Q1 2026 Roadmap
status: active
created: 2026-01-01
updated: 2026-01-08
owner: alice

teams: [frontend, backend]
repos:
  - github/myorg/*

projects: [tsl-myproject, market-protection]
start: 2026-01-01
end: 2026-03-31

health: green
progress: 0.45
---

## Overview
...
```

## Detailed References

- [FRONTMATTER.md](references/FRONTMATTER.md) - Complete roadmap schema
