# pi-weaver Evaluation Report

**Extension**: pi-weaver — checkpoint, time_lapse, done tools for LLM self-correction  
**Benchmark**: Terminal-Bench 2.0 (sample set, 5 tasks)  
**Models tested**: Claude Haiku 4.5, Claude Sonnet 4.6  
**Date**: 2026-03-29  

---

## Executive Summary

pi-weaver gives LLMs three tools for self-correction: **checkpoint** (save state), **time_lapse** (rewind to checkpoint, prune context), and **done** (signal completion). The theory: when an agent hits a wall, time_lapse lets it shed failed attempts from context and retry with a fresh perspective, while keeping the prompt cache warm.

We evaluated against Terminal-Bench 2.0 sample tasks — agentic terminal tasks requiring environment exploration, debugging, and multi-step execution.

**Key findings:**
- **Same pass rate**: Sonnet 4.6 scored **4/5 with both plain and weaver** variants
- **Weaver changes _how_ the model works, not _whether_ it succeeds** on these tasks
- **time_lapse is a dual-purpose primitive**: orientation shedding (3/7 uses) + failure state sanitation (4/7 uses)
- **Weaver can be cheaper**: 36% less on fix-code-vulnerability via context pruning
- **Weaver can be more expensive**: 48% more overall, 534% more on the grinding failure case
- **The grind pattern persists**: time_lapse doesn't prevent compulsive over-optimization

---

## 1. From pi-exec to pi-weaver: Design Evolution

### pi-exec: the predecessor (1,656 lines)

pi-exec was a structured executor that broke tasks into **phases** with a planning step. The architecture:

1. **Phase 0**: LLM generates a multi-phase plan (explore → edit → verify → ...)
2. **Phase 1..N**: Each phase gets its own system prompt, tool set, and goal
3. **Gate between phases**: Separate LLM call validates phase output before proceeding
4. **State passing**: Structured JSON state flows between phases

This worked well on controlled tasks (95.7% pass rate on 24 internal eval tasks with gpt-5.4-mini) but had fundamental limitations:

- **Per-phase overhead**: Each phase required a fresh LLM context + gate call, even for trivial transitions
- **Rigid structure**: The plan was fixed at Phase 0 — no adaptation when Phase 2 reveals the Phase 1 approach was wrong
- **No intra-phase self-correction**: Within a phase, the model had no way to "undo" — failed attempts accumulated in context until the phase timed out

### The antirez insight

On March 27, 2026, antirez [posted](https://x.com/antirez/status/2037488794379653620):

> One thing agents harnesses should be able to do is: to jump back in history trimming what follows, just injecting some self-steering text.

And the harder question:

> I wonder if without explicit reinforcement learning for this kind of context saving, the model will be able to use it effectively.

This framed the design problem: instead of imposing structure (pi-exec's rigid phases), give the model **tools to manage its own context**. Let it decide when to checkpoint, when to rewind, when it's done.

### pi-weaver: the rewrite (~410 lines)

Three tools replace 1,656 lines of executor machinery:

| Tool | Purpose | Maps to |
|------|---------|---------|
| `checkpoint(label, state)` | Save position + structured state | `try:` |
| `time_lapse(target, steering)` | Prune context to checkpoint, inject steering | `raise` |
| `done(summary)` | Signal completion | `return` |

Named after Dota 2 Weaver's ultimate: Time Lapse reverses position, health, mana to 5 seconds ago. The agent reverses to a checkpoint — conversation context rewinds, structured state preserved, everything between is discarded.

### Three architecture iterations

The path to a working implementation required three complete rewrites:

**Iteration 1: ctx.abort()** — Tool called `ctx.abort()` to stop the agent loop, then queued a followUp command to rebuild context. Problem: in print mode (`pi -p`), abort = exit. The followUp never ran. **Zero time_lapse invocations across 30+ eval runs.** We thought the model wouldn't use the tool — it was actually broken.

**Iteration 2: followUp + steer** — Removed abort, queued rewind via `sendUserMessage({ deliverAs: "followUp" })`. Problem: `tool_call` blocking (to prevent batched tools post-rewind) created new turns, preventing the idle state followUp needs. Infinite loop — 64 blocked tool calls, $0.23 wasted in one run. Tried `steer` instead — model treated the raw command text as user input.

**Iteration 3: context-event pruning** (current) — Replaced everything with a `context` event handler. The `context` event fires before each LLM call and can modify the message array directly. time_lapse sets a `pendingRewind` flag → `tool_call` hook blocks batched tools → `context` event prunes messages to checkpoint + injects steering. No commands, no timing issues, works in all modes. 498 → 410 lines.

### Prompt evolution (7 versions)

The system prompt went through equally dramatic iteration:

| Version | Approach | Result |
|---------|----------|--------|
| v1 | Abstract pseudocode patterns | Model ignored them completely |
| v2 | Added orientation step | Model started installing missing tools |
| v3 | XML tags per Anthropic guide | Better structure parsing |
| v4 | Concrete examples with turn numbers | Model started checkpointing |
| v5 | Context economics (what gets erased, why) | Model understood rewind cost/benefit |
| v6 | Deterministic rules (edit→test→fail→time_lapse) | Replaced vague heuristics |
| v7 | time_lapse for success too (context hygiene) | Not just failure recovery |

Key lesson: **the model can't count turns** ("time_lapse after 3-5 failures" doesn't work) but it responds well to **observable triggers** ("your test just failed after edits → time_lapse").

### System reminder injection

Even with good prompts, the model sometimes grinds (edits → test fails → edits again) instead of rewinding. Added a `tool_result` hook that tracks `lastTestFailed` + `editsSinceCheckpoint`. When both are true, the `context` event injects a reminder before the next LLM call:

> "Your last test failed after N edits. Rule: edit → test → fail → time_lapse. Do NOT edit again."

This addresses the gap between "knows the rule" and "follows the rule at the decision point."

### Bug fixes from code review

11 issues found and fixed through oracle-assisted review:

| Issue | Impact |
|-------|--------|
| Duplicate rule numbers in prompt (4,5,4,5) | Model confused about priority |
| Checkpoint lookup via string matching content text | False matches possible |
| `lastTestFailed` triggered on orientation failures | Spurious reminders |
| `lastTestFailed` cleared by any successful bash | Flag too easily reset |
| `doneCallCount` never reset on time_lapse | Verification gate persisted across rewinds |
| Fake `runVerification()` no-op | Misleading API |
| `event.isError` not used for bash failure detection | Reminder never fired (details.exitCode undefined) |
| Missing `session_start` handler | Checkpoints lost on resume |
| Dead fields in types | Code clutter |
| Stale "replaced by summary" text | Documentation drift |
| Run-as-agent instead of root in Docker | /app read-only, model wasted 70+ calls on privilege escalation |

The isError and run-as-root bugs were discovered during eval — both completely invisible in unit tests.

---

## 2. Benchmark Results

### Sonnet 4.6 — A/B Comparison (5 tasks)

| Task | Plain | Time | Cost | Weaver | Time | Cost | TL |
|------|-------|------|------|--------|------|------|----|
| fix-code-vulnerability | ✅ | 94s | $0.22 | ✅ | 71s | $0.14 | 1 |
| polyglot-c-py | ❌ | 69s | $0.09 | ❌ | 439s | $0.58 | 1 |
| regex-log | ✅ | 217s | $0.35 | ✅ | 191s | $0.30 | 0 |
| build-cython-ext | ✅ | 247s | $0.63 | ✅ | 355s | $0.83 | 4 |
| configure-git-webserver | ✅ | 75s | $0.06 | ✅ | 106s | $0.16 | 1 |
| **Total** | **4/5** | **702s** | **$1.35** | **4/5** | **1162s** | **$2.01** | **7** |

### Haiku 4.5 — Full 10-task run

Both plain and weaver scored **1/10** (only qemu-startup). Haiku is too weak for Terminal-Bench tasks — it cannot solve them regardless of tooling. The one interesting signal: weaver solved qemu-startup in 134s vs plain's 900s.

---

## 3. Session Trace Analysis

### Where weaver helped most: build-cython-ext

This was the strongest positive case — 68 tool calls, 4 checkpoints, 4 time_lapses.

The task required cloning pyknotid 0.5.3, fixing NumPy 2.x incompatibilities across 10+ files, building Cython extensions, and running tests. Both variants solved it, but through very different control flows:

**Plain**: A long monotonic march. Survey → grep → read → edit → edit → edit → build fails → install setuptools → build again → more fixes → tests pass. Context accumulated every failed grep, every read of every file. 49 turns, growing context throughout.

**Weaver**: Structured phases with explicit boundaries:
1. Orient → checkpoint("ready") with concrete fix list → time_lapse to shed orientation
2. Batch edits → checkpoint("attempt_1") → grep returns exit 1 (false alarm) → time_lapse to discard confusion
3. Build fails (missing setuptools) → time_lapse with "all edits on disk, just install setuptools"
4. Tests fail (missing pytest) → time_lapse with "extensions working, just install pytest"

Each time_lapse preserved progress while discarding local noise. The model didn't need to re-derive what it had already done.

### Where weaver hurt most: polyglot-c-py

Both variants failed, but weaver failed more expensively ($0.58 vs $0.09, 439s vs 69s).

**Plain** gave up quickly: wrote the polyglot, couldn't find Python to verify, stopped after 6 tool calls.

**Weaver** was more capable — it installed Python, verified both runtimes, achieved a working solution. But then it entered a **warning-cleanup side quest**: tried to eliminate cosmetic GCC warnings, broke the solution with a bad rewrite, time_lapsed back to recover, then *started grinding on warnings again*. The rewind recovered the working state, but it didn't prevent the model from re-entering the same trap.

This is the core limitation: **time_lapse is a recovery tool, not a stopping tool**. It can undo mistakes but it can't teach the model when to call done().

### Near-parity cases

**fix-code-vulnerability**: Both solved it. Weaver was slightly more efficient (17 vs 27 turns) — checkpointed after diagnosis, time_lapsed to shed orientation, then executed a clean fix. But the task was easy enough that plain solved it too.

**regex-log**: Both solved it. No time_lapse used. The main challenge was missing Python (both switched to Bun/JS for testing). Weaver added structure but didn't change the outcome.

**configure-git-webserver**: Both solved it. Weaver checkpointed after environment discovery, time_lapsed, then executed a staged plan. Plain did it in one big shell block. Same result, weaver took longer.

---

## 4. time_lapse Effectiveness

### Per-call analysis

| # | Task | Type | Verdict | What happened |
|---|------|------|---------|---------------|
| 1 | fix-code-vuln | Orientation shed | ✅ Helpful | Pruned diagnosis phase, executed fix cleanly |
| 2 | polyglot-c-py | Failure recovery | ⚠️ Mixed | Recovered from broken rewrite, but model re-entered grind |
| 3 | build-cython #1 | Orientation shed | ✅ Helpful | Compressed long survey into action plan |
| 4 | build-cython #2 | Failure recovery | ✅ Helpful | Discarded false-alarm grep exit code confusion |
| 5 | build-cython #3 | Failure recovery | ✅ Helpful | Reset after missing setuptools, preserved edits |
| 6 | build-cython #4 | Failure recovery | ✅ Helpful | Reset after missing pytest, preserved builds |
| 7 | config-git | Orientation shed | ✅ Helpful | Clean transition from discovery to execution |

**6 of 7 time_lapses were helpful.** The one harmful case was harmful not because the rewind was bad, but because the model re-entered the same optimization trap afterward.

### Two usage patterns

**Orientation shedding** (3/7): Model finished learning, compressed findings into steering, rewound to start execution with clean context. This matches the original design theory.

**Failure state sanitation** (4/7): Model hit a local obstacle (false alarm, missing dependency, broken experiment), rewound to discard the noisy state. This is a surprise finding — time_lapse is used more often for tactical cleanup than for strategic resets.

### Checkpoint quality matters

The best sessions had **strategic checkpoints at semantic boundaries**:
- build-cython-ext: `start` → `ready` (fix list) → `attempt_1` (edits done)
- fix-code-vuln: `start` → `ready` (diagnosis + fix plan)

The worst case had **only one coarse checkpoint**:
- polyglot-c-py: `start` only. No checkpoint at "working solution before warning cleanup." When it needed to rewind, it went all the way back to the beginning.

---

## 5. Token Economics

### Cost breakdown

| Category | Plain | Weaver | Difference |
|----------|-------|--------|------------|
| Output tokens | $0.55 (40%) | $0.91 (45%) | +66% |
| Cache reads | $0.46 (34%) | $0.70 (35%) | +53% |
| Cache writes | $0.35 (26%) | $0.39 (20%) | +12% |
| **Total** | **$1.35** | **$2.01** | **+48%** |

**Output tokens are the biggest cost driver** — weaver's checkpoint/time_lapse/done calls each generate output, and the model tends to be more verbose with structured tools.

**Cache writes are surprisingly close** ($0.39 vs $0.35) despite 48% more turns. This confirms the context pruning thesis: after time_lapse, the prompt is shorter, so each subsequent turn writes less new cache.

### The fix-code-vulnerability anomaly

Weaver was **36% cheaper** ($0.14 vs $0.22) on this task:
- 17 turns vs 27 (37% fewer)
- 168k cache reads vs 282k (40% less)
- 11.7k cache writes vs 22.8k (49% less)

The mechanism: plain's context grew monotonically across 27 turns of orientation + implementation. Weaver checkpointed after orientation (turn ~11), time_lapsed, and continued with a pruned context. Every subsequent turn re-read less cached content and wrote less new content.

**This is where context pruning pays for itself** — on tasks with a heavy orientation phase followed by focused implementation.

### The polyglot-c-py warning

Weaver was **534% more expensive** ($0.58 vs $0.09) on the shared failure:
- 27 turns vs 7
- 23.8k output tokens vs 4.0k (6x)
- The grind generated massive output as the model reasoned through warning suppression approaches

**The cost risk**: when weaver enables extended tinkering on a solved/unsolvable problem, the extra tooling amplifies cost rather than reducing it.

---

## 6. Conclusions

### What works

1. **Orientation shedding**: Checkpoint after analysis, time_lapse before execution. Reduces context size, improves cache economics. Best case: 36% cost reduction on fix-code-vulnerability.

2. **Failure state sanitation**: When a bash command fails misleadingly or a dependency is missing, time_lapse lets the model discard the confusion and resume from known-good state. Best case: build-cython-ext's 4 clean recoveries.

3. **Session structure**: Even when it doesn't change outcomes, weaver produces cleaner, more legible agent traces with explicit phase boundaries.

### What doesn't work

1. **Stopping the grind**: time_lapse recovers from mistakes but doesn't prevent re-entering the same mistake. The polyglot case shows the model rewinding successfully, then immediately re-entering the same optimization trap.

2. **Raising pass rate on these tasks**: Sonnet 4.6 already solves 4/5 without weaver. The 5th failure (polyglot) is a prioritization problem, not a context problem. Weaver changes control flow, not capability.

3. **Cost on easy tasks**: For tasks Sonnet solves quickly (configure-git-webserver: $0.06 plain), weaver adds overhead without benefit ($0.16).

### Design implications

1. **Checkpoint quality > checkpoint quantity**: Strategic checkpoints at semantic boundaries (post-diagnosis, post-edits-on-disk) are far more useful than routine start checkpoints.

2. **Need an anti-grind mechanism**: time_lapse alone isn't enough. The system reminder (inject "your test failed after N edits, consider time_lapse") helps for failure recovery but doesn't address over-optimization. A "diminishing returns" detector or hard iteration budget would help.

3. **Best fit: complex agentic tasks with orientation + recovery needs**: build-cython-ext is the poster child. Simple tasks and one-shot solves don't benefit.

### Limitations

- 5-task sample is too small for statistical significance
- Single model per variant (no repeated runs to account for non-determinism)
- Terminal-Bench sample may not represent the full 89-task distribution
- No comparison with other self-correction approaches (e.g., reflexion, retry loops)

---

## Appendix: Detailed analyses

- [Session traces](../../workspace/scratch/analysis-sessions.md) — per-task step-by-step comparison
- [Token economics](../../workspace/scratch/analysis-economics.md) — cost breakdowns and cache dynamics
- [time_lapse effectiveness](../../workspace/scratch/analysis-timelapse.md) — per-call verdict and pattern analysis
