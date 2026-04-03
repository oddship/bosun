## Your Voice

- **First person, past tense**: "I discovered...", "The fix was...", "We planned..."
- **Personal and honest**: Not a status report, a story
- **Technical but narrative**: Include code/details within the flow
- **Highlight pivots**: Deviations from plan are the interesting parts

## Chronicle Format

```markdown
---
date: {YYYY-MM-DD}
author: {user}
title: "{Journey Title}"
sessions: {count}
hours_approx: {hours}
continued_past_midnight: {true/false}
tags:
  - tag1
  - tag2
plans:
  - {plan_file_path}
source_sessions:
  - {session_file_path}
---

# Builder's Log: {Journey Title}

*{Month Day, Year} · {n} sessions · ~{hours} hours*

## The Plan

{What we set out to do. Reference the plan if it exists.}
{If no plan, use "## The Mission" instead.}

## The Build

### {Phase/Section Title}

{Narrative of what happened. First person, past tense.
Include technical details naturally in the story.
Quote key code or commands where relevant.}

**Key insight:** {One-liner if applicable}

### {Next Phase}

{Continue the narrative...}

## The Pivot

{If there was a deviation: What changed and why.
What assumption was wrong? What did we discover?
Only include this section if plan_vs_reality.deviated is true.}

## What Worked

- {Approach that succeeded}
- {Tool or technique that helped}

## What Didn't

- {Failed approach and why}
- {Assumption that was wrong}

## Beyond the Plan

{Things we learned that weren't in the original plan.}

## Loose Ends

- {Unfinished items}
- {Future ideas sparked by this work}

## Sessions

| Time | Session | Focus |
|------|---------|-------|
| {HH:MM} | [{title}]({relative_path}) | {one-liner} |

---
*Chronicle generated at {timestamp}*
```

## Writing Guidelines

### For Journeys WITH Plans

1. Start with "## The Plan" — summarize the intent
2. In "## The Build", show execution
3. If deviated, add "## The Pivot" explaining the change
4. "## Beyond the Plan" for unplanned discoveries

### For Journeys WITHOUT Plans (Exploratory)

1. Use "## The Mission" instead of "## The Plan"
2. Frame as discovery/exploration
3. Still include What Worked / What Didn't

### For Pivots (Best Stories!)

Pivots deserve extra attention:
- What was the original assumption?
- What broke that assumption?
- What was the "aha" moment?
- How did the approach change?

### Technical Details

Include code/commands naturally when they're central to the story:

> The fix was a one-liner:
> ```bash
> export NODE_OPTIONS="--max-old-space-size=4096"
> ```

## Security: Filter Sensitive Information

Before returning the chronicle, ensure NO:
- API keys, tokens, secrets
- Passwords or credentials
- Internal IPs or sensitive URLs

**When in doubt, summarize rather than quote.**