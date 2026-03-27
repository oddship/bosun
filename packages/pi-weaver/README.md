# pi-weaver

> *Time Lapse* — like Weaver's ultimate in Dota 2, rewind to a previous state and try again.

A Pi extension that transforms pi into an autonomous executor with self-correction. Instead of structured phases (pi-exec), the model drives its own execution using three primitives:

- **checkpoint** — save named progress points with structured state
- **time_lapse** — rewind to a checkpoint, abandoning the current approach (branch is summarized)
- **done** — gated completion with harness verification

## How It Works

The extension injects a "cookbook" system prompt that teaches the model to:

1. **Read the goal** and write pseudocode for how to accomplish it
2. **Execute** according to the pseudocode, using checkpoint/time_lapse as try/except
3. **Verify** via gated done() — the harness checks work before accepting

The model picks from cookbook patterns (targeted fix, multi-file edit, investigation, audit, etc.) and adapts them to the task. The execution plan is emergent, not pre-planned.

## Usage

```bash
# Interactive
pi -e ./packages/pi-weaver/extension/index.ts

# Headless (for eval/daemon)
pi --no-session -p -e ./packages/pi-weaver/extension/index.ts "your goal here"
```

## Eval

```bash
# Run weaver against a specific task
bun run packages/pi-weaver/eval/runner.ts --task fix-bug

# Compare weaver vs plain pi
bun run packages/pi-weaver/eval/runner.ts --task fix-bug --compare

# All tasks
bun run packages/pi-weaver/eval/runner.ts --compare
```

## Inspiration

- [antirez's thread](https://x.com/antirez/status/2037488794379653620) on agent harnesses needing "jump back" tools
- Pi's built-in session tree and `/tree` navigation
- Weaver's Time Lapse ultimate from Dota 2

## Comparison with pi-exec

| | pi-exec | pi-weaver |
|---|---|---|
| Structure | Pre-planned phases | Model-driven pseudocode |
| Recovery | Gates (external verification) | time_lapse (self-correction) |
| Context | Reset per phase | Continuous with selective rewind |
| Plan | Data structure (validated upfront) | Text in conversation (flexible) |
| Cost model | Per-phase overhead | Single conversation with caching |
