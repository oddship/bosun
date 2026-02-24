# Project Frontmatter Schema

Complete schema for project files in `workspace/users/{username}/projects/`.

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Kebab-case identifier |
| `title` | string | Project title |
| `status` | enum | planning, active, blocked, completed, archived |
| `priority` | enum | P0, P1, P2, P3 |
| `created` | date | ISO date (YYYY-MM-DD) |
| `updated` | date | ISO date, auto-updated on changes |

## Optional Fields

### Temporal

| Field | Type | Description |
|-------|------|-------------|
| `due` | date | Due date |
| `completed` | date | Completion date |
| `archived` | date | Archive date |

### Ownership

| Field | Type | Description |
|-------|------|-------------|
| `owner` | string | Project owner username |
| `repos` | array | Repository paths |
| `team` | string | Team name (derived from repos) |
| `stakeholders` | array | Interested parties |

### Composition

| Field | Type | Description |
|-------|------|-------------|
| `roadmap` | string | Parent roadmap ID |
| `promoted_from` | string | If promoted from task (format: `task:id`) |
| `promoted_to` | string | If promoted to roadmap |
| `parent` | string | Parent project ID |
| `children` | array | Child project IDs |

### Tracking

| Field | Type | Description |
|-------|------|-------------|
| `health` | enum | green, yellow, red |
| `progress` | number | 0.0 - 1.0 |

### Flexible Metadata

| Field | Type | Description |
|-------|------|-------------|
| `tags` | array | Arbitrary tags |
| `wiki` | string | Wiki page reference |
| `sprint` | string | Sprint identifier |

## Zod Schema

```typescript
import { z } from "zod";

const ProjectSchema = z.object({
  // Required
  id: z.string(),
  title: z.string().min(1),
  status: z.enum(["planning", "active", "blocked", "completed", "archived"]),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

  // Optional temporal
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  completed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  archived: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),

  // Optional ownership
  owner: z.string().optional().nullable(),
  repos: z.array(z.string()).optional().default([]),
  team: z.string().optional().nullable(),
  stakeholders: z.array(z.string()).optional().default([]),

  // Optional composition
  roadmap: z.string().optional().nullable(),
  promoted_from: z.string().optional().nullable(),
  promoted_to: z.string().optional().nullable(),
  parent: z.string().optional().nullable(),
  children: z.array(z.string()).optional().default([]),

  // Optional tracking
  health: z.enum(["green", "yellow", "red"]).optional().default("green"),
  progress: z.number().min(0).max(1).optional().default(0),

  // Optional metadata
  tags: z.array(z.string()).optional().default([]),
  wiki: z.string().optional().nullable(),
  sprint: z.string().optional().nullable(),
}).passthrough();

export type Project = z.infer<typeof ProjectSchema>;
```

## Example Project File

```markdown
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
stakeholders: [kailash, vivek]

roadmap: myorg-q1-2026
promoted_from: task:x7y8
promoted_to: null
parent: null
children: []

health: green
progress: 0.80

tags: [infrastructure, trading]
wiki: myorg/myproject
sprint: 2026-w02
---

## Overview

Migrate the GTT (Good Till Triggered) system to v2 architecture with support for Trailing Stop Loss (TSL) orders.

## Goals

- [ ] TSL support in GTT engine
- [x] UAT environment setup
- [x] API compatibility layer
- [ ] Production deployment

## Milestones

1. **Phase 1**: Engine updates (complete)
2. **Phase 2**: API layer (in progress)
3. **Phase 3**: UAT testing (pending)
4. **Phase 4**: Production rollout (pending)

## Notes

Key decisions and context for the project.

## Risks

- Engine performance under load
- Backward compatibility with v1 orders
```

## ID Generation

Project IDs are kebab-case strings derived from the title:

```typescript
function generateProjectId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}
```

## Status Transitions

Valid transitions:

```
planning -> active
active -> blocked
active -> completed
blocked -> active
blocked -> completed
completed -> archived
archived -> active (reopen)
```
