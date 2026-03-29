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

## 1. Benchmark Results

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

## 2. Session Trace Analysis

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

## 3. time_lapse Effectiveness

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

## 4. Token Economics

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

## 5. Conclusions

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
