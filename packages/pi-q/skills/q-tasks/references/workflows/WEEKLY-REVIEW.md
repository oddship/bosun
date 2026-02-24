# Weekly Review Workflow

End-of-week review across tasks, projects, and roadmaps.

## Steps

```bash
# 1. Review completed tasks this week
qt list --status done

# 2. Review project progress
qp list
qp progress <project-id>  # for each active project

# 3. Check roadmap health (if using roadmaps)
qr list
qr progress <roadmap-id>  # for each active roadmap

# 4. Identify stale items (no updates in 7+ days)
# Review tasks and projects that haven't been touched
```

## Summary Generation

Generate weekly summary covering:
- Tasks completed this week
- Progress on projects
- Blockers resolved
- New blockers identified
- Focus areas for next week

## Interaction

Ask about next week priorities:

```
question: "What are your priorities for next week?"
header: "Next Week"
multiple: true
options: [list of active projects and P0/P1 tasks]
```

## Output

- Weekly summary document
- Next week's focus areas confirmed
