# pi-weaver Research Notes

## Origin

On March 27, 2026, antirez posted about agent harnesses:

> One thing agents harnesses should be able to do is: to jump back in history
> trimming what follows, just injecting some self-steering text.

He asked the harder question:

> I wonder if without explicit reinforcement learning for this kind of context
> saving, the model will be able to use it effectively.

We built pi-weaver to find out.

## The Idea

Three tools that give the model control over its own conversation context:

- **checkpoint(label, state)** — mark a position, save structured state
- **time_lapse(target, steering)** — erase everything after a checkpoint, inject a summary + steering text
- **done(summary)** — signal completion with verification

Named after Dota 2 Weaver's ultimate: Time Lapse reverses to 5 seconds ago — position, health, mana all rewind. The agent reverses to a checkpoint — conversation context rewinds, structured state preserved, everything between is summarized.

The insight: this is just try/except for the model's reasoning. checkpoint = try:, time_lapse = raise, steering = exception message.

## What We Built

### Extension (~350 lines)

`packages/pi-weaver/extension/index.ts` — Pi extension that registers the three tools plus a hidden `/weaver-time-lapse` command.

**Architecture (context-event pruning):**
- Tool `time_lapse` sets a `pendingRewind` flag with checkpoint label + steering
- `tool_call` hook blocks all subsequent tool calls in the same batch
- `context` event (fires before each LLM call) prunes the message array to the checkpoint, appends steering as a user message
- The model sees a clean context on its next turn — no explicit rewind needed

**Previous architecture (abandoned):** Two-phase command delegation — tool stored intent, queued `/weaver-time-lapse` command via `sendUserMessage({ deliverAs: "followUp" })`, command handler called `navigateTree()`. This failed because:
1. `followUp` delivers after ALL tool calls finish — but blocking tools created new turns, preventing the idle state followUp needs (infinite loop)
2. `steer` delivers the raw text as a user message — model treated `/weaver-time-lapse nonce` as text, not a command
3. `ctx.abort()` in print mode killed pi before followUp ran

The context-event approach is simpler (404 vs 498 lines) and works in all modes.

### System Prompt (~5KB)

`packages/pi-weaver/extension/prompt.ts` — Teaches the model context economics and deterministic rules.

**Key evolution:**
1. v1: Pseudocode cookbook with abstract patterns → model ignored them
2. v2: Added orientation step → helped (model installed missing tools)
3. v3: XML tags per Anthropic prompting guide → better structure parsing
4. v4: Concrete examples with turn numbers → model started checkpointing
5. v5: Taught context economics (what gets erased, why early checkpoint matters)
6. v6: Deterministic rules (edit → test → fail → time_lapse, always)
7. v7: time_lapse for success too (context hygiene, not just failure recovery)

**Current rules:**
- checkpoint("start") is always the first tool call
- Orient → checkpoint("ready") → time_lapse("ready") to shed orientation output
- edit → test → fail → time_lapse (deterministic, no judgment)
- Phase complete → checkpoint results → time_lapse to shed work context
- Each phase starts with clean context: system prompt + task + structured state

### Harbor Adapters

`packages/pi-weaver/harbor/pi_harbor/` — Two Python adapters for Harbor eval framework:

- `pi_agent.py` — Plain Pi (BaseInstalledAgent): installs bun + pi in Docker, configures auth.json + settings.json, runs `pi -p`
- `pi_weaver_agent.py` — Pi + Weaver: extends PiAgent, copies extension files into container, runs `pi -p -e weaver/index.ts`

**Key fixes discovered during Harbor integration:**
- Docker's `-e` flag doesn't expand `$HOME`/`$PATH` — set PATH inside the command, not env dict
- Pi's shebang is `#!/usr/bin/env node` — symlink bun as node in container
- Session files go to `~/.pi/agent/sessions/<cwd-slug>/` — copy to `/logs/agent/` for Harbor download
- Install same system deps as Claude Code + Codex adapters (curl, git, unzip, ripgrep)

## Critical Bugs: Three Architecture Iterations

### Bug 1: ctx.abort() kills print mode

Original implementation called `ctx.abort()` to stop the agent loop before queuing the followUp command. In print mode (`pi -p`), abort = exit. The followUp command never ran. Zero time_lapse invocations across 30+ eval task attempts.

**Fix:** Remove `ctx.abort()`. Let the turn finish, followUp runs after.

### Bug 2: followUp timing deadlock

After removing abort, added `tool_call` blocking to prevent batched tools from executing after time_lapse. But blocked tools generated new turns (model kept retrying), preventing the "idle" state that `followUp` needs. Result: infinite loop of blocked tool calls ($0.23 wasted in one run, 64 blocked edits).

Tried `steer` instead of `followUp` — but `sendUserMessage` with steer delivers raw text that the model interprets as user input, not a command.

**Fix:** Abandon two-phase command delegation entirely.

### Bug 3 (final fix): Context-event pruning

Replaced the entire command delegation architecture with a `context` event handler. The `context` event fires before each LLM call and can modify the message array. When time_lapse sets a pending rewind, the next context event prunes messages to the checkpoint and injects steering. No sendUserMessage, no commands, no timing issues.

This is the current architecture — 404 lines, works in all modes (interactive, print, RPC).

## Eval Results: Terminal-Bench Sample (10 tasks)

### Plain Pi + Haiku 4.5: 4/10 (40%)

| Task | Score | Notes |
|------|-------|-------|
| build-cython-ext | 0 | Too complex for Haiku |
| chess-best-move | 0 | Needs vision |
| configure-git-webserver | 0* | Auth error (0 tool calls) |
| fix-code-vulnerability | 1 | 55 tool calls, $0.26 |
| log-summary-date-ranges | 1 | |
| polyglot-c-py | 0 | Left compiled binary in output dir |
| qemu-alpine-ssh | 0 | Timeout at 900s |
| qemu-startup | err | Docker container conflict |
| regex-log | 1 | |
| sqlite-with-gcov | 1 | |

*Auth error means this task didn't actually run.

### Weaver Pi + Haiku 4.5: 3/10 (30%)

| Task | Score | Notes |
|------|-------|-------|
| build-cython-ext | 0 | 88 calls, used 2 checkpoints |
| chess-best-move | 0 | |
| configure-git-webserver | 0 | 34 calls, $0.13 |
| fix-code-vulnerability | 1 | 23 calls, $0.08 (3x cheaper than plain!) |
| log-summary-date-ranges | 1 | |
| polyglot-c-py | 0 | Left compiled binary |
| qemu-alpine-ssh | err | |
| qemu-startup | 0 | |
| regex-log | 0 | Non-deterministic (scored 1.0 in spike runs) |
| sqlite-with-gcov | 1 | |

**Note:** These results are from BEFORE the ctx.abort() fix. time_lapse was broken during all eval runs.

### Sonnet 4.6 + Weaver (4 tasks): 3/4 (75%)

| Task | Score | Notes |
|------|-------|-------|
| build-cython-ext | 1 | Haiku couldn't solve this |
| fix-code-vulnerability | 1 | 1 checkpoint, $0.25 |
| regex-log | 1 | |
| sqlite-with-gcov | 0 | Only gcov .gcda files missing (2/3 tests passed) |

## Key Findings

### 1. The tool was broken the whole time

Zero time_lapse invocations wasn't a prompting problem or a model capability issue. The tool literally didn't work in print mode. Once fixed, it fired naturally on the first hard task.

### 2. Weaver's cookbook prompt helps even without time_lapse

On fix-code-vulnerability, weaver was 3x cheaper ($0.08 vs $0.26) with half the tool calls (23 vs 55). The structured workflow (orient → understand → checkpoint → fix → verify → done) leads to more focused execution, even if time_lapse never fires.

### 3. Orientation step is high-value

The biggest single win: adding "check what tools exist, install what's missing" to the prompt. On regex-log, this made Haiku install python3 and test with the actual `re.findall` instead of approximating with Perl (score 0 → 1).

### 4. Prompt engineering matters more than we expected

The model ignored abstract pseudocode patterns completely. What worked:
- XML tags for structure (per Anthropic's prompting guide)
- Concrete examples showing tool call sequences
- Explaining the economics (what gets erased, why early checkpoint matters)
- Deterministic rules (edit → test → fail → time_lapse) instead of vague heuristics
- Observable triggers ("test fails") instead of counting ("after 3-5 calls")

### 5. The model can't count turns

Early prompts said "time_lapse after 3-5 failed tool calls." The model has no idea what turn it's on. Replaced with deterministic triggers based on observable events.

### 6. Caching works well with time_lapse

After a rewind, the prefix up to the checkpoint stays cached. In the polyglot session:
- Pre-rewind: 99% cache rate, cacheRead growing to 43K
- Post-rewind: cacheRead jumped to 46K (prefix preserved), 99% cache rate continues
- The cache warmth transfers across the rewind — you shed context without losing cache

### 7. Terminal-Bench sample is wrong for this hypothesis

Most tasks are either "easy enough to solve directly" or "too hard for any scaffolding." The sweet spot — tasks where the model can solve it but needs to try multiple approaches — barely exists in the 10-task sample. Full 89-task set may have more.

### 8. time_lapse for context hygiene, not just failure recovery

The biggest conceptual shift: time_lapse after EVERY phase, not just failures. Orientation output, successful edits, debug logs — all dead weight once captured in a checkpoint. Shed it.

The flow: checkpoint("start") → orient → checkpoint("ready") → time_lapse (shed orient) → attempt → test → if pass: checkpoint results → time_lapse (shed work) → next phase.

## Open Questions

### Does the fixed time_lapse actually improve scores?

We haven't re-run the full eval since fixing ctx.abort(). The previous 3/10 vs 4/10 comparison is meaningless because time_lapse was broken. Need fresh numbers.

### Does aggressive time_lapsing (after every phase) help or hurt?

Shedding orientation context means the model can't refer back to file listings or code it read during orient. The checkpoint state must capture everything needed. If the state is incomplete, the model loses information.

### Will models time_lapse on success voluntarily?

The prompt says to, but models are trained to make forward progress. time_lapsing after success feels counterintuitive. Need to test if the model actually follows this instruction.

### Is Haiku too weak for this hypothesis?

Haiku 4.5 never time_lapsed organically (before the fix). After the fix, it did — once, on a very hard task. Sonnet 4.6 might use it more naturally. Need comparative data.

### Would custom eval tasks work better?

Tasks specifically designed to require backtracking: misleading error messages, red herring bugs, multi-approach problems. Terminal-Bench isn't optimized for testing this hypothesis.

## What's Done

- [x] Extension: checkpoint, time_lapse, done tools with command delegation
- [x] Cookbook system prompt (7 iterations, current version teaches context economics)
- [x] Harbor adapters for plain Pi and Pi+Weaver
- [x] Fixed ctx.abort() bug — time_lapse now works in print mode
- [x] 10-task eval on Haiku (pre-fix: plain 4/10, weaver 3/10)
- [x] 4-task eval on Sonnet 4.6 (weaver: 3/4)
- [x] Session audit tooling (audit-session.js, full trace analysis)
- [x] Confirmed time_lapse fires and context is properly rebuilt post-rewind
- [x] Confirmed prompt caching survives rewind (prefix stays cached)

## What's Next

1. **Re-run full eval with fixed time_lapse** — the only valid comparison
2. **Test aggressive context hygiene** — time_lapse after every phase including orientation
3. **Sonnet 4.6 comparison** — stronger model may use time_lapse more effectively
4. **Full 89-task Terminal-Bench** — sample of 10 is too small
5. **Custom eval tasks** — design problems that specifically require backtracking
6. **Analyze time_lapse economics** — does shedding context save enough tokens to offset the overhead?

## Auth & Cost

Using Anthropic Claude subscription (OAuth tokens in auth.json). For Harbor containers, copy the auth entry into `~/.pi/agent/auth.json`. Also tested with OpenAI Codex subscription (ChatGPT Plus, $20/mo).

Available models: claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-6 (Anthropic); gpt-5.1 through gpt-5.4 (OpenAI Codex).

## References

- antirez thread: https://x.com/antirez/status/2037488794379653620
- Pi: https://github.com/badlogic/pi-mono
- Harbor: https://harborframework.com/
- Terminal-Bench: https://www.tbench.ai/
- Anthropic prompting guide: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Dota 2 Weaver: https://www.dota2.com/hero/weaver
