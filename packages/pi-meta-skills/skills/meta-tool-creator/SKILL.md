---
name: meta-tool-creator
description: Create custom Pi tools via extensions that the LLM can call. Use when adding new callable functions for the LLM.
license: MIT
compatibility: pi
metadata:
  audience: developers
  category: meta
---

# Meta Tool Creator

Create custom tools that extend Pi's capabilities. Tools are functions the LLM can call during conversations.

## What I Do

- Generate custom tool extensions (TypeScript)
- Set up TypeBox schema argument validation
- Show how to invoke external scripts (Python, shell)
- Create custom UI for tool results

## When to Use Me

Use this skill when:
- Creating new callable tools for the LLM
- Building tools that integrate with APIs
- Creating tools that run scripts in other languages
- Adding project-specific utilities

Do NOT use for:
- Creating skills (use meta-skill-creator)
- Creating agents (use meta-agent-creator)
- Creating prompt templates (use meta-command-creator)

## Quick Start

### Basic Tool Extension

Create `.pi/extensions/my-tool/index.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function myTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "Query the project database",
    parameters: Type.Object({
      query: Type.String({ description: "SQL query to execute" }),
    }),

    async execute(_toolCallId, params, _onUpdate, ctx, _signal) {
      const result = `Executed: ${params.query}`;
      return {
        content: [{ type: "text", text: result }],
      };
    },
  });
}
```

### Tool with Context

```typescript
async execute(_toolCallId, params, _onUpdate, ctx, signal) {
  // ctx provides session context
  const cwd = ctx.cwd;           // Current working directory
  const hasUI = ctx.hasUI;       // Is UI available?
  
  // signal for cancellation
  if (signal.aborted) {
    return { content: [{ type: "text", text: "Cancelled" }] };
  }
  
  return {
    content: [{ type: "text", text: `Working in ${cwd}` }],
  };
}
```

### Tool with Custom UI

```typescript
import { Text } from "@mariozechner/pi-tui";

pi.registerTool({
  name: "my_tool",
  // ... params ...

  async execute(_toolCallId, params, _onUpdate, ctx, _signal) {
    return {
      content: [{ type: "text", text: "Done" }],
      details: { count: 42 },  // Custom details for rendering
    };
  },

  renderCall(args, theme) {
    return new Text(theme.fg("accent", `my_tool: ${args.query}`), 0, 0);
  },

  renderResult(result, _options, theme) {
    const count = result.details?.count || 0;
    return new Text(theme.fg("success", `Processed ${count} items`), 0, 0);
  },
});
```

## Tool Location

- **Project**: `.pi/extensions/<name>/index.ts`
- Auto-discovered via `"extensions": ["extensions/*"]` in settings (no config change needed)

## TypeBox Schema Types

```typescript
import { Type } from "@sinclair/typebox";

Type.String({ description: "A string" })
Type.Number({ description: "A number" })
Type.Boolean({ description: "A boolean" })
Type.Optional(Type.String())  // Optional field
Type.Array(Type.String())     // Array of strings
Type.Union([Type.Literal("a"), Type.Literal("b")])  // Enum-like
Type.Object({ nested: Type.String() })  // Nested object
```

## Running External Scripts

```typescript
import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

async execute(_toolCallId, params, _onUpdate, ctx, _signal) {
  // Python
  const { stdout } = await execAsync(`python3 script.py ${params.input}`);
  
  // Or with Bun
  const result = await Bun.$`./script.sh ${params.param}`.text();
  
  return { content: [{ type: "text", text: stdout.trim() }] };
}
```

## Interactive Tools (Custom UI)

For tools that need user input, use `ctx.ui.custom()`:

```typescript
const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
  // Return render/handleInput functions
  // Call done(value) when complete
});
```

See the `pi-question` extension for a full example.

## Tips

1. **Use TypeBox**: For parameter validation (not Zod)
2. **Return content array**: `{ content: [{ type: "text", text: "..." }] }`
3. **Add details**: For custom rendering with `renderResult`
4. **Check signal**: Handle cancellation gracefully
5. **Test in isolation**: Run `bun build` to check for errors

## Detailed References

- [TypeBox Schemas](references/TYPEBOX-SCHEMAS.md) - All parameter types and validation
- [Examples](references/EXAMPLES.md) - Complete tool examples
- [External Scripts](references/EXTERNAL-SCRIPTS.md) - Python, shell integration
