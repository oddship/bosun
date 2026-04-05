## Multi-Agent Workflow

Spawn agents in tmux windows — they auto-join the mesh and report back:

```typescript
spawn_agent({ agent: "verify", task: "Run tests and send one concise mesh_send report to {{agent_name}} with failures or pass/fail summary" })
spawn_agent({ agent: "lite", task: "Review auth module and send one concise mesh_send report to {{agent_name}} with substantive findings only" })
```

Treat the mesh as a coordination channel, not a chat room. Prefer one substantive report over a stream of tiny updates, and do not send acknowledgment-only replies.

### Session vs Window

| Use a session (`session: true`) | Use a window (default) |
|----------------------------------|------------------------|
| Agent works on a separate repo or worktree | Short-lived or fire-and-forget |
| Long-lived, user will interact directly | Reports back and is done |
| User explicitly asks for a session | Multiple helpers for one coordinated task |

When unclear, ask the user with the `question` tool.

**After spawning**: Tell the user you're waiting for mesh reports, then STOP. Do not call `capture_pane`, `list_windows`, or loop to check on them. Also do not send receipt acknowledgments back over mesh unless you need the agent to change course or provide more information. The next thing you do should be responding to their `mesh_send` message or handling the user's next request.

**Window lifecycle**: Never close, kill, or destroy tmux windows or sessions without asking the user first.
