# TypeBox Schemas for Pi Tools

Pi uses [TypeBox](https://github.com/sinclairzx81/typebox) for tool parameter schemas.

## Import

```typescript
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";  // For string enums
```

## Basic Types

### String

```typescript
Type.String({ description: "A text value" })
Type.String({ minLength: 1, description: "Non-empty string" })
Type.String({ maxLength: 100, description: "Limited length" })
Type.String({ pattern: "^[a-z]+$", description: "Lowercase only" })
```

### Number

```typescript
Type.Number({ description: "Any number" })
Type.Number({ minimum: 0, description: "Non-negative" })
Type.Number({ maximum: 100, description: "Up to 100" })
Type.Number({ minimum: 1, maximum: 10, description: "1-10" })
Type.Integer({ description: "Whole number" })
```

### Boolean

```typescript
Type.Boolean({ description: "True or false" })
```

### Literal

```typescript
Type.Literal("exact-value")
Type.Literal(42)
Type.Literal(true)
```

## Optional Fields

```typescript
Type.Optional(Type.String({ description: "Optional text" }))
Type.Optional(Type.Number({ description: "Optional number" }))
```

## Arrays

```typescript
Type.Array(Type.String(), { description: "List of strings" })
Type.Array(Type.Number(), { description: "List of numbers" })
Type.Array(Type.Object({
  name: Type.String(),
  value: Type.Number()
}), { description: "List of objects" })
```

## Enums (String Unions)

**Important:** Use `StringEnum` from `@mariozechner/pi-ai` for Google API compatibility.

```typescript
import { StringEnum } from "@mariozechner/pi-ai";

// Correct - works with all providers
StringEnum(["list", "add", "remove"] as const, { description: "Action type" })

// Also works but verbose
Type.Union([
  Type.Literal("list"),
  Type.Literal("add"),
  Type.Literal("remove")
], { description: "Action type" })
```

**Do NOT use** `Type.Enum` - it doesn't work correctly with Google's API.

## Objects

### Simple Object

```typescript
Type.Object({
  name: Type.String({ description: "Item name" }),
  count: Type.Number({ description: "Item count" })
})
```

### Nested Object

```typescript
Type.Object({
  user: Type.Object({
    name: Type.String(),
    email: Type.String()
  }),
  settings: Type.Object({
    theme: Type.String(),
    notifications: Type.Boolean()
  })
})
```

### Object with Optional Fields

```typescript
Type.Object({
  required: Type.String({ description: "Must provide" }),
  optional: Type.Optional(Type.String({ description: "Can omit" }))
})
```

## Union Types

```typescript
// String or number
Type.Union([Type.String(), Type.Number()])

// Different object shapes
Type.Union([
  Type.Object({ type: Type.Literal("file"), path: Type.String() }),
  Type.Object({ type: Type.Literal("url"), href: Type.String() })
])
```

## Complete Tool Example

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "todo",
    label: "Todo",
    description: "Manage a todo list",
    parameters: Type.Object({
      action: StringEnum(["list", "add", "remove", "complete"] as const, {
        description: "Action to perform"
      }),
      text: Type.Optional(Type.String({
        description: "Todo text (for add)"
      })),
      id: Type.Optional(Type.Number({
        description: "Todo ID (for remove/complete)"
      })),
      filter: Type.Optional(StringEnum(["all", "pending", "done"] as const, {
        description: "Filter for list action"
      }))
    }),

    async execute(_toolCallId, params, _onUpdate, ctx, _signal) {
      // params is typed based on schema
      const { action, text, id, filter } = params;
      
      switch (action) {
        case "list":
          return { content: [{ type: "text", text: "Todos..." }] };
        case "add":
          if (!text) {
            return { content: [{ type: "text", text: "Error: text required" }] };
          }
          return { content: [{ type: "text", text: `Added: ${text}` }] };
        // ...
      }
    }
  });
}
```

## Validation

TypeBox schemas are validated at runtime. Invalid parameters result in tool errors sent back to the LLM.

## Type Inference

TypeScript infers parameter types from the schema:

```typescript
const params = Type.Object({
  name: Type.String(),
  count: Type.Number(),
  tags: Type.Optional(Type.Array(Type.String()))
});

// In execute, params is typed as:
// { name: string; count: number; tags?: string[] }
```

## Common Patterns

### File Path Parameter

```typescript
Type.Object({
  path: Type.String({ description: "File path relative to workspace" })
})
```

### Search with Options

```typescript
Type.Object({
  query: Type.String({ description: "Search query" }),
  caseSensitive: Type.Optional(Type.Boolean({ description: "Case sensitive" })),
  maxResults: Type.Optional(Type.Number({ 
    description: "Maximum results",
    minimum: 1,
    maximum: 100
  }))
})
```

### Multi-Action Tool

```typescript
Type.Object({
  action: StringEnum(["create", "read", "update", "delete"] as const),
  id: Type.Optional(Type.String({ description: "Resource ID" })),
  data: Type.Optional(Type.Object({
    name: Type.String(),
    value: Type.String()
  }))
})
```
