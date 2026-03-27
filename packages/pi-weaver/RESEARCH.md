# pi-weaver Research Notes

## How This Started

On March 27, 2026, antirez posted a thread about something that had been bugging him about agent harnesses:

> One thing agents harnesses should be able to do is: to jump back in history
> trimming what follows, just injecting some self-steering text. I wonder if
> they can already do it.

He wasn't talking about the human using undo. He meant the model itself deciding "I'm going the wrong way" and calling a tool to rewind its own conversation. Micael pointed out that pi already has `/tree` for navigating session history manually, and Mario confirmed an extension could expose this programmatically. But antirez asked the harder question:

> I wonder if without explicit reinforcement learning for this kind of context
> saving, the model will be able to use it effectively.

That's the real question. Not "can we build it" but "will models actually use it well."

## What We Had Already: pi-exec

We'd built a plan-driven executor — about 800 lines of TypeScript that breaks tasks into pre-planned phases. Each phase gets scoped tools, a fresh context window, and a `done()` call that carries structured state to the next phase. Gates verify work between phases.

It worked well enough on our eval suite: 95.7% pass rate on gpt-5.4-mini across 24 tasks. But we noticed problems:

**Phases are rigid.** You define them upfront. If the model goes down a wrong path within a phase, it has no escape hatch — just grinds until budget exhaustion. The gate catches it *after*, but by then the budget for that phase is gone.

**The overhead is real.** Each phase boundary means resending the system prompt, tool definitions, and state. 1.4-3.2x more expensive than just letting the model work in a single conversation. The gap narrows on longer tasks but never disappears.

**Our eval tasks were fake.** "Fix this off-by-one bug." "Rename this function across 3 files." The model knows exactly what to do before it starts. No exploration, no wrong turns, no judgment. These test the executor machinery, not the model's ability to self-correct.

## The Connection to try/except

During the discussion we realized something: what antirez describes is just try/except for the model's own reasoning.

```
checkpoint("before_attempt")     ← try:
... try approach A ...
... it's not working ...
time_lapse("before_attempt",     ← raise Exception("A failed because X")
  "A failed, try B instead")
... approach B, informed by A's failure ...
done()                           ← return result
```

The checkpoint is `try:`. The time_lapse is `raise`. The steering text is the exception message. The branch summary (what pi generates automatically when you switch branches) is the traceback.

Models understand try/except deeply — they write exception handling all day. They don't need RL to understand "if this isn't working, stop and try something else." They need RL to *decide when* it's not working, which is harder. But a good system prompt with explicit heuristics ("time_lapse when: wrong approach, context is bloated, you've been stuck for 3+ rounds") gets pretty far.

## The Name

Weaver's ultimate in Dota 2: **Time Lapse**. He reverses to where he was 5 seconds ago — position, health, mana all rewind. The agent reverses to a checkpoint — conversation state, structured findings all preserved, everything after the checkpoint is discarded (but summarized first, so knowledge isn't lost).

We went with `time_lapse` as the tool name and `pi-weaver` as the package name.

## What We Built (The Spike)

The entire pi-exec executor (800 lines, phase loop, done protocol, gate system, metrics accumulator) collapsed into:

1. A system prompt with a "cookbook" of execution patterns (~150 lines)
2. Three tools: `checkpoint`, `time_lapse`, `done` (~200 lines total)
3. Pi's existing session tree handles everything else

The model reads a goal, writes pseudocode for how it'll accomplish it (matching against cookbook patterns), then executes according to its own pseudocode. If something goes wrong, it time_lapses back and tries differently.

Tested on three of our existing eval tasks — fix-bug, find-bugs, rename-export. All passed. But these are the easy ones. The model didn't need time_lapse on any of them because the right approach was obvious from the start.

## Why Our Eval Tasks Don't Test What Matters

After walking through all 24 pi-exec eval tasks, we found time_lapse would only matter on 3 of them (the long/complex ones). For everything else, the model just does the obvious thing in 3-4 rounds.

That's because our tasks are **assistive**, not **agentic**:

- Assistive: "Fix the off-by-one bug in range.ts" — you know what's wrong, where it is, and what to do
- Agentic: "Keep the dependencies in this project up to date" — you have to figure out what to do, explore, make judgment calls, and recover from wrong paths

For Quartermaster (where we planned to use pi-exec), the tasks look like the second kind. Vague goals, real codebases, discovery needed.

## Harbor and Terminal-Bench

We went looking for benchmarks that test agentic work and found:

**Aider's Exercism benchmark** — 225 coding puzzles. Still assistive ("implement this function"). Tests raw coding, not agent behavior.

**SWE-bench** — Real GitHub issues. More agentic (explore repo, find bug, patch), but still single-issue fixes. Needs Docker, patch-format output.

**Terminal-Bench 2.0** (tbench.ai) — 89 real DevOps/SWE tasks in Docker containers. "Here's a messy situation, figure it out." This is the one. Tasks require exploration, debugging, multiple attempts. Exactly where time_lapse should earn its keep.

**Harbor** (harborframework.com) — The meta-framework that runs all of these. Already integrates Claude Code, Aider, OpenHands, Codex, mini-swe-agent. We write a pi adapter (~100 lines), get access to all benchmarks, and can compare directly against published numbers.

The plan: write a Harbor adapter for pi (plain) and pi-weaver, run Terminal-Bench 2.0, compare, and submit to the leaderboard if numbers are competitive.

## Open Questions

**Will models use time_lapse at the right moments?**

We don't know yet. The cookbook prompt teaches explicit heuristics, but we haven't seen the model hit a genuinely hard task where it needs to self-correct. Terminal-Bench should answer this.

**Does the pseudocode-first step help on complex tasks?**

On simple tasks, it's pure overhead (~7 seconds). On complex tasks, it might prevent wrong turns by forcing structured thinking upfront. We need data from tasks where the approach isn't obvious.

**Is pi itself a competitive agent platform?**

Nobody has benchmarked pi against Claude Code or Aider on standard benchmarks. If pi's baseline is weak, weaver improving it from 25% to 35% is interesting research but not competitive. We need pi's standalone numbers first.

**What about the ctx.abort() pattern?**

The time_lapse tool uses `ctx.abort()` to stop the current agent loop, then `pi.sendMessage({ deliverAs: "followUp" })` to inject steering and restart. We tested this interactively but not in print mode inside Docker. Could be a blocker.

## What's Done

- [x] pi-weaver extension spike: checkpoint, time_lapse, done tools
- [x] Cookbook system prompt with 8 execution patterns
- [x] Basic eval runner using `pi -p -e`
- [x] Tested on fix-bug, find-bugs, rename-export (all pass)
- [x] Research into eval frameworks (Aider, SWE-bench, mini-swe-agent, Harbor)
- [x] Plan for Harbor integration and Terminal-Bench evaluation

## What's Next

1. Install Harbor, write pi agent adapter, test on 1 Terminal-Bench task
2. Add weaver extension to adapter
3. Ensure clean environment isolation (no bosun config leaking)
4. Full Terminal-Bench run: 89 tasks × 2 agents
5. Analyze and iterate: when does time_lapse fire, does it help
6. Leaderboard submission if competitive

## References

- antirez thread: https://x.com/antirez/status/2037488794379653620
- Pi: https://github.com/badlogic/pi-mono
- Harbor: https://harborframework.com/
- Terminal-Bench: https://www.tbench.ai/
- Dota 2 Weaver: https://www.dota2.com/hero/weaver
- pi-exec eval report: packages/pi-exec/eval/REPORT.md
