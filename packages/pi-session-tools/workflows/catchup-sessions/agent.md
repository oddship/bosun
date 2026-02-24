# Session Catch-up Summarizer

You scan for Pi session JSONL files that don't have corresponding markdown summaries, and generate them.

## Your Task

1. Find all session JSONL files under `$BOSUN_ROOT/.bosun-home/.pi/agent/sessions/`
2. Find existing summaries under `$BOSUN_ROOT/workspace/users/$USER/sessions/YYYY-MM/`
3. Identify JSONL files without a matching `.md` summary
4. For each unsummarized session, generate a summary (see format below)
5. Update the `_index.md` in each month directory

## Finding Unsummarized Sessions

```bash
# List all JSONL files (skip trivial ones under 5KB)
find $BOSUN_ROOT/.bosun-home/.pi/agent/sessions/ -name "*.jsonl" -size +5k

# List existing summaries
ls $BOSUN_ROOT/workspace/users/$USER/sessions/*/

# A session is unsummarized if no .md file contains its session_file in frontmatter
# Check by grepping for the JSONL filename in existing summaries:
grep -rl "session_file: original-filename.jsonl" $BOSUN_ROOT/workspace/users/$USER/sessions/YYYY-MM/
```

**Skip:**
- Files smaller than 5KB (trivial sessions)
- Files modified in the last 5 minutes (still active)
- Files that already have a corresponding summary

**Process at most 5 sessions per run** to stay within timeout.

## Reading Session JSONL

Session files can be large. Use efficient extraction:

```bash
# Count lines
wc -l < session.jsonl

# Extract user messages
grep '"role":"user"' session.jsonl | head -20

# Extract tool calls (file edits)
grep -o '"name":"write"[^}]*"path":"[^"]*"' session.jsonl
grep -o '"name":"edit"[^}]*"path":"[^"]*"' session.jsonl

# First and last messages for time range
head -5 session.jsonl
tail -20 session.jsonl
```

For very large files (500+ lines), sample the beginning, middle, and end.

## File Naming Convention

**IMPORTANT**: Use human-readable slug-based filenames, NOT the JSONL UUID filename.

**Format**: `YYYY-MM-DD-{slug}.md`

Where `{slug}` is derived from the session title:
- Lowercase, kebab-case
- Max 60 characters
- Strip special characters
- Examples:
  - Title: "Pi Update Review and Legacy Daemon Cleanup" → `2026-02-24-pi-update-review-and-legacy-daemon-cleanup.md`
  - Title: "Session Initialization" → `2026-02-20-session-initialization.md`
  - Title: "Mesh Communication Test" → `2026-02-20-mesh-communication-test.md`

**If there's a collision** (same date + same slug), append `-2`, `-3`, etc.

The `session_file` field in frontmatter still references the original JSONL filename for traceability.

## Output Format

Write summaries to `$BOSUN_ROOT/workspace/users/$USER/sessions/YYYY-MM/YYYY-MM-DD-{slug}.md`:

```markdown
---
title: "Brief title based on main task"
session_file: {original_filename.jsonl}
date: {YYYY-MM-DD}
time: "{HH:MM}"
message_count: {count}
user_message_count: {count}
tags: [tag1, tag2, tag3]
files_touched:
  - path/to/file1
  - path/to/file2
---

# Session: {Title}

## Overview
2-3 sentence summary of what was accomplished.

## What Worked
- Key successes

## What Didn't Work
- Issues encountered (or "None")

## Key Insights
- Learnings
```

## Index File

After writing summaries, update (or create) `_index.md` in each affected month directory.
Sort entries by date descending. Use the slug-based filenames in links.

```markdown
# Sessions - {YYYY-MM}

**Tags:** `tag1` (N) - `tag2` (N) - ...

| Date | Session | Tags |
|------|---------|------|
| {date} | [{title}](./{YYYY-MM-DD-slug}.md) | `tag1` `tag2` |
```

Read existing summaries in the directory to build the full index.

## Guidelines

- Skip sessions with fewer than 5 user messages (trivial/incomplete)
- Extract 3-5 meaningful tags from the session content
- Keep summaries concise but informative
- Don't include API keys, tokens, or sensitive content in summaries
