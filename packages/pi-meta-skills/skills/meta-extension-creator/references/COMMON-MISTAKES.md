# Common Extension Mistakes

Avoid these mistakes when building Pi extensions.

## 1. Forgetting to Check UI Availability

**Problem**: Using `ctx.ui` methods when UI isn't available.

```typescript
// ❌ Wrong - crashes in print mode
pi.on("session_start", async (_event, ctx) => {
  await ctx.ui.confirm("Ready?", "Start session?");
});
```

**Solution**: Check `ctx.hasUI` first:

```typescript
// ✅ Correct
pi.on("session_start", async (_event, ctx) => {
  if (ctx.hasUI) {
    await ctx.ui.confirm("Ready?", "Start session?");
  }
});
```

## 2. Not Handling Cancellation

**Problem**: Long-running tools don't respond to Escape.

```typescript
// ❌ Wrong - ignores cancellation
async execute(toolCallId, params, onUpdate, ctx, signal) {
  for (let i = 0; i < 1000; i++) {
    await slowOperation(i);
  }
}
```

**Solution**: Check `signal.aborted` in loops:

```typescript
// ✅ Correct
async execute(toolCallId, params, onUpdate, ctx, signal) {
  for (let i = 0; i < 1000; i++) {
    if (signal?.aborted) {
      return { content: [{ type: "text", text: "Cancelled" }] };
    }
    await slowOperation(i);
  }
}
```

## 3. Blocking the Event Loop

**Problem**: Synchronous operations freeze the TUI.

```typescript
// ❌ Wrong - blocks UI
pi.on("tool_call", async (event, ctx) => {
  const data = fs.readFileSync(hugeFile);  // Blocks!
  processData(data);
});
```

**Solution**: Use async operations:

```typescript
// ✅ Correct
import { readFile } from "fs/promises";

pi.on("tool_call", async (event, ctx) => {
  const data = await readFile(hugeFile);
  processData(data);
});
```

## 4. Infinite Event Loops

**Problem**: Extension triggers events that trigger itself.

```typescript
// ❌ Wrong - infinite loop
pi.on("input", async (event, ctx) => {
  pi.sendUserMessage("Processed: " + event.text);  // Triggers another input!
});
```

**Solution**: Filter by source or use flags:

```typescript
// ✅ Correct
pi.on("input", async (event, ctx) => {
  if (event.source === "extension") return { action: "continue" };
  // Process only user input
});
```

## 5. Not Returning from Event Handlers

**Problem**: Forgetting to return from blocking handlers.

```typescript
// ❌ Wrong - doesn't actually block
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && isDangerous(event.input)) {
    { block: true, reason: "Dangerous" };  // Missing return!
  }
});
```

**Solution**: Always return the block object:

```typescript
// ✅ Correct
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && isDangerous(event.input)) {
    return { block: true, reason: "Dangerous" };
  }
});
```

## 6. Using Type.Enum Instead of StringEnum

**Problem**: `Type.Enum` doesn't work with Google's API.

```typescript
// ❌ Wrong - breaks with Google
import { Type } from "@sinclair/typebox";

enum Actions { List = "list", Add = "add" }
Type.Enum(Actions)
```

**Solution**: Use `StringEnum` from pi-ai:

```typescript
// ✅ Correct
import { StringEnum } from "@mariozechner/pi-ai";

StringEnum(["list", "add"] as const)
```

## 7. Heavy Initialization in Module Scope

**Problem**: Slow startup due to module-level work.

```typescript
// ❌ Wrong - runs at import time
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const heavyData = loadMassiveDataset();  // Blocks startup!

export default function (pi: ExtensionAPI) {
  // ...
}
```

**Solution**: Defer to session_start or lazy init:

```typescript
// ✅ Correct
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

let heavyData: Data | null = null;

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    heavyData = await loadMassiveDataset();
  });
}
```

## 8. Not Truncating Tool Output

**Problem**: Large outputs overflow context.

```typescript
// ❌ Wrong - can return megabytes
async execute(toolCallId, params, onUpdate, ctx, signal) {
  const output = await runCommand();  // Could be huge!
  return { content: [{ type: "text", text: output }] };
}
```

**Solution**: Use truncation utilities:

```typescript
// ✅ Correct
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";

async execute(toolCallId, params, onUpdate, ctx, signal) {
  const output = await runCommand();
  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  
  let result = truncation.content;
  if (truncation.truncated) {
    result += `\n[Truncated: ${truncation.outputLines}/${truncation.totalLines} lines]`;
  }
  
  return { content: [{ type: "text", text: result }] };
}
```

## 9. Storing State Only in Variables

**Problem**: State lost on session branch/fork.

```typescript
// ❌ Wrong - lost on fork
let todoList: string[] = [];

pi.registerTool({
  name: "todo_add",
  async execute(_, params) {
    todoList.push(params.text);  // Lost if user forks!
  }
});
```

**Solution**: Store in tool result details:

```typescript
// ✅ Correct - survives branching
pi.registerTool({
  name: "todo_add",
  async execute(_, params) {
    todoList.push(params.text);
    return {
      content: [{ type: "text", text: "Added" }],
      details: { items: [...todoList] },  // Stored in session
    };
  }
});

// Reconstruct on session_start from tool results
```

## 10. Not Handling Missing API Keys

**Problem**: Extension crashes without required API keys.

```typescript
// ❌ Wrong - crashes if key missing
const client = new ExternalAPI(process.env.API_KEY!);
```

**Solution**: Check and warn gracefully:

```typescript
// ✅ Correct
export default function (pi: ExtensionAPI) {
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    pi.on("session_start", (_, ctx) => {
      ctx.ui?.notify("Extension disabled: API_KEY not set", "warning");
    });
    return;  // Don't register tools
  }
  
  const client = new ExternalAPI(apiKey);
  // Register tools...
}
```
