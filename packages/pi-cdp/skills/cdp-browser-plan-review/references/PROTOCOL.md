# Plan Review Protocol (v1)

Transport-agnostic state contract for Bosun browser plan review.

- **Kind:** `plan-review`
- **Schema version:** `1`
- **Storage root:** `workspace/scratch/plan-reviews/<session-id>/`

This protocol is intentionally **plan-review-focused** in v1.

---

## 1) Core records

Defined in `scripts/session-types.ts`.

### PlanReviewSession
Long-lived review container.

Key fields:
- `id`
- `planFilePath`
- `targetAgent`
- `bridgeAgent`
- `status`: `open | waiting | ready | closed`
- `latestSnapshotId`
- `latestSubmissionId`
- `createdAt`, `updatedAt`

### PlanReviewDocument
Parsed view of the current plan file.

Key fields:
- `sessionId`
- `planFilePath`
- `title`
- `currentSnapshotId`
- `anchorCount`
- `lineCount`
- `anchors[]`
- `snapshots[]`

### PlanReviewSnapshot
Immutable markdown snapshot of a plan revision.

Key fields:
- `id`
- `sessionId`
- `planFilePath`
- `source`: `initial | reround`
- `storagePath`
- `sha256`, `byteLength`, `lineCount`
- `createdAt`

### PlanReviewThread
Persistent anchored feedback thread.

On reround, threads are re-anchored against the latest snapshot when possible. If no acceptable match is found, the thread remains attached to its prior anchor and is marked `stale: true`.

Key fields:
- `id`, `sessionId`
- `createdInSnapshotId`, `latestSnapshotId`
- `anchor`
- `comment`, `suggestion`
- `status`: `open | addressed | accepted`
- `stale`
- `createdAt`, `updatedAt`

### PlanReviewSubmission
A reviewer decision for one snapshot.

Key fields:
- `id`, `sessionId`, `snapshotId`
- `outcome`: `approve | request_changes`
- `feedback[]`
- `feedbackCount`
- `summary`
- `actor`, `targetAgent`
- `createdAt`

### PlanReviewEvent
Substantive state transitions.

Envelope fields:
- `id`, `sessionId`, `submissionId`, `threadId`
- `type`
- `summary`
- `actor`
- `payload`
- `createdAt`

---

## 2) Event catalog

Event types:
- `review.session.open`
- `review.submission.create`
- `review.result.ready`
- `review.thread.accept`
- `review.thread.reopen`
- `review.session.close`
- `review.reround.request`
- `review.reround.ready`

Payloads are strongly typed in `PlanReviewEventPayloadMap` (`session-types.ts`).

---

## 3) Local persistence layout

Managed by `scripts/review-state.ts`.

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
- `document.json` is the primary parsed-document state file.
- `drafts.json` stores persisted local drafts plus an optional global review note.
- Snapshot markdown files are immutable once written.
- Events are append-only.
- State writes are atomic (`*.tmp` + rename).

---

## 4) Anchor model

Plan review anchors are markdown-aware, not diff-line-first.

Anchor fields:
- `headingPath: string[]`
- `blockKind: paragraph | checklist_item | list_item | heading | code_block | table | quote | global`
- `blockIndexPath: number[]`
- `quote: string | null`
- `lineStart`, `lineEnd` as optional hints

In v1, UI affordances such as replace/insert/delete are treated as presentation-layer sugar over one stored feedback shape:
- anchor
- comment
- optional suggestion text

---

## 5) Launcher/result contract

A Bosun launcher should:
1. Resolve a plan file path.
2. Create/load a session under `workspace/scratch/plan-reviews/<session-id>/`.
3. Start the browser bridge/window flow for that session.
4. Return a lightweight pending result contract to the caller.

Recommended immediate return fields:
- `status: pending`
- `sessionId`
- `reviewPath`
- `bridgeAgent`
- `targetAgent`

When the reviewer acts:
1. persist the submission + result event locally
2. send a compact mesh notification referencing the persisted payload path

Suggested mesh message format:

```text
plan-review.result session=<id> outcome=request_changes feedback=3
Summary: Changes requested with 3 feedback items
Payload: workspace/scratch/plan-reviews/<session-id>/submissions/<submission-id>.json
```

Bridge/UI transport should treat the persisted local protocol as authoritative state.

---

## 6) Reround + view modes

Reround publication appends a new immutable snapshot, updates `document.json` to the latest parsed anchor set, re-anchors existing threads best-effort, and emits `review.reround.ready`.

Single-document v1 view modes:
- `delta` — only anchors added/modified since the previous snapshot
- `full` — the complete current plan for context

In practice, changing the root plan title should not invalidate every nested anchor; matching heuristics normalize heading paths to reduce that churn while still flagging genuinely stale threads.
