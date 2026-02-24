# Pi Configuration

Pi-specific configuration for skills.

## Skill Permissions

Control which skills agents can access in `settings.json`:

```json
{
  "permission": {
    "skill": {
      "pr-review": "allow",
      "internal-*": "deny",
      "experimental-*": "ask",
      "*": "allow"
    }
  }
}
```

### Permission Values

| Value | Behavior |
|-------|----------|
| `allow` | Skill loads immediately |
| `deny` | Skill hidden from agent |
| `ask` | User prompted before loading |

### Pattern Matching

Use `*` for wildcards:
- `internal-*` - matches `internal-tools`, `internal-docs`, etc.
- `*-experimental` - matches `auth-experimental`, `api-experimental`
- `*` - matches all skills (default rule)

## Per-Agent Overrides

Override permissions for specific agents:

```json
{
  "agent": {
    "plan": {
      "permission": {
        "skill": { 
          "internal-*": "allow",
          "dangerous-*": "deny"
        }
      }
    },
    "code": {
      "permission": {
        "skill": {
          "code-review": "allow"
        }
      }
    }
  }
}
```

## Disable Skill Tool

Completely disable the skill tool for an agent:

```yaml
# In agent frontmatter (.pi/agents/my-agent.md)
---
name: my-agent
tools:
  skill: false
---
```

Or in `settings.json`:

```json
{
  "agent": {
    "restricted": {
      "tools": {
        "skill": false
      }
    }
  }
}
```

## Skill Loading Order

Skills are loaded from multiple locations in this order:

1. Global config: `~/.pi/agent/skill/`
2. Project: `.pi/skills/`
3. Claude-compatible global: `~/.claude/skills/`
4. Claude-compatible project: `.claude/skills/`

Later skills with the same name override earlier ones.

## Example Configuration

### Restrictive Setup

Only allow specific skills:

```json
{
  "permission": {
    "skill": {
      "git": "allow",
      "git-commit": "allow",
      "code-review": "allow",
      "*": "deny"
    }
  }
}
```

### Development Setup

Allow most, deny dangerous:

```json
{
  "permission": {
    "skill": {
      "deploy-*": "ask",
      "delete-*": "deny",
      "*": "allow"
    }
  }
}
```

### Team Setup

Different permissions per agent:

```json
{
  "permission": {
    "skill": {
      "*": "allow"
    }
  },
  "agent": {
    "junior": {
      "permission": {
        "skill": {
          "deploy-*": "deny",
          "delete-*": "deny"
        }
      }
    },
    "senior": {
      "permission": {
        "skill": {
          "*": "allow"
        }
      }
    }
  }
}
```

## Debugging Skill Loading

If skills aren't loading:

1. **Check permissions**: Look for `deny` rules matching your skill
2. **Check agent overrides**: Agent-specific permissions take precedence
3. **Check skill location**: Must be in recognized directory
4. **Verify skill validity**: Use `skills-ref validate ./my-skill`
5. **Check logs**: Pi logs skill loading events

### List Available Skills

The skill tool shows available skills in its description. If a skill doesn't appear:

1. Verify it's in the correct location
2. Check it has valid frontmatter
3. Ensure no `deny` permission applies
4. Restart Pi to reload skills
