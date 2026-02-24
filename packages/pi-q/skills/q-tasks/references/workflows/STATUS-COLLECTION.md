# Status Collection Workflow

Loop over tasks and collect status updates interactively.

## Steps

```bash
# 1. Get tasks (filtered by tag, project, or custom query)
qt list -t deploy --json | jq '.tasks[]'

# Or by project
qt list --project myproject --json | jq '.tasks[]'

# Or by priority
qt list --priority P0 --json | jq '.tasks[]'
```

## Interaction

**For each task**, ask:

```
question: "Status update for: {task.title}?"
header: "Status"
options:
  - label: "Done"
    description: "Mark as completed"
  - label: "In progress"
    description: "Still working on it"
  - label: "Blocked"
    description: "New blocker emerged"
  - label: "Reschedule"
    description: "Push to later date"
  - label: "No change"
    description: "Status unchanged"
```

If "Blocked" selected, follow up:

```
question: "What's blocking {task.title}?"
header: "Blocker"
options: [list of other active tasks that could be blockers]
# custom input enabled for external blockers
```

If "Reschedule" selected, follow up:

```
question: "New due date for {task.title}?"
header: "Due Date"
options:
  - label: "Tomorrow"
  - label: "End of week"
  - label: "Next week"
  - label: "Next month"
```

## Output

Summary of changes:
- N tasks marked done
- M tasks still in progress  
- K tasks blocked
- L tasks rescheduled
