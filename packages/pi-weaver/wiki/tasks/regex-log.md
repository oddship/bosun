# regex-log

**Category**: Text Processing / Regex  **Difficulty**: Medium
**Result**: Plain pass (217s, $0.35) | Weaver pass (191s, $0.30)
**Verdict**: neutral

## What the task asks

Write a single regex that matches the last YYYY-MM-DD date on log lines containing a valid IPv4 address. Edge cases everywhere: February can have 29 days, IPs can't have leading zeros, things that look like dates (e.g., `1134-12-1234`) aren't, and valid dates/IPs can't be embedded inside larger alphanumeric strings.

## What happened without weaver

The plain agent spent most of its time thinking. Turn 1 was a massive output — 16K tokens of chain-of-thought reasoning about the regex structure. IPv4 lookahead, month validation (01–12), day validation (01–28/29/30/31 per month), greedy `.*` to match the *last* date, word boundary guards. Then it tested iteratively over 6 bash turns, fixing edge cases one at a time.

Eight turns total. All 27 test cases pass. $0.35.

The cost is high for such a short session because the output tokens dominate — the model essentially wrote a regex essay before producing the actual regex.

## What happened with weaver

Checkpoint "start" (task requirements, output file path). Then the same kind of reasoning, spread across more turns. The agent built a test harness in Bun (regex syntax is compatible enough with Python `re` for these constructs), iterated on edge cases, and converged.

No time_lapse. The model never felt the need to rewind. There was nothing to rewind from — no exploration phase, no wrong turns, just iterative refinement of a single artifact.

Twelve turns, $0.30. The checkpoint and `done()` call added 2 turns of overhead but the model's output was more concise (13K vs 16K tokens), which more than compensated.

## Why this is boring (and why that matters)

The $0.05 difference is noise. The 26-second time difference is noise. This task tells us almost nothing about weaver's rewind mechanism because the mechanism was never used.

But that *is* the data point. Not every task has an explore-then-execute structure. Some tasks are just "think hard, write one thing, test it." The regex task is pure reasoning — there's no codebase to explore, no files to read, no context to accumulate and then prune. The model thinks, writes, and iterates.

| | Plain | Weaver |
|--|-------|--------|
| Turns | 8 | 12 |
| Output tokens | 16,307 | 12,787 |
| Cache read | 97K | 163K |
| Cost | $0.35 | $0.30 |
| Time | 217s | 191s |

The interesting asymmetry: weaver used more turns but fewer output tokens. The model spread its reasoning across more responses instead of front-loading everything into one massive turn. I don't think the checkpoint caused this — it's more likely run-to-run variance in how the model chooses to structure its thinking. But it's worth watching across more tasks.

## The lesson

Weaver doesn't help or hurt on single-artifact reasoning tasks. No rewind means no savings — but no overhead either (the checkpoint cost is negligible). The tool just sat there, unused, like a fire extinguisher in a kitchen where nothing caught fire.

This contrasts sharply with [configure-git-webserver](configure-git-webserver.md), which is also a "short, no rewind needed" task — but where the checkpoint ritual added meaningful overhead because the base cost was so low ($0.06). Here the base cost ($0.35) is high enough that the checkpoint overhead disappears into rounding error.

The takeaway: weaver's overhead is fixed (a few tool calls), so it matters more on cheap tasks and less on expensive ones. The [fix-code-vulnerability](fix-code-vulnerability.md) and [build-cython-ext](build-cython-ext.md) sessions, which cost $0.14–$0.83, are where the rewind decision actually moves the needle.
