# Archive Workflow

Review and archive old completed items.

## Steps

```bash
# 1. Preview candidates
qt archive --dry-run
qp archive --dry-run
```

## Interaction

Show summary, then ask:

```
question: "Archive these completed items?"
header: "Archive"
options:
  - label: "Archive all"
    description: "Move all {X} tasks and {Y} projects to archive"
  - label: "Tasks only"
    description: "Archive {X} tasks, skip projects"
  - label: "Projects only"
    description: "Archive {Y} projects, skip tasks"
  - label: "Review individually"
    description: "Show each item for confirmation"
  - label: "Skip"
    description: "Don't archive anything now"
```

### Individual Review Mode

If "Review individually" selected, for each item:

```
question: "Archive: {item.title} (completed {date})?"
header: "Confirm"
options:
  - label: "Archive"
    description: "Move to archive"
  - label: "Keep"
    description: "Don't archive yet"
  - label: "Reopen"
    description: "Set back to active"
```

## Execution

```bash
qt archive --older-than 30d
qp archive --older-than 60d
```

## Output

Report:
- Tasks archived: N (moved to archive/YYYY-MM/)
- Projects archived: M (moved to archive/YYYY-MM/)

## Notes

- Roadmaps are NEVER archived (living documents)
- Archive retention: Tasks 30 days, Projects 60 days
- Archived items are kept forever (no deletion)
- Use `--include-archived` flag to query archived items
