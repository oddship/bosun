# pi-exec — DEPRECATED

**Replaced by [pi-weaver](../pi-weaver/).**

pi-exec was a structured phase executor (1,656 lines) that broke tasks into planning and execution phases with gate validation. It worked well on controlled tasks but couldn't adapt mid-run.

pi-weaver replaced the rigid phase structure with three tools — `checkpoint`, `time_lapse`, `done` — that let the model decide when to save state and when to rewind. Same goal (structured execution), more adaptive approach.

## History

The code is preserved in git history. Key commits:

- `cbd6d71` — phase granularity impact on performance
- `486ca2e` — latency comparison eval report  
- `4afa726` — codex-mini optimized results (87% pass)

To browse the old code:
```
git show cbd6d71:packages/pi-exec/src/executor.ts
```

## Why Deprecated

See the [pi-weaver architecture page](https://rohanverma.net/pages/harness-engineering/research/pi-weaver/analysis/architecture/) for the full story of why rigid phases were replaced with checkpoint/rewind.
