---
name: background-processes
description: Use when starting dev servers, long-running processes, or any command that shouldn't block. Covers createBackgroundProcess patterns and common mistakes.
---

# Background Processes

How to run long-running commands (dev servers, watchers, Docker) without blocking.

## When to Use

- Starting a dev server (`yarn dev`, `npm start`, `go run`)
- Running Docker compose in background
- Any command that runs indefinitely
- Watching file changes

## Key Pattern: createBackgroundProcess with cd

The `createBackgroundProcess` tool does **NOT** have a `workdir` parameter!

### WRONG (Common Mistake!)

```javascript
// This FAILS - workdir is NOT a valid parameter!
createBackgroundProcess({
  command: "yarn dev",
  workdir: "/path/to/project"  // ❌ DOES NOT EXIST
})

// This also FAILS - runs in wrong directory
createBackgroundProcess({
  command: "yarn dev",
  name: "dev-server"
})
```

### CORRECT

```javascript
createBackgroundProcess({
  command: "cd /full/path/to/project && yarn dev",
  name: "my-dev-server",
  tags: ["project-name", "dev-server"]
})
```

### With Environment Variable

```javascript
createBackgroundProcess({
  command: "cd $BOSUN_ROOT/workspace/code/worktrees/github.com/myorg/frontend/my-branch && yarn dev",
  name: "dev-server",
  tags: ["frontend", "dev-server"]
})
```

Note: `$BOSUN_ROOT` expands to `/home/$USER/Documents/Code/github.com/bosun`

## Tool Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | Yes | Full command with `cd` prefix |
| `name` | string | No | Human-readable name |
| `tags` | array | No | Tags for filtering |
| `global` | boolean | No | Persist across sessions |

## Managing Background Processes

```javascript
// List all running processes
listBackgroundProcesss({})

// Get specific process details and output
getBackgroundProcess({ taskId: "task-xxx" })

// Kill a specific process
killTasks({ taskId: "task-xxx" })

// Kill by tag
killTasks({ tags: ["dev-server"] })
```

## Common Patterns

### Dev Server + Docker Proxy

```javascript
// Start dev server
createBackgroundProcess({
  command: "cd /path/to/frontend/branch && yarn dev",
  name: "dev-server",
  tags: ["frontend", "dev-server"]
})

// Start Docker proxy
createBackgroundProcess({
  command: "cd /path/to/frontend/branch/dev && docker compose up",
  name: "api-proxy",
  tags: ["frontend", "docker-proxy"]
})
```

### Go Backend

```javascript
createBackgroundProcess({
  command: "cd /path/to/backend/branch && go run ./cmd/backend",
  name: "backend",
  tags: ["backend", "backend"]
})
```

## Common Mistakes

### Mistake 1: Assuming workdir Parameter Exists

The tool signature is: `command`, `name`, `tags`, `global`. 
There is NO `workdir` parameter. Always use `cd <path> && command`.

### Mistake 2: Using Bash Tool for Dev Servers

The Bash tool blocks until the command completes. For dev servers that run indefinitely, use `createBackgroundProcess`.

```javascript
// WRONG - blocks forever
bash({ command: "yarn dev", workdir: "/path" })

// CORRECT - runs in background
createBackgroundProcess({ command: "cd /path && yarn dev" })
```

### Mistake 3: Relative Paths

Always use full absolute paths. The background process doesn't inherit the current working directory context.

### Mistake 4: Forgetting to Check if Already Running

Before starting a new dev server, check if one is already running:

```javascript
listBackgroundProcesss({ tags: ["dev-server"] })
// Check output, kill if needed, then start new one
```

## Source

Derived from session debugging where createBackgroundProcess was incorrectly used multiple times.
