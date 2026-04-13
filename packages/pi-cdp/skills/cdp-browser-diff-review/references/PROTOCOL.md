# Diff Review Protocol (v1)

Transport-agnostic state contract for Bosun browser diff review.

- **Kind:** `diff-review`
- **Schema version:** `1`
- **Storage root:** `workspace/scratch/diff-reviews/<session-id>/`

This protocol is intentionally **diff-review-focused** in v1.

---

## 1) Core records

Defined in `scripts/session-types.ts`.

### ReviewSession
Long-lived review container.

Key fields:
- `id`
- `repoRoot`
- `targetAgent`
- `bridgeAgent`
- `status`: `open | waiting | ready | closed`
- `baselineSnapshotId`
- `latestRoundId`
- `createdAt`, `updatedAt`

### ReviewRound
Immutable published comparison point.

Key fields:
- `id`, `sessionId`, `parentRoundId`
- `kind`: `initial | reround`
- `sourceScope` (`worktree|staged|last-commit|commit-range|custom`)
- `baseSnapshotId`, `headSnapshotId`
- `changedFiles`
- `fileChanges[]` (status + optional rename source)
- `affectedThreadIds`
- `summary`, `requestedBy`, `createdAt`

### ReviewThread
Persistent file/line conversation.

Key fields:
- `id`, `sessionId`
- `createdInRoundId`, `latestRoundId`
- `path`
- `anchor` (`original|modified|file` + optional line range/context)
- `status`: `open | addressed | accepted`
- `stale` (anchor-health flag)

### ReviewSnapshotManifest
Immutable side snapshot (`base` or `head`).

Key fields:
- `id`, `sessionId`, `side`
- `sourceScope`
- `target` (`commit|index|worktree`, requested ref, resolved commit SHA when available)
- `files[]` with:
  - `path` (captured side path)
  - `canonicalPath` (round path)
  - `status`
  - `present`
  - `byteLength`, `sha256`, `storagePath`

### ReviewEvent
Substantive state transitions and reviewer/agent actions.

Envelope fields:
- `id`, `sessionId`, `roundId`, `threadId`
- `type`
- `summary`
- `actor`
- `payload`
- `createdAt`

---

## 2) Event catalog

Event types:
- `review.session.open`
- `review.batch.submit`
- `review.thread.reply`
- `review.thread.accept`
- `review.thread.reopen`
- `review.thread.addressed`
- `review.round.request`
- `review.round.ready`
- `review.session.summary`
- `review.session.close`

Payloads are strongly typed in `ReviewEventPayloadMap` (`session-types.ts`).

---

## 3) Local persistence layout

Managed by `scripts/review-state.ts` (`createInitialSession`, `loadSession`, `persistBatchSubmission`, `persistThreadReply`, `persistThreadStatus`, `publishReround`, `listSessionPayload`, `resolveSessionDir`).

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

Notes:
- Writes are atomic (`*.tmp` + rename).
- Snapshot file paths are traversal-safe (must stay repo-relative).
- Events are append-only files.

---

## 4) Git round materialization

Implemented in `scripts/git-review-data.ts` (`collectInitialDiffScope`, `buildGitReviewRoundData`/`persistGitReviewRoundData`, `loadRoundFilePair`).

### Supported scopes
- `worktree` → `HEAD` vs working tree (+ untracked)
- `staged` → `HEAD` vs index
- `last-commit` → `HEAD~1` vs `HEAD`
- `commit-range` → `<baseRef>` vs `<headRef>`
- `custom`:
  - if `headRef` present: `<baseRef|HEAD>` vs `<headRef>`
  - else: `<baseRef|HEAD>` vs working tree (+ untracked)

### Round helper outputs
`buildGitReviewRoundData()` returns:
- resolved scope
- changed files
- base snapshot manifest
- head snapshot manifest
- round object
- unified patch text
- patch file path

`persistGitReviewRoundData()` additionally writes `rounds/<round-id>.json`.

---

## 5) Mesh message pattern (recommended)

Keep mesh payloads compact and human-readable; store full JSON on disk.

Suggested format:

```text
review.round.ready session=<id> round=<id> files=<n>
Summary: <one-line summary>
Payload: workspace/scratch/diff-reviews/<session-id>/events/<event-file>.json
```

Bridge/UI transport should treat this protocol as authoritative state and not invent parallel schema versions.
