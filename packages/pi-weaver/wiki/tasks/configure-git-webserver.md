# configure-git-webserver

**Category**: DevOps / System Administration  **Difficulty**: Medium
**Result**: Plain pass (75s, $0.06) | Weaver pass (106s, $0.16)
**Verdict**: weaver-hurts

## Task Description

Configure a bare git repository at `/git/server` with a post-receive hook that deploys pushed content to a web server running on port 8080, so that `git push` automatically makes files available via HTTP.

## Plain Session Trace

1. **Setup (T1–T4)**: Created git user, initialized bare repo at `/git/server`, wrote a post-receive hook (`GIT_WORK_TREE=/var/www/gitdeploy git checkout -f`), configured nginx to serve from the deploy directory on port 8080.
2. **Start services (T5–T6)**: Started nginx, set permissions.
3. **End-to-end test (T7–T9)**: Cloned the repo locally, created `hello.html`, committed, pushed. Verified `curl http://localhost:8080/hello.html` returns "hello world".
4. **Done (T10)**: Summarized the setup.

Total: 10 turns, 10 tool calls (9 bash, 1 write). Clean, linear execution — the agent knew exactly what to do and did it.

## Weaver Session Trace

1. **Checkpoint "start" (T1)**: Saved task requirements (git clone path, web port, push-to-deploy pattern).
2. **Exploration (T2–T4)**: Checked environment — OS version, available tools (nginx, apache, git), existing users. Used parallel tool calls.
3. **Checkpoint "ready" (T4–T5)**: Saved environment details and a plan: `{env: "Ubuntu 24.04", tools: [...], plan: "bare repo + post-receive + nginx", nginx_config_path: ..., web_root: ..., repo_path: ...}`.
4. **time_lapse → "ready" (T6)**: Rewound to "ready" checkpoint. Pruned exploration turns.
5. **Setup (T7–T17)**: Created git user, bare repo, post-receive hook, nginx config. Started services. Ran end-to-end test. Hit a `systemctl` issue (not available in container), used `nginx` directly.
6. **Cleanup & done (T18–T19)**: Cleaned up test repo, signaled completion.

Total: 20 turns, 22 tool calls (15 bash, 2 checkpoint, 1 time_lapse, 3 write, 1 done).

## Key Divergence

This task is **procedural knowledge** — the agent either knows how to set up git + nginx + post-receive hooks or it doesn't. Both agents knew.

- **Plain** executed the recipe in 10 turns with zero wasted effort. It didn't need to explore because the task is well-defined and the agent had the knowledge already.
- **Weaver** added overhead: 2 checkpoints, 1 time_lapse, and an exploration phase that discovered facts (Ubuntu 24.04, nginx available) the agent could have assumed. The rewind pruned 4 turns of exploration that cost very little to begin with.

The rewind was **net negative**: the 4 turns of exploration it pruned were cheap (~5K tokens), but the weaver tooling overhead (checkpoints, time_lapse, done) added 10 extra turns and 2x the tool calls.

## Token Economics

| Metric | Plain | Weaver |
|--------|-------|--------|
| Turns | 10 | 20 |
| Tool calls | 10 | 22 |
| Output tokens | 2,176 | 4,916 |
| Cache read | 30,701 | 163,525 |
| Cache write | 4,963 | 9,254 |
| Cost | $0.0605 | $0.1576 |
| Time | 75s | 106s |

Weaver cost **2.6x more** — from $0.06 to $0.16. The overhead is disproportionate because the base task was so cheap. Cache reads jumped 5x (30K → 163K) despite the task being shorter in real complexity.

## Lessons

**Weaver hurts on fast procedural tasks.** When the agent already knows the answer and can execute linearly, checkpoints and rewinds are pure overhead. There's nothing to prune because there's nothing wasted. The plain agent's 10-turn execution was already optimal.

**The cost ratio matters more than the absolute difference.** The $0.10 absolute cost increase is small, but the 2.6x ratio is significant. For a benchmark with many easy procedural tasks, weaver would consistently overpay on the ones the model can already solve efficiently.

**Weaver's exploration instinct is counterproductive for known recipes.** The weaver-equipped model spent turns checking the OS version and available packages — information it didn't need and wouldn't need even if it failed. This suggests the checkpoint/time_lapse tools encourage an "explore first" mindset even when direct execution would be faster.
