# fix-git

**Category**: Git/Version Control  **Difficulty**: Easy-Medium
**Result**: Plain pass (43s, $0.07) | Weaver pass (67s, $0.10)
**Verdict**: weaver-hurts

## Task Description

Find changes that were lost after checking out master in a personal site git repo, and merge them back into master.

## What Happened

Both agents nailed the diagnosis. The user made a commit in detached HEAD state (checked out `HEAD~1`, then committed "Move to Stanford"). When they switched back to master, the commit became orphaned — still in the reflog, but not reachable from any branch. Classic git footgun.

**Plain** found it in 4 turns: `git log --all`, `git reflog`, spot `650dba4`, `git cherry-pick`. Hit a conflict in `about.md`, resolved it (keep the Stanford version), done. Eleven turns total, 43 seconds.

**Weaver** found it just as fast, also via reflog. But then things got weird.

The agent set a "start" checkpoint, found the orphaned commit, tried `git merge 650dba4` (merge instead of cherry-pick — both valid), resolved the conflict. So far so good. Then at T10, *after the merge was already resolved and staged*, it called `time_lapse`. After that, it created a "ready" checkpoint recording the completed resolution. Then at T12 it tried `git merge 650dba4` *again* — the merge was already in progress, which caused confusion for two turns before it figured out it just needed to `git commit --no-edit`.

The sequence was: do the work → call time_lapse → checkpoint → redo the work (fail) → recover → done.

## The Backwards Ceremony

In every other weaver session I analyzed, the pattern is checkpoint→time_lapse→work→done. Here it was work→time_lapse→checkpoint→confused-work→done. The agent treated weaver as an *afterthought* — documentation of what it already did, not planning for what it's about to do.

This is [the-idea](../analysis/the-idea.md) in reverse. The time_lapse is supposed to prune context *before* execution, keeping only the structured state from the checkpoint. When you call it *after* doing the work, you prune... the work you just did. And then you try to redo it with only the checkpoint state, which may not capture the current git state accurately.

That's exactly what happened at T12. The agent rewound to a checkpoint that said "merge commit 650dba4," so it tried to merge again. But git was already in a merge state from T6. The agent had to spend two turns figuring out it was mid-merge and just needed to commit.

**Plain** didn't have this problem because it didn't have the tools to confuse itself with.

## Token Economics

| Metric | Plain | Weaver |
|--------|-------|--------|
| Turns | 11 | 16 |
| Tool calls | 14 (bash:12, read:1, write:1) | 15 (cp:2, bash:10, edit:1, tl:1, done:1) |
| Output tokens | 1,682 | 2,954 |
| Cache read | 40k | 95k |
| Total cost | $0.07 | $0.10 |
| Elapsed | 43s | 67s |

48% more expensive, 56% slower. The cache reads are 2.4× higher from the checkpoint replays.

## What This Teaches

**Ordering matters more than having the tools.** Weaver's tools aren't magic — they're `try/raise/return` for conversations. If you put the `try` after the code that might fail, it doesn't help. The model needs to learn the idiom: checkpoint *before* you start, time_lapse *when* you're ready to execute, not after.

This is also a case where the task is too linear for weaver to help. Git forensics follows a chain: find the commit (reflog) → incorporate it (merge/cherry-pick) → resolve conflicts → done. There's no "explore, then execute" phase split like [fix-code-vulnerability](fix-code-vulnerability.md) had. You don't need to prune context because you never accumulate irrelevant context.

Compare [log-summary-date-ranges](log-summary-date-ranges.md): weaver was also unnecessary there, but at least it did the ceremony in the right order and didn't trip over itself. Here, the mis-ordering actively caused a bug. Small sample, but it suggests the model's grasp of *when* to use the tools is shakier than its grasp of *how*.
