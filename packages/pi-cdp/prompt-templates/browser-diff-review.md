---
description: Start or advance a browser diff-review session
skill: cdp-browser-diff-review, cdp-browser, mesh
---

Start a v1 diff-review session (or reround) using the diff-review skill state model.

Workflow:
1. Parse `$ARGUMENTS` into a diff scope (`worktree`, `staged`, `last-commit`, `commit-range`, or `custom`) and target agent.
2. Create/load session state under `workspace/scratch/diff-reviews/<session-id>/`.
3. Build immutable round artifacts with `scripts/git-review-data.ts`.
4. Persist substantive events (`review.round.request`, `review.round.ready`, etc.) with `scripts/review-state.ts`.
5. Launch or update the session-specific bridge/window flow for this session.

Hard constraints for v1:
- Keep behavior diff-review-specific.
- Publish explicit rounds only (no ambient worktree auto-rounds).
- Send compact mesh notifications that reference persisted event payload paths.

$ARGUMENTS
