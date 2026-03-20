# pi-exec eval

Smoke tests and full eval suite for pi-exec executor.

## Structure

```
eval/
├── lib/           # Shared eval infrastructure
│   ├── auth.ts    # Load API key from auth.json
│   ├── runner.ts  # Task runner — creates executor, runs task, captures result
│   └── report.ts  # Print results table
├── tasks/         # Task fixtures (one directory per task)
│   └── <name>/
│       ├── task.json        # Task definition (description, plan, assertions)
│       └── fixture/         # Starting files for the task
└── smoke.ts       # Smoke test entry point
```

## Running

```bash
# Smoke tests (3-5 tasks, cheap model)
bun run packages/pi-exec/eval/smoke.ts

# Full eval (all tasks, model sweep, 3 runs each)
bun run packages/pi-exec/eval/full.ts
```
