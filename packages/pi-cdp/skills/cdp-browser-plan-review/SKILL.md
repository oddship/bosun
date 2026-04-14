---
name: cdp-browser-plan-review
description: |
  Session-based browser plan review primitives for Bosun. Provides a local-first
  state model, markdown-aware anchor extraction, and review-session persistence
  for reviewing existing plan files in dedicated CDP browser windows.
  Triggers: "plan-review", "review this plan", "review markdown plan".
license: MIT
compatibility: Requires Bun 1.0+, local workspace write access
allowed-tools: Bash Read Write
metadata:
  category: review
  requires: bun
---

# CDP Browser Plan Review (v1)

Plan-review-specific model and persistence helpers used by the Bosun browser plan review flow.

## V1 scope (locked)

- Review existing markdown plan files only.
- One dedicated browser window per review session.
- Local-first state under `workspace/scratch/plan-reviews/<session-id>/`.
- Mesh-native result delivery via compact messages pointing to persisted payloads.
- Core outcomes only:
  - `approve`
  - `request_changes`
- Markdown-aware anchors, not raw line-only identities.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/session-types.ts` | v1 schemas, typed constructors, runtime validators |
| `scripts/plan-anchors.ts` | Markdown-aware anchor extraction for plan documents |
| `scripts/plan-diff.ts` | Reround diffing and thread re-anchoring heuristics |
| `scripts/plan-markdown.ts` | View-model helpers for browser rendering |
| `scripts/review-state.ts` | Session-scoped state API for plan review |
| `scripts/plan-review-bridge.ts` | Session-local HTTP bridge + browser launcher |
| `web/index.html` + `web/app.js` | Minimal v1 review UI |

## State layout

```text
workspace/scratch/plan-reviews/<session-id>/
  session.json
  document.json
  drafts.json
  threads/<thread-id>.json
  events/<timestamp>-<type>-<event-id>.json
  submissions/<submission-id>.json
  snapshots/<snapshot-id>.md
```

Notes:
- `document.json` stores the parsed anchor map for the current plan snapshot.
- `drafts.json` stores persisted local drafts plus an optional global review note.
- Snapshot content is stored as raw markdown in `snapshots/`.
- Writes are atomic (`*.tmp` + rename).
- Events are append-only files.

## Round model for plans

Unlike diff review, plan review starts as a single-document review loop:
1. Persist the current plan snapshot.
2. Open a dedicated browser review session.
3. Collect anchored feedback.
4. Persist a submission with outcome + feedback.
5. Notify the target agent over mesh with a compact message pointing at persisted payloads.

Rerounds and delta/full-plan review are supported with lightweight markdown-aware matching heuristics. Thread remapping prefers exact text matches, then scoped fuzzy/block-index matches, and marks unresolved threads as stale.

## API quick-start

```ts
import {
  createInitialSession,
  persistSubmission,
  listSessionPayload,
} from "./scripts/review-state";

const created = createInitialSession({
  planFilePath: "workspace/users/me/plans/2026-04/14-my-plan.md",
  targetAgent: "bosun-plan-review",
  bridgeAgent: "browser-plan-review-1234",
  title: "My plan review",
});

const summary = listSessionPayload(created.sessionDir);

const result = persistSubmission({
  sessionDir: created.sessionDir,
  outcome: "request_changes",
  actor: "browser-plan-review-1234",
  targetAgent: "bosun-plan-review",
  feedback: [
    {
      anchor: summary.document.anchors[0],
      comment: "This phase needs explicit rollback steps.",
      suggestion: "Add a rollback subsection.",
    },
  ],
});
```

## Reference

- [references/PROTOCOL.md](references/PROTOCOL.md)
