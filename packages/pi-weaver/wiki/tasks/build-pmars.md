# build-pmars

**Category**: Build/Compilation  **Difficulty**: Medium
**Result**: Plain pass (92s, $0.09) | Weaver pass (110s, $0.13)
**Verdict**: neutral

## Task Description

Build pMARS (a Core War simulator) from Debian source packages without X11 support, extract source to `/app`, and install the binary to `/usr/local/bin/pmars`.

## What Happened

Both agents solved this cleanly. The path was the same: enable `deb-src` in apt, download the source package, find the Makefile, remove the X11 flag (`-DXWINGRAPHX`) and library (`-lX11`), compile, install, verify.

The difference is how they handled the Makefile.

**Plain** found `src/Makefile`, identified the X11 lines, and overrode them on the command line: `make CFLAGS="-O -DEXT94 -DPERMUTATE -DRWLIMIT" LIB="" LFLAGS=""`. Never touched the file. Seventeen turns of bash, each one doing exactly one thing.

**Weaver** explored more broadly first — read the top-level Makefile, `config/Makefile`, `debian/rules`, and `src/Makefile`. Four files instead of two. Then it checkpointed ("ready"), time_lapsed with a steering message ("Edit Makefile, build, install"), and used the `edit` tool to surgically remove the X11 defines and library from the Makefile before compiling.

The edit approach is arguably cleaner — you can `cat` the Makefile afterwards and see exactly what changed. The override approach is arguably safer — you never modify source files. Both work. Neither is wrong.

## The Exploration Tax

Weaver spent turns 9-13 reading four different Makefiles. Plain spent turns 9-11 reading two. The extra exploration (debian/rules, config/Makefile) provided no information that changed the build strategy — they all point to `src/Makefile` as the real build file. But the agent didn't know that until it looked.

Is that wasted work? I'm not sure. In a different task, `debian/rules` might have contained build flags that matter (it often does for Debian packages). The agent was being thorough. Weaver's checkpoint structure may have encouraged this — "orient fully before committing" is baked into the time_lapse pattern.

The cost of thoroughness: 4 extra turns, 18 extra seconds, $0.04. Not much. But not nothing.

## Why Neutral, Not Weaver-Hurts

I rated [log-summary-date-ranges](log-summary-date-ranges.md) and [fix-git](fix-git.md) as weaver-hurts. This one feels different because:

1. **The overhead is proportionally smaller.** $0.04 on a $0.09 task (44%) vs $0.02 on a $0.06 task (33%) — percentage is higher here, but the task is more complex. Build tasks can go sideways (wrong compiler flags, missing dependencies, broken patches). Having a checkpoint at the "I understand the build system" stage *could* have saved a restart.
2. **The checkpoint captured useful state.** The "ready" checkpoint recorded the exact Makefile path, the specific lines to edit, and the expected result. If the build had failed, rewinding to that checkpoint would have been efficient. It didn't fail, so this is theoretical value. But [sqlite-with-gcov](sqlite-with-gcov.md) shows what happens when the build *almost* works — having a structured plan to iterate on matters.
3. **No mis-ordering.** Unlike [fix-git](fix-git.md), weaver used the tools in the right order: checkpoint start → explore → checkpoint ready → time_lapse → execute → done. The ceremony was clean even if it wasn't necessary.

The honest answer is: weaver didn't help and didn't hurt much. It's insurance that didn't pay out, but the premium was low.

## Token Economics

| Metric | Plain | Weaver |
|--------|-------|--------|
| Turns | 17 | 21 |
| Tool calls | 18 (bash:18) | 22 (cp:2, bash:17, tl:1, edit:1, done:1) |
| Output tokens | 1,993 | 3,198 |
| Cache read | 65k | 154k |
| Total cost | $0.09 | $0.13 |
| Elapsed | 92s | 110s |

Cache reads 2.4× higher, the consistent overhead pattern across all weaver sessions.

## What This Teaches

Build tasks are inherently linear: discover build system → understand flags → modify → compile → verify. There's a right answer and you converge on it or you don't. Weaver's value proposition — "explore broadly, then execute with clean context" — works best when exploration generates a lot of irrelevant context. Building pMARS doesn't. Every Makefile read was relevant to understanding the build.

The interesting comparison is with [sqlite-with-gcov](sqlite-with-gcov.md), another build task. There, weaver's structured planning produced a *better first attempt* (symlink vs profile.d for PATH). Here, both approaches were equally good. The difference: SQLite's task had a hidden requirement (PATH must work in subprocesses) that planning helped surface. pMARS didn't have hidden requirements — the task description was complete.

Weaver helps most when the gap between "what the task says" and "what actually matters" is large. For build-pmars, the gap was zero.
