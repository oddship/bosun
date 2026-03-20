# pi-exec Integration Design: Quartermaster & Hodor

## Quartermaster Integration

### Current Architecture
```
QM: scanRepo() → createAgentSession() → session.prompt(task) → submit_plan tool → executePlan()
                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                 Chat loop: single growing conversation
```

### With pi-exec
```
QM: scanRepo() → createExecutor() → run({ task }) → Phase 0 generates plan → validate → executePlan()
                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                 pi-exec: Phase 0 replaces chat loop
```

### Key Changes

1. **Replace `createAgentSession` with `createExecutor`**
   - `submit_plan` tool → `done()` with `state.plan`
   - Mission system prompt → `config.systemPrompt`
   - Mission skills → included in system prompt
   - Tools: read, bash, grep, find, ls (same as current)

2. **Phase 0 generates the plan**
   - Input: mission task description
   - Output: `state.plan` + `state.context_gathered`
   - Plan validation via `stateSchema` or post-Phase-0 validation
   - This replaces the custom `submit_plan` tool entirely

3. **Plan validation stays separate**
   - QM's `validatePlan()` runs on Phase 0's output
   - If validation fails, could re-run Phase 0 with error feedback in state
   - Or use pi-exec's gate mechanism: Phase 0 with a gate that validates the plan

4. **executePlan() unchanged**
   - QM's deterministic executor stays as-is
   - It receives the validated plan from pi-exec Phase 0

### Code Sketch

```typescript
import { createExecutor } from "pi-exec";

export async function scanRepo(opts) {
  const executor = createExecutor({
    model: getModel(opts.model),
    systemPrompt: mission.systemPrompt,
    tools: {
      read: createReadTool(repoDir),
      bash: createBashTool(repoDir),
      grep: createGrepTool(repoDir),
      find: createFindTool(repoDir),
      ls: createLsTool(repoDir),
    },
    maxCostUsd: 2.0,
    phaseBudget: 100_000,  // scan needs lots of context
    onPhase: (event) => onEvent?.(mapEvent(event)),
  });

  // Phase 0 generates the plan
  const result = await executor.run({
    task: mission.buildPrompt(missionContext),
    initialState: {},
  });

  if (result.status !== "completed" || !result.state.plan) {
    throw new Error("Plan generation failed");
  }

  const plan = validatePlan(result.state.plan, mission.allowlist);
  return { plan, metrics: result.metrics };
}
```

### Benefits
- No custom `submit_plan` tool needed — `done()` handles it
- Plan validation via gate mechanism (retry on failure)
- Bounded context — Phase 0 can't grow unbounded
- Metrics are structured and per-phase

## Hodor Integration

### Current Architecture
```
Hodor: runReview() → createAgentSession() → session.prompt(diff) → submit_review tool → post
                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                     Chat loop: read code, analyze, produce review
```

### With pi-exec
```
Hodor: runReview() → createExecutor() → run({ plan: [
         { description: "Read diff and changed files", tools: ["read", "bash", "grep"] },
         { description: "Analyze for issues", tools: ["read", "grep", "find"] },
         { description: "Write review findings", tools: [] }
       ] }) → format and post
```

### Key Changes

1. **Replace `createAgentSession` with `createExecutor`**
   - `submit_review` tool → `done()` with `state.findings`
   - System prompt stays the same
   - Tools: read, bash, grep, find, ls (same as current)

2. **Structured phases**
   - Phase 1: Read diff, checkout PR branch, read changed files
   - Phase 2: Analyze code for issues (read-only tools)
   - Phase 3: Produce structured findings (no tools — just state)
   - Optional Phase 4: Verify findings by re-reading code (gate)

3. **Review output via state**
   - Phase 3's `done()` state includes `findings`, `overall_correctness`, `overall_explanation`
   - Validated against Hodor's existing schema
   - No custom tool needed

### Benefits
- Phase 2 gets read-only tools (can't accidentally modify PR code)
- Gate on Phase 3 verifies findings are well-formed
- Bounded context per phase — no risk of running out on large diffs
- Per-phase metrics show where time/tokens are spent

## Shared Integration Pattern

Both QM and Hodor follow the same pattern:
1. Explore codebase (read-only)
2. Analyze (read-only)
3. Produce structured output (done() with state)
4. Validate output
5. Execute/post result

pi-exec makes this pattern first-class with phases and gates.
