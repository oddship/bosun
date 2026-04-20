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

## Sites

`pi-q` now also exposes a package-owned `pi.sites` surface:

- `console` → `./sites/console`

When the gateway is enabled, this is served at:

- `/sites/pi-q/console/`

This site is intended to be a q-owned workbench, not just a generic chat shell. The site launches a real `q` agent session with site-maintainer intent so q can treat the website as part of the maintained user experience.

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
