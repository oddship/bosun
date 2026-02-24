# pi-sandbox

Tool-level sandboxing for [Pi](https://github.com/badlogic/pi-mono) — restrict bash, write, edit, and read calls per config.

## Install

```bash
pi install npm:pi-sandbox
```

## Configuration

Create `.pi/sandbox.json`:

```json
{
  "enabled": true,
  "filesystem": {
    "denyRead": ["~/.ssh", "~/.aws", "~/.gnupg"],
    "allowWrite": [".", "/tmp"],
    "denyWrite": [".env", ".env.*", "*.pem", "*.key"]
  }
}
```

### Rules

- **denyRead**: Block read access to these paths (bash, read, write, edit)
- **allowWrite**: Only allow writes to these directories (`.` = project root)
- **denyWrite**: Block writes matching these patterns (overrides allowWrite)

### Pattern syntax

- `~/.ssh` — Expands `~` to home directory
- `*.pem` — Matches files ending in `.pem`
- `.env.*` — Matches files like `.env.local`, `.env.production`
- `.env` — Exact basename match

### Evaluation order

1. `denyWrite` checked first (blocks if matched)
2. `allowWrite` checked second (blocks if NOT matched)
3. `denyRead` checked independently for read operations

## How it works

Hooks into Pi's `tool_call` event to intercept bash, write, edit, and read tool calls before execution. If a call violates the sandbox config, it's blocked with an explanation.

This is a second layer of defense on top of process-level sandboxing (bwrap). It works even without bwrap, providing fine-grained per-command restrictions.

## License

MIT
