# Sync Workflow

Sync updates across Q modules (tasks, projects, roadmaps).

## Steps

```bash
# 1. Check for completed tasks
qt list --status done --json

# 2. Update project progress
qp progress <project-id>  # for each project with completed tasks

# 3. Update roadmap progress
qr progress <roadmap-id>  # for each roadmap with updated projects
```

## Blocker Resolution

Check for resolved blockers:
- Find tasks that were blocked
- Check if their blockers are now done
- Update status: blocked -> active

## Consistency Check

Verify consistency:
- Orphan tasks (invalid project refs)
- Ghost dependencies (invalid blocked_by refs)

## Interaction

If inconsistencies found:

```
question: "Found {N} inconsistencies. How to handle?"
header: "Fix"
options:
  - label: "Auto-fix all"
    description: "Clear invalid references automatically"
  - label: "Review each"
    description: "Show details for manual decision"
  - label: "Skip"
    description: "Ignore for now"
```

## Output

Sync report:
```json
{
  "tasks_synced": N,
  "projects_updated": M,
  "roadmaps_updated": K,
  "blockers_resolved": L,
  "inconsistencies": [...]
}
```
