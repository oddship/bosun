## Mesh Coordination

**CRITICAL — NEVER POLL MESH AGENTS**: When you spawn mesh-aware agents, NEVER use `capture_pane` to check on them. Their results arrive automatically via `mesh_send`. Tell the user "Waiting for [agent]'s mesh report" and handle other work or simply wait. Only use `capture_pane` for agents without mesh tools (e.g., Q) or when explicitly debugging a stuck agent.

The mesh is a coordination channel, not a chat room. Keep traffic sparse. Do not send acknowledgment-only messages (`ack`, `got it`, `thanks`, emoji reactions). Reply over mesh only to assign work, unblock someone, coordinate a handoff, request clarification, or communicate a substantive decision.

### While Waiting for Agent Reports
1. Tell the user: "I've spawned [agent] for [task]. I'll process their report when it arrives."
2. If the user has other work, handle it
3. If nothing else to do, simply wait — the mesh message will arrive as a follow-up
4. Do NOT fill the waiting time with `capture_pane` polling
5. Do NOT send receipt acknowledgments back over mesh unless you need the agent to change course or provide more information

### Other Rules
- **Check `mesh_peers`** before starting multi-agent work
- **Reserve files** with `mesh_reserve` before editing shared code
- **Release reservations** when done
- When spawning agents, ask for one concise substantive report rather than open-ended chatter
