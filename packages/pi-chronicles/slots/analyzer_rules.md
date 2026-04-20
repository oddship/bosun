## Journey Clustering Rules

Sessions belong to the **same journey** when:
- Time proximity: Sessions within 2 hours of each other
- Tag overlap: 50%+ tags in common
- File overlap: Working on same files
- Topic continuity: Titles/problems clearly related
- **Same plan**: Sessions executing the same plan

Sessions are **different journeys** when:
- Time gap: 3+ hours between sessions
- Topic shift: Completely different problem domain
- No file overlap: Different parts of codebase
- Different plans: Executing unrelated plans

## Deviation Detection

Flag deviations when:
- Session "What Went Wrong" / "What Didn't Work" section is substantial
- Session tags include: `troubleshooting`, `debugging`, `fix`, `pivot`
- Session title differs significantly from plan title
- Session duration >> plan estimated time
- Session touches files not mentioned in plan

## Deviation Type Classification

| Type | Description |
|------|-------------|
| `pivot` | Completely changed approach |
| `minor_adjustment` | Small tweaks to plan |
| `expansion` | Plan succeeded + discovered more |
| `null` | Plan executed as-is |

## Output Format

Return ONLY valid JSON (no markdown, no explanation):

```json
{
  "date": "2026-01-06",
  "total_sessions": 36,
  "total_plans": 3,
  "journeys": [
    {
      "id": 1,
      "title": "Descriptive Journey Title",
      "slug": "kebab-case-slug",
      "plans": [
        {
          "file": "plans/2026-01/06-22-58-plan-name.md",
          "title": "Plan Title",
          "time": "22:58",
          "success_criteria": ["Criterion 1", "Criterion 2"],
          "approach_summary": "Brief approach from plan"
        }
      ],
      "sessions": [
        {
          "file": "sessions/2026-01/06-22-26-session-name.md",
          "title": "Session Title",
          "time": "22:26",
          "duration_minutes": 45,
          "tags": ["tag1", "tag2"],
          "summary": "Rich 3-5 sentence summary.",
          "what_worked": ["Thing 1", "Thing 2"],
          "what_didnt": ["Issue 1"],
          "key_insight": "Main learning if any"
        }
      ],
      "plan_vs_reality": {
        "had_plan": true,
        "deviated": true,
        "deviation_type": "pivot|minor_adjustment|expansion|null",
        "planned_approach": "What the plan said to do",
        "actual_approach": "What actually happened",
        "pivot_point": "The moment/reason things changed",
        "unplanned_discoveries": ["Discovery 1", "Discovery 2"]
      },
      "time_range": "22:26-23:42",
      "hours_approx": 1.3,
      "continued_past_midnight": false,
      "primary_tags": ["main", "tags"],
      "theme": "Brief description of what this journey accomplished"
    }
  ],
  "orphan_plans": [],
  "unplanned_sessions": []
}
```

## Extraction Guide

**CRITICAL**: Extract RICH summaries. Scribes will NOT read files — they rely entirely on your extraction.

### From Plans (YAML frontmatter + content)

Extract thoroughly:
- `## Success Criteria` section — list all criteria
- `## Approach` section — summarize the strategy (2-3 sentences)
- `## Implementation Steps` section — list key steps

### From Sessions (YAML frontmatter + content)

Extract from frontmatter:
- `title`, `time`, `duration_minutes` (optional), `tags`, `files_touched`
- If `duration_minutes` is missing, set it to `null` or omit it. Do **not** inspect raw `.jsonl` session logs to recover it.

Extract from content (BE THOROUGH):
- `## Overview` — full overview, not just first sentence (3-5 sentences)
- `## What Went Wrong` / `## What Didn't Work` — ALL issues encountered (gold for narratives)
- `## What Worked` — ALL items
- `## Solution` — what actually worked
- `## Key Insights` — ALL items
- Any "aha moments" or discoveries

**Aim for 3-5 sentence summaries per session**, not 1 sentence.

## Important

- Return ONLY JSON, no other text
- Stay on today's markdown summaries and top-level plan docs only; do not load unrelated docs or skills
- Include ALL sessions in some journey (or `unplanned_sessions`)
- Include ALL plans (matched to journeys or in `orphan_plans`)
- Skip trivial greeting-only sessions — put them in `unplanned_sessions` with just the filename
- No journey should have more than ~10 sessions. If grouping too many, split by sub-topic
- Pivots/deviations are GOOD — they make interesting stories
- Sort journeys chronologically by start time