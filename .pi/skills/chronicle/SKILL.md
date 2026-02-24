---
name: chronicle
description: Generate public builder's logs from coding sessions. Analyzes plans and sessions, detects deviations, synthesizes narratives per journey. Use with /chronicle command.
---

# Chronicle

Generate builder's logs from your coding sessions. Transforms raw session data into compelling narratives that capture the journey of building.

## What I Do

- Analyze sessions AND plans for a given date
- Detect when execution deviated from plans (pivots = best stories)
- Group work into distinct journeys
- Generate narrative chronicles in builder's log voice
- Run analysis and writing in parallel for efficiency

## Commands

```bash
/chronicle                    # Today (or yesterday if before 4am)
/chronicle 2026-01-06         # Specific date
/chronicle weekly             # Last 7 days (future)
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Bosun (Orchestrator)                                            │
│                                                                 │
│  1. Determine target date (smart: before 4am = yesterday)       │
│  2. Check for existing chronicles (skip duplicates)             │
│  3. Delegate to @chronicle-analyzer (Haiku) ──────────────┐     │
│  4. Receive enriched JSON with plan-vs-reality            │     │
│  5. Spawn @chronicle-scribe (Haiku) per journey ──────────┼──┐  │
│  6. Collect results, report to user                       │  │  │
└───────────────────────────────────────────────────────────┼──┼──┘
                                                            │  │
     ┌──────────────────────────────────────────────────────┘  │
     ▼                                                         │
┌─────────────────────────────────────┐                        │
│ @chronicle-analyzer (Haiku)         │                        │
│                                     │                        │
│ SCANS:                              │                        │
│ ├── plans/YYYY-MM/DD-*.md          │                        │
│ └── sessions/YYYY-MM/DD-*.md       │                        │
│                                     │                        │
│ RETURNS:                            │                        │
│ ├── Journeys with matched plans    │                        │
│ ├── Plan-vs-reality analysis       │                        │
│ ├── Deviation detection            │                        │
│ └── Enriched session summaries     │                        │
└─────────────────────────────────────┘                        │
                                                               │
     ┌─────────────────────────────────────────────────────────┘
     ▼ (parallel - one per journey)
┌─────────────────────────────────────┐
│ @chronicle-scribe (Haiku) x N       │
│                                     │
│ RECEIVES:                           │
│ ├── Journey metadata + theme        │
│ ├── Plan summaries (if any)         │
│ ├── Session summaries               │
│ └── Plan-vs-reality analysis        │
│                                     │
│ WRITES:                             │
│ └── Complete chronicle markdown     │
└─────────────────────────────────────┘
```

## Workflow

### Step 1: Date Detection

```bash
HOUR=$(date +%H)
if [ "$HOUR" -lt 4 ]; then
  TARGET_DATE=$(date -d "yesterday" +%Y-%m-%d)
else
  TARGET_DATE=$(date +%Y-%m-%d)
fi
```

### Step 2: Handle Existing Chronicles

```bash
# Check what exists
ls workspace/users/$USER/public/chronicles/YYYY-MM/DD-*.md 2>/dev/null
```

**For fresh generation**: Skip journeys that already have chronicles.

**For regeneration** (user explicitly requests): Delete existing chronicles first:
```bash
rm workspace/users/$USER/public/chronicles/YYYY-MM/DD-*.md 2>/dev/null
```

### Step 3: Delegate to Analyzer

```
Task(
  agent: "chronicle-analyzer",
  prompt: "Analyze date {TARGET_DATE} for user {USER}..."
)
```

Analyzer returns **ENRICHED JSON** with:
- Journeys with **full session summaries** (not just file paths)
- Plan summaries extracted from plan files
- Plan-vs-reality analysis per journey
- what_worked, what_didnt, key_insight per session
- Orphan plans and unplanned sessions

**CRITICAL**: The analyzer does the heavy reading. Scribes should NOT need to read session files.

### Step 4: Spawn Parallel Scribes

For each journey, spawn a scribe with the **enriched JSON data**:

```
# PARALLEL - all at once
Task(scribe, journey_1_json)
Task(scribe, journey_2_json)
Task(scribe, journey_3_json)
Task(scribe, journey_4_json)
```

**CRITICAL**: Pass the analyzer's JSON directly. Do NOT tell scribes to "read these files".

Each scribe:
1. Receives journey JSON with pre-extracted summaries
2. Synthesizes narrative from the summaries (NO file reading needed)
3. Writes chronicle directly using Write tool
4. Returns short confirmation: "Chronicle written: DD-{slug}.md"

### Step 5: Collect & Report

Scribes write directly to:
```
workspace/users/{user}/public/chronicles/YYYY-MM/DD-{slug}.md
```

Orchestrator collects confirmations and reports to user.

## Scribe Prompt Template

**IMPORTANT**: Use this template for scribe prompts to avoid step exhaustion:

```
Write a chronicle for this journey. Use the PROVIDED SUMMARIES below - do NOT read session files.

## Journey: {title}
- Slug: {slug} (use exactly this for filename)
- Date: {date}
- User: {user}
- Time Range: {time_range}
- Hours: {hours_approx}
- Tags: {tags}

## Plans (if any)
{For each plan: title, summary, success_criteria, approach}

## Sessions (ALREADY SUMMARIZED - don't re-read files)
{For each session:
  - time, title
  - summary (1-2 sentences)
  - what_worked, what_didnt
  - key_insight
}

## Plan vs Reality
- Deviated: {yes/no}
- Deviation type: {pivot/minor_adjustment/expansion/null}
- Pivot point: {description}
- Unplanned discoveries: {list}

## Output
Write chronicle to: workspace/users/{user}/public/chronicles/YYYY-MM/DD-{slug}.md
Return only: "Chronicle written: DD-{slug}.md ({n} sessions, ~{hours}h)"
```

## Error Handling: Re-Delegation

**CRITICAL**: Bosun (orchestrator) must NOT do the work itself if spawn_agent fail.

### If Analyzer Fails
1. Check the error message
2. Re-delegate to analyzer with adjusted prompt (e.g., "Focus on sessions only, skip plans")
3. If still fails, report to user: "Analysis failed after retry. Try with fewer sessions?"

### If Scribe Fails
1. Check which journey failed (scribe returns error or incomplete output)
2. **Re-delegate** to a new scribe with the same journey data
3. If scribe returned partial content (no file written), spawn new scribe
4. If still fails after retry, **write the file yourself** as last resort

### Signs of Scribe Failure
- Returns "I couldn't write the file" → Re-delegate
- Returns summary but no "Chronicle written:" confirmation → Re-delegate  
- Returns nothing or error → Re-delegate
- Says "step limit reached" → Re-delegate with simpler prompt

### DO NOT
- ❌ Write chronicles yourself when scribes fail (expensive, defeats purpose)
- ❌ Give up after first failure
- ❌ Accept partial results without retrying

### Example Re-Delegation
```
# First scribe failed
Task(scribe, journey_1) → Failed: "step limit"

# Re-delegate with simpler prompt
Task(scribe, journey_1, prompt="Write a BRIEF chronicle (500 words max)...")
```

## Cost Efficiency

| Component | Model | Tokens | Purpose |
|-----------|-------|--------|---------|
| Orchestrator | Sonnet | ~3K | Coordination only |
| Analyzer | Haiku | ~50K | Read all files |
| Scribe (x4) | Haiku | ~5K each | Write chronicles |

**Total: ~73K Haiku + ~3K Sonnet vs ~60K Sonnet (old)**

~80% cost reduction while improving quality through specialization.

## Output Structure

Chronicles saved to:
```
workspace/users/{user}/public/chronicles/
└── YYYY-MM/
    ├── DD-journey-slug.md
    ├── DD-another-journey.md
    └── _index.md  (monthly index, future)
```

## Chronicle Format

```markdown
---
date: 2026-01-06
author: alice
title: "The Nix-LD Saga"
sessions: 5
hours_approx: 4.5
plans:
  - plans/2026-01/06-22-58-dev-server-setup.md
tags: [frontend, nix-ld, sandbox]
---

# Builder's Log: The Nix-LD Saga

## The Plan
What we intended...

## The Build
What happened...

## The Pivot
Where things changed...

## What Worked / What Didn't

## Sessions
| Time | Session | Focus |
```

## Key Concepts

### Journeys vs Days

A day may have multiple unrelated journeys:
- Morning: Feature work
- Afternoon: Infrastructure fix
- Evening: Documentation

Each becomes a **separate chronicle** with its own narrative arc.

### Plans vs Sessions

- **Plans** = Intent (what we meant to do)
- **Sessions** = Execution (what actually happened)
- **Deviations** = The interesting part!

### Midnight Spillover

Work starting at 10pm and ending at 2am:
- Chronicle dated by **start date**
- Includes sessions from both days
- Notes "continued past midnight"

## Best Practices

1. **Don't force splits** - If all work is related, one chronicle
2. **Highlight pivots** - Deviations from plan are the best stories
3. **Be honest** - Include what didn't work
4. **Stay technical** - Include code, but in narrative flow
5. **No secrets** - Filter sensitive data before writing

## Session Analysis

For detailed session export patterns (jq, trimming, tool analysis), load the **session-analysis** skill:

```
skill({ name: "session-analysis" })
```

Use session-analysis for:
- Exporting and trimming large sessions for LLM processing
- Extracting tool usage metrics, steering prompts, file operations
- Verifying chronicle claims against session evidence
