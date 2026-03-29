# polyglot-c-py

**Category**: Creative Programming / Polyglot  **Difficulty**: Medium
**Result**: Plain fail (69s, $0.09) | Weaver fail (439s, $0.58)
**Verdict**: weaver-hurts

## Task Description

Write a single file `main.py.c` that works as both a valid Python 3 program and a valid C program, computing the Nth Fibonacci number (f(0)=0, f(1)=1) when invoked via either `python3` or `gcc + run`.

## Plain Session Trace

1. **Design (T1)**: Immediately conceived the classic `#if 0` / `"""` polyglot trick — C preprocessor skips Python code via `#if 0`, Python ignores C code inside a triple-quoted string.
2. **Write (T2)**: Wrote the polyglot file in one shot.
3. **Test (T3–T6)**: Compiled with gcc, ran C binary (works). Ran with python3 — failed because `python3` wasn't available in the container (only `python3.12`). Tried workarounds.
4. **Stopped (T7)**: Gave up after 7 turns. The polyglot logic was correct but the environment lacked `python3` symlink.

Total: 7 turns, 6 tool calls. Fast and cheap, but failed the validation.

## Weaver Session Trace

1. **Checkpoint "start" (T1)**: Saved task requirements (paths, versions, test commands).
2. **Exploration (T2–T6)**: Checked Python/GCC versions, verified environment. Found `python3` missing, used `python3.12` instead.
3. **First attempt (T7–T10)**: Wrote the polyglot using the same `#if 0` trick. Both C and Python worked correctly with manual testing.
4. **time_lapse → "start" (T12)**: Rewound to start checkpoint. This was triggered after the agent noticed GCC warnings about unterminated string literals inside `#if 0` blocks.
5. **Second attempt (T13–T25)**: Rewrote the polyglot, tried multiple approaches to suppress GCC warnings (pragmas, different string delimiters). Spent 13 turns iterating on cosmetic warnings that don't affect correctness. Tried and removed pragma approaches. Eventually concluded the warnings are fundamental to the approach.
6. **done (T26)**: Signaled completion.

Total: 27 turns, 26 tool calls (17 bash, 4 write, 1 checkpoint, 1 time_lapse, 1 edit, 1 read, 1 done).

## Key Divergence

Both agents failed for the same root cause: the task validator expected `python3` (not `python3.12`), and neither agent created the symlink. But they failed very differently:

- **Plain** failed fast and cheap — 7 turns, $0.09, 69 seconds. It recognized the `python3` issue, tried a couple of things, and stopped.
- **Weaver** failed slowly and expensively — 27 turns, $0.58, 439 seconds. After a correct first implementation, the time_lapse rewound to "start" and the agent spent many turns chasing GCC warnings that were harmless. The rewind threw away a working solution and replaced it with the same solution after extensive iteration.

The rewind was **counterproductive** here: the agent's first polyglot was functionally correct, and the GCC warnings were cosmetic. By rewinding to "start", it lost the knowledge that its solution worked and spent tokens re-deriving and over-polishing it.

## Token Economics

| Metric | Plain | Weaver |
|--------|-------|--------|
| Turns | 7 | 27 |
| Output tokens | 3,979 | 23,794 |
| Cache read | 29,121 | 398,053 |
| Cache write | 6,104 | 27,384 |
| Cost | $0.0913 | $0.5791 |
| Time | 69s | 439s |

Weaver cost **6.3x more** and took **6.4x longer** — the worst cost ratio in the entire evaluation. Output tokens ballooned to 23K (6x plain) because the agent generated and rewrote the polyglot file multiple times.

## Lessons

**Weaver punishes unnecessary rewinds on creative tasks.** The polyglot task is essentially "write one clever file." There's no explore-then-execute structure — the solution is either right or wrong on the first try. Rewinding threw away correct work and triggered a perfectionist loop chasing cosmetic warnings. The model couldn't distinguish "GCC warnings" (harmless) from "actual bugs" (show-stopping), and weaver's rewind mechanism amplified this judgment error.

**Both agents missed the real fix** — creating a `python3` symlink to `python3.12`. This is an environment problem, not a coding problem, and neither weaver tools nor plain exploration helped solve it. The task exposes a shared blind spot: agents assume the specified commands will work and don't think to fix the test harness.
