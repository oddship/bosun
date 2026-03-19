---
title: Testing
description: How to run tests, write tests, and validate changes in bosun
---

# Testing

Bosun has three levels of testing: unit tests, e2e scripts, and live Pi tests.

## Unit tests

Each package has its own `tests/` directory using `bun:test`.

```bash
# Run all tests
bun test

# Run tests for a specific package
bun test packages/pi-agents/tests/
bun test packages/pi-memory/tests/

# Run a specific test file
bun test packages/pi-agents/tests/template.test.ts
```

### What's tested

| Package | What |
|---------|------|
| pi-agents | Agent discovery, frontmatter parsing, config loading, template rendering |
| pi-daemon | Config loading, workflow discovery, rules engine, task queue, triggers, validators |
| pi-memory | Config loading, memory tools (search/get/multi_get/status) |

### Writing unit tests

Tests use temp directories and don't touch the real project:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("myFeature", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does something", () => {
    // Create fixture files in tmpDir
    // Call the function under test
    // Assert
  });
});
```

## E2E scripts

E2E scripts validate integration scenarios that unit tests can't cover — config
generation, CLI flows, tmux interactions. They run against isolated temp
directories and tmux sockets.

```bash
# Config generation
just e2e-memory-init          # init.ts generates correct pi-memory config

# CLI flows
just e2e-memory-cli           # memory search/get/multi-get against fixtures

# Tmux runtime identity
just e2e-runtime-identity     # window rename targets correct pane
```

### E2e harness

The harness at `scripts/e2e/harness.ts` provides:

- `TmuxHarness` — manages an isolated tmux server with its own socket
- `startSession()`, `newWindow()`, `sendKeys()`, `capturePane()`
- `waitFor()` — poll a predicate with timeout
- Automatic cleanup on exit

```typescript
import { TmuxHarness, worktreeRoot } from "./harness";

const root = worktreeRoot();
const harness = new TmuxHarness({ root, name: "my-e2e" });

try {
  await harness.startSession("test", "win", "bash");
  await harness.sendKeys("test:1", "echo hello");
  await harness.waitFor(async () => {
    const output = await harness.capturePane("test:1", 10);
    return output.includes("hello");
  }, 5000);
} finally {
  await harness.cleanup();
}
```

### Adding e2e scenarios

1. Create `scripts/e2e/my-scenario.ts`
2. Add a justfile recipe: `e2e-my-scenario: bun {{bosun_pkg}}/scripts/e2e/my-scenario.ts`
3. Update `scripts/e2e/README.md`

Prefer scenarios that test one thing. Keep them deterministic and isolated.

## Live Pi tests

Live tests start a real Pi process and interact with it. They require
`auth.json` (Pi login) and `config.toml` to be set up.

```bash
# Agent loads, calls a tool, updates mesh and tmux
just e2e-runtime-identity-live-pi

# Agent loads with rendered slots from pi-bosun
just e2e-agent-slots
```

These are slower (depend on LLM responses) and require API keys.
Run them after structural changes to agents, slots, or the template engine.

### Prerequisites

{{< note type="warning" >}}
Live Pi tests require API keys and incur LLM costs. Only run them after structural changes to agents, slots, or the template engine.
{{< /note >}}

```bash
# Must have auth configured
ls .bosun-home/.pi/agent/auth.json

# Must have config.toml
ls config.toml

# Must have run init
just init
```

## When to run what

| Change | Run |
|--------|-----|
| Package code (src/) | `bun test` |
| Agent definitions, slots, template engine | `bun test` + `just e2e-agent-slots` |
| Config/init pipeline | `bun test` + `just e2e-memory-init` |
| Memory tools | `bun test` + `just e2e-memory-cli` |
| Tmux/spawn behavior | `just e2e-runtime-identity` |
| Before merge | All of the above |

## CI

There is no CI pipeline yet. Tests are run locally before commits.
The verify + review agent gate pattern is the primary quality gate.
