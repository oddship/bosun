# sqlite-with-gcov

**Category**: Build/Compilation  **Difficulty**: Medium
**Result**: Plain fail (178s, $0.15) | Weaver fail (110s, $0.11)
**Verdict**: neutral

## Task Description

Compile SQLite from a pre-vendored source tarball with gcov instrumentation enabled, install it to `/app/sqlite`, and make the `sqlite3` binary available in PATH.

## What Happened

Both agents failed this one, but they failed *differently*, and that difference is the interesting part.

The task looks straightforward: extract tarball, configure with coverage flags, build, install, wire into PATH. Both agents got the build right. SQLite compiled, gcov flags applied, binary worked. The failures were in the last mile — making the verifier happy.

**Plain** installed sqlite to `/app/sqlite/install/bin/` and set PATH via `/etc/profile.d/sqlite-gcov.sh` plus `/etc/environment`. Classic sysadmin approach. Problem: the verifier runs in a subprocess that doesn't source profile scripts. `sqlite3` command not found. All 3 tests fail.

**Weaver** did something smarter. Its [time_lapse](../analysis/architecture.md) steering message included "symlink to /usr/local/bin" — and that's exactly what it did. `ln -sf /app/sqlite/bin/sqlite3 /usr/local/bin/sqlite3`. The verifier found the binary, 2 of 3 tests passed.

The third test checked for `.gcda` files under `/app/sqlite/` after running the binary. Weaver built in `/tmp/sqlite-build/` instead of directly in `/app/sqlite/`, so the runtime coverage data landed in the wrong directory. A one-directory decision that turned a pass into a fail.

## The Interesting Part

The plain agent spent 21 turns doing careful, methodical work. It even noticed `configure` was saying "Use gcov? no" and went back to find the `--gcov` flag — good recovery. But it never questioned whether `/etc/profile.d/` would work in the verifier's context. That's a hidden-spec problem: you're building for a test harness you can't see.

Weaver's checkpoint at T10 captured the essentials — gcc version, gcov path, tarball structure — and the time_lapse steering laid out the plan: "extract, configure with --coverage, make install to /app/sqlite, symlink to /usr/local/bin." That plan was *better* than plain's. The symlink approach just works, regardless of shell type.

But the same planning that got the PATH right also chose `/tmp/sqlite-build/` as the build directory. The checkpoint state tracked where to *install* but not where to *build*. One missing field in the structured state, one failed test.

This is the pattern I keep seeing: weaver improves the parts of the problem you think to plan for, and leaves the parts you don't think about exactly as vulnerable as before.

## Token Economics

| Metric | Plain | Weaver |
|--------|-------|--------|
| Turns | 21 | 20 |
| Tool calls | 24 (bash:23, write:1) | 19 (cp:2, bash:15, tl:1, done:1) |
| Output tokens | 3,606 | 2,563 |
| Cache read | 124k | 117k |
| Total cost | $0.15 | $0.11 |
| Elapsed | 178s | 110s |

Weaver was 25% cheaper and 38% faster, while getting closer to passing (2/3 vs 0/3). If this were scored on partial credit, weaver wins clearly.

## What This Teaches

Weaver's value here wasn't self-correction — no rewinds happened. It was **structured planning producing a better first attempt**. The act of writing a checkpoint forced the agent to articulate its approach, and the time_lapse steering message became a concrete plan. Plain just... started doing things.

That said, structured planning has the same blind spots as any plan. You plan for what you foresee. The `.gcda` file location was a detail neither approach foresaw, because neither agent could read the verifier's test code.

Compare with [fix-code-vulnerability](fix-code-vulnerability.md), where weaver's checkpoint-and-rewind actually pruned exploration context. Here there was nothing to prune — the task is linear. The value came from the planning side-effect, not the rewind mechanism.
