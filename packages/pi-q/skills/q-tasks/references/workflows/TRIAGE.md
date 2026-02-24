# Triage Workflow

Process inbox tasks interactively.

## Steps

```bash
# 1. Get inbox tasks
qt list --status inbox --json
```

## Interaction

**For each inbox task**, ask:

```
question: "How should we handle: {task.title}?"
header: "Triage"
options:
  - label: "Activate (P0)"
    description: "High priority, do immediately"
  - label: "Activate (P1)"
    description: "Important, do this week"
  - label: "Activate (P2)"
    description: "Normal priority"
  - label: "Defer (P3)"
    description: "Low priority, do when possible"
  - label: "Cancel"
    description: "Don't do this task"
```

Update tasks based on responses.

## Batch Mode

For many inbox items, offer mode selection first:

```
question: "You have N inbox items. Triage one-by-one or batch?"
header: "Mode"
options:
  - label: "One by one"
    description: "Review each task individually"
  - label: "Batch by project"
    description: "Group by project and prioritize"
  - label: "Quick sort"
    description: "Just set priorities, skip details"
```

## Output

Summary report:
- X tasks activated
- Y tasks deferred
- Z tasks cancelled
