---
name: meta-extension-creator
description: Create Pi extensions with event handling, commands, and hooks. Use when building extensions that respond to session events or add custom commands.
license: MIT
compatibility: pi
metadata:
  audience: developers
  category: meta
---

# Meta Extension Creator

Create Pi extensions with event handling, commands, and custom functionality.

## What I Do

- Generate properly structured Pi extension files
- Set up TypeScript extensions with correct imports
- Create event handlers for session lifecycle
- Register custom commands
- Guide on extension architecture patterns

## When to Use Me

Use this skill when:
- Creating extensions that respond to events
- Adding custom slash commands
- Building automation extensions
- Setting up session lifecycle hooks

Do NOT use for:
- Creating skills (use meta-skill-creator)
- Creating agents (use meta-agent-creator)
- Creating tools only (use meta-tool-creator - simpler)

## Quick Start

### Basic Extension

Create `.pi/extensions/my-extension/index.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function myExtension(pi: ExtensionAPI) {
  // Register event handlers
  pi.on("session_start", async (event, ctx) => {
    ctx.ui.notify("Session started!", "info");
  });

  pi.on("session_end", async (event, ctx) => {
    // Clean up or log
  });

  // Register a command
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello, ${args || "world"}!`, "info");
    },
  });
}
```

### Extension with Tool

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function myExtension(pi: ExtensionAPI) {
  // Register a tool
  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "Does something useful",
    parameters: Type.Object({
      input: Type.String({ description: "Input data" }),
    }),
    async execute(_toolCallId, params, _onUpdate, ctx, _signal) {
      return {
        content: [{ type: "text", text: `Processed: ${params.input}` }],
      };
    },
  });

  // Register command that uses the tool
  pi.registerCommand("do-thing", {
    description: "Run my tool",
    handler: async (args, ctx) => {
      // Commands can trigger UI actions or modify state
      ctx.ui.notify("Running tool...", "info");
    },
  });
}
```

## Extension Location

- **Project**: `.pi/extensions/<name>/index.ts`
- **Global**: `~/.pi/agent/extensions/<name>/index.ts`

Extensions are auto-discovered via `"extensions": ["extensions/*"]` in settings. No config change needed when adding new extensions to `.pi/extensions/`.

## Available Events

| Event | Description |
|-------|-------------|
| `session_start` | Session begins |
| `session_end` | Session ends |
| `message` | User or assistant message |
| `tool_call` | Tool is being called |
| `tool_result` | Tool returned result |

## Event Handler Signature

```typescript
pi.on("session_start", async (event, ctx) => {
  // event: Event data
  // ctx: ExtensionContext with:
  //   - ctx.ui: UI methods (notify, setStatus, custom)
  //   - ctx.cwd: Current working directory
  //   - ctx.hasUI: Whether UI is available
});
```

## Registering Commands

```typescript
pi.registerCommand("my-command", {
  description: "What this command does",
  handler: async (args, ctx) => {
    // args: string after command name
    // ctx: ExtensionContext
    
    if (args === "help") {
      ctx.ui.notify("Usage: /my-command <arg>", "info");
      return;
    }
    
    // Do something
    ctx.ui.notify("Done!", "success");
  },
});
```

## Custom Events

Extensions can emit and listen to custom events:

```typescript
// Emit
pi.events.emit("my-extension:something", { data: "value" });

// Listen
pi.events.on("other-extension:event", (data) => {
  console.log(data);
});
```

## UI Methods

```typescript
ctx.ui.notify("Message", "info");     // info, success, warning, error
ctx.ui.setStatus("key", "value");     // Status bar item
ctx.ui.custom((tui, theme, kb, done) => {
  // Full custom TUI component
});
```

## Tool Execute Signature

```typescript
async execute(toolCallId, params, signal, onUpdate, ctx) { ... }
```

If `ctx` is undefined, check parameter order matches above.

## Tips

1. **Keep it focused**: One extension, one purpose
2. **Use events**: React to session lifecycle
3. **Notify sparingly**: Don't spam the user
4. **Handle errors**: Wrap in try/catch
5. **Clean up**: Use session_end for cleanup
6. **Check pi version**: Tool signatures change between versions

## Detailed References

- [Advanced Patterns](references/ADVANCED-PATTERNS.md) - Complex extension patterns
- [Examples](references/EXAMPLES.md) - Complete extension examples
- [Common Mistakes](references/COMMON-MISTAKES.md) - Pitfalls to avoid
