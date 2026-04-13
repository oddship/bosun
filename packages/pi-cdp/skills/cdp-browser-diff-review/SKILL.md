---
name: cdp-browser-diff-review
description: |
  Session-based browser diff review primitives for Bosun. Provides transport-
  agnostic v1 schemas plus local state and git snapshot helpers for immutable
  review rounds.
  Triggers: "diff-review", "reround", "review round", "snapshot-backed review".
license: MIT
compatibility: Requires Bun 1.0+, local git repository, workspace write access
allowed-tools: Bash Read Write
metadata:
  category: review
  requires: bun git
---

# CDP Browser Diff Review (v1)

Diff-review-specific model and persistence helpers used by the browser diff review flow.

## V1 scope (locked)

- Diff-review workflows only (no generic code browsing/review product).
- Immutable, published review rounds.
- Transport-agnostic session/round/thread/event records.
- Local-first storage under `workspace/scratch/diff-reviews/<session-id>/`.
- Git-backed scopes for round creation:
  - `worktree`
  - `staged`
  - `last-commit`
  - `commit-range`
  - `custom`

## Scripts

| Script | Purpose |
|---|---|
| `scripts/session-types.ts` | v1 schemas, typed constructors, runtime validators |
| `scripts/review-state.ts` | Session-scoped state API (`createInitialSession`, `loadSession`, `persistBatchSubmission`, `persistThreadReply`, `persistThreadStatus`, `publishReround`, `listSessionPayload`, `resolveSessionDir`) plus low-level read/write helpers |
| `scripts/git-review-data.ts` | Git diff extraction + snapshot materialization + round artifact helpers, including `collectInitialDiffScope` and `loadRoundFilePair` |

## State layout

```text
workspace/scratch/diff-reviews/<session-id>/
  session.json
  rounds/<round-id>.json
  threads/<thread-id>.json
  events/<timestamp>-<type>-<event-id>.json
  snapshots/<snapshot-id>/
    manifest.json
    files/<repo-relative-path>
  round-diffs/<round-id>.patch
```

## Round data flow

1. Resolve scope (`ReviewSourceScope`).
2. Collect changed files from git (`collectDiffFileChanges`).
3. Materialize base/head snapshots (`materializeSnapshotFromFileChanges`).
4. Build round metadata + unified patch (`buildGitReviewRoundData`).
5. Persist round (`persistGitReviewRoundData`) or write state manually.

## API quick-start

```ts
import {
  createReviewSession,
  createReviewEvent,
} from "./scripts/session-types";
import {
  writeReviewSession,
  appendReviewEvent,
} from "./scripts/review-state";
import { persistGitReviewRoundData } from "./scripts/git-review-data";

const session = createReviewSession({
  repoRoot,
  targetAgent,
  bridgeAgent,
  title: "Auth diff review",
  baselineSnapshotId: "drp_baseline",
});
writeReviewSession(session);

const round = persistGitReviewRoundData({
  sessionId: session.id,
  repoRoot,
  scope: { kind: "worktree" },
  summary: "Initial candidate for review",
  requestedBy: targetAgent,
});

appendReviewEvent(
  createReviewEvent({
    sessionId: session.id,
    roundId: round.round.id,
    type: "review.round.ready",
    summary: "Round ready",
    actor: targetAgent,
    payload: {
      roundId: round.round.id,
      parentRoundId: round.round.parentRoundId,
      changedFiles: round.round.changedFiles,
      affectedThreadIds: [],
      summary: round.round.summary,
    },
  })
);
```

## Reference

- [references/PROTOCOL.md](references/PROTOCOL.md)
