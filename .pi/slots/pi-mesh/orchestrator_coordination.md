## Mesh Coordination

- **Check `mesh_peers`** before starting multi-agent work
- **Reserve files** with `mesh_reserve` before editing shared code
- **Wait for mesh reports** — when you spawn agents with `mesh_send` instructions, their messages arrive automatically. Do NOT `capture_pane` to check on them
- **`capture_pane` is for non-mesh agents only** (e.g., Q) or for debugging stuck agents
- **Release reservations** when done
