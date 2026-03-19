# Chronicle Workflow Reference

Detailed step-by-step workflow for the `/chronicle` command.

## Complete Execution Flow

```
User: /chronicle 2026-01-06
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: ORCHESTRATOR SETUP                                      │
│                                                                 │
│ a) Parse date (or detect: before 4am = yesterday)               │
│ b) Get user: echo $USER                                         │
│ c) Build paths:                                                 │
│    - sessions: workspace/users/{user}/sessions/2026-01/         │
│    - plans: workspace/users/{user}/plans/2026-01/               │
│    - chronicles: workspace/users/{user}/public/chronicles/      │
│ d) Check existing chronicles (skip if already done)             │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: DELEGATE TO @chronicle-analyzer                         │
│                                                                 │
│ Task(                                                           │
│   agent: "chronicle-analyzer",                          │
│   prompt: """                                                   │
│     Analyze sessions and plans for chronicle generation.        │
│                                                                 │
│     Date: 2026-01-06                                            │
│     User: alice                                                │
│     Sessions dir: workspace/users/alice/sessions/2026-01/      │
│     Plans dir: workspace/users/alice/plans/2026-01/            │
│                                                                 │
│     Include:                                                    │
│     - All sessions: 06-*.md                                     │
│     - All plans: 06-*.md                                        │
│     - Late previous day: 05-{22,23}-*.md                        │
│     - Early next day: 07-0{0,1,2,3,4,5}-*.md                    │
│                                                                 │
│     Return JSON with journey groupings and plan-vs-reality.     │
│   """                                                           │
│ )                                                               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: ANALYZER RETURNS JSON                                   │
│                                                                 │
│ {                                                               │
│   "date": "2026-01-06",                                         │
│   "total_sessions": 35,                                         │
│   "total_plans": 3,                                             │
│   "journeys": [                                                 │
│     {                                                           │
│       "id": 1,                                                  │
│       "title": "The Nix-LD Saga",                               │
│       "slug": "nix-ld-saga",                                    │
│       "plans": [...],                                           │
│       "sessions": [...],                                        │
│       "plan_vs_reality": {                                      │
│         "had_plan": true,                                       │
│         "deviated": true,                                       │
│         "pivot_point": "sass-embedded Dart runtime blocked"    │
│       }                                                         │
│     },                                                          │
│     ...                                                         │
│   ]                                                             │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: SPAWN PARALLEL SCRIBES                                  │
│                                                                 │
│ For each journey (in parallel):                                 │
│                                                                 │
│ Task(                                                           │
│   agent: "chronicle-scribe",                            │
│   prompt: """                                                   │
│     Write a builder's log chronicle for this journey.           │
│                                                                 │
│     Journey: {journey_json}                                     │
│     Output path: workspace/users/alice/public/chronicles/      │
│                  2026-01/06-nix-ld-saga.md                      │
│                                                                 │
│     Read the session/plan files listed if you need more detail. │
│     Write in first-person, past-tense builder's log voice.      │
│     Return the complete chronicle markdown content.             │
│   """                                                           │
│ )                                                               │
│                                                                 │
│ All scribes run SIMULTANEOUSLY (not sequentially)               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: COLLECT & SAVE                                          │
│                                                                 │
│ For each scribe result:                                         │
│   - Validate markdown structure                                 │
│   - Save to chronicles directory                                │
│   - Track success/failure                                       │
│                                                                 │
│ mkdir -p workspace/users/{user}/public/chronicles/2026-01/      │
│ write(path, content)                                            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 6: REPORT TO USER                                          │
│                                                                 │
│ Chronicle generation complete!                                  │
│                                                                 │
│ Analyzed: 35 sessions, 3 plans                                  │
│ Identified: 4 journeys                                          │
│                                                                 │
│ Created:                                                        │
│ - 06-nix-ld-saga.md (5 sessions, 2 plans, ~4.5 hours)          │
│ - 06-agent-infrastructure.md (12 sessions, ~3 hours)           │
│ - 06-cdp-browser.md (3 sessions, 1 plan, ~1.5 hours)           │
│ - 06-chronicle-genesis.md (4 sessions, 1 plan, ~0.5 hours)     │
│                                                                 │
│ Chronicles: workspace/users/alice/public/chronicles/2026-01/   │
└─────────────────────────────────────────────────────────────────┘
```

## Analyzer JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["date", "total_sessions", "total_plans", "journeys"],
  "properties": {
    "date": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    },
    "total_sessions": { "type": "integer" },
    "total_plans": { "type": "integer" },
    "journeys": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "title", "slug", "sessions", "plan_vs_reality"],
        "properties": {
          "id": { "type": "integer" },
          "title": { "type": "string" },
          "slug": { "type": "string", "pattern": "^[a-z0-9-]+$" },
          "plans": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "file": { "type": "string" },
                "title": { "type": "string" },
                "time": { "type": "string" },
                "success_criteria": { "type": "array", "items": { "type": "string" } },
                "approach_summary": { "type": "string" }
              }
            }
          },
          "sessions": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["file", "title", "time"],
              "properties": {
                "file": { "type": "string" },
                "title": { "type": "string" },
                "time": { "type": "string" },
                "duration_minutes": { "type": "integer" },
                "tags": { "type": "array", "items": { "type": "string" } },
                "summary": { "type": "string" },
                "what_worked": { "type": "array", "items": { "type": "string" } },
                "what_didnt": { "type": "array", "items": { "type": "string" } },
                "key_insight": { "type": "string" }
              }
            }
          },
          "plan_vs_reality": {
            "type": "object",
            "properties": {
              "had_plan": { "type": "boolean" },
              "deviated": { "type": "boolean" },
              "deviation_type": { 
                "type": ["string", "null"],
                "enum": ["pivot", "minor_adjustment", "expansion", null]
              },
              "planned_approach": { "type": "string" },
              "actual_approach": { "type": "string" },
              "pivot_point": { "type": "string" },
              "unplanned_discoveries": { 
                "type": "array", 
                "items": { "type": "string" } 
              }
            }
          },
          "time_range": { "type": "string" },
          "hours_approx": { "type": "number" },
          "continued_past_midnight": { "type": "boolean" },
          "primary_tags": { "type": "array", "items": { "type": "string" } },
          "theme": { "type": "string" }
        }
      }
    },
    "orphan_plans": { "type": "array" },
    "unplanned_sessions": { "type": "array" }
  }
}
```

## Scribe Prompt Template

```
Write a builder's log chronicle for this journey.

## Journey Data

Title: {journey.title}
Date: {date}
Time Range: {journey.time_range}
Duration: ~{journey.hours_approx} hours
Continued Past Midnight: {journey.continued_past_midnight}

## Plans (Intent)

{for plan in journey.plans}
### {plan.title} ({plan.time})
File: {plan.file}
Success Criteria: {plan.success_criteria}
Approach: {plan.approach_summary}
{/for}

{if no plans}
No formal plan - exploratory work.
{/if}

## Sessions (Execution)

{for session in journey.sessions}
### {session.title} ({session.time})
File: {session.file}
Duration: {session.duration_minutes} minutes
Tags: {session.tags}
Summary: {session.summary}
What Worked: {session.what_worked}
What Didn't: {session.what_didnt}
Key Insight: {session.key_insight}
{/for}

## Plan vs Reality

Had Plan: {journey.plan_vs_reality.had_plan}
Deviated: {journey.plan_vs_reality.deviated}
Deviation Type: {journey.plan_vs_reality.deviation_type}
Pivot Point: {journey.plan_vs_reality.pivot_point}
Unplanned Discoveries: {journey.plan_vs_reality.unplanned_discoveries}

## Instructions

1. If you need more detail, READ the session files listed above
2. Write in first-person, past-tense builder's log voice
3. If there was a pivot, make it a story beat - it's the interesting part
4. Include technical details (code, commands) within the narrative
5. Be honest about what didn't work

## Output

Return complete markdown for the chronicle file, including YAML frontmatter.
Save path will be: workspace/users/{user}/public/chronicles/{YYYY-MM}/{DD}-{slug}.md
```

## Error Handling

### No Sessions Found
```
No sessions found for {date}. 
Need at least one session to create a chronicle.
```

### Analyzer Timeout
```
Analyzer timed out after 60 seconds.
This can happen with very high session counts (100+).
Try analyzing a smaller date range.
```

### Scribe Failure
```
Scribe failed for journey "{title}".
Error: {error}
Other chronicles were created successfully.
```

### Existing Chronicle
```
Skipped: {slug}.md (already exists)
Use --force to regenerate.
```

## Performance Characteristics

| Sessions | Analyzer Time | Scribe Time (parallel) | Total |
|----------|---------------|------------------------|-------|
| 10 | ~15s | ~10s | ~25s |
| 30 | ~30s | ~15s | ~45s |
| 50 | ~45s | ~20s | ~65s |
| 100+ | Consider splitting by time range |

## Parallelization Details

Scribes run in parallel using multiple Task invocations in a single message:

```
// Single message with multiple Task calls
Task(scribe, journey_1)  // starts immediately
Task(scribe, journey_2)  // starts immediately  
Task(scribe, journey_3)  // starts immediately
Task(scribe, journey_4)  // starts immediately

// All complete roughly together
// Total time ≈ slowest scribe, not sum of all
```

This is critical for performance with multiple journeys.
