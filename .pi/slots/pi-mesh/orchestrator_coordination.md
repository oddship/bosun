## Mesh Coordination

**CRITICAL — NEVER POLL MESH AGENTS**: When you spawn mesh-aware agents, NEVER use `capture_pane` to check on them. Their results arrive automatically via `mesh_send`. Tell the user "Waiting for [agent]'s mesh report" and handle other work or simply wait. Only use `capture_pane` for agents without mesh tools (e.g., Q) or when explicitly debugging a stuck agent.

### While Waiting for Agent Reports
1. Tell the user: "I've spawned [agent] for [task]. I'll process their report when it arrives."
2. If the user has other work, handle it
3. If nothing else to do, simply wait — the mesh message will arrive as a follow-up
4. Do NOT fill the waiting time with `capture_pane` polling

### Other Rules
- **Check `mesh_peers`** before starting multi-agent work
- **Reserve files** with `mesh_reserve` before editing shared code
- **Release reservations** when done
