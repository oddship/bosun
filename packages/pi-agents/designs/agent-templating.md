# Agent Template Engine — Design Doc

**Status**: Implemented (pending: meta-agent-creator skill docs)
**Author**: bosun session
**Date**: 2026-02-25
**Updated**: 2026-03-04

## Problem

Agent `.md` files hardcode references to specific packages (pi-mesh, pi-tmux, skills). When a user doesn't install a package, these references become dead instructions that confuse the LLM and waste context tokens.

## Goals

1. Agent `.md` files remain self-contained and readable
2. Sections conditionally included based on installed packages
3. Packages can own their messaging via named content slots (partials)
4. Works for both local (`packages/`) and npm (`node_modules/`) packages
5. Uses Handlebars — well-tested, readable, familiar to humans and AI agents

## Non-Goals

- Full template engine features (no complex helpers, no inheritance chains)
- Runtime template changes (processed once at `before_agent_start`)
- Replacing Pi's skill system (skills remain separate, on-demand)

## Why Handlebars

Evaluated Mustache, Handlebars, Liquid, EJS. Chose Handlebars because:

- `{{#if pi_mesh}}` reads like English — self-documenting for humans and AI agents editing files
- Compound conditions via custom `ifAll` helper — clean, no pre-computed keys
- Same partial syntax as Mustache: `{{> pi_mesh/worker_reporting}}`
- Better error reporting than Mustache (missing partials, bad syntax)
- AI agents know Handlebars extremely well (huge training corpus)
- Superset of Mustache — no capability tradeoff

Mustache's `{{#pi_mesh}}` overloads section/loop/conditional meaning — confusing for someone reading agent files for the first time.

## Template Syntax

### Conditionals

```handlebars
{{#if pi_mesh}}
Content included when pi-mesh is installed.
{{/if}}
```

Compound conditions (all must be installed):

```handlebars
{{#ifAll pi_mesh pi_tmux}}
Content included when both pi-mesh AND pi-tmux are installed.
{{/ifAll}}
```

### Partials (Slots)

```handlebars
{{> pi_mesh/worker_reporting}}
```

Resolves to a named markdown snippet owned by a package.

### Combined

```handlebars
{{#if pi_mesh}}
{{> pi_mesh/worker_reporting}}
{{/if}}
```

Partials can also appear outside conditionals (always included if the file exists).

## Package Detection

A package is "installed" if any of these exist:
1. `packages/<pkg>/package.json` (local workspace package)
2. `node_modules/<pkg>/package.json` (npm dependency)

Resolution is relative to `ctx.cwd` (the project root).

Underscore-to-hyphen normalization: `pi_mesh` in templates → `pi-mesh` on filesystem.

## Partial Resolution

For `{{> pi_mesh/worker_reporting}}`:

1. **Project override**: `.pi/slots/pi-mesh/worker_reporting.md`
2. **Package-provided**: `packages/pi-mesh/slots/worker_reporting.md`
3. **npm package-provided**: `node_modules/pi-mesh/slots/worker_reporting.md`

Resolution order: **project override wins** (1 → 2 → 3). This lets users customize
messaging for npm packages they don't control, and override local package defaults.

If no partial file found: resolves to empty string, no error.

## Processing Pipeline

```
agent.body (raw markdown with Handlebars tags)
  → processTemplate(body, cwd)
    → build context (scan installed packages → boolean flags)
    → register partials (discover slot files)
    → register helpers (ifAll)
    → Handlebars.compile + execute
    → strip empty lines left by removed blocks
  → inject into systemPrompt via before_agent_start
```

Processing happens once per `before_agent_start` call. Results are not cached
(agent files may change between sessions).

## Directory Structure

```
.pi/
  slots/                          # Project-level slots (override or standalone)
    pi-mesh/
      worker_reporting.md         # "Report via mesh_send with substantive findings"
      orchestrator_coordination.md  # "Use mesh_peers, mesh_reserve, mesh_send"

packages/pi-agents/
  slots/
    delegation.md                 # Agent table + delegation guidelines
  extensions/
    template.ts                   # Template engine implementation
  designs/
    agent-templating.md           # This file

.pi/
  agents/
    lite.md                       # Uses {{#if pi_mesh}} and {{> ...}}
    bosun.md                      # Uses compound conditions
```

## Example: lite.md

```markdown
---
name: lite
model: lite
extensions:
  - pi-agents
  - pi-question
  - pi-mesh
---

You are a fast, efficient helper agent. Optimize for speed over depth.

## Your Role

- Quick summaries and context gathering
- Simple file edits and updates
- Fast information retrieval
- Routine tasks that don't need deep reasoning

## Guidelines

1. **Be fast** — Don't overthink, act quickly
2. **Be concise** — Bullet points over paragraphs, code over explanation
3. **Escalate** — If a task needs deep reasoning, say so

{{#if pi_mesh}}
{{> pi_mesh/worker_reporting}}
{{/if}}
```

## Example: bosun.md

```markdown
---
name: bosun
model: high
thinking: medium
extensions:
  - pi-agents
  - pi-tmux
  - pi-mesh
  - ...
---

You are Bosun, the main orchestrator agent.

## Your Role
- Coordinate complex tasks by delegating to specialist agents
- Maintain context across multi-step workflows
- Make high-level architectural decisions

## Guidelines
1. Load skills proactively before starting work
2. Verify changes — always review lite agent output before reporting done
3. Plan before executing — mandatory for 3+ files or cross-cutting concerns

{{#if pi_agents}}
{{> pi_agents/delegation}}
{{/if}}

{{#if pi_mesh}}
{{> pi_mesh/orchestrator_coordination}}
{{/if}}

{{#ifAll pi_mesh pi_agents}}
{{> pi_agents/multi_agent_workflow}}
{{/ifAll}}
```

## Implementation

### Location

`packages/pi-agents/extensions/template.ts`

### Custom Helpers

- `ifAll` — compound conditional, all named packages must be installed

### Integration Point

```typescript
// packages/pi-agents/extensions/index.ts — before_agent_start handler
const processedBody = processTemplate(agent.body, { cwd: ctx.cwd });
```

### Edge Cases

1. **Unknown package in condition** → treated as not installed (block removed)
2. **Missing partial file** → resolves to empty string, no error
3. **Malformed tags** → Handlebars throws — caught and returns body as-is
4. **Empty blocks after processing** → collapsed (extra blank lines removed)
5. **Partials inside false conditionals** → entire block removed, partial not read
6. **Recursive partials** → Handlebars supports this natively but we don't use it

## Migration Plan

1. ✅ Build template engine in pi-agents (template.ts)
2. ✅ Create initial slots for pi-mesh, pi-agents
3. ✅ Convert agent .md files to use Handlebars syntax
4. ✅ Test with packages present and absent
5. Document the template syntax in meta-agent-creator skill

## Future Considerations

- `{{else}}` blocks — Handlebars supports this natively
- `{{#unless pkg}}` — for fallback content when a package is absent
- Partial discovery via `package.json` pi.slots field
- Validation: warn on missing partials in dev mode
- `{{> slot_name default="fallback text"}}` — inline defaults via helper
