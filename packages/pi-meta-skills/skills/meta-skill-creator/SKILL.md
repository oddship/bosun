---
name: meta-skill-creator
description: Create new agent skills following the Agent Skills specification. Use when building reusable skills with proper structure and frontmatter.
license: MIT
compatibility: pi
metadata:
  audience: developers
  category: meta
  spec-version: "1.0"
---

# Create Skill

Create agent skills following the [Agent Skills specification](https://agentskills.io/specification).

## What I Do

- Generate properly structured `SKILL.md` files
- Ensure valid YAML frontmatter and naming conventions
- Create skills with optional directories (scripts, references, assets)
- Guide progressive disclosure for efficient context usage

## Skill Structure

```
skill-name/
├── SKILL.md              # Required - main skill file (ALL CAPS!)
├── scripts/              # Optional - executable code
├── references/           # Optional - detailed docs (loaded on demand)
└── assets/               # Optional - static resources
```

**Locations:**
- Project: `.pi/skills/<name>/SKILL.md`
- Global: `~/.pi/agent/skills/<name>/SKILL.md`

## Quick Start

### Minimal Skill

```markdown
---
name: my-skill
description: Does X when user needs Y. Use when working with Z.
---

# My Skill

## What I Do

- Action 1
- Action 2

## When to Use Me

Use this skill when:
- Scenario 1
- Scenario 2

Do NOT use for:
- Anti-pattern 1

## Instructions

Step-by-step guidance here...
```

### Frontmatter (Required Fields)

```yaml
---
name: skill-name        # Must match directory name
description: ...        # What it does AND when to use it
---
```

**Name rules:**
- Lowercase, numbers, hyphens only
- 1-64 characters
- No leading/trailing/consecutive hyphens
- Must match directory name

## Progressive Disclosure

| Level | Content | Budget |
|-------|---------|--------|
| Metadata | name + description | ~100 tokens |
| Instructions | SKILL.md body | < 5000 tokens |
| Resources | references/, scripts/ | As needed |

**Key guidelines:**
1. Keep SKILL.md under 500 lines
2. Move detailed docs to `references/`
3. Keep reference chains shallow

## Process

1. Choose descriptive kebab-case name
2. Create directory: `.pi/skills/<name>/`
3. Create `SKILL.md` with frontmatter
4. Add references/ if needed for detailed content
5. Verify name in frontmatter matches directory

## Best Practices

1. **Specific descriptions**: Include keywords for agent selection
2. **Include anti-patterns**: When NOT to use the skill
3. **Concrete examples**: Show inputs and outputs
4. **Actionable instructions**: Use imperative language
5. **Focused scope**: One skill = one task domain
6. **Progressive disclosure**: Keep main file concise

## Detailed References

- [Specification](references/SPECIFICATION.md) - Full frontmatter spec, all fields, validation
- [Templates](references/TEMPLATES.md) - Complete templates and examples
- [Pi Config](references/PI-CONFIG.md) - Permissions, agent overrides
