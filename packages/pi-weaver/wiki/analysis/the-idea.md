# The Idea

On March 27, 2026, antirez posted about agent harnesses:

> One thing agent harnesses should be able to do is: to jump back in history trimming what follows, just injecting some self-steering text.

And the harder question:

> I wonder if without explicit reinforcement learning for this kind of context saving, the model will be able to use it effectively.

That's the question pi-weaver tries to answer.

---

The name comes from Dota 2. Weaver's ultimate ability, Time Lapse, reverses position, health, and mana to 5 seconds ago. Everything that happened in those 5 seconds is undone — damage taken, mana spent, distance traveled. But the player's *knowledge* of what happened persists.

That's the exact mechanic we wanted. The agent reverses to a checkpoint. Conversation context rewinds. Structured state (the model's knowledge) is preserved. Everything between — the failed grep, the wrong edit, the misleading error — is gone.

It maps to programming primitives:
- `checkpoint` = `try:`
- `time_lapse` = `raise`  
- steering message = exception message
- `done` = `return`

---

The bet was specific: give the model these tools and a good prompt, and it will use them without reinforcement learning. No fine-tuning, no RLHF on rewind behavior. Just tool descriptions and a cookbook of when to use them.

Whether the bet paid off is [more complicated than a yes or no](when-weaver-helps.md). The model does use the tools — 17 time_lapse calls across 15 tasks, [6 of 7 helpful](time-lapse-patterns.md) in our initial eval. But using them well is harder. The [polyglot-c-py](../tasks/polyglot-c-py.md) session shows the model rewinding correctly from a broken rewrite, then immediately re-entering the same trap. The tool works. The judgment doesn't always.

antirez's question was the right one to ask.

---

### What this isn't

This isn't a general self-correction framework. It doesn't do:
- Automatic retries (the model decides when to retry)
- Reflection or chain-of-thought forcing (no "think about what went wrong" injection)
- Git-based checkpointing (file changes persist — only the conversation rewinds)
- Phase gating or plan validation (no structure imposed)

It's three tools and a prompt. The model does the rest. That's the experiment.

### What came before

[pi-exec](https://github.com/oddship/bosun/tree/main/packages/pi-exec) was the predecessor — a 1,656-line structured executor with rigid phases and gate calls. It worked well on controlled tasks but couldn't adapt mid-run. The [architecture page](architecture.md) covers why we threw it away.

### The evaluation

We ran 15 Terminal-Bench 2.0 tasks with Sonnet 4.6, comparing plain pi against pi+weaver. Both scored [11/15](../index.md) — same pass rate, different tasks. The interesting question isn't "does it work" but "when does it help and when does it hurt." The [task pages](../tasks/) and [analysis pages](./) try to answer that.
