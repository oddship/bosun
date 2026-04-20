---
title: pi-gateway agent console
---

# pi-gateway agent console

This site demonstrates the `pi-agent` runtime mode.

What it is for:

- one site = one dedicated Pi agent tmux session
- browser messages dispatch directly into the session
- logs come from tmux capture
- status comes from tmux session presence

Current contract:

- `runtime.backend = "pi-agent"`
- `runtime.sessionName` sets the stable tmux session name
- `runtime.agentName` selects the Pi agent persona
- `runtime.prompt` seeds the initial session prompt
- `runtime.inputMode = "tmux"` sends browser messages into the session

Notes:

- this is an early adopter of the runtime contract
- structured agent replies are not yet parsed out of the terminal stream
- use the logs panel to inspect agent output live
