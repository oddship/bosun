# Document Templates

Templates for plans, handoffs, and forks.

## Plan Template

```markdown
# Plan: [Title]

**Effort: X/10** (0=trivial, 10=very complex. No time estimates.)

## Context
- Brief summary of the task
- Relevant background information
- Links to related files/documentation

## Success Criteria
- Clear, measurable outcomes
- How we'll know the task is complete

## Approach
- High-level strategy
- Key design decisions
- Trade-offs considered

## Phases

Group implementation into phases. Each phase ends with a gate (verify + review) before committing.

### Phase 1: [Name]
- [ ] Step 1
- [ ] Step 2
- Files: `path/to/file1.ext`, `path/to/file2.ext`
- **Gate**: `spawn_agent({ agent: "verify", ... })` then `spawn_agent({ agent: "review", ... })` then commit

### Phase 2: [Name]
- [ ] Step 1
- [ ] Step 2
- Files: `path/to/file3.ext`
- **Gate**: `spawn_agent({ agent: "verify", ... })` then `spawn_agent({ agent: "review", ... })` then commit

<!-- For simple tasks (effort 1-3), a single phase is fine. -->
<!-- For complex tasks, add milestone dry checks between phase groups. -->

## Testing Strategy
- How to verify the changes work
- Test cases to add/modify

## Risks & Considerations
- Potential issues
- Migration concerns
- Breaking changes

## Rollback Plan
- How to undo changes if needed
```

## Handoff Template

```markdown
---
type: handoff
status: pending
created: {ISO timestamp}
picked_up_at: null
title: "{title}"
session_id: {sessionID}
files_modified:
  - path/to/file1
  - path/to/file2
---

# Handoff: {title}

## Context
[Summarize what was being worked on]

## Key Decisions
[Important decisions made during the session]

## Current State
- What's completed
- What's in progress
- What's blocked

## Next Steps
1. [First next step]
2. [Second next step]

## Files Modified
- `path/to/file1` - what changed
- `path/to/file2` - what changed

## Q Updates
<!-- If Q task context was provided -->
Task: {taskID} - {taskTitle}

When picking up:
- Review task: `qt show {taskID}`
- Add progress notes: `qt edit {taskID}`
- If blocked, update status and blockers

<!-- If no Q task context -->
No Q task linked. If working on a tracked issue:
- Link progress: `qt edit <task-id>`

---
*Handoff from session: {sessionID}*
*Continue with: /pickup {path}*
```

## Fork Template

```markdown
---
type: fork
status: pending
created: {ISO timestamp}
picked_up_at: null
title: "{exploration reason}"
branching_reason: experiment
session_id: {sessionID}
original_session_title: "{original title}"
files_at_fork:
  - path/to/file1
  - path/to/file2
---

# Fork: {exploration reason}

## Branching Point
[Describe what was figured out / current state when creating this fork]

From session: {original title}

## Exploration Direction
{What this fork is meant to explore}

## What to Try
1. [First thing to explore]
2. [Second thing to explore]

## Success Criteria
- [How will we know this direction is better/worse?]

## Notes
[Any relevant context for this exploration]

## Q Updates
<!-- If Q task context was provided -->
Task: {taskID} - {taskTitle}

If this exploration yields results:
- Update task notes: `qt edit {taskID}`
- If this becomes separate work: `qt add "..." --related {taskID}`

<!-- If no Q task context -->
No Q task linked. If working on a tracked issue:
- Link exploration: `qt edit <task-id>`

---
*Fork from session: {sessionID}*
*Continue with: /pickup {path}*
```

## Frontmatter Fields

### Plan
| Field | Type | Description |
|-------|------|-------------|
| title | string | Plan title |
| status | string | active, completed, abandoned |
| created | string | ISO timestamp |

### Handoff
| Field | Type | Description |
|-------|------|-------------|
| type | string | Always "handoff" |
| status | string | pending, picked_up |
| created | string | ISO timestamp |
| picked_up_at | string | ISO timestamp when picked up |
| title | string | Session/work title |
| session_id | string | Original session ID |
| files_modified | array | List of modified file paths |
| q_task | string | Optional Q task ID if working on tracked issue |

### Fork
| Field | Type | Description |
|-------|------|-------------|
| type | string | Always "fork" |
| status | string | pending, picked_up |
| created | string | ISO timestamp |
| picked_up_at | string | ISO timestamp when picked up |
| title | string | Exploration reason |
| branching_reason | string | experiment, alternative, rollback |
| session_id | string | Original session ID |
| original_session_title | string | What was being worked on |
| files_at_fork | array | List of files at fork point |
| q_task | string | Optional Q task ID if working on tracked issue |
