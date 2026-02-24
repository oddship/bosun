---
name: q-review
description: Review and sync skill for Q agent. Monitors changes across tasks/projects/roadmaps, maintains update logs, and ensures consistency. Use after bulk changes or during standups.
---

# Q Review Skill

Cross-module sync and consistency layer for the Q agent system.

## What I Do

- Propagate changes across modules (task -> project -> roadmap)
- Maintain update logs for team visibility
- Verify consistency of dependency graphs
- Identify stale items and inconsistencies

## When to Use Me

Use this skill when:
- After completing multiple tasks
- During standup/weekly review
- When something seems out of sync
- After bulk task updates
- When publishing items

Do NOT use for:
- Individual task operations (use q-tasks)
- Project management (use q-projects)
- Roadmap planning (use q-roadmaps)

## Sync Operations

### 1. Task -> Project Sync

When tasks are marked done:
- Find the task's project
- Recalculate project progress
- Update project health
- Log the change

### 2. Project -> Roadmap Sync

When project progress changes:
- Find the project's roadmap
- Recalculate roadmap progress
- Log the change

### 3. Blocker Resolution

When a blocking task is done:
- Find tasks blocked by it
- Update their status (blocked -> active)
- Log the unblock event

### 4. Update Log Maintenance

Append timestamped entries to `_update-log.md`:
```markdown
## 2026-01-08

### a3f9: Deploy GTT v2
- **12:30** Status: active -> done
- **12:30** Unblocked: b2c4, c3d5
```

## Consistency Checks

Run these checks during review:

| Check | Issue | Resolution |
|-------|-------|------------|
| Orphan tasks | Task has invalid project ref | Clear project field |
| Ghost deps | blocked_by refs non-existent task | Remove from blocked_by |
| Stale items | No updates in 30+ days | Tag for review |
| Progress mismatch | Project progress != task counts | Recalculate |

## Workflow Integration

### After Bulk Task Updates
```
1. Complete tasks via qt done
2. Load q-review skill
3. Run sync to propagate changes
4. Review update logs
```

### During Standup
```
1. Check blocked tasks
2. Review stale items
3. Sync progress across modules
4. Identify inconsistencies
```

## Using mcp_question

### When inconsistencies found:
```
question: "Found 3 orphan tasks. How to handle?"
header: "Orphans"
options:
  - label: "Clear refs"
    description: "Remove invalid project references"
  - label: "Create project"
    description: "Group under 'Uncategorized'"
  - label: "Review each"
    description: "Show tasks for manual review"
```

### When stale items detected:
```
question: "5 tasks haven't been updated in 30+ days"
header: "Stale"
options:
  - label: "Show list"
    description: "Display stale tasks"
  - label: "Tag for review"
    description: "Add 'needs-review' tag"
  - label: "Skip"
    description: "Ignore for now"
```

## File Locations

- Task logs: `workspace/users/{user}/tasks/_update-log.md`
- Project logs: `workspace/users/{user}/projects/_update-log.md`
- Roadmap logs: `workspace/users/{user}/roadmaps/_update-log.md`

## Agent Responsibilities

The q-review-agent handles:
- Monitoring changes
- Propagating updates
- Maintaining logs
- Verifying consistency
- Flagging issues for Q

It does NOT:
- Make strategic decisions
- Create new items
- Delete or archive items
- Interact directly with users
