# Template System

## How It Works

`scripts/bosun init.ts` reads `config.toml` and processes template files, replacing `${section.key}` with values from the config.

## Template Mappings

| Source | Output |
|--------|--------|
| `.pi/agents-templates/` | `.pi/agents/` |
| `.pi/settings.template.json` | `.pi/settings.json` |
| `config.toml` | `.pi/config.resolved.toml` |

## Interpolation Syntax

```
${section.key}
```

Dot-separated paths into the TOML structure. Examples:

```
${models.lite}     → claude-haiku-4-5-20251001
${models.medium}   → claude-sonnet-4-5-20250929
${models.high}     → claude-opus-4-6
```

### Code Block Protection

Content inside fenced code blocks (``` or ~~~) and inline code (`) is NOT interpolated. This prevents accidental replacement in documentation examples.

## File Types Processed

- `.md` - Markdown (agent definitions, prompts)
- `.json` - JSON (settings)
- `.toml` - TOML (resolved config)

Other files are copied as-is.

## Adding New Template Variables

1. Add a section/key to `config.toml`:
   ```toml
   [my_section]
   my_key = "my_value"
   ```

2. Reference in templates:
   ```
   ${my_section.my_key}
   ```

3. Regenerate: `bun scripts/bosun init.ts`

## Creating a New Agent Template

1. Create `.pi/agents-templates/my-agent.md`:
   ```markdown
   ---
   name: my-agent
   description: Does X
   tools: read, grep, find, ls
   model: ${models.medium}
   ---

   You are my-agent. Your job is...
   ```

2. Run `bun scripts/bosun init.ts`

3. Generated file appears at `.pi/agents/my-agent.md` with resolved model

## Gotchas

- **Don't edit generated files** - they get overwritten on next init
- Generated files are in `.gitignore` - changes won't be committed
- `just start` runs init automatically, but mid-session changes need manual `bun scripts/bosun init.ts`
- Missing variables produce a warning and keep the `${...}` literal
