# log-summary-date-ranges

**Category**: Data Processing  **Difficulty**: Easy-Medium
**Result**: Plain pass (34s, $0.06) | Weaver pass (45s, $0.08)
**Verdict**: weaver-hurts

## Task Description

Analyze log files in `/app/logs/` (named `YYYY-MM-DD_source.log`) and produce a CSV counting ERROR, WARNING, and INFO occurrences across five date-range periods, using 2025-08-12 as the reference date.

## What Happened

This is the task where weaver looks silliest.

Plain solved it in 6 turns. Look at logs, understand format, write Python script, run it, write CSV, verify. Thirty-four seconds, six cents. Done.

Weaver solved the exact same problem the exact same way — but took 11 turns doing it. Two checkpoints, a time_lapse, a done call, even cleaned up its temp script afterwards. Forty-five seconds, eight cents. Same CSV.

The five extra turns were pure ceremony. The "start" checkpoint recorded the task requirements (which were already in the system prompt). The "ready" checkpoint recorded the log format (which a single `head -5` had revealed). The time_lapse steering said "write a Python script to parse all files, count severities, produce CSV" — which is... what the task says to do.

Nobody rewound. Nobody needed to. The problem is: parse filenames for dates, count strings, bucket by range. There's one approach, it works on the first try, and that's it.

## Why This Matters

Every framework has a tax. Weaver's tax is the checkpoint/time_lapse/done ceremony — roughly 3-5 tool calls of overhead per task. On a task that takes 5 tool calls total, that's a 60-100% increase in overhead. On a task that takes 50, it's 6-10% and probably invisible.

The question isn't whether this task is the right one for weaver. Obviously it isn't. The question is: **can the agent learn when to skip the ceremony?** Right now, it can't. The weaver prompt tells it to checkpoint early and time_lapse after orientation. So it does, even when orientation takes one bash call.

Compare with [chess-best-move](chess-best-move.md), where the agent actually *under-used* weaver — only 1 checkpoint, no time_lapse. The model has some sense of when it's stuck vs. cruising, but the threshold is off. It does ceremony on easy tasks and skips it on hard ones.

## Token Economics

| Metric | Plain | Weaver |
|--------|-------|--------|
| Turns | 6 | 11 |
| Tool calls | 5 (bash:4, write:1) | 10 (cp:2, bash:5, tl:1, write:1, done:1) |
| Output tokens | 1,853 | 2,500 |
| Cache read | 24k | 65k |
| Total cost | $0.06 | $0.08 |
| Elapsed | 34s | 45s |

32% more expensive, 32% slower. The cache reads are 2.7× higher because each checkpoint replays the growing context.

## What This Teaches

The tax is real but small in absolute terms — two cents, eleven seconds. If you told me "pay $0.02 extra for every task so that hard tasks get self-correction," I'd take that deal. The problem is when the tax is all you get.

This task is the "hello world" of the evaluation: well-specified input, deterministic output, one obvious approach. Weaver's bet is that across a portfolio of tasks, the wins on hard problems ([fix-code-vulnerability](fix-code-vulnerability.md) saved $0.08, [polyglot-c-py](polyglot-c-py.md) enabled a correct rewind) outweigh the losses on easy ones. This page is what a loss looks like. It's boring. That's the point.
