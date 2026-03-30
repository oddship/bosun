# pi-weaver Roadmap

**Status**: Core shipped. Wiki published. Available via `spawn_agent({ agent: "weaver" })` or `/weaver on` in any interactive agent.

---

## Done ✅

### Core
- [x] Extension: checkpoint, time_lapse, done tools (~480 lines)
- [x] Context-event pruning architecture (3rd iteration, works in all modes)
- [x] Cookbook system prompt (7 iterations, teaches context economics)
- [x] System reminder injection (edit→test→fail→nudge time_lapse)
- [x] 11 bug fixes from oracle-assisted code review
- [x] `/weaver on|off` toggle with 🕸️ status indicator
- [x] Session state persistence (toggle + checkpoints survive resume)
- [x] Opt-in for interactive agents (disabled by default on deckhand/bosun, enabled on weaver)

### Agents
- [x] `weaver` agent type (`packages/pi-bosun/agents/weaver.md`)
- [x] Anti-grind guidance in agent prompt (3+ rewinds = change strategy)
- [x] pi-weaver extension loaded on deckhand + bosun (opt-in via `/weaver on`)

### Evaluation
- [x] 15-task Terminal-Bench 2.0 eval (Sonnet 4.6, plain vs weaver)
- [x] Both score 11/15 — different tasks pass/fail
- [x] 2 divergent results: db-wal-recovery (weaver wins), qemu-alpine-ssh (plain wins)
- [x] Token economics analysis (weaver 5% cheaper at scale)
- [x] Per-time_lapse effectiveness tracing
- [x] Fast eval runner with pre-baked Docker images
- [x] Harbor adapters (plain Pi + Pi+Weaver)

### Package
- [x] LICENSE (MIT)
- [x] .npmignore (excludes eval/, harbor/, wiki/)
- [x] README.md (user-facing, 44 lines)
- [x] package.json (description, keywords, license)
- [x] Build transpiles clean

### Documentation
- [x] REPORT.md — full evaluation report
- [x] RESEARCH.md — design history and research notes
- [x] Wiki — 22 pages on rohanverma.net (15 tasks + 7 analysis)
- [x] Grouped sidebar (Analysis + Task Results sections)
- [x] Help Wanted page for community eval contributions
- [x] Bosun docs updated (agents.md + packages.md)

### Deprecated
- [x] pi-exec removed (DEPRECATED.md points to git history)

---

## Next

### Anti-grind mechanism
The biggest open problem. time_lapse enables recovery but also enables unproductive tinkering.

Ideas:
- **Diminishing returns detector**: If 3+ time_lapses target the same checkpoint, inject warning
- **Cost budget**: Set a token budget, inject warning at 80%
- **Iteration cap**: Max N time_lapses per checkpoint label

### Multi-model evaluation
- Opus 4.6: expected higher baseline, less room for weaver
- GPT-5.4-mini: different tool-calling style
- Gemini 2.5 Flash: fast, cheap, may grind differently
- Open-source (Qwen, Llama): smaller context, checkpoint more valuable

### Full Terminal-Bench 2.0
- 74 remaining tasks need ~$60 of API tokens
- Help Wanted page published
- Pre-baked Docker images + fast runner ready

### Custom eval tasks
Design tasks that specifically test backtracking:
- "The obvious fix breaks something else"
- "Red herring debugging"
- "Multi-approach problem"

## Known Issues

### TUI tool call rendering broken when pi-weaver registers tools
Pi-weaver's `registerTool` and `pi.on("tool_call")` calls interfere with Pi's
TUI streaming tool call renderer. Tool calls render as raw `<tool_call>` XML
instead of formatted blocks. Tools still execute correctly.

**Mitigated**: non-weaver agents now early-return from the extension init,
so only the weaver agent is affected. The weaver agent's TUI still shows raw
XML but functions correctly.

**Root cause**: likely a Pi upstream issue with extensions that register custom
tools alongside built-in tool hooks. Needs investigation in Pi's
`interactive-mode.js` rendering pipeline.
