# build-cython-ext

**Category**: Build Systems / Compatibility  **Difficulty**: Hard
**Result**: Plain pass (247s, $0.63) | Weaver pass (355s, $0.83)
**Verdict**: weaver-hurts

## What the task asks

Clone pyknotid 0.5.3 (a knot theory library), fix its NumPy 2.3.0 compatibility issues across ~15 source files, compile three Cython extensions, install everything to system Python, and verify that both the README snippet and test suite still work.

This is the hardest task in my batch. It's not conceptually difficult — you're replacing deprecated NumPy aliases — but there are a lot of them, scattered across a lot of files, and the build has to work end-to-end.

## What happened without weaver

The plain agent was methodical. It cloned the repo, read the key files, then ran two grep commands to find every deprecated NumPy alias in the codebase. That gave it a complete fix list: `np.float` → `float`, `np.int` → `int`, `np.bool` → `bool`, `np.complex` → `complex`, `np.int` → `np.intp` in Cython code. Also `fractions.gcd` → `math.gcd` for Python 3.9+.

Then it edited. Twelve files, one after another, 22 turns of read-edit cycles. No backtracking. No surprises. It built the extensions, installed the package, ran the README snippet, ran the test suite. Eighteen tests pass. Done.

Forty-nine turns, 62 tool calls, $0.63. Linear execution — the agent had a clear mental model of every file that needed changes and followed it through.

## What happened with weaver

The weaver agent started the same way: checkpoint "start", explore the codebase. But it explored for much longer — 27 turns of bash commands before saving checkpoint "ready" with a detailed fix plan.

Then `time_lapse("ready")`. Good — that's the pattern that [worked for fix-code-vulnerability](fix-code-vulnerability.md). Prune the exploration, execute the fix plan from clean context.

But this isn't a one-edit fix. This is twelve files. The agent started applying edits, hit build errors, and called `time_lapse("attempt_1")`. Then hit more errors. `time_lapse("attempt_1")` again. And again. And again.

Four time_lapses total. Each one rewound past all the edits the agent had applied and forced it to re-apply them. The checkpoint "attempt_1" was saved *before* any fixes were applied — so every rewind meant re-doing every edit from scratch.

It got there eventually: 69 turns, 68 tool calls, $0.83. Same result as plain, same fixes, 32% more expensive, 44% slower.

## The checkpoint placement problem

This is the most instructive failure in my batch. The rewind pattern itself isn't wrong — it's where the checkpoint was placed.

```
checkpoint("ready")     ← fix plan saved
time_lapse → "ready"    ← exploration pruned ✓
  ... apply 12 edits ...
  ... build fails ...
checkpoint("attempt_1") ← saved BEFORE edits
time_lapse → "attempt_1" ← edits lost ✗
  ... re-apply 12 edits ...
  ... build fails differently ...
time_lapse → "attempt_1" ← edits lost again ✗
```

If "attempt_1" had been saved *after* all edits were applied, the rewinds would have preserved the edits and only retried the build step. Instead, the agent checkpointed its intent ("I'm about to fix things") rather than its progress ("I've fixed these 12 files"). Every rewind threw away correct work.

This is a learnable skill. The model needs to understand: checkpoint *after* you've done something valuable, not before. The [architecture page](../analysis/architecture.md) describes checkpoint as analogous to `try:` — but in practice, you want it more like a database commit. Save the state you want to keep, not the state you want to start from.

## The numbers

| | Plain | Weaver |
|--|-------|--------|
| Turns | 49 | 69 |
| Tool calls | 62 | 68 |
| Cache read | 1.09M | 1.45M |
| Cost | $0.63 | $0.83 |
| Time | 247s | 355s |

The cache read difference — 370K extra tokens — is the cost of four rewinds. Each rewind forces the model to re-process everything from the checkpoint forward, and each re-application of edits adds to the context that subsequent turns must read.

## The lesson

Weaver struggles with scattered multi-file edits. When the fix is twelve small changes across twelve files, rewinds are destructive — they erase correct changes along with stale context. The plain agent's linear approach was better: grep everything, fix everything, build once.

Four time_lapses in a single task is a red flag. Each one means the previous attempt's work was lost. Compare this to [fix-code-vulnerability](fix-code-vulnerability.md), which used one time_lapse perfectly — the difference is that a CRLF fix is a single edit, and this task is a dozen.

The deeper lesson is about checkpoint granularity. The model treated the entire fix-and-build cycle as one atomic operation, but it's actually two: "apply all edits" (deterministic, repeatable, cheap) and "build and debug" (uncertain, iterative, where rewinds might help). Checkpointing between them would have given the model the best of both worlds. But nobody taught it that — and as [the-idea](../analysis/the-idea.md) notes, we're betting the model figures out these patterns without RL. Sometimes it doesn't.
