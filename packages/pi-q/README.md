# pi-q

Task, project, and roadmap management system for [Pi](https://github.com/badlogic/pi-mono) agents.

## Install

```bash
pi install npm:pi-q
```

## Architecture

```
Tasks (atoms) → Projects (collections) → Roadmaps (teams + projects)
```

## CLI Tools

| Tool | Command | Purpose |
|------|---------|---------|
| `qt` | `.pi/skills/q-tasks/scripts/qt` | Task CRUD, queries, dependencies |
| `qp` | `.pi/skills/q-projects/scripts/qp` | Project management, task aggregation |
| `qr` | `.pi/skills/q-roadmaps/scripts/qr` | Roadmap planning, project coordination |

## Skills

| Skill | Description |
|-------|-------------|
| `q-tasks` | Task tracking, priorities, dependencies, archival |
| `q-projects` | Project management, progress tracking |
| `q-roadmaps` | Strategic roadmap planning |
| `q-review` | Cross-module sync and consistency |

## Agent

The `q` agent is an executive assistant that uses these skills for planning and oversight. Spawn it with:

```typescript
spawn_agent({ agent: "q", session: true, task: "Morning standup" })
```

## Workspace Structure

```
workspace/users/{username}/
├── tasks/          # Task markdown files
├── projects/       # Project markdown files
├── roadmaps/       # Roadmap markdown files
└── public/         # Published items
```

## License

MIT
