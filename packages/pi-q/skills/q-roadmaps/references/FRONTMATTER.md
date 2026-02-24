# Roadmap Frontmatter Schema

Complete schema for roadmap files in `workspace/users/{username}/roadmaps/`.

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Kebab-case identifier |
| `title` | string | Roadmap title |
| `status` | enum | active, completed |
| `created` | date | ISO date |
| `updated` | date | ISO date |
| `teams` | array | Team names |

## Optional Fields

### Timeline

| Field | Type | Description |
|-------|------|-------------|
| `start` | date | Start date |
| `end` | date | End date |

### Ownership

| Field | Type | Description |
|-------|------|-------------|
| `owner` | string | Roadmap owner |
| `repos` | array | Repository patterns |

### Composition

| Field | Type | Description |
|-------|------|-------------|
| `projects` | array | Project IDs |
| `promoted_from` | string | If promoted from project |

### Tracking

| Field | Type | Description |
|-------|------|-------------|
| `health` | enum | green, yellow, red |
| `progress` | number | 0.0 - 1.0 |

## Zod Schema

```typescript
const RoadmapSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  status: z.enum(["active", "completed"]),
  created: z.string(),
  updated: z.string(),
  teams: z.array(z.string()),
  
  start: z.string().optional().nullable(),
  end: z.string().optional().nullable(),
  owner: z.string().optional().nullable(),
  repos: z.array(z.string()).optional().default([]),
  projects: z.array(z.string()).optional().default([]),
  promoted_from: z.string().optional().nullable(),
  health: z.enum(["green", "yellow", "red"]).optional().default("green"),
  progress: z.number().optional().default(0),
}).passthrough();
```

## Example Roadmap File

```markdown
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
  - github/frontend/*

projects:
  - tsl-myproject
  - market-protection
  - basket-optimizer

start: 2026-01-01
end: 2026-03-31

health: green
progress: 0.45
---

## Overview

Q1 2026 roadmap for the backend and frontend teams.

## Ordered Goals

1. Launch GTT v2 with TSL support (effort: 8/10)
2. Implement market protection features (effort: 5/10, after #1)
3. Optimize basket order performance (effort: 6/10, parallel to #2)

## Milestones

- GTT v2 UAT complete (blocks market protection)
- Market protection beta (after GTT v2)
- Basket optimizer v1 (independent track)
- All features production-ready

## Blockers & Risks

- Frontend team bandwidth constraints (affects #2, #3)

## Notes

Weekly sync: Fridays 3pm IST
```

## Important Notes

- Roadmaps are **never archived** - they are living documents
- Teams are derived from repo ownership patterns
- Progress is aggregated from project progress
