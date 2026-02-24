---
name: meta-workflow-creator
description: Create Pi daemon workflows with proper structure, config, agents, and validators. Use when building automated workflows for the daemon system.
license: MIT
compatibility: pi
metadata:
  audience: developers
  category: meta
---

# Create Workflow

Create daemon workflows that run automatically via triggers (schedules, file watchers) or manually.

## What I Do

- Generate workflow directories with config, agent prompts, and validators
- Guide workflow type selection (agent vs script)
- Help configure triggers, model tiers, and retry behavior
- Create input/output validators for reliability

## Workflow Structure

```
workflow-name/
├── config.toml           # Required - trigger, model, prompt, retry settings
├── agent.md              # Required for agent workflows - system prompt
├── validate-input.ts     # Optional - bun script, exit 0 to proceed, 1 to skip
├── validate-output.ts    # Optional - bun script, exit 0 = pass, 1 = retry
├── test/                 # Optional - test fixtures and assertions
│   ├── fixtures/
│   └── workflow.test.ts
└── README.md             # Optional - documentation
```

**Locations (discovery order, later overrides earlier):**
- Package: `packages/<pkg>/workflows/<name>/`
- Repo: `.pi/workflows/<name>/`
- User: `workspace/workflows/<name>/` (gitignored)

## Workflow Types

### Agent Workflow (type = "agent")

The agent is the brain. It has tools (`read`, `write`, `bash`) and does the actual work. The daemon just spawns it and validates the result.

```toml
[workflow]
name = "my-workflow"
description = "What this workflow does"
type = "agent"

[trigger]
schedule = "hourly"              # or: watcher, manual, startup

[agent]
model = "lite"                   # Tier name from config.toml [models]
prompt = "Task description for the agent."

[retry]
max_attempts = 2

[validators]
input = "validate-input.ts"
output = "validate-output.ts"

[timeout]
minutes = 10
```

### Script Workflow (type = "script")

For pure automation that doesn't need LLM intelligence (backups, cleanup, etc).

```toml
[workflow]
name = "daily-backup"
type = "script"

[trigger]
schedule = "daily:02"

[script]
command = "backup.ts"

[timeout]
minutes = 5
```

## Triggers

| Trigger | Config | Description |
|---------|--------|-------------|
| Schedule | `schedule = "hourly"` | Time-based: `hourly`, `daily:HH`, `interval:NNm` |
| File watcher | `watcher = "path/**/*.json"` | Fires on file add/change matching glob |
| Manual | `manual = true` | Via `daemon trigger <name>` CLI |
| Startup | `startup = true` | Runs once when daemon starts |

## Agent System Prompt (`agent.md`)

The agent.md is the system prompt. Write it like you're briefing a developer:

1. **What to do** - Clear task description
2. **Where to find input** - Paths, env vars (WORKFLOW_PATHS, WORKFLOW_DATE)
3. **How to process** - Extraction patterns, clustering rules, etc.
4. **What to output** - Exact format, where to write files
5. **What NOT to do** - Common pitfalls, security concerns

Key env vars available to agents:
- `WORKFLOW_NAME` - workflow name
- `WORKFLOW_DIR` - workflow directory path
- `WORKFLOW_PATHS` - comma-separated trigger file paths (from file watcher)
- `WORKFLOW_DATE` - date string (from scheduled triggers)
- `USER` / `LOGNAME` - current user

## Validators

Validators are Bun TypeScript scripts. They receive context via env vars.

### Input Validator

Runs before agent. Exit 0 to proceed, exit 1 to skip (saves cost).

```typescript
// validate-input.ts
import { existsSync, readdirSync } from "fs";
import { join } from "path";

const dataDir = join(process.cwd(), "workspace", "data");
if (!existsSync(dataDir) || readdirSync(dataDir).length === 0) {
  console.error("No data files to process");
  process.exit(1);
}
process.exit(0);
```

### Output Validator

Runs after agent. Exit 0 = success. Exit 1 = retry (stderr fed back to agent).

```typescript
// validate-output.ts
import { existsSync, readFileSync } from "fs";

const outputFile = process.env.EXPECTED_OUTPUT || "output.json";
if (!existsSync(outputFile)) {
  console.error(`Output file not created: ${outputFile}. Write results to this path.`);
  process.exit(1);
}

// Validate structure
try {
  const data = JSON.parse(readFileSync(outputFile, "utf-8"));
  if (!data.results || !Array.isArray(data.results)) {
    console.error("Output JSON missing 'results' array");
    process.exit(1);
  }
} catch (e) {
  console.error(`Invalid JSON: ${e}`);
  process.exit(1);
}

process.exit(0);
```

## Workflow Chaining

Chain workflows via filesystem. One workflow writes output, another watches for it:

```
analyzer/config.toml:        scribe/config.toml:
  [trigger]                    [trigger]
  schedule = "hourly"          watcher = "workspace/analysis/**/*.json"
  # Writes JSON analysis       # Reads analysis, writes reports
```

Each step is independently testable, retriable, and inspectable.

## Model Tiers

Workflows reference model tiers from `config.toml`:

```toml
# In root config.toml
[models]
lite = "claude-haiku-4-5"
medium = "claude-sonnet-4"
cheap = "gemini-2.0-flash"
```

The workflow's `[agent] model = "lite"` resolves to the concrete model ID.

## Quick Start

To create a new workflow:

1. Choose location: `packages/<pkg>/workflows/<name>/` or `.pi/workflows/<name>/`
2. Create `config.toml` with trigger and type
3. For agent workflows, create `agent.md` with the system prompt
4. Optionally add validators for reliability
5. Run `just workflow-dag` to visualize the dependency graph
6. Test with `daemon trigger <name>`

## Guidelines

- Keep agent prompts focused on one task
- Use validators for anything that must be deterministic
- Prefer file watcher chaining over multi-step prompts
- Set appropriate timeouts (agents with many file reads take longer)
- Use `model = "lite"` for routine tasks, higher tiers for complex reasoning
