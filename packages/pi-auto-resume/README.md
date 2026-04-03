# pi-auto-resume

Automatically resume after context compaction, with optional early compaction based on context usage thresholds.

## What it does

**Auto-resume**: When Pi compacts a session (summarizing older messages to free context), the agent normally goes idle. This extension sends a follow-up prompt so the agent continues working from the compaction summary's next steps.

**Early compaction** (opt-in): Triggers compaction when context usage exceeds a configurable % threshold — before model quality degrades in long contexts. Per-model thresholds let you tune for models that degrade earlier (e.g. compact Opus at 15%, Sonnet at 40%).

Works after any compaction — threshold (context too large), manual (`/compact`), or overflow. For overflow, Pi already retries internally, so the extension detects that and stays out of the way.

The LLM decides what to do — if there's a clear plan, it continues. If the task is complete or it needs input, it asks.

## Behavior

- **On by default** — agents keep working after compaction
- **Footer indicator** — `🔁 auto` when enabled
- **`/autoresume`** — toggle on/off at runtime
- **Cooldown** — configurable minimum time between auto-resumes (default 60s)
- **Overflow-safe** — skips when Pi is already handling an overflow retry
- **Early compaction** — opt-in, checks context % after each turn

## Configuration

In `config.toml`:

```toml
[auto_resume]
enabled = true            # on by default
cooldown_seconds = 60     # min seconds between auto-resumes (0 = disabled)
# message = "Continue where you left off. If the previous task is complete or you need clarification, just ask."

# Early compaction (opt-in — not set by default)
# compact_threshold = 50          # default % for all models

# Per-model overrides (takes precedence over compact_threshold)
# [auto_resume.compact_thresholds]
# "claude-opus-4-6" = 35          # Opus degrades after ~35% context usage
# "claude-sonnet-4-6" = 40
# "gpt-5.4" = 30
```

Run `bun run init` to regenerate `.pi/pi-auto-resume.json`.

## How it works

### Auto-resume (after compaction)

1. Pi fires `session_compact` after any compaction (threshold, manual, or overflow)
2. Extension schedules a deferred check (200ms) to avoid racing with Pi's overflow retry
3. If the agent is idle, sends the resume prompt — if Pi is already retrying (overflow), skips
4. LLM reads the compaction summary and either continues or asks for input

### Early compaction (opt-in)

1. After each LLM turn (`turn_end`), checks `ctx.getContextUsage().percent`
2. Resolves the threshold: per-model override → default threshold → disabled
3. If usage ≥ threshold, calls `ctx.compact()` to trigger compaction
4. Guard prevents re-triggering while compaction is in progress

## Agent support

Added to agents that run multi-step workflows:
- **bosun** — orchestrator, plans and delegates
- **lite** — fast helper, often runs delegated multi-step tasks

Not added to single-task agents (scout, review, verify, oracle) where compaction rarely matters.
