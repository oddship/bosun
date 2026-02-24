# Extension Examples

Complete Pi extension examples.

## 1. Notification Extension

Shows desktop notification when session completes.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { exec } from "child_process";

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async (_event, ctx) => {
    // macOS notification
    exec(`osascript -e 'display notification "Task completed!" with title "Pi"'`);
  });
}
```

## 2. Session Timer

Tracks and displays session duration.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let startTime: number;

  pi.on("session_start", async (_event, ctx) => {
    startTime = Date.now();
    ctx.ui.setStatus("timer", "0:00");
    
    // Update every second
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      ctx.ui.setStatus("timer", `${mins}:${secs.toString().padStart(2, "0")}`);
    }, 1000);
    
    pi.on("session_shutdown", () => clearInterval(interval));
  });
}
```

## 3. Dangerous Command Blocker

Requires confirmation for destructive commands.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DANGEROUS_PATTERNS = [
  /rm\s+-rf/,
  /sudo\s+/,
  />\s*\/dev\/sd/,
  /mkfs\./,
  /dd\s+if=/,
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    
    const cmd = event.input.command || "";
    const isDangerous = DANGEROUS_PATTERNS.some(p => p.test(cmd));
    
    if (isDangerous && ctx.hasUI) {
      const confirmed = await ctx.ui.confirm(
        "⚠️ Dangerous Command",
        `Allow: ${cmd}?`
      );
      if (!confirmed) {
        return { block: true, reason: "Blocked by user" };
      }
    }
  });
}
```

## 4. Auto Git Checkpoint

Creates git stash before each agent turn.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("turn_start", async (event, ctx) => {
    const result = await pi.exec("git", ["stash", "push", "-m", `pi-checkpoint-${event.turnIndex}`]);
    if (result.code === 0) {
      ctx.ui.notify(`Checkpoint created (turn ${event.turnIndex})`, "info");
    }
  });
  
  // Command to restore checkpoint
  pi.registerCommand("restore", {
    description: "Restore last git checkpoint",
    handler: async (args, ctx) => {
      const result = await pi.exec("git", ["stash", "pop"]);
      if (result.code === 0) {
        ctx.ui.notify("Checkpoint restored", "success");
      } else {
        ctx.ui.notify("Failed to restore", "error");
      }
    }
  });
}
```

## 5. Todo List Tool

Stateful todo list with session persistence.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

export default function (pi: ExtensionAPI) {
  let todos: Todo[] = [];
  let nextId = 1;

  // Reconstruct state from session
  pi.on("session_start", async (_event, ctx) => {
    todos = [];
    nextId = 1;
    
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && 
          entry.message.role === "toolResult" &&
          entry.message.toolName === "todo") {
        const state = entry.message.details?.state;
        if (state) {
          todos = state.todos;
          nextId = state.nextId;
        }
      }
    }
  });

  pi.registerTool({
    name: "todo",
    label: "Todo",
    description: "Manage a todo list",
    parameters: Type.Object({
      action: StringEnum(["list", "add", "complete", "remove"] as const),
      text: Type.Optional(Type.String({ description: "Todo text (for add)" })),
      id: Type.Optional(Type.Number({ description: "Todo ID (for complete/remove)" })),
    }),

    async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
      let result = "";

      switch (params.action) {
        case "list":
          if (todos.length === 0) {
            result = "No todos.";
          } else {
            result = todos.map(t => 
              `${t.id}. [${t.done ? "x" : " "}] ${t.text}`
            ).join("\n");
          }
          break;

        case "add":
          if (!params.text) {
            return { content: [{ type: "text", text: "Error: text required" }], isError: true };
          }
          const newTodo = { id: nextId++, text: params.text, done: false };
          todos.push(newTodo);
          result = `Added: ${newTodo.id}. ${newTodo.text}`;
          break;

        case "complete":
          const todo = todos.find(t => t.id === params.id);
          if (!todo) {
            return { content: [{ type: "text", text: `Error: todo ${params.id} not found` }], isError: true };
          }
          todo.done = true;
          result = `Completed: ${todo.text}`;
          break;

        case "remove":
          const idx = todos.findIndex(t => t.id === params.id);
          if (idx === -1) {
            return { content: [{ type: "text", text: `Error: todo ${params.id} not found` }], isError: true };
          }
          const removed = todos.splice(idx, 1)[0];
          result = `Removed: ${removed.text}`;
          break;
      }

      return {
        content: [{ type: "text", text: result }],
        details: { state: { todos: [...todos], nextId } },
      };
    },
  });
}
```

## 6. Path Protection

Blocks writes to sensitive paths.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PROTECTED_PATHS = [
  /\.env/,
  /node_modules\//,
  /\.git\//,
  /package-lock\.json$/,
  /bun\.lock$/,
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    
    const path = event.input.path || "";
    const isProtected = PROTECTED_PATHS.some(p => p.test(path));
    
    if (isProtected) {
      if (ctx.hasUI) {
        const confirmed = await ctx.ui.confirm(
          "Protected Path",
          `Write to ${path}?`
        );
        if (!confirmed) {
          return { block: true, reason: `Protected path: ${path}` };
        }
      } else {
        return { block: true, reason: `Protected path: ${path}` };
      }
    }
  });
}
```

## 7. Custom Compaction

Provides custom conversation summary.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_before_compact", async (event, ctx) => {
    // Create custom summary instead of default
    const messages = event.branchEntries
      .filter(e => e.type === "message")
      .map(e => e.message);
    
    const toolCalls = messages
      .filter(m => m.role === "assistant" && m.content)
      .flatMap(m => m.content.filter(c => c.type === "toolCall"))
      .map(c => c.name);
    
    const summary = `Session summary:
- ${messages.length} messages
- Tools used: ${[...new Set(toolCalls)].join(", ") || "none"}
- ${event.customInstructions || "No special instructions"}`;

    return {
      compaction: {
        summary,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
      }
    };
  });
}
```

## 8. Keyboard Shortcut

Adds custom keyboard shortcut.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerShortcut("ctrl+shift+t", {
    description: "Run tests",
    handler: async (ctx) => {
      ctx.ui.notify("Running tests...", "info");
      const result = await pi.exec("npm", ["test"]);
      if (result.code === 0) {
        ctx.ui.notify("Tests passed!", "success");
      } else {
        ctx.ui.notify("Tests failed!", "error");
      }
    },
  });
}
```

## 9. Widget Display

Shows information in a widget above the editor.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    // Show git branch in widget
    const result = await pi.exec("git", ["branch", "--show-current"]);
    if (result.code === 0) {
      const branch = result.stdout.trim();
      ctx.ui.setWidget("git-branch", [`Branch: ${branch}`]);
    }
  });
  
  // Update on tool_result (might have changed branch)
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("git checkout")) {
      const result = await pi.exec("git", ["branch", "--show-current"]);
      if (result.code === 0) {
        ctx.ui.setWidget("git-branch", [`Branch: ${result.stdout.trim()}`]);
      }
    }
  });
}
```

## 10. Input Transform

Transforms user input before processing.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    // Expand shortcuts
    if (event.text === "!fix") {
      return { 
        action: "transform", 
        text: "Find and fix any issues in the current file" 
      };
    }
    
    if (event.text === "!test") {
      return { 
        action: "transform", 
        text: "Run the test suite and fix any failures" 
      };
    }
    
    // Add prefix for brief responses
    if (event.text.startsWith("?")) {
      return {
        action: "transform",
        text: `Respond briefly: ${event.text.slice(1)}`
      };
    }
    
    return { action: "continue" };
  });
}
```
