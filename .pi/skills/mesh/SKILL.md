---
name: mesh
description: Multi-agent coordination via pi-mesh. Use when multiple agents work in the same project - reservations, messaging, and peer awareness.
triggers:
  - mesh
  - coordination
  - multiple agents
  - reserve files
  - send message
  - who is working
---

# Pi Mesh - Multi-Agent Coordination

## When to Use

Load this skill when:
- Multiple Pi sessions are active in the same workspace
- You need to check what other agents are doing
- You want to reserve files before editing shared code
- You need to message another agent
- You're spawning agents via tmux and want them to coordinate

## Tools

5 tools available when pi-mesh is loaded:

### mesh_peers
Check who's active. Always do this before starting work on shared code.

```
mesh_peers({})
```

### mesh_reserve / mesh_release
Claim files before editing. Other agents get blocked with your name and a message to coordinate.

```
mesh_reserve({ paths: ["src/auth/", "config.ts"], reason: "Refactoring auth" })
// ... do your work ...
mesh_release({})  // Release all when done
```

- Use trailing `/` for directories: `"src/auth/"` reserves everything under it
- Be specific - reserve `src/auth/login.ts` not `src/`
- Always release when done (auto-released on session shutdown)
- Only `edit` and `write` tools are blocked. `bash` commands bypass reservations.

### mesh_send
Send messages to other agents.

```
// Normal message (waits for recipient to finish current work)
mesh_send({ to: "bosun-1", message: "Auth refactor done, interface changed" })

// Urgent (interrupts immediately)
mesh_send({ to: "bosun-1", message: "Stop! Breaking change in config.ts", urgent: true })

// Broadcast to all
mesh_send({ broadcast: true, message: "Deploying in 5 minutes" })
```

Use urgent sparingly - only for time-sensitive coordination.

### mesh_manage
Utility actions:

```
mesh_manage({ action: "whois", name: "bosun-1" })     // Detailed agent info
mesh_manage({ action: "rename", name: "auth-worker" }) // Change your name
mesh_manage({ action: "set_status", message: "reviewing PRs" })
mesh_manage({ action: "feed", limit: 20 })            // Activity timeline
```

## Coordination Patterns

### Before Starting Work
1. `mesh_peers({})` - check who's active and what they're working on
2. `mesh_reserve({ paths: [...] })` - claim your files
3. Do your work
4. `mesh_release({})` - release when done
5. `mesh_send({ ... })` - notify if your changes affect others

### Parallel Work on Same Module
Agent A reserves `src/auth/login.ts`, Agent B reserves `src/auth/signup.ts`. Both can work in parallel without conflicts. If B needs login.ts, they message A.

### Handoff Between Agents
```
// Agent A finishing up
mesh_send({ to: "bosun-2", message: "Auth module ready. New interface: authenticate(token: string): Promise<User>" })
mesh_release({ paths: ["src/auth/"] })

// Agent B picks up
mesh_reserve({ paths: ["src/auth/"] })
```

### Spawning Coordinated Agents
When spawning agents via tmux, they auto-join the mesh:
```
spawn_agent({ agent: "lite", task: "Fix tests in src/utils/" })
// The lite agent appears in mesh_peers automatically
```

## Status Meanings

| Status | Meaning | Can you message them? |
|--------|---------|----------------------|
| **active** | Currently processing a turn | Yes - message queued, delivered after current turn |
| **away** | Idle between turns, waiting for input | **Yes** - they are alive and will respond when prompted |
| **stuck** | No activity for a long time | Yes, but they may need user intervention |
| **exited** | Session has ended | No - they're gone |

**"Away" does NOT mean unavailable.** It just means the agent is idle - waiting for the user or for a message. You can `mesh_send` to an "away" agent and they will receive it. Only "exited" agents are truly unreachable.

## What Gets Tracked

pi-mesh automatically tracks:
- File edits (which files you're modifying)
- Git commits (commit messages)
- Test runs (pass/fail)
- Session duration and tool usage

This feeds into auto-generated status messages visible to peers.

## Configuration

Config at `.pi/pi-mesh.json` (in bosun, generated from `config.toml` via `bosun init`; pi-mesh itself reads the JSON directly):

| Setting | Description | Default |
|---------|-------------|---------|
| autoRegister | Join mesh on startup | false (bosun sets true) |
| autoRegisterPaths | Only auto-register in these dirs | [] (all) |
| contextMode | How much context to inject | "full" |
| feedRetention | Max events in feed | 50 |
| stuckThreshold | Seconds idle before stuck | 900 |
| autoStatus | Auto-detect agent activity for status | true |

## Anti-Patterns

**Don't poll for results.** When you spawn agents and ask them to `mesh_send` results, messages arrive automatically via Pi's followUp delivery. Never do:
- `sleep` + `capture_pane` to check if an agent is done
- `bash("sleep 15 && ...")` loops waiting for messages
- Repeated `mesh_peers` to check if an agent has responded

Instead, tell the user you're waiting for reports and let the mesh messages arrive naturally.

**Don't use capture_pane for mesh-aware agents.** If the agent has mesh tools, ask it to `mesh_send` results. Only use `capture_pane` for non-mesh agents (e.g., Q) or debugging.

## Known Limitations

- `bash` tool can modify reserved files (e.g., `sed -i`). Only `edit`/`write` are blocked.
- PID checking may not work across container boundaries.
- Concurrent feed writes may produce partial JSON lines (auto-skipped on read).
