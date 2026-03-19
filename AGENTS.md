# AGENTS.md — Guidelines for Agents Working in This Repo

This document is for Pi agents (including you) operating inside the bosun environment.

## Repository Structure

```
bosun/
├── .pi/agents/          # Agent overrides (project-level)
├── .pi/skills/          # Skill overrides (project-level)
├── skills/              # Generic skills (git, github, cdp-browser, etc.)
├── packages/            # Pi packages (independent, publishable)
├── scripts/             # Scaffolding (sandbox.sh, init.ts, daemon handlers)
├── config/              # tmux.conf
├── config.toml          # User config (gitignored)
├── workspace/           # User data (gitignored)
└── .bosun-home/         # Sandboxed HOME (gitignored)
```

## Conventions

### Commits

Use conventional commits:
```
feat(pi-agents): add spawn_agent tool
fix(daemon): handle stale triggers on restart
docs: update user manual
test(pi-daemon): add queue recovery tests
```

### Testing

```bash
bun test                           # run all tests in current package
bun test tests/specific.test.ts    # run specific test
```

Tests use `bun:test`. Each package has its own `tests/` directory.

### Code Style

- TypeScript, ESM (`"type": "module"`)
- Prefer explicit types over inference for public APIs
- Use `node:` prefix for Node.js built-in imports
- Keep package dependencies minimal

### Dependencies

- **Pin exact versions** — use `"1.2.3"` not `"^1.2.3"` in all `package.json` files
- `workspace:*` is fine for local workspace packages
- **After changing dependency versions**: run `bun install` then `just init` — pi reads package specifiers from `.pi/settings.json` (generated), not `package.json` directly

### Package Guidelines

Each package under `packages/` is independent:
- Own `package.json` with `"pi"` key for extension/skill discovery
- Uses `peerDependencies` for Pi core packages
- Reads config from `.pi/<package-name>.json`
- No cross-package imports at runtime

## Working with This Repo

### Before Making Changes

1. Load relevant skills: `git`, `context-management`
2. For 3+ files: create a plan first (see context-management skill)
3. Check `mesh_peers` if other agents are active
4. Reserve files with `mesh_reserve` before editing shared code

### After Making Changes

1. Run tests: `bun test`
2. Check for stale references: `rg -i "zerodha|zero_root|\.zero-" .`
3. Commit with conventional commit format
4. Release reservations: `mesh_release`

### Adding a New Package

1. Create `packages/<name>/package.json` with `"pi"` config
2. Add extension in `extensions/index.ts` or skills in `skills/`
3. Add to root `package.json` dependencies
4. Update `scripts/init.ts` if package needs config generation
5. Add to README.md package table

### Adding a New Agent

1. Create agent `.md` in a package (`packages/<pkg>/agents/`) or `.pi/agents/` for project overrides
2. Model tiers: `lite`, `medium`, `high`, `oracle`
3. Add to agent table in README.md and bosun.md

### Adding a New Skill

1. Create skill in a package (`packages/<pkg>/skills/`) or `skills/` for generic skills
2. Add `references/` for detailed docs, `scripts/` for CLI tools
3. Skills auto-discover via Pi's skill system

## Environment Variables

Inside the sandbox:

| Variable | Value |
|----------|-------|
| `BOSUN_ROOT` | Absolute path to bosun repo |
| `BOSUN_WORKSPACE` | `$BOSUN_ROOT/workspace` |
| `HOME` | `$BOSUN_ROOT/.bosun-home` |
| `PI_AGENT` | Agent template name (e.g., `bosun`) |
| `PI_AGENT_NAME` | Unique instance name (e.g., `bosun`, `lite-1`) |
| `BOSUN_SANDBOX` | `1` if running inside bwrap |
| `TMUX` | Tmux socket path |
