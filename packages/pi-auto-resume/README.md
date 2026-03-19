# pi-auto-resume

Automatically resume after context compaction instead of waiting for user input.

## What it does

When Pi compacts a long session (summarizing older messages to free context), the agent normally goes idle. This extension sends a follow-up prompt so the agent continues working from the compaction summary's next steps.

The LLM decides what to do — if there's a clear plan, it continues. If the task is complete or it needs input, it asks.

## Behavior

- **On by default** — agents keep working after compaction
- **Footer indicator** — `🔁 auto` when enabled
- **`/autoresume`** — toggle on/off at runtime
- **Cooldown** — configurable minimum time between auto-resumes (default 60s)
- **Overflow-safe** — detects when Pi is already handling an overflow retry and stays out of the way

## Configuration

In `config.toml`:

```toml
[auto_resume]
enabled = true            # on by default
cooldown_seconds = 60     # min seconds between auto-resumes (0 = disabled)
# message = "Continue where you left off. If the previous task is complete or you need clarification, just ask."
```

Run `bun run init` to regenerate `.pi/pi-auto-resume.json`.

## How it works

1. Pi fires `session_compact` after compaction completes
2. Extension schedules a deferred check (200ms) to avoid racing with overflow retry
3. If the agent is idle (no overflow retry running), sends the resume prompt
4. LLM reads the compaction summary and either continues or asks for input

## Agent support

Added to agents that run multi-step workflows:
- **bosun** — orchestrator, plans and delegates
- **lite** — fast helper, often runs delegated multi-step tasks

Not added to single-task agents (scout, review, verify, oracle) where compaction rarely matters.
