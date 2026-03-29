# pi-weaver

Self-correction for Pi agents. The model checkpoints its progress, rewinds when stuck, and verifies before finishing.

## Quick start

```bash
pi -e pi-weaver "fix the bug in app.js"
```

## What it does

pi-weaver adds three tools to any Pi session:

- **checkpoint** — saves a named snapshot of progress so the model can return to it later
- **time_lapse** — rewinds to a previous checkpoint, discarding a failed approach and trying something different
- **done** — signals completion with a verification gate; the harness checks the work before accepting it

## When to use it

- Complex, multi-step tasks where the first approach might not work
- Debugging sessions that require trying different fixes
- Build-from-source or configuration tasks with many failure modes
- Any task where "undo and retry" is better than plowing ahead

## When NOT to use it

- Quick questions or explanations
- One-shot edits where the change is obvious
- Read-only tasks (code review, search, exploration)
- Simple tasks that don't benefit from checkpointing overhead

## How it works

The extension injects a system prompt that teaches the model to treat `checkpoint` and `time_lapse` like try/except — save progress at stable points, rewind if something goes wrong, and always verify via `done()` before finishing. Context is pruned at rewind time so the model doesn't carry forward dead-end reasoning. See [REPORT.md](REPORT.md) for evaluation results and [RESEARCH.md](RESEARCH.md) for design notes.

## Configuration

Toggle weaver on or off mid-session with `/weaver on|off` (coming soon).

## Links

- [Evaluation results](REPORT.md) — task-by-task performance data
- [Research notes](RESEARCH.md) — design rationale and alternatives considered
