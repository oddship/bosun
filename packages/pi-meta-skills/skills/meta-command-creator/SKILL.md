---
name: meta-command-creator
description: Create Pi prompt templates (slash commands) for repetitive tasks. Use when adding /commands that trigger specific prompts or workflows.
license: MIT
compatibility: pi
metadata:
  audience: developers
  category: meta
---

# Meta Command Creator

Create prompt templates (slash commands) that trigger specific prompts in Pi.

## What I Do

- Generate prompt template files (Markdown with YAML frontmatter)
- Configure command arguments and placeholders
- Set up skill injection and model overrides
- Help design reusable workflow commands

## When to Use Me

Use this skill when:
- Creating reusable prompt workflows (e.g., `/test`, `/review`, `/deploy`)
- Building project-specific commands
- Defining commands that load specific skills
- Adding shortcuts for common tasks

Do NOT use for:
- Creating tools the LLM calls (use meta-tool-creator)
- Creating extensions (use meta-extension-creator)
- Creating agents (use meta-agent-creator)
- Creating skills (use meta-skill-creator)

## Quick Start

### Basic Prompt Template

Create `.pi/prompts/test.md`:

```markdown
---
description: Run tests with coverage
---

Run the full test suite with coverage report and show any failures.
Focus on the failing tests and suggest fixes.
```

Run it with:
```
/test
```

### Command with Arguments

Create `.pi/prompts/component.md`:

```markdown
---
description: Create a new component
---

Create a new React component named $ARGUMENTS with TypeScript support.
Include proper typing and basic structure.
```

Run with arguments:
```
/component Button
```

### Positional Arguments

Use `$1`, `$2`, `$3` for specific arguments:

```markdown
---
description: Create a file with content
---

Create a file named $1 in the directory $2
with the following content: $3
```

Run:
```
/create-file config.json src "{ \"key\": \"value\" }"
```

## Prompt Template Location

| Location | Scope | Path |
|----------|-------|------|
| Project | This project only | `.pi/prompts/` |
| Global | All projects | `~/.pi/agent/prompts/` |

The filename becomes the command name:
- `test.md` → `/test`
- `review-pr.md` → `/review-pr`

## Frontmatter Options

```markdown
---
description: Brief description shown in command list
skill: git, github          # Skills to load with this prompt
model: ${models.medium}  # Override model for this command
---

Your prompt template here...
```

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `description` | string | Yes | Brief description shown in `/` menu |
| `skill` | string | No | Comma-separated skills to inject |
| `model` | string | No | Override the default model |

## Prompt Features

### Shell Output Injection

Use `` `command` `` in the prompt body:

```markdown
---
description: Analyze test coverage
---

Here are the current test results:
`npm test`

Based on these results, suggest improvements.
```

### File References

Reference files for context:

```markdown
---
description: Review component
---

Review the component. Check for performance issues.
Load @src/components/Button.tsx for context.
```

## Common Patterns

### Testing Commands

```markdown
---
description: Run and fix failing tests
skill: git
---

Run the test suite and analyze failures.
Fix any issues found.
```

### Code Review Commands

```markdown
---
description: Review changes
skill: git, github
---

Review the current changes:
`git diff HEAD~1`

Check for:
- Code quality issues
- Security concerns
- Performance problems
```

### Documentation Commands

```markdown
---
description: Generate docs for file
---

Generate documentation for $ARGUMENTS.
Follow project conventions.
```

### Handoff Command

```markdown
---
description: Create handoff for session continuation
skill: context-management
---

Create a handoff document for the current session.
Focus: $ARGUMENTS

1. Summarize what was accomplished
2. Document blockers and next steps
3. Save to workspace/users/$USER/handoffs/
```

### Feedback Command

```markdown
---
description: Submit feedback or report issues
skill: github
---

The user wants to provide feedback: $ARGUMENTS

Help them:
1. Clarify the type (bug, feature, feedback)
2. Gather relevant details
3. Create a GitLab issue with context
```

## Command vs Tool vs Skill

| Feature | Command | Tool | Skill |
|---------|---------|------|-------|
| Purpose | User-triggered prompts | LLM-callable functions | Knowledge/instructions |
| Invoked by | User types `/name` | LLM decides to call | Agent loads on-demand |
| Location | `.pi/prompts/` | `.pi/extensions/` | `.pi/skills/` |
| Format | Markdown + frontmatter | TypeScript | Markdown + frontmatter |
| Arguments | `$ARGUMENTS`, `$1`, `$2` | TypeBox schema | N/A |

## Tips

1. **Keep prompts focused**: One command, one purpose
2. **Use skills**: Load relevant skills via frontmatter
3. **Inject context**: Use shell commands for dynamic data
4. **Document well**: Clear descriptions help discoverability
5. **Test arguments**: Verify `$ARGUMENTS` and `$1` work as expected
