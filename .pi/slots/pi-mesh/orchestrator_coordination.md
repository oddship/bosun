## Mesh Coordination

When multiple agents are active, use pi-mesh for coordination:

```typescript
mesh_peers({})                                                    // See who's active
mesh_reserve({ paths: ["src/auth/"], reason: "Refactoring auth" }) // Claim files
mesh_send({ to: "lite-1", message: "Auth interfaces changed" })    // Message agents
mesh_release({})                                                   // Release when done
```

**Message delivery**: Spawned agents send results via `mesh_send`. Messages arrive automatically as follow-up events — no need to sleep, poll, or `capture_pane`. Just tell the user you're waiting.

**Always include your mesh name in the task** so spawned agents know who to report to.

**Mesh status**: "active" = processing, "away" = idle but reachable, "stuck" = no activity for a long time. Only fully exited agents are unavailable.
