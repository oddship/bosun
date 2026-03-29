# The Architecture

Three tools. That's it.

`checkpoint` saves a position. `time_lapse` rewinds to it. `done` says you're finished. The model decides when to use them. No rigid phases, no planning step, no gate calls between stages.

---

The predecessor was pi-exec — 1,656 lines of structured executor that broke tasks into phases with a planning step. Phase 0 generates a plan. Phase 1 through N execute it. A gate LLM validates each transition. State flows as JSON between phases.

It worked. 95.7% pass rate on internal eval tasks. But it was brittle in exactly the way that matters: the plan was fixed at the start. When Phase 2 reveals that the Phase 1 approach was wrong, there's no mechanism to go back. The model just pushes forward with accumulating context until it times out.

The [antirez insight](https://x.com/antirez/status/2037488794379653620) reframed the problem:

> One thing agent harnesses should be able to do is: to jump back in history trimming what follows, just injecting some self-steering text.

Instead of imposing structure, give the model tools to manage its own context. Let it decide when to save, when to rewind, when it's done. 1,656 lines collapsed into 410.

---

### How time_lapse actually works

The model calls `time_lapse("ready", "Found the bug. Fix _hkey/_hval.")`. Here's what happens:

1. The tool sets a flag: `pendingRewind = { label: "ready", steering: "Found the bug..." }`
2. If there are batched tool calls in the same response, they get blocked (they'd be pruned anyway)
3. Before the next LLM call, the `context` event fires. It finds the checkpoint message, truncates everything after it, appends the steering text as a user message
4. The model's next turn sees a clean context: system prompt → task → checkpoint → steering. Everything between is gone.

The cache prefix through the checkpoint stays warm. Anthropic's prompt caching recognizes the shared prefix. So the model sheds context without losing cache — that's where the [economics](economics.md) get interesting.

---

### Three tries to get here

This is the third architecture. The first two failed in ways that were invisible in unit tests and only surfaced during eval.

**Attempt 1**: The tool called `ctx.abort()` to stop the agent loop before rebuilding context. In print mode — which is how every eval runs — abort means exit. The followUp command never ran. Zero time_lapse invocations across 30+ eval attempts. We spent days thinking the model wouldn't use the tool. It was broken.

**Attempt 2**: Removed abort, queued the rewind via `sendUserMessage({ deliverAs: "followUp" })`. But tool blocking created new turns, preventing the idle state followUp needs. Infinite loop. 64 blocked tool calls in one run, $0.23 wasted. Tried `steer` delivery instead — the model treated the raw command text as user input and responded to it conversationally.

**Attempt 3**: The `context` event. Fires before each LLM call, can modify the message array directly. No commands, no timing dependencies, no mode-specific behavior. Works everywhere.

The lesson: agent extension APIs have sharp edges that only show up in production-like conditions. Unit tests pass. Eval runs fail silently.

---

### The prompt matters more than the code

Seven versions of the system prompt, each solving a different failure mode:

The model ignored abstract pseudocode patterns. It responded to concrete examples with tool call sequences. It couldn't count turns ("time_lapse after 3-5 failures") but it could respond to observable events ("your test just failed after edits"). It needed to understand context economics — *why* early checkpointing matters, not just that it should checkpoint.

The current prompt teaches deterministic rules: `edit → test → fail → time_lapse`. No judgment call. The model sees a test failure after edits, it rewinds. That's the rule.

Even with good rules, the model sometimes grinds. A system reminder — injected into context when `lastTestFailed` and `editsSinceCheckpoint` are both true — nudges at the exact decision point where the model should rewind but historically doesn't.

The [per-task traces](../tasks/) show where this works and where it doesn't. The short version: the prompt shapes behavior more than the tools do.
