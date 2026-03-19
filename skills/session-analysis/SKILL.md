---
name: session-analysis
description: |
  Analyze Pi session JSONL files using jq patterns. Use when extracting
  metrics, tool usage, costs, or reviewing session history. Load for
  session export, summarization, or workflow analysis.
---

# Session Analysis

Extract insights from Pi session files. Covers session discovery, jq patterns for metadata, tools, costs, and workflow analysis.

## Session Location

Pi stores sessions as JSONL files:
```
..bosun-home/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl
```

## Quick Reference

```bash
# List recent sessions (newest first)
ls -lt ..bosun-home/.pi/agent/sessions/*/*.jsonl | head -10

# Find sessions by date
find ..bosun-home/.pi/agent/sessions -name "2026-02-01*.jsonl"

# Search sessions for keyword
rg -l 'keyword' ..bosun-home/.pi/agent/sessions/

# Count messages in session
wc -l session.jsonl
```

## Session Structure

Each line is a JSON object with a `type` field:

| Type | Description |
|------|-------------|
| `session` | Session metadata (id, cwd, timestamp) |
| `model_change` | Model selection (provider, modelId) |
| `thinking_level_change` | Thinking level (low/medium/high) |
| `message` | User or assistant message |

### Message Structure
```json
{
  "type": "message",
  "id": "...",
  "parentId": "...",
  "timestamp": "...",
  "message": {
    "role": "user|assistant|toolResult",
    "content": [...],
    "usage": { "input": N, "output": N, "cost": {...} }
  }
}
```

## Essential jq Patterns

### Session Metadata
```bash
# Get session info
jq -s '.[0]' session.jsonl

# Get model used
jq -s '.[] | select(.type == "model_change") | {provider, modelId}' session.jsonl
```

### Messages
```bash
# Count messages by role
jq -s '[.[] | select(.type == "message") | .message.role] | group_by(.) | map({role: .[0], count: length})' session.jsonl

# Extract user prompts
jq -s '.[] | select(.type == "message" and .message.role == "user") | .message.content[].text' session.jsonl

# Extract assistant responses (text only)
jq -s '.[] | select(.type == "message" and .message.role == "assistant") | .message.content[] | select(.type == "text") | .text' session.jsonl
```

### Tool Usage
```bash
# List all tool calls
jq -s '[.[] | select(.type == "message" and .message.role == "assistant") | .message.content[] | select(.type == "toolCall") | .name] | group_by(.) | map({tool: .[0], count: length}) | sort_by(-.count)' session.jsonl

# Get tool call details
jq -s '.[] | select(.type == "message" and .message.role == "assistant") | .message.content[] | select(.type == "toolCall") | {name, arguments}' session.jsonl

# Files read
jq -s '[.[] | select(.type == "message") | .message.content[]? | select(.type == "toolCall" and .name == "read") | .arguments.path] | unique' session.jsonl

# Files written/edited
jq -s '[.[] | select(.type == "message") | .message.content[]? | select(.type == "toolCall" and (.name == "write" or .name == "edit")) | .arguments.path] | unique' session.jsonl
```

### Costs & Usage
```bash
# Total cost
jq -s '[.[] | select(.type == "message" and .message.usage.cost) | .message.usage.cost.total] | add' session.jsonl

# Token usage summary
jq -s '{
  input: [.[] | select(.message.usage) | .message.usage.input] | add,
  output: [.[] | select(.message.usage) | .message.usage.output] | add,
  cacheRead: [.[] | select(.message.usage) | .message.usage.cacheRead] | add,
  cacheWrite: [.[] | select(.message.usage) | .message.usage.cacheWrite] | add
}' session.jsonl

# Cost per turn
jq -s '.[] | select(.type == "message" and .message.role == "assistant" and .message.usage) | {turns: .message.usage.turns, cost: .message.usage.cost.total}' session.jsonl
```

### Subagent Results
```bash
# Find spawn_agent calls
jq -s '.[] | select(.type == "message") | .message.content[]? | select(.type == "toolCall" and .name == "spawn_agent")' session.jsonl

# Subagent artifacts directory
ls ..bosun-home/.pi/agent/sessions/*/spawn_agent-artifacts/
```

## Trimming for LLM Processing

Large sessions can be trimmed:

```bash
jq -s '[.[] | select(.type == "message") | {
  role: .message.role,
  time: .timestamp,
  content: [.message.content[] |
    if .type == "text" then {type: "text", text: .text[:500]}
    elif .type == "toolCall" then {type: "tool", name: .name}
    else empty
    end
  ]
}]' session.jsonl > trimmed.json
```

## When to Use

- Reviewing what happened in a session
- Extracting costs and usage metrics
- Finding files modified in a session
- Analyzing tool usage patterns
- Preparing session summaries for chronicles

## Subagent Session Files

Subagent runs create their own session files in:
```
..bosun-home/.pi/agent/sessions/*/spawn_agent-artifacts/<id>_<agent>.jsonl
```

Use the same jq patterns to analyze spawn_agent sessions.
