# Tool Examples

Complete Pi extension tool examples using `registerTool`.

## 1. Database Query Tool

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "db_query",
    label: "Database Query",
    description: "Execute a read-only SQL query on the project database",
    parameters: Type.Object({
      query: Type.String({ description: "SELECT query to execute" }),
    }),

    async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
      if (!params.query.toLowerCase().startsWith("select")) {
        return {
          content: [{ type: "text", text: "Error: Only SELECT queries allowed" }],
          isError: true,
        };
      }
      
      const result = await Bun.$`sqlite3 ./data/app.db "${params.query}"`.text();
      return {
        content: [{ type: "text", text: result.trim() || "No results" }],
      };
    },
  });
}
```

## 2. API Health Check Tool

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "api_health",
    label: "API Health",
    description: "Check health of configured API endpoints",
    parameters: Type.Object({
      endpoint: Type.Optional(Type.String({ description: "Specific endpoint" })),
    }),

    async execute(_toolCallId, params, onUpdate, _ctx, signal) {
      const endpoints = params.endpoint 
        ? [params.endpoint]
        : ["https://api.example.com/health", "https://api.example.com/status"];
      
      const results: string[] = [];
      
      for (const url of endpoints) {
        if (signal?.aborted) {
          return { content: [{ type: "text", text: "Cancelled" }] };
        }
        
        // Stream progress
        onUpdate?.({ content: [{ type: "text", text: `Checking ${url}...` }] });
        
        try {
          const start = Date.now();
          const response = await fetch(url);
          const latency = Date.now() - start;
          results.push(`${url}: ${response.status} (${latency}ms)`);
        } catch (error: any) {
          results.push(`${url}: ERROR - ${error.message}`);
        }
      }
      
      return {
        content: [{ type: "text", text: results.join("\n") }],
        details: { endpoints: results },
      };
    },
  });
}
```

## 3. Git Info Tool

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "git_info",
    label: "Git Info",
    description: "Get git repository information",
    parameters: Type.Object({
      info: StringEnum(["branch", "status", "log", "diff"] as const, {
        description: "Type of info to retrieve"
      }),
      count: Type.Optional(Type.Number({ description: "Number of log entries" })),
    }),

    async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
      let result: string;
      
      switch (params.info) {
        case "branch":
          result = await Bun.$`git branch --show-current`.text();
          break;
        case "status":
          result = await Bun.$`git status --short`.text();
          break;
        case "log":
          const count = params.count || 5;
          result = await Bun.$`git log --oneline -${count}`.text();
          break;
        case "diff":
          result = await Bun.$`git diff --stat`.text();
          break;
        default:
          result = "Unknown info type";
      }
      
      return {
        content: [{ type: "text", text: result.trim() || "No output" }],
      };
    },
  });
}
```

## 4. File Stats Tool

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { stat } from "fs/promises";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "file_stats",
    label: "File Stats",
    description: "Get detailed statistics about a file",
    parameters: Type.Object({
      path: Type.String({ description: "Path to file" }),
    }),

    async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
      try {
        const stats = await stat(params.path);
        
        const info = {
          size: stats.size,
          created: stats.birthtime.toISOString(),
          modified: stats.mtime.toISOString(),
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
        };
        
        const text = Object.entries(info)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");
        
        return {
          content: [{ type: "text", text }],
          details: info,
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  });
}
```

## 5. Todo List Tool (Stateful)

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
      text: Type.Optional(Type.String({ description: "Todo text" })),
      id: Type.Optional(Type.Number({ description: "Todo ID" })),
    }),

    async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
      let result = "";

      switch (params.action) {
        case "list":
          result = todos.length === 0 
            ? "No todos."
            : todos.map(t => `${t.id}. [${t.done ? "x" : " "}] ${t.text}`).join("\n");
          break;
        case "add":
          if (!params.text) {
            return { content: [{ type: "text", text: "Error: text required" }], isError: true };
          }
          todos.push({ id: nextId++, text: params.text, done: false });
          result = `Added: ${params.text}`;
          break;
        case "complete":
          const todo = todos.find(t => t.id === params.id);
          if (!todo) {
            return { content: [{ type: "text", text: "Error: not found" }], isError: true };
          }
          todo.done = true;
          result = `Completed: ${todo.text}`;
          break;
        case "remove":
          const idx = todos.findIndex(t => t.id === params.id);
          if (idx === -1) {
            return { content: [{ type: "text", text: "Error: not found" }], isError: true };
          }
          result = `Removed: ${todos.splice(idx, 1)[0].text}`;
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

## 6. Environment Info Tool

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "env_info",
    label: "Environment Info",
    description: "Get information about the execution environment",
    parameters: Type.Object({
      variable: Type.Optional(Type.String({ description: "Specific env var" })),
    }),

    async execute(_toolCallId, params, _onUpdate, ctx, _signal) {
      if (params.variable) {
        const value = process.env[params.variable];
        return {
          content: [{ type: "text", text: value ? `${params.variable}=${value}` : "Not set" }],
        };
      }
      
      const info = [
        `CWD: ${ctx.cwd}`,
        `NODE_ENV: ${process.env.NODE_ENV || "not set"}`,
        `USER: ${process.env.USER || "unknown"}`,
        `SHELL: ${process.env.SHELL || "unknown"}`,
      ].join("\n");
      
      return { content: [{ type: "text", text: info }] };
    },
  });
}
```

## 7. Custom UI Tool

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "confirm_action",
    label: "Confirm Action",
    description: "Ask user to confirm an action",
    parameters: Type.Object({
      action: Type.String({ description: "Action to confirm" }),
    }),

    async execute(_toolCallId, params, _onUpdate, ctx, _signal) {
      if (!ctx.hasUI) {
        return { content: [{ type: "text", text: "Error: UI not available" }], isError: true };
      }
      
      const confirmed = await ctx.ui.confirm(
        "Confirm Action",
        `Proceed with: ${params.action}?`
      );
      
      return {
        content: [{ type: "text", text: confirmed ? "User confirmed" : "User cancelled" }],
        details: { confirmed },
      };
    },

    renderResult(result, _options, theme) {
      const confirmed = result.details?.confirmed;
      const icon = confirmed ? "✓" : "✗";
      const color = confirmed ? "success" : "warning";
      return new Text(theme.fg(color, `${icon} ${confirmed ? "Confirmed" : "Cancelled"}`), 0, 0);
    },
  });
}
```
