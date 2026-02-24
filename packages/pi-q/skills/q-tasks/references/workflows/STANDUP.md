# Standup Workflow

Morning standup to review state and pick focus.

## Steps

```bash
# 1. Show inbox tasks
qt list --status inbox

# 2. Show due today
qt list --due today

# 3. Show blocked tasks
qt blocked

# 4. Show recent updates
cat workspace/users/$USER/tasks/_update-log.md | head -50
```

## Interaction

Summarize findings, then ask:

```
question: "What should you focus on today?"
header: "Focus"
options: [top 3 priority items from analysis]
```

## Output

- Summary of inbox, due today, blocked
- User's chosen focus for the day
