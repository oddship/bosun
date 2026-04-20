---
title: Review & Cleanup
---

# Review & Cleanup

Use this page to restore trust in the workbench when summaries, statuses, or rollups drift out of sync.

---

## Recent movement

### 2026-03-18
- `cb45` — **moat v0.6.0 release** created and made active

### 2026-03-15
- `0ef6` — **Add persistent agent support to spawn_agent** created
- `56fe` — **Review and merge bosun PR #1** created as blocked
- `bdaf` — **Review and merge bosun PR #1** created as inbox

### 2026-02-25
- **Moat CSS Framework Architecture** publication logged
- blog project log updated with imported tasks and revised task summary
- blogging roadmap log updated with publication and migration notes

---

## Most important cleanup first

### Resolve duplicate PR-review intent
Two tasks appear to represent the same work:
- `bdaf` — inbox, P1
- `56fe` — blocked, P2

**Why it matters:** the dashboard cannot give clean guidance while one unit of work has two competing records.

**Current resolution recommendation:**
- keep **`bdaf`** as the canonical task record
- copy over the richer bosun context from `56fe` (`repo: github/oddship/bosun`, `team: oddship`) if needed
- retire or rewrite **`56fe`** unless a real blocker can be stated explicitly

**Why this is the cleanest fix:**
- `bdaf` is higher priority
- `bdaf` is not carrying a weak "blocked" status with empty blocker metadata
- `56fe` adds useful context, but not enough to justify a second competing task record

---

## Other trust issues to fix

### Blocked tasks lack explicit blockers
Current blocked tasks show blocked status without visible `blocked_by` metadata:
- `dd69`
- `56fe`

**Fix:** add explicit blocker context or change the status to match reality.

### Project rollup looks stale
`rohanverma-net-blog-posts` still shows `progress: 0` even though the logs show shipped work.

**Fix:** refresh project progress/health or repair the rollup path.

### Roadmap points to an unverifiable project
`2026-blogging-roadmap` references `zerodha-internal-blog-posts`, which is not visible in the current project list.

**Fix:** verify, replace, or remove the stale reference.

---

## Good use of this page

Run through this page before a standup, weekly review, or planning reset:
1. scan recent movement
2. fix duplicate or stale task surfaces
3. repair trust in project and roadmap summaries
4. leave with one clear next priority

---

## If you only fix one thing

Fix the duplicate PR-review tasks first.

That single cleanup improves:
- inbox clarity
- blocked-work clarity
- homepage guidance
- overall trust in the workbench

[← Back to Q Workbench](index.md)
