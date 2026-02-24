# Task Dependency Management

## Dependency Model

Tasks form a directed acyclic graph (DAG) through dependency relationships.

### Dependency Types

| Field | Direction | Meaning |
|-------|-----------|---------|
| `blocked_by` | Incoming | Tasks that must complete before this one |
| `blocks` | Outgoing | Tasks waiting on this one |
| `related` | Bidirectional | Related but not blocking |

### Example Graph

```
     b2c4 (UAT sign-off)
       |
       v blocks
     a3f9 (Deploy GTT)
      /  \
     v    v blocks
   d4e6  e5f7
```

In this example:
- a3f9.blocked_by = [b2c4]
- a3f9.blocks = [d4e6, e5f7]
- b2c4.blocks = [a3f9]
- d4e6.blocked_by = [a3f9]
- e5f7.blocked_by = [a3f9]

## Automatic Status Updates

When `blocked_by` is set or cleared:

1. **Adding blocker**: If task is `active` and `blocked_by` becomes non-empty, status -> `blocked`
2. **Clearing blockers**: If task is `blocked` and `blocked_by` becomes empty, status -> `active`
3. **Completing blocker**: When a blocking task is marked `done`, it's removed from `blocked_by` arrays

## Cycle Detection

Before adding a dependency, check for cycles:

```typescript
function wouldCreateCycle(taskId: string, newBlockerId: string, tasks: Map<string, Task>): boolean {
  // BFS from newBlockerId's blocked_by chain
  const visited = new Set<string>();
  const queue = [newBlockerId];
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === taskId) return true; // Cycle detected
    if (visited.has(current)) continue;
    visited.add(current);
    
    const task = tasks.get(current);
    if (task?.blocked_by) {
      queue.push(...task.blocked_by);
    }
  }
  return false;
}
```

## CLI Commands

### View Dependencies

```bash
# Full dependency tree (both directions)
qt deps a3f9

# What's blocking this task
qt deps a3f9 --blocked-by

# What this task blocks
qt deps a3f9 --blocks

# All blocked tasks
qt blocked
```

### Modify Dependencies

```bash
# Add blocker when creating
qt add "New task" --blocked-by b2c4,c3d5

# Add blocker to existing task
qt edit a3f9
# (manually edit blocked_by in frontmatter)

# Clear blockers (mark task as unblocked)
qt unblock a3f9
```

## Dependency Resolution Flow

When a task is marked done:

```typescript
async function onTaskDone(taskId: string) {
  // 1. Update the task itself
  task.status = "done";
  task.done = today();
  task.updated = today();
  
  // 2. Find tasks blocked by this one
  const dependents = findTasksBlockedBy(taskId);
  
  for (const dep of dependents) {
    // 3. Remove this task from their blocked_by
    dep.blocked_by = dep.blocked_by.filter(id => id !== taskId);
    
    // 4. If no more blockers and status is blocked, activate
    if (dep.blocked_by.length === 0 && dep.status === "blocked") {
      dep.status = "active";
    }
    
    dep.updated = today();
    await saveTask(dep);
    await logUpdate(dep, `Unblocked by completion of ${taskId}`);
  }
  
  await saveTask(task);
  await logUpdate(task, "Status: active -> done");
}
```

## Visualization

The `qt deps` command outputs an ASCII tree:

```
a3f9: Deploy GTT v2 [blocked]
├── blocked_by:
│   └── b2c4: UAT sign-off [active]
└── blocks:
    ├── d4e6: Update docs [inbox]
    └── e5f7: Notify users [inbox]
```

With `--json`:

```json
{
  "task_id": "a3f9",
  "title": "Deploy GTT v2",
  "status": "blocked",
  "blocked_by": [
    { "id": "b2c4", "title": "UAT sign-off", "status": "active" }
  ],
  "blocks": [
    { "id": "d4e6", "title": "Update docs", "status": "inbox" },
    { "id": "e5f7", "title": "Notify users", "status": "inbox" }
  ]
}
```

## Best Practices

1. **Keep dependencies shallow**: Avoid long chains (> 3 levels)
2. **Use related for context**: Non-blocking relationships use `related`
3. **Document why blocked**: Add notes when setting blockers
4. **Review blocked tasks daily**: Part of standup workflow (see `workflows/STANDUP.md`)
5. **Clean up stale blockers**: Archive or cancel orphan blockers
