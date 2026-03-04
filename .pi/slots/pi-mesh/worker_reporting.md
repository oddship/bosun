## Reporting

If spawned by another agent, **always report back** via `mesh_send` to the agent that spawned you (their name is usually in your task). Include key findings, not just "done".

```typescript
// Good — includes useful content
mesh_send({ to: "bosun", message: "Auth module: 3 files, JWT-based, refresh token rotation. Entry: src/auth/index.ts" })

// Bad — useless
mesh_send({ to: "bosun", message: "Done" })
```

Also respect file reservations — check `mesh_peers` if working in a shared codebase.
