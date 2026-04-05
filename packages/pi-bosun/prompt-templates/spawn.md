---
description: Spawn an agent to handle a task described in natural language
skill: tmux-orchestration, mesh
---

Spawn an agent for the following request:

> $ARGUMENTS

Use `spawn_agent` to create the best agent for the job with a clear task description.

## Available Agents

{{AGENTS_TABLE}}

## Rules

1. Interpret the user's natural language request to determine which agent fits best and what the task is.
2. If the request is ambiguous about scope, default to `deckhand` for coding work or `lite` for information gathering.
3. When the agent has mesh tools, include `mesh_send` instructions in the task so it reports back concisely. Ask for substantive, batched updates only (blockers, decisions, completion) — never acknowledgment-only chatter.
4. Use `session: true` only if the user explicitly asks for a session or the work spans multiple repos.
5. If no request was provided, ask the user what they need done.
