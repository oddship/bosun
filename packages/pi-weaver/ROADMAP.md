# pi-weaver Roadmap

**Goal**: Ship pi-weaver as a usable Pi extension by March 30, 2026.

---

## Done ✅

### Core
- [x] Extension: checkpoint, time_lapse, done tools (~410 lines)
- [x] Context-event pruning architecture (3rd iteration, works in all modes)
- [x] Cookbook system prompt (7 iterations, teaches context economics)
- [x] System reminder injection (edit→test→fail→nudge time_lapse)
- [x] 11 bug fixes from oracle-assisted code review

### Evaluation
- [x] 15-task Terminal-Bench 2.0 eval (Sonnet 4.6, plain vs weaver)
- [x] Both score 11/15 — different tasks pass/fail
- [x] 2 divergent results: db-wal-recovery (weaver wins), qemu-alpine-ssh (plain wins)
- [x] Token economics analysis (weaver 5% cheaper at scale)
- [x] Per-time_lapse effectiveness tracing (6/7 helpful)
- [x] Fast eval runner with pre-baked Docker images
- [x] Harbor adapters (plain Pi + Pi+Weaver)

### Documentation
- [x] REPORT.md — full evaluation report
- [x] RESEARCH.md — design history and research notes
- [x] Wiki pages — per-task traces + cross-cutting analysis (in progress)

---

## Ship Today (March 29)

### 1. Package cleanup
- [ ] Remove eval/harbor artifacts from the npm package (only extension/ should ship)
- [ ] Add proper package.json with name, version, description, keywords
- [ ] Add LICENSE (MIT)
- [ ] Ensure `bun build` produces a clean bundle
- [ ] Test install from git: `pi -e github:oddship/bosun/packages/pi-weaver`
- [ ] Test install from npm: `pi -e pi-weaver` (if we publish)

### 2. Toggle in chat mode
- [ ] `/weaver on` / `/weaver off` command to enable/disable mid-session
- [ ] Visual indicator in prompt: 🕸️ emoji when active (like plan-mode's 📋)
- [ ] When off: checkpoint/time_lapse/done tools hidden, prompt injection skipped
- [ ] When on: tools registered, prompt injected
- [ ] Persist toggle state across session resume

### 3. Integrate into bosun agents
- [ ] Add `weaver` as an extension type in pi-agents config
- [ ] Agent definitions can opt-in: `extensions: ["weaver"]` in frontmatter
- [ ] deckhand agent: weaver enabled by default (it does sustained coding)
- [ ] lite agent: weaver disabled (quick tasks, no benefit)
- [ ] oracle agent: weaver disabled (read-only, no edits to checkpoint)
- [ ] verify agent: weaver disabled (runs tests, doesn't iterate)

### 4. Refactor quartermaster (pi-exec → pi-weaver)
- [ ] Audit pi-exec's 24 eval tasks — which ones test self-correction?
- [ ] Replace pi-exec's rigid phase executor with weaver's checkpoint/time_lapse
- [ ] Keep pi-exec's planning prompt as a skill, not an executor
- [ ] Migrate the eval suite to use weaver's done() for completion signal
- [ ] Deprecate pi-exec (keep as reference, stop active development)

### 5. Wiki / documentation site
- [ ] Finish all 15 task pages (agents working on it now)
- [ ] Finish cross-cutting analysis pages (economics, patterns, taxonomy, decision framework)
- [ ] Write index page with thesis + linked page list
- [ ] Voice pass — rewrite any dry analysis pages in first-person narrative
- [ ] Add to rohanverma.net as a new pages section (like harness-engineering)
- [ ] Cross-link from harness-engineering pages where relevant

---

## Ship Tomorrow (March 30)

### 6. Public story
- [ ] Blog post: "Teaching Agents to Undo" or "The Time Lapse Experiment"
  - The antirez thread that started it
  - The Dota 2 naming (developers like game references)
  - Three architecture failures before it worked
  - The 15-task eval — honest results (11/15 both, but different tasks)
  - db-wal-recovery: the one task where weaver cracked what plain couldn't
  - The grind problem: time_lapse doesn't stop compulsive optimization
  - Token economics: when context pruning pays for itself
- [ ] Thread on X summarizing findings (tag antirez)
- [ ] README.md rewrite — user-facing, not developer-facing
  - Quick start: `pi -e pi-weaver "fix the bug in app.js"`
  - What it does (3 bullet points, not architecture)
  - When to use it (complex tasks, multi-step debugging)
  - When NOT to use it (quick questions, one-shot edits)

### 7. Call for evaluation help
- [ ] GitHub issue: "Help wanted: Terminal-Bench 2.0 full eval (89 tasks)"
  - We have the adapters, Docker images, and fast runner
  - Need API tokens (Anthropic or OpenAI) for ~$50-100 of compute
  - Or: someone runs it on their infra and shares results
  - Provide exact reproduction steps
- [ ] Offer to share pre-baked Docker images via registry
- [ ] Create a results template so community contributions are standardized

### 8. Open questions to address
- [ ] Does weaver help more on weaker models? (Haiku was 1/10 for both — too weak to tell)
- [ ] Does weaver help with OpenAI models? (Different tool-calling behavior)
- [ ] What's the right checkpoint granularity? (polyglot had too few, build-cython had too many)
- [ ] Can we detect the grind pattern automatically? (N time_lapses to same checkpoint = abort?)
- [ ] Should done() run verification? (Currently a simple signal — Harbor/eval does verification)

---

## Future

### 9. Anti-grind mechanism
The biggest open problem. time_lapse enables recovery but also enables unproductive tinkering.

Ideas:
- **Diminishing returns detector**: If 3+ time_lapses target the same checkpoint, inject "You've rewound to this checkpoint N times. Either try a fundamentally different approach or call done()."
- **Cost budget**: Set a token budget. When 80% consumed, inject "You're running low on budget. Wrap up or rewind to a working state."
- **Iteration cap**: Max N time_lapses per checkpoint label. After that, auto-done() or force a different checkpoint.

### 10. Smarter checkpoint placement
The model currently checkpoints routinely at start and sometimes strategically at phase boundaries. Could we:
- Auto-checkpoint after successful test runs? (The model has a working state — save it)
- Auto-checkpoint before risky operations? (About to rewrite a file — save first)
- Suggest checkpoint via system reminder? ("You've made 5 edits without checkpointing. Consider checkpoint.")

### 11. Multi-model evaluation
- Sonnet 4.6: 11/15 (done)
- Opus 4.6: expected higher baseline, less room for weaver to help
- GPT-5.4-mini: different tool-calling style, may use time_lapse differently
- GPT-5.3-Codex: code-specialized, may benefit from structured phases
- Gemini 2.5 Flash: fast, cheap, may grind less (or more)
- Open-source (Qwen, Llama): smaller context, checkpoint more valuable

### 12. Custom eval tasks
Terminal-Bench doesn't optimize for testing backtracking. Design tasks that specifically require approach pivots:
- "The obvious fix breaks something else" — edit A fixes test 1, breaks test 2
- "Red herring debugging" — the error message points to the wrong file
- "Environment discovery" — the right tool isn't installed, need to find alternatives
- "Multi-approach problem" — approach A works for 80% of cases, approach B for the rest

---

## Non-goals

- **Fine-tuning**: We explicitly test whether the model can use these tools without RL/RLHF. That's the experiment.
- **Git checkpointing**: File changes persist on disk. Rewinding conversation context is enough. Adding git stash/restore adds complexity without clear benefit.
- **Automatic time_lapse**: The model decides. We nudge via system reminders but never force. The agency is the point.
- **SWE-bench**: Terminal-Bench 2.0 is more agentic (exploration, debugging, building). SWE-bench is mostly "read the issue, find the file, make the patch."
