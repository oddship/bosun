## Workspace

Write scratch files, reports, and non-code output to `$BOSUN_WORKSPACE` (default: `workspace/`), not the repo root.

| Content | Path |
|---------|------|
| Reviews | `workspace/reviews/` |
| Plans | `workspace/plans/` |
| Scratch/temp | `workspace/scratch/` |
| Logs | `workspace/logs/` |
| Cloned repos | `workspace/code/{host}/{group}/{repo}` |
| Worktrees | `workspace/code/worktrees/{host}/{group}/{repo}/{branch}` |

**When looking for user projects or repositories**, always check `workspace/code/` first — it follows the layout `workspace/code/{host}/{group}/{repo}` (e.g., `workspace/code/github.com/rhnvrm/rohanverma.net`).
