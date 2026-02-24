# Advanced Extension Patterns

Patterns learned from production experience building Pi extensions.

## Environment Constraints

Extensions run in Pi's context with some limitations:

- Node.js environment (not browser)
- Access to filesystem, network, child processes
- Can import npm packages from node_modules
- TypeScript compiled via jiti (no separate build step)

## State Management

### Reconstructing State from Session

Extensions with state should store it in tool result `details` for proper branching support:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let items: string[] = [];

  // Reconstruct state from session on startup
  pi.on("session_start", async (_event, ctx) => {
    items = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "toolResult") {
        if (entry.message.toolName === "my_tool") {
          items = entry.message.details?.items ?? [];
        }
      }
    }
  });

  pi.registerTool({
    name: "my_tool",
    // ...
    async execute(toolCallId, params, onUpdate, ctx, signal) {
      items.push(params.item);
      return {
        content: [{ type: "text", text: "Added" }],
        details: { items: [...items] },  // Store for reconstruction
      };
    },
  });
}
```

### Persistent Entries

For state that doesn't fit in tool results, use `pi.appendEntry()`:

```typescript
pi.appendEntry("my-extension-state", { count: 42, lastUpdated: Date.now() });

// Restore on reload
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === "my-extension-state") {
      // Reconstruct from entry.data
    }
  }
});
```

## Event Filtering

### Filtering by Source

When sending messages that trigger turns, filter to prevent loops:

```typescript
pi.on("input", async (event, ctx) => {
  // Skip messages sent by extensions
  if (event.source === "extension") {
    return { action: "continue" };
  }
  
  // Process user input
  // ...
});
```

### Debouncing Events

For events that fire frequently:

```typescript
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

pi.on("tool_result", async (event, ctx) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  
  debounceTimer = setTimeout(() => {
    // Process after 500ms of no events
    processResults();
    debounceTimer = null;
  }, 500);
});
```

## Tool Interception

### Blocking Dangerous Commands

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash") {
    const cmd = event.input.command || "";
    
    // Block destructive commands
    if (cmd.includes("rm -rf") || cmd.includes("sudo")) {
      const confirmed = await ctx.ui.confirm(
        "Dangerous Command",
        `Allow: ${cmd}?`
      );
      if (!confirmed) {
        return { block: true, reason: "Blocked by user" };
      }
    }
  }
});
```

### Modifying Tool Results

```typescript
pi.on("tool_result", async (event, ctx) => {
  if (event.toolName === "read") {
    // Add metadata to read results
    const enhanced = event.content.map(c => {
      if (c.type === "text") {
        return { ...c, text: `[Read at ${new Date().toISOString()}]\n${c.text}` };
      }
      return c;
    });
    return { content: enhanced };
  }
});
```

## Custom Message Injection

### Adding Context Before Agent Runs

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  // Inject a message with project context
  return {
    message: {
      customType: "project-context",
      content: "Remember: This is a TypeScript project using Bun.",
      display: false,  // Don't show in TUI but send to LLM
    }
  };
});
```

### Modifying System Prompt

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  return {
    systemPrompt: event.systemPrompt + `\n\nCurrent time: ${new Date().toISOString()}`
  };
});
```

## Multi-Extension Communication

### Event Bus

```typescript
// Extension A
pi.events.emit("my-ext:task-completed", { taskId: 123 });

// Extension B
pi.events.on("my-ext:task-completed", (data) => {
  console.log(`Task ${data.taskId} completed`);
});
```

### Shared State via Custom Entries

Extensions can read each other's custom entries:

```typescript
// Extension A writes
pi.appendEntry("shared-state", { value: 42 });

// Extension B reads
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === "shared-state") {
      // Use entry.data
    }
  }
});
```

## Error Handling

### Graceful Degradation

```typescript
pi.on("session_start", async (_event, ctx) => {
  try {
    await initializeExternalService();
  } catch (err) {
    ctx.ui.notify(`Extension degraded: ${err.message}`, "warning");
    // Continue with limited functionality
  }
});
```

### Tool Error Handling

```typescript
async execute(toolCallId, params, onUpdate, ctx, signal) {
  try {
    const result = await riskyOperation(params);
    return { content: [{ type: "text", text: result }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
}
```

## Performance Tips

1. **Lazy initialization** - Don't do heavy work in module scope
2. **Cache expensive operations** - Store results across calls
3. **Use streaming updates** - Call `onUpdate` for long operations
4. **Handle cancellation** - Check `signal.aborted` in loops
5. **Debounce events** - Don't process every event immediately

## Testing Extensions

```bash
# Test extension loading
pi -e ./my-extension.ts

# Test with specific prompt
pi -e ./my-extension.ts -p "Test the extension"

# Debug output
DEBUG=pi:* pi -e ./my-extension.ts
```
