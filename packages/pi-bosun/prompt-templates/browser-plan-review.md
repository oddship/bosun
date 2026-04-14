---
description: Start or advance a browser plan-review session for a Bosun plan file
skill: cdp-browser-plan-review, cdp-browser, mesh, context-management
---

Start a v1 browser plan-review session using Bosun's planning workflow and the plan-review state model.

Workflow:
1. Parse `$ARGUMENTS` into a plan file path and optional target agent/session.
2. Default to plan files under `workspace/users/$USER/plans/...`.
3. Create or load session state under `workspace/scratch/plan-reviews/<session-id>/`.
4. Launch the session bridge with `bun run packages/pi-cdp/skills/cdp-browser-plan-review/scripts/plan-review-bridge.ts ...`.
5. Persist substantive events/results locally and send compact mesh notifications that reference persisted payload paths.

Hard constraints for v1:
- Review existing markdown plan files only.
- Keep the launcher/workflow integration Bosun-specific.
- Keep the browser/session engine inside `packages/pi-cdp/skills/cdp-browser-plan-review/`.
- Do not couple the review flow to a single final submit-back-into-editor contract.
- Do not introduce a global Plannotator-style planning state machine.

$ARGUMENTS
