# polyglot-c-py

**Category**: Creative Programming / Polyglot  **Difficulty**: Medium
**Result**: Plain fail (69s, $0.09) | Weaver fail (439s, $0.58)
**Verdict**: weaver-hurts

## What the task asks

Write a single file `main.py.c` that works as both a valid Python 3 program and a valid C program. Both `python3 main.py.c N` and `gcc main.py.c -o cmain && ./cmain N` should print the Nth Fibonacci number.

## What happened without weaver

The plain agent nailed the concept immediately. Turn 1: "I'll use the `#if 0` / `"""` bridge." This is the classic polyglot trick — C's preprocessor skips Python code via `#if 0`, Python hides C code inside a triple-quoted string. Turn 2: wrote the file. Turns 3–6: compiled with gcc (works), tried running with python3 (binary not found — only `python3.12` exists in the container).

Seven turns. Six tool calls. $0.09. The polyglot was correct; the environment was broken. The agent didn't think to create a `python3` symlink, so it failed validation.

## What happened with weaver

Same correct idea, same environment problem, but a very different trajectory.

The weaver agent checkpointed "start", explored the environment (found python3.12, not python3), and wrote the polyglot by turn 7. It worked — C compiled and ran, Python ran via `python3.12`. Same place the plain agent reached, same fundamental `python3` symlink problem.

Then things went sideways. GCC printed two warnings about unterminated string literals inside `#if 0` blocks. These warnings are cosmetic — they come from GCC's tokenizer scanning `"""` inside skipped preprocessor blocks. The compiled binary works fine. They're noise.

But the agent called `time_lapse("start")`.

It rewound to the beginning, losing its working solution. Then it spent 13 more turns — rewriting the polyglot, trying `#pragma GCC diagnostic` to suppress the warnings, discovering that doesn't work for tokenizer-level warnings, removing the pragma, rewriting again. By turn 25 it had... the same polyglot file it had at turn 7. With the same warnings. Which were always harmless.

It called `done()` on turn 26 and failed validation for the same reason: no `python3` symlink.

## The numbers are brutal

| | Plain | Weaver |
|--|-------|--------|
| Turns | 7 | 27 |
| Output tokens | 3,979 | 23,794 |
| Cost | $0.09 | $0.58 |
| Time | 69s | 439s |

6.3x the cost. 6.4x the time. The worst ratio in the entire [evaluation](../index.md).

The output tokens tell the story: 23K vs 4K. The agent generated and regenerated the polyglot file four times, each time producing long reasoning about string delimiter tricks. All of it converging on the original solution.

## Why this went wrong

Two failures compounded:

**The rewind was a judgment error.** The agent couldn't distinguish "GCC warnings" (cosmetic) from "GCC errors" (blocking). It treated warnings as a signal that its approach was flawed and rewound to try a different one. But there was no different approach — the `#if 0`/`"""` trick is essentially the only way to do Python/C polyglots, and the warnings are inherent to it.

**Weaver amplified the judgment error.** Without weaver, the agent would have spent a few turns trying to fix the warnings and then moved on. With weaver, it *rewound past its working solution*. The rewind destroyed the knowledge that the polyglot was functionally correct, and the agent re-entered the same exploration from scratch. The tool didn't cause the bad judgment, but it made the consequences 6x more expensive.

**Neither agent solved the real problem.** Both missed that `python3` → `python3.12` symlink was needed. This is an environment fix, not a coding fix. The agents were so focused on the polyglot logic that they never questioned whether the test harness's assumptions held. Weaver's tools don't help with this kind of problem — there's nothing to checkpoint about "the test runner can't find python3."

## The lesson

Weaver punishes unnecessary rewinds on creative tasks. The polyglot is a "write one clever file" problem — there's no explore-then-execute structure, no accumulated context to prune. The solution is either right or wrong on the first try.

The [fix-code-vulnerability](fix-code-vulnerability.md) rewind worked because it pruned exploration that was genuinely finished — grep output, test analysis, CWE research. Here, the rewind pruned *the solution itself*. That's the difference between pruning scaffolding and demolishing the building.

This is also a warning about what "self-correction" means in practice. The agent correctly identified a problem (GCC warnings), correctly used the tool (time_lapse to start over), and still made things worse. The tool worked. The judgment didn't. That's [antirez's question](../analysis/the-idea.md) showing up in the data.
