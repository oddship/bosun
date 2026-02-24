# Task Frontmatter Schema

Complete schema for task files in `workspace/users/{username}/tasks/`.

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | 4-character unique identifier |
| `title` | string | Task title |
| `status` | enum | inbox, active, blocked, done, cancelled |
| `priority` | enum | P0, P1, P2, P3 |
| `created` | date | ISO date (YYYY-MM-DD) |
| `updated` | date | ISO date, auto-updated on changes |

## Optional Fields

### Temporal

| Field | Type | Description |
|-------|------|-------------|
| `due` | date | Due date |
| `done` | date | Completion date (set when status -> done) |
| `archived` | date | Archive date (set when archived) |

### Composition

| Field | Type | Description |
|-------|------|-------------|
| `project` | string | Parent project ID |
| `promoted_from` | string | If promoted from another task |
| `promoted_to` | string | If promoted to project |

### Team Context

| Field | Type | Description |
|-------|------|-------------|
| `repo` | string | Repository path (e.g., github/myorg/myrepo) |
| `team` | string | Team name (derived from repo) |
| `owner` | string | Task owner username |
| `assignees` | array | Assigned usernames |
| `stakeholders` | array | Interested parties |

### Dependencies

| Field | Type | Description |
|-------|------|-------------|
| `blocked_by` | array | Task IDs blocking this task |
| `blocks` | array | Task IDs this task blocks |
| `related` | array | Related task IDs (non-blocking) |

> **Important**: All IDs must be strings. Quote numeric IDs like `'9600'` to prevent YAML parsing them as numbers.

### Flexible Metadata

These fields are optional and extensible:

| Field | Type | Description |
|-------|------|-------------|
| `tags` | array | Arbitrary tags |
| `effort` | string | Effort estimate (e.g., "2h", "1d") |
| `sprint` | string | Sprint identifier |
| `milestone` | string | Milestone name |
| `risk` | enum | low, medium, high |

## Zod Schema

```typescript
import { z } from "zod";

const TaskSchema = z.object({
  // Required
  id: z.string().length(4),
  title: z.string().min(1),
  status: z.enum(["inbox", "active", "blocked", "done", "cancelled"]),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

  // Optional temporal
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  done: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  archived: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),

  // Optional composition
  project: z.string().optional().nullable(),
  promoted_from: z.string().optional().nullable(),
  promoted_to: z.string().optional().nullable(),

  // Optional team
  repo: z.string().optional().nullable(),
  team: z.string().optional().nullable(),
  owner: z.string().optional().nullable(),
  assignees: z.array(z.string()).optional().default([]),
  stakeholders: z.array(z.string()).optional().default([]),

  // Optional dependencies
  blocked_by: z.array(z.string()).optional().default([]),
  blocks: z.array(z.string()).optional().default([]),
  related: z.array(z.string()).optional().default([]),

  // Optional metadata
  tags: z.array(z.string()).optional().default([]),
  effort: z.string().optional().nullable(),
  sprint: z.string().optional().nullable(),
  milestone: z.string().optional().nullable(),
  risk: z.enum(["low", "medium", "high"]).optional().nullable(),
}).passthrough(); // Allow additional fields

export type Task = z.infer<typeof TaskSchema>;
```

## Example Task File

```markdown
---
id: a3f9
title: Deploy GTT v2 to production
status: blocked
priority: P0
created: 2026-01-08
updated: 2026-01-10
due: 2026-01-15
done: null

project: tsl-myproject
repo: github/myorg/myrepo
team: myorg
owner: alice
assignees: [alice]
stakeholders: [kailash, vivek]

blocked_by: [b2c4]
blocks: [d4e6, e5f7]
related: []

tags: [deployment, production, uat]
effort: 2h
sprint: 2026-w02
milestone: v2.0-release
risk: high
---

## Description

Deploy the GTT v2 service to production after UAT sign-off is received.

## Acceptance Criteria

- [ ] UAT sign-off received from QA
- [ ] Deployment runbook updated
- [ ] Monitoring alerts configured
- [ ] Rollback plan documented

## Notes

- Deployment window: 6pm IST
- Requires Kailash's approval
- Coordinate with DBA for schema migration

## Log

- 2026-01-08 12:00: Created task
- 2026-01-08 14:00: Added dependency on b2c4 (UAT sign-off)
- 2026-01-10 09:00: Status changed to blocked
```

## Status Transitions

Valid transitions:

```
inbox -> active
active -> blocked (when blocked_by is set)
active -> done
active -> cancelled
blocked -> active (when blockers cleared)
blocked -> cancelled
done -> active (reopen)
cancelled -> active (reopen)
```

## ID Generation

IDs are 4-character hex strings generated from the first 4 chars of a UUID:

```typescript
function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 4);
}
```
