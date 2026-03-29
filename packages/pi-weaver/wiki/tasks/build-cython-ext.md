# build-cython-ext

**Category**: Build Systems / Compatibility  **Difficulty**: Hard
**Result**: Plain pass (247s, $0.63) | Weaver pass (355s, $0.83)
**Verdict**: weaver-hurts

## Task Description

Clone pyknotid 0.5.3, fix NumPy 2.3.0 compatibility issues across ~15 source files, compile three Cython extensions (chelpers, ccomplexity, cinvariants), install to system Python, and verify the README snippet plus test suite pass.

## Plain Session Trace

1. **Clone & survey (T1–T6)**: Cloned repo, read setup.py, examined Cython source files and Python modules. Identified numpy version, checked Cython availability.
2. **Systematic grep (T7–T9)**: Searched for all deprecated NumPy aliases (`np.int`, `np.float`, `np.bool`, `np.complex`) across the codebase. Built a mental fix list.
3. **Apply fixes (T11–T33)**: Methodically edited 12+ files, replacing deprecated aliases: `np.float` → `float`, `np.int` → `int`, `np.bool` → `bool`, `np.complex` → `complex`, `np.int` → `np.intp` (in Cython). Also fixed `fractions.gcd` → `math.gcd` for Python 3.9+ compatibility.
4. **Build & verify (T35–T49)**: Built extensions with `python setup.py build_ext --inplace`, installed package, ran README snippet (works), ran test suite (18/18 pass).

Total: 49 turns, 62 tool calls (30 bash, 21 read, 11 edit). Linear, methodical execution.

## Weaver Session Trace

1. **Checkpoint "start" (T1)**: Saved task overview (repo, numpy target, extensions needed, test snippet, skip-tests list).
2. **Exploration (T2–T28)**: Long exploration phase — 27 turns of bash commands examining the codebase, checking versions, reading files, grepping for deprecated APIs. Much more exploration than plain.
3. **Checkpoint "ready" (T29)**: Saved detailed fix plan: `{fixes_needed: [...], build_cmd: ..., test_cmd: ..., verify_snippet: ...}`.
4. **time_lapse → "ready" (T30)**: First rewind. Pruned 28 turns of exploration.
5. **Checkpoint "attempt_1" + fixes (T31–T44)**: Applied edits, ran build. Hit issues, made additional fixes.
6. **time_lapse → "attempt_1" (T45)**: Second rewind after build errors. Retried.
7. **time_lapse → "attempt_1" (T52)**: Third rewind. Still working through build issues.
8. **time_lapse → "attempt_1" (T63)**: Fourth rewind. Finally got clean build.
9. **Verify & done (T64–T68)**: Ran tests (18/18 pass), ran README snippet, checkpointed "done", called done().

Total: 69 turns, 68 tool calls (44 bash, 4 checkpoint, 4 time_lapse, 12 edit, 3 read, 1 done).

## Key Divergence

Both agents completed the task with the same set of fixes. The difference is in execution strategy:

- **Plain** was methodical and linear: grep for all issues, fix them one by one, build once, verify. It had a clear mental model of all 12+ files that needed changes and executed the plan without backtracking.
- **Weaver** used 4 time_lapses — one to compress exploration, and three retries from "attempt_1". The repeated rewinds suggest the agent kept hitting build errors, rewinding to a clean state, and retrying. But each rewind discarded partial progress (edits that were correct), forcing re-application.

The core problem: **this task requires many small coordinated edits across many files**. Rewinding discards those edits, forcing the agent to redo them. The explore-then-execute pattern doesn't help when the "execute" phase itself is complex and iterative.

## Token Economics

| Metric | Plain | Weaver |
|--------|-------|--------|
| Turns | 49 | 69 |
| Tool calls | 62 | 68 |
| Output tokens | 10,566 | 15,920 |
| Cache read | 1,086,163 | 1,452,445 |
| Cache write | 38,645 | 41,503 |
| Cost | $0.6294 | $0.8304 |
| Time | 247s | 355s |

Weaver cost 32% more and took 44% longer. The 4 time_lapses each forced context rebuilding and re-application of fixes, adding ~370K cache reads and 5K output tokens compared to plain.

## Lessons

**Weaver struggles with multi-file edit tasks.** When the fix requires touching 12+ files with small targeted edits, rewinds are destructive — they erase correct edits along with stale context. The plain agent's linear approach was more efficient: grep everything, fix everything, build once.

**Multiple time_lapses signal trouble.** Four rewinds in a single task is a red flag. Each rewind means the previous attempt's work was lost. For build-and-fix tasks, a better strategy would be to never rewind past the point where edits were applied — checkpoint *after* edits, not before them. The "attempt_1" checkpoint was placed too early (before fixes), so rewinding to it meant re-doing all fixes.

**Checkpoint placement matters.** If "attempt_1" had been saved *after* all edits were applied (but before the build), rewinds would have preserved the edits and only retried the build step. This is a learnable skill for the model.
