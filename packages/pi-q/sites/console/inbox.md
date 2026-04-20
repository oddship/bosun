---
title: Inbox & Triage
---

# Inbox & Triage

Use this page to turn a pile of possibilities into a smaller set of deliberate next moves.

**Inbox count:** 15 tasks

---

## Best next picks

These are the strongest candidates to pull from the inbox soon.

### If you want one recommendation right now
**Pull `0ef6` — Add persistent agent support to spawn_agent.**

Why this is the cleanest next pick:
- it is not currently blocked
- it has clear product leverage
- it does not depend on first resolving duplicate task records
- it is easier to activate confidently than the broad blog backlog

Use `bdaf` instead only if bosun PR review is urgent. Current best cleanup is to treat `bdaf` as the canonical task and retire or rewrite `56fe` unless an explicit blocker exists.


### 1) `0ef6` — Add persistent agent support to spawn_agent
- **Priority:** P2
- **Tags:** `pi-agents`, `spawn`, `improvement`
- **Why it stands out:** product-facing improvement with clear leverage
- **What to check first:** whether it should stay a task or graduate into project-shaped work

### 2) `bdaf` — Review and merge bosun PR #1
- **Priority:** P1
- **Tags:** `deps`, `bosun`
- **Why it stands out:** higher priority than most of the inbox and likely close to near-term bosun work
- **What to check first:** whether it is the same work as blocked task `56fe`

### 3) `5499` — Skill eval framework inspired by Anthropic skill-creator
- **Priority:** P2
- **Tags:** `meta-skills`, `evals`, `skills`
- **Why it stands out:** likely broader than a one-off task
- **What to check first:** whether it needs scope shaping before activation

---

## Large backlog cluster: blog-post ideas

Most inbox volume currently lives inside **`rohanverma-net-blog-posts`**.

### Ready-to-pull writing candidates
- `0336` — My First Nixpkgs Contribution
- `137c` — Session Analysis with jq
- `2e55` — Chronicle Generation - Automating Builder's Logs
- `5ef8` — Migrating GoReleaser to Native Rust
- `60f8` — Contributing Bug Fixes to go-huml
- `6933` — AI-Driven Email Inbox Cleanup
- `73d0` — Building Duh Browser Extension
- `786c` — Developer Tools I Use
- `a60f` — Git Memory Overflow Debugging
- `d26d` — Humanizing AI-Generated Writing
- `4aca` — Automated Wedding Music Mix

### Best use of this section
Do **not** treat this as eleven equal priorities.

A better triage move is to pick:
- one **next post to activate**
- one **later post worth keeping warm**
- and leave the rest as backlog without pretending they are all current

---

## Needs clarification before pull

These items are not blocked by effort. They are blocked by ambiguity.

### Duplicate or conflicting intent
- `bdaf` and `56fe` appear to describe the same bosun PR-review work
- current best cleanup: keep `bdaf` as canonical, carry over bosun repo/team context from `56fe`, and retire `56fe` unless it has a real blocker

### Likely under-scoped
- `5499` may really be project-shaped work

### Missing ordering decision
- the blog-post backlog needs a single explicit next pick after `cb45`

---

## Leave parked for now

### `248b` — Set up web search API key for pi-web-access
- **Priority:** P3
- **Why parked:** useful, but not urgent unless web-access setup becomes immediately blocking

---

## Quick triage rules

When using this page, try to make one of these decisions:

### Pull next
Use when you want a clear successor task.

### Clarify first
Use when the task title is not enough to commit confidently.

### Keep parked
Use when something is valid but not worth attention right now.

---

## Recommended cleanup from this page

1. Collapse the duplicate PR-review intent around `bdaf` / `56fe`
2. Choose one blog post to become the next active writing task
3. Promote recurring multi-step work into projects when the single-task framing stops helping

[← Back to Q Workbench](index.md)
