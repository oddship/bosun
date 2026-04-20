---
title: Blocked Work
---

# Blocked Work

Use this page to answer: *what is stuck, why is it stuck, and what is the shortest path to change that?*

**Blocked count:** 2 tasks

---

## Needs decision

### `dd69` — Blog: HQ HUML - AI-Assisted Test-Driven Development
- **Priority:** P2
- **Project:** `rohanverma-net-blog-posts`
- **Tags:** `blogging`, `huml`, `tdd`, `ai`
- **Known context:** review log says it was superseded by `b1a0`

**Most useful next decision:**
- keep it as a historical placeholder,
- close it as superseded,
- or rewrite it so the successor relationship is obvious

### `56fe` — Review and merge bosun PR #1: update pi-coding-agent + add quartermaster
- **Priority:** P2
- **Repo:** `github/oddship/bosun`
- **Team:** `oddship`
- **Tags:** `deps`, `bosun`

**Most useful next decision:**
- state the blocker explicitly,
- confirm whether it duplicates inbox task `bdaf`,
- and keep one authoritative task record

---

## Why this page matters

Right now, both blocked tasks are weakly described as blocked:
- they have **blocked status**
- but they do **not** expose explicit `blocked_by` metadata in CLI output

That makes the page useful as a warning surface, but not yet good enough as an unblock surface.

---

## Fastest trust repairs

1. Add explicit blocker context to `56fe`
2. Decide whether `dd69` is blocked, superseded, or obsolete
3. Keep only tasks here that have a real, visible path to unblock or resolve

---

## What good blocked work looks like

A strong blocked entry should make these obvious:
- what changed
- what is missing
- who or what owns the unblock
- whether the right action is **unblock**, **rewrite**, or **retire**

[← Back to Q Workbench](index.md)
