# Agent Permissions

Tool access control for pi-agents.

## Tools Overview

| Tool | Description | Risk |
|------|-------------|------|
| `read` | Read file contents | Low |
| `grep` | Search in files | Low |
| `find` | Find files by pattern | Low |
| `ls` | List directory contents | Low |
| `bash` | Execute shell commands | High |
| `write` | Create/overwrite files | Medium |
| `edit` | Edit existing files | Medium |

## Specifying Tools

In agent frontmatter:

```yaml
tools: read, grep, find, ls
```

Or for full access:

```yaml
tools: read, grep, find, ls, bash, write, edit
```

## Permission Patterns

### Read-Only (Safest)

For analysis agents that should never modify anything:

```yaml
tools: read, grep, find, ls
```

**Use cases:** Code review, security audit, documentation analysis, codebase exploration.

### Read + Bash (Careful)

For agents that need to run commands but not write files directly:

```yaml
tools: read, grep, find, ls, bash
```

**Use cases:** Running tests, checking git status, API calls.

**Risk:** Bash can still modify files via shell commands.

### Full Access

For implementation agents:

```yaml
tools: read, grep, find, ls, bash, write, edit
```

**Use cases:** Feature implementation, bug fixes, refactoring, test writing.

## Recommended Patterns

| Agent Type | Tools | Model Tier | Rationale |
|------------|-------|------------|-----------|
| Scout | read-only | lite | Fast, cheap, no risk |
| Reviewer | read-only | medium | Quality analysis, no risk |
| Security | read-only | medium | Thorough audit, no risk |
| Builder | full | medium | Needs to modify, balanced |
| Planner | read-only | high | Best reasoning, no risk |
| Orchestrator | read-only | high | Strategic decisions |

## Security Considerations

### Bash Command Risks

With `bash` enabled, agents can:
- Delete files: `rm -rf`
- Modify files via shell
- Access network: `curl`, `wget`
- Install software: `npm install`, `pip install`
- Access environment: `env`, `printenv`

### Mitigation Strategies

1. **Limit tools** — Only grant what's needed
2. **Use read-only for analysis** — Review agents don't need write access
3. **Sandbox environment** — Use pi-sandbox for tool-level restrictions
4. **Process sandbox** — Use bwrap/sandbox.sh for filesystem isolation
5. **Lite model for scouts** — Cheaper errors are better errors
