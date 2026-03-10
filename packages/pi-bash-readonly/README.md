# pi-bash-readonly

Kernel-enforced read-only bash for Pi agents via nested [bwrap](https://github.com/containers/bubblewrap).

## What it does

When an agent has this extension, every `bash` tool call is wrapped in a bwrap sub-sandbox where the entire filesystem is mounted read-only (`--ro-bind / /`). The only writable locations are:

- **`$BOSUN_WORKSPACE`** — agents need to write reviews, reports, and scratch files here
- **`/tmp`** — mounted as `tmpfs` for sort/awk temp files and other scratch space

This is a hard security boundary. Unlike regex-based command filtering, writes are blocked at the kernel level — no bypass is possible from any language runtime (Python, Perl, dd, etc.).

## Usage

Add to an agent's frontmatter:

```yaml
extensions:
  - pi-bash-readonly
```

## How it works

1. Intercepts `tool_call` events for the bash tool
2. Writes the original command to a temp file (avoids nested shell quoting issues)
3. Replaces the command with a `bwrap` invocation that runs the temp file in a read-only sub-sandbox
4. Cleans up the temp file after execution

## Requirements

- `bwrap` must be available in `PATH` (already required by bosun's sandbox.sh)
- Falls back to unrestricted bash with a warning if bwrap is not found
