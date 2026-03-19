# AGENTS.md

For architecture, package details, and development workflows see `docs/`.

## Commits

Conventional commits: `feat(scope):`, `fix(scope):`, `docs:`, `test(scope):`, `chore:`

## Testing

```bash
bun test                           # all tests
bun test tests/specific.test.ts    # specific test
```

## Dependencies

- Pin exact versions: `"1.2.3"` not `"^1.2.3"`
- After changing versions: `bun install` then `just init`

## Code Style

- TypeScript, ESM, `node:` prefix for builtins
- Explicit types for public APIs
