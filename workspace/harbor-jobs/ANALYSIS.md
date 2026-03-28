# Pi-Weaver Eval: Terminal-Bench Sample (10 tasks)

## Results

| Task | Plain Pi | Weaver Pi | Notes |
|------|---------|-----------|-------|
| build-cython-ext | ❌ 0 | ❌ 0 | Both failed — complex build task |
| chess-best-move | ❌ 0 | ❌ 0 | Needs vision (image of chess board) |
| configure-git-webserver | ❌ 0 | ❌ 0 | Hard difficulty, system config |
| fix-code-vulnerability | ✅ 1 | ✅ 1 | Both passed |
| log-summary-date-ranges | ✅ 1 | ✅ 1 | Both passed |
| polyglot-c-py | ❌ 0 | ❌ 0 | Left temp files in output dir |
| qemu-alpine-ssh | ❌ 0 | err | VM tasks — timeout/crash |
| qemu-startup | err | ❌ 0 | VM tasks — timeout/crash |
| regex-log | ✅ 1 | ❌ 0* | *Non-deterministic (scored 1.0 in spike runs) |
| sqlite-with-gcov | ✅ 1 | ✅ 1 | Both passed |

**Plain: 4/10 (40%) | Weaver: 3/10 (30%)**

## Analysis

### No significant difference on this sample

On the 10-task sample, weaver and plain pi perform similarly. The tasks split into:
- **Both pass (3):** fix-code-vulnerability, log-summary-date-ranges, sqlite-with-gcov  
- **Both fail (5):** build-cython-ext, chess-best-move, configure-git-webserver, polyglot-c-py, qemu-*
- **Mixed (2):** regex-log (non-deterministic), qemu tasks (timeouts/errors)

### Why weaver didn't help more

1. **No time_lapse fired** — 0 checkpoints, 0 time_lapses across all runs. Haiku 4.5 never uses the rewind mechanism. The model either gets it right on first try or fails without recognizing it should backtrack.

2. **Cookbook overhead** — The weaver system prompt adds ~1500 tokens. For simple tasks where Haiku would pass anyway, this is pure overhead. For hard tasks where Haiku can't solve them regardless (chess vision, qemu VMs), the cookbook doesn't help.

3. **The sweet spot is narrow** — Weaver helps most on tasks where:
   - The model can make progress but might go down wrong paths
   - Self-correction is possible with feedback
   - The task is complex enough to benefit from checkpointing
   
   Most Terminal-Bench sample tasks are either "straightforward" (Haiku solves them) or "too hard" (Haiku can't solve them with any scaffolding).

4. **Non-determinism dominates** — regex-log scored 1.0 in spike runs but 0.0 in the eval run. With Haiku 4.5, the variance per run is high enough to mask any scaffolding effect.

### Where weaver DID help (spike observations)

In our development spikes, we saw clear wins:
- **Orientation step** made Haiku install python3 before trying to test regex (1.0 vs 0.0)
- **Cookbook prompting** made Haiku more methodical (structured pseudocode, verification)
- **fix-code-vulnerability** used checkpoint once before the pi JSON crash

### Recommendations

1. **Stronger model** — Try with Sonnet 4 or Opus. The time_lapse mechanism is designed for models that can recognize when they're stuck. Haiku 4.5 doesn't introspect enough.

2. **Larger task set** — 10 tasks is too small for statistical significance, especially with 2 error/timeout tasks. The full 89-task Terminal-Bench would give better signal.

3. **Multiple runs** — Need 3-5 runs per configuration to measure variance. Single-run comparison is noisy.

4. **Polyglot fix** — Both agents leave temp files. The cookbook could emphasize cleanup more strongly, or done() could check for unexpected files.

## Cost & Time

- Plain: ~66 min for 10 tasks, ~$0.05-0.10 per task (Anthropic subscription, no direct cost)
- Weaver: ~30 min for 5 + ~29 min for 5, similar cost
- Rate limiting: Haiku 4.5 via Anthropic subscription had no issues at -n 1
