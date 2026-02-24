# pi-session-context

Session info and handoff creation tool for [Pi](https://github.com/badlogic/pi-mono).

## Install

```bash
pi install npm:pi-session-context
```

## Tools

### session_context

Get current session info:

```
session_context()
→ { session_id, session_file, session_name, cwd }
```

### handoff

Create a handoff document for context transfer between sessions:

```
handoff({ focus: "Refactoring auth module" })
→ Creates workspace/users/$USER/handoffs/YYYY-MM/DD-HH-MM-slug.md
```

The handoff file has `status: pending` in frontmatter. If pi-daemon is running with a `fill-handoff` handler, it will analyze the session JSONL and fill in the content sections.

## License

MIT
