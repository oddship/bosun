# Session Audit: Plain vs Weaver (Haiku 4.5, Terminal-Bench Sample)

## Per-Task Deep Dive

### ✅ fix-code-vulnerability (Both pass)
**The weaver showcase.** Weaver was 3.3x cheaper ($0.08 vs $0.26) and used less than half the tool calls (23 vs 55). The cookbook's structured approach — orient, understand, checkpoint, fix, verify, done — led to a focused execution. Used checkpoint once. Plain Haiku was more exploratory and verbose but also passed.

### ✅ log-summary-date-ranges (Both pass)
Simple task, both solved efficiently. Nearly identical cost (~$0.035). Weaver had slightly better caching (99.8% vs 52.8%).

### ✅ sqlite-with-gcov (Both pass)
Both solved it. Similar cost (~$0.09). Weaver used fewer tool calls (18 vs 30) — more focused execution. Both had "file: command not found" (minor, didn't affect outcome).

### ❌ regex-log (Plain pass, Weaver fail)
**Non-deterministic.** Weaver correctly oriented (installed python3), found+fixed capture group issue, cleaned up test files, called done() — but the regex logic itself was wrong (missed 3/9 dates). In our spike runs, weaver scored 1.0 on this same task. Haiku's regex quality varies per run.

### ❌ polyglot-c-py (Both fail)
**Weaver was catastrophically worse.** 77 tool calls, $0.95 (!!) vs plain's 10 calls, $0.21. The model got stuck in a loop rewriting the polyglot, compiling test binaries, and never cleaned up. Context compaction kicked in (evidenced by "undefined" text entries). The compiled binary `cmain` was left in `/app/polyglot/` alongside `main.py.c`, failing the verifier's check for exactly one file. 

Root cause: Haiku can't write a working C/Python polyglot and kept retrying without time_lapsing.

### ❌ build-cython-ext (Both fail)
Both spent a lot (72-88 tool calls, ~$0.35). Weaver used 2 checkpoints and done(). Both failed — task requires deep knowledge of Cython build systems that Haiku lacks.

### ❌ chess-best-move (Both fail)
Requires analyzing a chess board image. Plain Haiku: 2 tool calls (read image, write answer) — $0.09. Weaver: 16 calls, $0.25 — tried multiple approaches to analyze the image. Neither can actually see the chess board (no vision support in pi's print mode).

### ❌ configure-git-webserver (Plain: auth error, Weaver: fail)
**Plain had an auth error** — "No API key for provider: anthropic" — 0 tool calls. This was a transient auth issue, not a task failure. Weaver actually ran (34 calls, $0.13) but couldn't configure the git server correctly.

### ❌/err qemu tasks (Both fail/error)
qemu-startup: Docker container name conflict (plain), no session data (weaver).
qemu-alpine-ssh: Agent timeout at 900s (plain), no session data (weaver).
These tasks need QEMU inside Docker — extremely challenging setup.

## Key Findings

### 1. Weaver tools barely used
- **Checkpoints:** 3 total across 8 tasks (build-cython:2, fix-code-vuln:1)
- **Time lapse:** 0 — never once fired
- **Done:** 7 tasks called done()

Haiku 4.5 doesn't have the metacognition to recognize when it's stuck. It either succeeds or fails without self-correcting.

### 2. The cookbook prompt is a double-edged sword
- **Win:** fix-code-vulnerability — 3x cheaper, half the calls, same result
- **Loss:** polyglot-c-py — 7.7x more calls, 4.5x more expensive, same failure
- **Neutral:** log-summary, sqlite — similar performance

The cookbook makes Haiku more thorough (verify, test, check), which helps on tasks it can solve but hurts on tasks it can't (more retries before giving up).

### 3. Orientation step works but isn't enough
regex-log: oriented correctly, installed python3, tested — but regex logic was still wrong.
The issue isn't tool availability, it's Haiku's capability on the actual task.

### 4. Cost comparison

| Task | Plain | Weaver | Ratio |
|------|-------|--------|-------|
| fix-code-vuln | $0.26 | $0.08 | **0.3x** ✅ |
| sqlite-with-gcov | $0.09 | $0.09 | 1.0x |
| log-summary | $0.04 | $0.03 | 0.9x |
| regex-log | $0.07 | $0.12 | 1.7x |
| chess-best-move | $0.09 | $0.25 | 2.9x |
| polyglot-c-py | $0.22 | $0.95 | **4.3x** ❌ |
| build-cython-ext | $0.35 | $0.35 | 1.0x |
| configure-git | $0.00* | $0.13 | n/a |

*auth error

### 5. Auth issue affected plain results
configure-git-webserver had "No API key for provider: anthropic" — 0 tool calls. This means plain's 4/10 should arguably be 4/9 (one task didn't run). The comparison isn't perfectly clean.

### 6. Caching is excellent for weaver
Weaver consistently shows 99.9%+ cache hit rates vs plain's more variable 50-99%. The cookbook system prompt is a stable prefix that caches well. However, this doesn't translate to better task completion.

## Conclusion

On Haiku 4.5, **weaver's scaffolding doesn't compensate for model capability limits.** The time_lapse mechanism — the core innovation — was never used. The cookbook helps with focus (fix-code-vuln) but hurts when the model can't solve the task and burns tokens retrying (polyglot).

The right test is a stronger model (Sonnet, Opus) that can actually recognize "I'm stuck, I should rewind" and use time_lapse. Haiku just... doesn't.
